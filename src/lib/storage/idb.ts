import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PersistedChunk, SotiMarker, TrackKind } from "../audio/types";

export interface StoredSession {
  id: string;
  episodeId: string;
  takeNumber: number;
  sampleRate: number;
  status: "recording" | "paused" | "finalizing" | "uploading" | "complete" | "failed";
  createdAt: number;
  totalSamples: number;
  markers: SotiMarker[];
  // Multipart bookkeeping - lets us resume mid-upload after a reload/crash
  // (spec section 6/10: "Recovery: در ورود بعدی، هر session با قطعهٔ
  // آپلودنشده تشخیص داده و ادامه یابد").
  raw: TrackUploadState;
  mixed: TrackUploadState;
}

export interface TrackUploadState {
  uploadId: string | null;
  key: string | null;
  nextPartNumber: number;
  completedParts: { PartNumber: number; ETag: string }[];
  headerEmbedded: boolean; // raw-only; irrelevant (stays false) for mixed
  finalized: boolean;
}

function freshTrackState(): TrackUploadState {
  return {
    uploadId: null,
    key: null,
    nextPartNumber: 1,
    completedParts: [],
    headerEmbedded: false,
    finalized: false,
  };
}

export function freshSession(params: {
  id: string;
  episodeId: string;
  takeNumber: number;
  sampleRate: number;
}): StoredSession {
  return {
    ...params,
    status: "recording",
    createdAt: Date.now(),
    totalSamples: 0,
    markers: [],
    raw: freshTrackState(),
    mixed: freshTrackState(),
  };
}

interface StudioDB extends DBSchema {
  chunks: {
    key: string;
    value: PersistedChunk;
    indexes: { "by-session-track": [string, TrackKind] };
  };
  sessions: {
    key: string;
    value: StoredSession;
  };
}

let dbPromise: Promise<IDBPDatabase<StudioDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<StudioDB>("narration-studio", 1, {
      upgrade(db) {
        const chunkStore = db.createObjectStore("chunks", { keyPath: "id" });
        chunkStore.createIndex("by-session-track", ["sessionId", "track"]);
        db.createObjectStore("sessions", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function putChunk(chunk: PersistedChunk) {
  const db = await getDb();
  await db.put("chunks", chunk);
}

export async function getUnflushedChunks(sessionId: string, track: TrackKind) {
  const db = await getDb();
  const all = await db.getAllFromIndex("chunks", "by-session-track", [sessionId, track]);
  return all.sort((a, b) => a.seq - b.seq);
}

export async function deleteChunks(ids: string[]) {
  const db = await getDb();
  const tx = db.transaction("chunks", "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function saveSession(session: StoredSession) {
  const db = await getDb();
  await db.put("sessions", session);
}

export async function loadSession(id: string) {
  const db = await getDb();
  return db.get("sessions", id);
}

export async function listRecoverableSessions() {
  const db = await getDb();
  const all = await db.getAll("sessions");
  return all.filter((s) => s.status !== "complete");
}

export async function deleteSession(id: string) {
  const db = await getDb();
  await db.delete("sessions", id);
}

/** navigator.storage.estimate() + persist(), per spec section 6. Returns
 * approximate minutes of headroom assuming worst case (raw+mixed uncompressed
 * estimate ~ 6.5 MB/min combined). */
export async function checkStorageHeadroomMinutes(): Promise<number | null> {
  if (!("storage" in navigator) || !navigator.storage.estimate) return null;
  try {
    await navigator.storage.persist?.();
    const { quota, usage } = await navigator.storage.estimate();
    if (quota == null || usage == null) return null;
    const freeBytes = quota - usage;
    const bytesPerMinute = 6.5 * 1024 * 1024;
    return freeBytes / bytesPerMinute;
  } catch {
    return null;
  }
}
