/// <reference lib="webworker" />
import { float32ToInt16 } from "./wav-header";

// Runs off the main thread per spec section 13 ("هیچ عملیات صوتی/انکودی در
// ترد اصلی"). Receives raw Float32 frames captured by pcm-capture-processor,
// converts to 16-bit PCM, and emits ~5-second chunks tagged with a sequence
// number and exact sample offset (needed later for soti-marker alignment,
// section 10 acceptance criterion 6).

interface InitMsg {
  type: "init";
  sessionId: string;
  sampleRate: number;
}
interface FramesMsg {
  type: "frames";
  samples: Float32Array;
}
interface FlushMsg {
  type: "flush";
}
type InMsg = InitMsg | FramesMsg | FlushMsg;

let sessionId = "";
let sampleRate = 48000;
const CHUNK_SECONDS = 5;
let chunkTargetFrames = sampleRate * CHUNK_SECONDS;

let pending: Int16Array[] = [];
let pendingFrameCount = 0;
let seq = 0;
let sampleCursor = 0; // total samples emitted so far (for sampleStart bookkeeping)

function emitChunk(isFinal: boolean) {
  if (pendingFrameCount === 0) return;

  const merged = new Int16Array(pendingFrameCount);
  let off = 0;
  for (const part of pending) {
    merged.set(part, off);
    off += part.length;
  }

  const sampleStart = sampleCursor;
  sampleCursor += pendingFrameCount;

  (self as unknown as Worker).postMessage(
    {
      type: "chunk",
      sessionId,
      seq: seq++,
      sampleStart,
      sampleCount: pendingFrameCount,
      data: merged.buffer,
      isFinal,
    },
    [merged.buffer]
  );

  pending = [];
  pendingFrameCount = 0;
}

self.addEventListener("message", (event: MessageEvent<InMsg>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      sessionId = msg.sessionId;
      sampleRate = msg.sampleRate;
      chunkTargetFrames = sampleRate * CHUNK_SECONDS;
      pending = [];
      pendingFrameCount = 0;
      seq = 0;
      sampleCursor = 0;
      break;
    }
    case "frames": {
      const int16 = float32ToInt16(msg.samples);
      pending.push(int16);
      pendingFrameCount += int16.length;
      if (pendingFrameCount >= chunkTargetFrames) {
        emitChunk(false);
      }
      break;
    }
    case "flush": {
      emitChunk(true);
      break;
    }
  }
});
