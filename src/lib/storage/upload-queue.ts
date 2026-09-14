import type { PersistedChunk, TrackKind } from "../audio/types";
import { buildWavHeader } from "../audio/wav-header";
import * as api from "../api-client";
import {
  deleteChunks,
  getUnflushedChunks,
  loadSession,
  putChunk,
  saveSession,
  type StoredSession,
  type TrackUploadState,
} from "./idb";

/**
 * S3 requires every part except the LAST one (by PartNumber) to be >= 5MB.
 * A 5-second raw PCM chunk (~470KB at 48kHz/16bit/mono) is far too small to be
 * its own part, so we accumulate chunks in IndexedDB and only flush to S3 once
 * the accumulated size crosses this threshold. The final flush (on
 * stop/finalize) is exempt and may be smaller.
 */
const PART_FLUSH_THRESHOLD_BYTES = 6 * 1024 * 1024;

/**
 * Raw WAV's 44-byte header must be the very first bytes of the object, but we
 * don't know the final sample count (and therefore the final byte count)
 * until the recording stops. Per S3's minimum-part-size rule (see above), we
 * can't upload it as its own tiny Part 1. Instead we prepend it to the FIRST
 * accumulated >=5MB PCM part, using the streaming-WAV convention (size
 * fields = 0xFFFFFFFF) documented in wav-header.ts. This keeps the header
 * correctly positioned while satisfying S3's size rule.
 */

type ProgressListener = (info: {
  track: TrackKind;
  bufferedBytes: number;
  uploadedBytes: number;
  online: boolean;
}) => void;

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }
  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// Shared across raw+mixed (and across concurrent sessions in theory) per spec
// section 6: "آپلود موازی حداکثر ۲ تایی".
const uploadSemaphore = new Semaphore(2);

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return out.buffer;
}

async function putWithRetry(url: string, body: BodyInit, onAttemptFail?: (err: unknown) => void) {
  let attempt = 0;
  // Exponential backoff, capped, per spec section 6 ("backoff نمایی").
  for (;;) {
    try {
      const res = await fetch(url, { method: "PUT", body });
      if (!res.ok) throw new Error(`PUT ${url} -> ${res.status}`);
      const etag = res.headers.get("ETag");
      if (!etag) throw new Error("S3 PUT response missing ETag header");
      return etag;
    } catch (err) {
      onAttemptFail?.(err);
      attempt++;
      const delayMs = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delayMs));
      // Loop forever - the caller decides when to give up (it never does
      // mid-session; it just waits for connectivity, per acceptance
      // criterion 4: "قطع اینترنت نباید حتی یک ثانیه صدا را از بین ببرد").
    }
  }
}

export class UploadQueue {
  private listeners: ProgressListener[] = [];
  private flushing: Record<TrackKind, boolean> = { raw: false, mixed: false };
  private online = typeof navigator === "undefined" ? true : navigator.onLine;

  constructor(private sessionId: string) {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  dispose() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
  }

  onProgress(cb: ProgressListener) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private handleOnline = () => {
    this.online = true;
    void this.flush("raw");
    void this.flush("mixed");
  };
  private handleOffline = () => {
    this.online = false;
  };

  /** Persist a chunk to IndexedDB immediately (before any upload attempt is
   * made), then opportunistically try to flush. Never throws on network
   * failure - the chunk is already durable on disk. */
  async enqueue(chunk: PersistedChunk) {
    await putChunk(chunk);
    void this.flush(chunk.track);
  }

  /** Called once when recording stops: flush whatever remains, even if under
   * the 5MB threshold (allowed - it's the final part), then complete the
   * multipart upload with the server. */
  async finalize(totalSamples: number, markers: import("../audio/types").SotiMarker[]) {
    await this.flush("raw", { force: true });
    await this.flush("mixed", { force: true });

    const session = await loadSession(this.sessionId);
    if (!session) throw new Error("finalize() called with no session recorded locally");
    session.totalSamples = totalSamples;
    session.markers = markers;
    session.status = "uploading";
    await saveSession(session);

    if (!session.raw.uploadId || !session.mixed.uploadId) {
      throw new Error("Missing multipart uploadId - createSession() was never called");
    }

    const result = await api.completeSession({
      sessionId: this.sessionId,
      totalSamples,
      markers,
      raw: { uploadId: session.raw.uploadId, parts: session.raw.completedParts },
      mixed: { uploadId: session.mixed.uploadId, parts: session.mixed.completedParts },
    });

    session.status = "complete";
    await saveSession(session);
    return result;
  }

  /** Attempts to flush accumulated, not-yet-uploaded bytes for one track. */
  async flush(track: TrackKind, opts: { force?: boolean } = {}) {
    if (this.flushing[track]) return; // one flush loop per track at a time
    this.flushing[track] = true;
    try {
      for (;;) {
        if (!this.online) return;
        const session = await loadSession(this.sessionId);
        if (!session) return;
        const state = session[track];
        if (!state.uploadId || !state.key || state.finalized) return;

        const chunks = await getUnflushedChunks(this.sessionId, track);
        if (chunks.length === 0) return;

        const totalBytes = chunks.reduce((s, c) => s + c.data.byteLength, 0);
        const isLastAvailableBatch = opts.force ?? false;
        if (!isLastAvailableBatch && totalBytes < PART_FLUSH_THRESHOLD_BYTES) return;

        await this.flushBatch(session, track, chunks, state);
        this.emitProgress(track);

        if (!opts.force) continue; // keep draining until under threshold
        // in force mode we already drained everything above via the loop
        // condition (chunks.length === 0 return), so just exit after one pass
        return;
      }
    } finally {
      this.flushing[track] = false;
    }
  }

  private async flushBatch(
    session: StoredSession,
    track: TrackKind,
    chunks: PersistedChunk[],
    state: TrackUploadState
  ) {
    const buffers = chunks.map((c) => c.data);
    let payload = concatBuffers(buffers);

    if (track === "raw" && !state.headerEmbedded) {
      const header = buildWavHeader({
        sampleRate: session.sampleRate,
        numChannels: 1,
        bitsPerSample: 16,
        totalDataBytes: null, // unknown until finalize(); streaming convention
      });
      payload = concatBuffers([header, payload]);
      state.headerEmbedded = true;
    }

    const partNumber = state.nextPartNumber++;
    const release = await uploadSemaphore.acquire();
    let etag: string;
    try {
      const { url } = await api.getPartUploadUrl({
        sessionId: this.sessionId,
        track,
        partNumber,
      });
      etag = await putWithRetry(url, payload);
    } finally {
      release();
    }

    state.completedParts.push({ PartNumber: partNumber, ETag: etag });
    session[track] = state;
    await saveSession(session);
    await deleteChunks(chunks.map((c) => c.id));
  }

  private emitProgress(track: TrackKind) {
    for (const l of this.listeners) {
      l({ track, bufferedBytes: 0, uploadedBytes: 0, online: this.online });
    }
  }
}

/** Called on app load / episode-page mount: find any session left in a
 * non-terminal state (tab closed mid-recording, crash, etc.) and resume
 * draining its IndexedDB backlog. Spec section 10 acceptance criterion 5. */
export async function recoverSession(sessionId: string): Promise<UploadQueue | null> {
  const session = await loadSession(sessionId);
  if (!session || session.status === "complete") return null;
  const queue = new UploadQueue(sessionId);
  await queue.flush("raw");
  await queue.flush("mixed");
  return queue;
}
