import { create } from "zustand";
import { AudioEngine, type MusicOrSfx } from "../audio/engine";
import type { LevelReading, SotiMarker } from "../audio/types";
import { UploadQueue, recoverSession } from "../storage/upload-queue";
import { checkStorageHeadroomMinutes, freshSession, saveSession } from "../storage/idb";
import * as api from "../api-client";

export type RecordingPhase =
  | "idle"
  | "initializing"
  | "calibrating"
  | "ready"
  | "recording"
  | "paused"
  | "finalizing"
  | "done"
  | "error";

interface RecordingState {
  phase: RecordingPhase;
  errorMessage: string | null;
  level: LevelReading;
  elapsedSeconds: number;
  markers: SotiMarker[];
  online: boolean;
  bufferedMinutesHeadroom: number | null;
  gateThresholdDb: number | null;
  activeMusicSlots: Set<number>;
  echoActive: boolean;

  init: (deviceId?: string) => Promise<void>;
  calibrate: () => Promise<void>;
  loadSound: (category: MusicOrSfx, slot: number, arrayBuffer: ArrayBuffer) => Promise<void>;
  startRecording: (episodeId: string, takeNumber: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<{ rawUrl: string; mixedUrl: string } | null>;
  markSoti: () => void;
  toggleMusic: (slot: number, gainDb?: number, loop?: boolean) => void;
  playSfx: (slot: number, gainDb?: number) => void;
  echoDown: () => void;
  echoUp: () => void;
  recoverPendingSession: (sessionId: string) => Promise<void>;
}

let engine: AudioEngine | null = null;
let wavWorker: Worker | null = null;
let uploadQueue: UploadQueue | null = null;
let mediaRecorder: MediaRecorder | null = null;
let currentSessionId: string | null = null;
let rawSampleCursor = 0;
let mixedSeq = 0;
let timerHandle: ReturnType<typeof setInterval> | null = null;
let headroomHandle: ReturnType<typeof setInterval> | null = null;

const RAW_SAMPLE_RATE = 48000;

export const useRecordingStore = create<RecordingState>((set, get) => ({
  phase: "idle",
  errorMessage: null,
  level: { rms: 0, peak: 0, clipping: false },
  elapsedSeconds: 0,
  markers: [],
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  bufferedMinutesHeadroom: null,
  gateThresholdDb: null,
  activeMusicSlots: new Set(),
  echoActive: false,

  async init(deviceId) {
    set({ phase: "initializing", errorMessage: null });
    try {
      engine = new AudioEngine({
        onLevel: (level) => set({ level }),
        onRawFrames: (samples) => {
          rawSampleCursor += samples.length;
          wavWorker?.postMessage({ type: "frames", samples }, [samples.buffer]);
        },
      });
      await engine.init(deviceId);
      set({ phase: "ready" });
    } catch (err) {
      set({ phase: "error", errorMessage: (err as Error).message });
      throw err;
    }
  },

  async calibrate() {
    if (!engine) throw new Error("call init() first");
    set({ phase: "calibrating" });
    const thresholdDb = await engine.calibrateNoiseFloor();
    set({ gateThresholdDb: thresholdDb, phase: "ready" });
  },

  async loadSound(category, slot, arrayBuffer) {
    await engine?.loadSound(category, slot, arrayBuffer);
  },

  async startRecording(episodeId, takeNumber) {
    if (!engine) throw new Error("call init() first");

    const headroomMinutes = await checkStorageHeadroomMinutes();
    if (headroomMinutes !== null && headroomMinutes < 15) {
      set({
        phase: "error",
        errorMessage: `فضای ذخیره‌سازی کافی نیست (کمتر از ۱۵ دقیقه). لطفاً فضای دستگاه را آزاد کنید.`,
      });
      return;
    }

    const { sessionId, raw, mixed } = await api.createSession({
      episodeId,
      takeNumber,
      sampleRate: RAW_SAMPLE_RATE,
    });
    currentSessionId = sessionId;
    rawSampleCursor = 0;
    mixedSeq = 0;

    const session = freshSession({
      id: sessionId,
      episodeId,
      takeNumber,
      sampleRate: RAW_SAMPLE_RATE,
    });
    session.raw.uploadId = raw.uploadId;
    session.raw.key = raw.key;
    session.mixed.uploadId = mixed.uploadId;
    session.mixed.key = mixed.key;
    await saveSession(session);

    uploadQueue = new UploadQueue(sessionId);
    uploadQueue.onProgress(({ online }) => set({ online }));

    wavWorker = new Worker(new URL("../audio/wav-encoder.worker.ts", import.meta.url), {
      type: "module",
    });
    wavWorker.postMessage({ type: "init", sessionId, sampleRate: RAW_SAMPLE_RATE });
    wavWorker.onmessage = (
      e: MessageEvent<{
        type: "chunk";
        seq: number;
        sampleStart: number;
        sampleCount: number;
        data: ArrayBuffer;
      }>
    ) => {
      const msg = e.data;
      if (msg.type !== "chunk") return;
      void uploadQueue!.enqueue({
        id: `${sessionId}:raw:${msg.seq}`,
        sessionId,
        track: "raw",
        seq: msg.seq,
        sampleStart: msg.sampleStart,
        sampleCount: msg.sampleCount,
        data: msg.data,
        createdAt: Date.now(),
      });
    };

    const stream = engine.mixedDestination!.stream;
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 128_000,
    });
    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size === 0) return;
      const seq = mixedSeq++;
      void e.data.arrayBuffer().then((data) => {
        void uploadQueue!.enqueue({
          id: `${sessionId}:mixed:${seq}`,
          sessionId,
          track: "mixed",
          seq,
          sampleStart: 0,
          sampleCount: 0,
          data,
          createdAt: Date.now(),
        });
      });
    };
    mediaRecorder.start(5000); // 5s timeslice per spec section 6

