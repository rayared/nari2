// Simple noise gate. Threshold is set post-calibration (2s of measured silence + margin).
// Smooth envelope follower avoids the clicking that a hard on/off gate produces.
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "thresholdDb", defaultValue: -50, minValue: -90, maxValue: 0 },
      { name: "attack", defaultValue: 0.005, minValue: 0.001, maxValue: 0.2 },
      { name: "release", defaultValue: 0.15, minValue: 0.01, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this._envelope = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const thresholdDb = parameters.thresholdDb[0];
    const thresholdLin = Math.pow(10, thresholdDb / 20);
    const attackCoef = Math.exp(-1 / (sampleRate * parameters.attack[0]));
    const releaseCoef = Math.exp(-1 / (sampleRate * parameters.release[0]));

    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      for (let i = 0; i < inCh.length; i++) {
        const rectified = Math.abs(inCh[i]);
        const targetGate = rectified > thresholdLin ? 1 : 0;
        const coef = targetGate > this._envelope ? attackCoef : releaseCoef;
        this._envelope = targetGate + coef * (this._envelope - targetGate);
        outCh[i] = inCh[i] * this._envelope;
      }
    }
    return true;
  }
}

registerProcessor("gate-processor", GateProcessor);
