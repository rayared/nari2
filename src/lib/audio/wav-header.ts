/**
 * Builds a 44-byte canonical PCM WAV header.
 *
 * When `totalDataBytes` is null we don't yet know the final size (recording is
 * still in progress and we must upload the header as part of the very first
 * S3 multipart part - see upload-queue.ts for why). In that case we use the
 * "streaming WAV" convention: RIFF size and data size fields are set to
 * 0xFFFFFFFF. ffmpeg, Audacity, VLC and every major DAW read this correctly by
 * falling back to "read until EOF" when they see that sentinel. A minority of
 * strict parsers may reject it - documented as a known MVP limitation
 * (section 14 excludes server-side re-render, which is the "real" fix).
 */
export function buildWavHeader(params: {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  totalDataBytes: number | null;
}): ArrayBuffer {
  const { sampleRate, numChannels, bitsPerSample, totalDataBytes } = params;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const UNKNOWN = 0xffffffff;
  const dataSize = totalDataBytes ?? UNKNOWN;
  const riffSize = totalDataBytes !== null ? 36 + totalDataBytes : UNKNOWN;

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  let offset = 0;

  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const writeU32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const writeU16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };

  writeStr("RIFF");
  writeU32(riffSize >>> 0);
  writeStr("WAVE");
  writeStr("fmt ");
  writeU32(16); // fmt chunk size (PCM)
  writeU16(1); // PCM format
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(bitsPerSample);
  writeStr("data");
  writeU32(dataSize >>> 0);

  return buffer;
}

export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = input[i] ?? 0;
    const s = Math.max(-1, Math.min(1, sample));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
