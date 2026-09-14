// Reports Peak + RMS of the raw mic signal to the main thread ~20x/sec.
// Target per spec: level meter aims for -18 dBFS RMS, warns on clipping (peak >= -0.5 dBFS).
class VuMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._samplesSinceReport = 0;
    this._reportEveryNSamples = Math.floor(sampleRate * 0.05); // ~50ms
    this._sumSquares = 0;
    this._peak = 0;
    this._count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const s = channel[i];
        this._sumSquares += s * s;
        const abs = Math.abs(s);
        if (abs > this._peak) this._peak = abs;
        this._count++;
      }
      this._samplesSinceReport += channel.length;
    }

    if (this._samplesSinceReport >= this._reportEveryNSamples && this._count > 0) {
      const rms = Math.sqrt(this._sumSquares / this._count);
      this.port.postMessage({ rms, peak: this._peak });
      this._sumSquares = 0;
      this._peak = 0;
      this._count = 0;
      this._samplesSinceReport = 0;
    }

    return true;
  }
}

registerProcessor("vu-meter-processor", VuMeterProcessor);