    set({ phase: "recording", elapsedSeconds: 0, markers: [] });

    timerHandle = setInterval(() => {
      if (get().phase === "recording") set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 }));
    }, 1000);
    headroomHandle = setInterval(async () => {
      const minutes = await checkStorageHeadroomMinutes();
      set({ bufferedMinutesHeadroom: minutes });
    }, 15_000);
  },

  async pause() {
    if (!engine || !mediaRecorder) return;
    await engine.suspend();
    if (mediaRecorder.state === "recording") mediaRecorder.pause();
    set({ phase: "paused" });
  },

  async resume() {
    if (!engine || !mediaRecorder) return;
    await engine.resume();
    if (mediaRecorder.state === "paused") mediaRecorder.resume();
    set({ phase: "recording" });
  },

  markSoti() {
    const seconds = rawSampleCursor / RAW_SAMPLE_RATE;
    const marker: SotiMarker = {
      index: get().markers.length,
      sampleOffset: rawSampleCursor,
      seconds,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ markers: [...s.markers, marker] }));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(40);
  },

  toggleMusic(slot, gainDb, loop) {
    const active = get().activeMusicSlots;
    if (active.has(slot)) {
      engine?.stopMusic(slot);
      active.delete(slot);
    } else {
      engine?.playMusic(slot, gainDb, loop);
      active.add(slot);
    }
    set({ activeMusicSlots: new Set(active) });
  },

  playSfx(slot, gainDb) {
    engine?.playSfx(slot, gainDb);
  },

  echoDown() {
    engine?.echoDown();
    set({ echoActive: true });
  },
  echoUp() {
    engine?.echoUp();
    set({ echoActive: false });
  },

  async stop() {
    if (!engine || !mediaRecorder || !uploadQueue || !currentSessionId) return null;
    set({ phase: "finalizing" });

    if (timerHandle) clearInterval(timerHandle);
    if (headroomHandle) clearInterval(headroomHandle);

    wavWorker?.postMessage({ type: "flush" });
    // Give the worker's final chunk message a moment to arrive & get enqueued.
    await new Promise((r) => setTimeout(r, 250));

    await new Promise<void>((resolve) => {
      if (mediaRecorder!.state === "inactive") return resolve();
      mediaRecorder!.onstop = () => resolve();
      mediaRecorder!.stop();
    });

    const totalSamples = rawSampleCursor;
    const markers = get().markers;
    const result = await uploadQueue.finalize(totalSamples, markers);

    wavWorker?.terminate();
    wavWorker = null;
    uploadQueue.dispose();
    uploadQueue = null;
    currentSessionId = null;

    set({ phase: "done" });
    return result;
  },

  async recoverPendingSession(sessionId: string) {
    const recovered = await recoverSession(sessionId);
    if (recovered) uploadQueue = recovered;
  },
}));
