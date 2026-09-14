export type TrackKind = "raw" | "mixed";

/** A 5-second-ish slice of encoded audio, written to IndexedDB before any
 * upload attempt is made (spec section 6: "نوشتن در IndexedDB قبل از هر تلاش
 * آپلود"). Deleted only after the server confirms receipt. */
export interface PersistedChunk {
  /** `${sessionId}:${track}:${seq}` */
  id: string;
  sessionId: string;
  track: TrackKind;
  seq: number;
  sampleStart: number;
  sampleCount: number;
  data: ArrayBuffer;
  createdAt: number;
}

export interface SotiMarker {
  index: number;
  sampleOffset: number;
  seconds: number;
  createdAt: string;
}

export interface RecordingSessionMeta {
  id: string;
  episodeId: string;
  takeNumber: number;
  sampleRate: 48000;
  startedAtSampleCount: number;
}

export type ConnectionState = "online" | "offline";

export interface LevelReading {
  rms: number;
  peak: number;
  clipping: boolean;
}
