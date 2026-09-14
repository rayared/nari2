// Taps a node (the raw mic path, pre-processing) and forwards Float32 frames
// to the main thread in ~100ms blocks for handoff to the WAV-encoding Web Worker.
// This node does NOT modify the signal - it is a pure tap, per spec section 5:
// "مسیر Raw هرگز از این زنجیره عبور نمی‌کند" (the raw path never passes through
// the processing chain).
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 20ms blocks: keeps the main thread's running sample-cursor (used for
    // soti-marker offsets, acceptance criterion 6: error < 100ms) tight,
    // while still being a cheap postMessage rate (~50/sec).
    this._blockFrames = Math.floor(sampleRate * 0.02);
    this._buffer = new Float32Array(this._blockFrames);
    this._writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._writeIndex++] = channel[i];
      if (this._writeIndex >= this._blockFrames) {
        // Transfer ownership of the underlying buffer to avoid copies/GC churn.
        this.port.postMessage({ samples: this._buffer }, [this._buffer.buffer]);
        this._buffer = new Float32Array(this._blockFrames);
        this._writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
