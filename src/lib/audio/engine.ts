import type { LevelReading } from "./types";

const DB = (db: number) => Math.pow(10, db / 20);

export interface SoundSlotDef {
  slot: number; // 1..5
  buffer: AudioBuffer;
  gainDb: number;
  loop: boolean;
}

export type MusicOrSfx = "music" | "sfx";

interface EngineCallbacks {
  onLevel?: (level: LevelReading) => void;
  onRawFrames?: (samples: Float32Array) => void;
  /** Fires once, right after `start()`, if the raw sample cursor should reset. */
  onRawCursorReset?: () => void;
}

/**
 * Owns the entire Web Audio graph described in spec section 5/2:
 *
 *   Mic -> [Raw tap: unprocessed] -> pcm-capture-processor -> (caller encodes to WAV)
 *        -> HPF -> Gate -> Compressor -> mixBus
 *   Music x5 (gain, loop, fades) -> duckGain -> mixBus
 *   SFX x5 (one-shot) -> mixBus
 *   EchoSend (hold-to-activate delay) -> mixBus
 *   mixBus -> masterGain -> Limiter -> mixedDestination (MediaRecorder taps this)
 *
 * The raw path NEVER touches HPF/Gate/Compressor/Limiter - verified by the
 * graph topology below, not by a runtime flag.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  private highpass: BiquadFilterNode | null = null;
  private gateNode: AudioWorkletNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private makeupGain: GainNode | null = null;

  private mixBus: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  mixedDestination: MediaStreamAudioDestinationNode | null = null;

  private musicGains = new Map<number, GainNode>();
  private musicSources = new Map<number, AudioBufferSourceNode>();
  private duckGain: GainNode | null = null;

  private sfxGains = new Map<number, GainNode>();

  private echoDelay: DelayNode | null = null;
  private echoFeedback: GainNode | null = null;
  private echoLpf: BiquadFilterNode | null = null;
  private echoWet: GainNode | null = null;

  private vuMeter: AudioWorkletNode | null = null;
  private pcmCapture: AudioWorkletNode | null = null;

  private sounds = new Map<string, AudioBuffer>(); // key: `${category}:${slot}`
  private ducked = false;

  constructor(private callbacks: EngineCallbacks = {}) {}

  get audioContext() {
    return this.ctx;
  }

  async init(deviceId?: string) {
    const ctx = new AudioContext({ sampleRate: 48000 });
    this.ctx = ctx;

    await ctx.audioWorklet.addModule("/workers/vu-meter-processor.js");
    await ctx.audioWorklet.addModule("/workers/gate-processor.js");
    await ctx.audioWorklet.addModule("/workers/pcm-capture-processor.js");

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false, // would degrade narration quality
        noiseSuppression: false,
        autoGainControl: false, // our own compressor handles this
      },
    });
    this.micSource = ctx.createMediaStreamSource(this.micStream);

    // --- Raw tap: straight off the mic source, zero processing ---
    this.pcmCapture = new AudioWorkletNode(ctx, "pcm-capture-processor");
    this.pcmCapture.port.onmessage = (e: MessageEvent<{ samples: Float32Array }>) => {
      this.callbacks.onRawFrames?.(e.data.samples);
    };
    this.micSource.connect(this.pcmCapture);

    this.vuMeter = new AudioWorkletNode(ctx, "vu-meter-processor");
    this.vuMeter.port.onmessage = (e: MessageEvent<{ rms: number; peak: number }>) => {
      const { rms, peak } = e.data;
      this.callbacks.onLevel?.({ rms, peak, clipping: peak >= DB(-0.5) });
    };
    this.micSource.connect(this.vuMeter);

    // --- Speaker processing chain (mixed path only) ---
    this.highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 80 });
    this.gateNode = new AudioWorkletNode(ctx, "gate-processor");
    this.compressor = new DynamicsCompressorNode(ctx, {
      ratio: 3,
      attack: 0.01,
      release: 0.12,
      knee: 6,
      threshold: -24,
    });
    this.makeupGain = new GainNode(ctx, { gain: DB(3) });

    this.micSource.connect(this.highpass);
    this.highpass.connect(this.gateNode);
    this.gateNode.connect(this.compressor);
    this.compressor.connect(this.makeupGain);

    // --- Mix bus / master / limiter ---
    this.mixBus = new GainNode(ctx, { gain: 1 });
    this.masterGain = new GainNode(ctx, { gain: 1 });
    this.limiter = new DynamicsCompressorNode(ctx, {
      threshold: -1,
      ratio: 20,
      attack: 0.001,
      release: 0.05,
      knee: 0,
    });
    this.mixedDestination = ctx.createMediaStreamDestination();

    this.makeupGain.connect(this.mixBus);
    this.mixBus.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.mixedDestination);

    // --- Music bus with ducking ---
    this.duckGain = new GainNode(ctx, { gain: 1 });
    this.duckGain.connect(this.mixBus);

    // Simple VAD: reuse the vu-meter's RMS stream to drive ducking envelope.
    this.vuMeter.port.addEventListener("message", ((e: Event) => {
      const { rms } = (e as MessageEvent<{ rms: number }>).data;
      this.applyDucking(rms);
    }) as EventListener);

    // --- Echo send (tapped post-compressor, i.e. on the processed voice) ---
    this.echoDelay = new DelayNode(ctx, { delayTime: 0.25, maxDelayTime: 1 });
    this.echoFeedback = new GainNode(ctx, { gain: 0.4 });
    this.echoLpf = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 4000 });
    this.echoWet = new GainNode(ctx, { gain: 0 }); // starts silent; ramped on hold

    this.makeupGain.connect(this.echoDelay);
    this.echoDelay.connect(this.echoLpf);
    this.echoLpf.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay); // feedback loop
    this.echoLpf.connect(this.echoWet);
    this.echoWet.connect(this.mixBus);
  }

  // -------------------------------------------------------------------
  // Calibration / gate
  // -------------------------------------------------------------------

  /** Measures 2s of (expected-silent) RMS and sets the gate threshold a few
   * dB above it, per spec section 5 ("آستانه از کالیبراسیون ۲ ثانیه سکوت"). */
  async calibrateNoiseFloor(): Promise<number> {
    if (!this.vuMeter || !this.gateNode) throw new Error("engine not initialized");
    const samples: number[] = [];
    const handler = (e: Event) => samples.push((e as MessageEvent<{ rms: number }>).data.rms);
    this.vuMeter.port.addEventListener("message", handler as EventListener);
    await new Promise((r) => setTimeout(r, 2000));
    this.vuMeter.port.removeEventListener("message", handler as EventListener);

    const avgRms = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0.001;
    const floorDb = 20 * Math.log10(Math.max(avgRms, 1e-6));
    const thresholdDb = Math.min(-30, floorDb + 8); // 8dB margin above measured floor
    this.setGateThreshold(thresholdDb);
    return thresholdDb;
  }

  setGateThreshold(db: number) {
    const param = this.gateNode?.parameters.get("thresholdDb");
    param?.setValueAtTime(db, this.ctx!.currentTime);
  }

  // -------------------------------------------------------------------
  // Ducking (auto, VAD-driven)
  // -------------------------------------------------------------------

  private applyDucking(rms: number) {
    if (!this.duckGain || !this.ctx) return;
    const speaking = rms > 0.02; // ~ -34dBFS heuristic gate for VAD purposes only
    if (speaking === this.ducked) return;
    this.ducked = speaking;
    const target = speaking ? DB(-9) : 1;
    const timeConstant = speaking ? 0.08 / 3 : 0.4 / 3; // attack 80ms / release 400ms
    this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, timeConstant);
  }

  // -------------------------------------------------------------------
  // Sound library (music/sfx)
  // -------------------------------------------------------------------

  async loadSound(category: MusicOrSfx, slot: number, arrayBuffer: ArrayBuffer) {
    if (!this.ctx) throw new Error("engine not initialized");
    const buffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    this.sounds.set(`${category}:${slot}`, buffer);
  }

  playMusic(slot: number, gainDb = -22, loop = false) {
    if (!this.ctx || !this.duckGain) return;
    const buffer = this.sounds.get(`music:${slot}`);
    if (!buffer) return;

    this.stopMusic(slot, 0.05);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = new GainNode(this.ctx, { gain: 0 });
    source.connect(gain);
    gain.connect(this.duckGain);
    source.start();

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(DB(gainDb), now + 0.15); // click-free fade in

    this.musicSources.set(slot, source);
    this.musicGains.set(slot, gain);
  }

  stopMusic(slot: number, fadeSeconds = 0.2) {
    const source = this.musicSources.get(slot);
    const gain = this.musicGains.get(slot);
    if (!source || !gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeSeconds); // no click on stop
    source.stop(now + fadeSeconds + 0.02);
    this.musicSources.delete(slot);
    this.musicGains.delete(slot);
  }

  playSfx(slot: number, gainDb = -12) {
    if (!this.ctx || !this.mixBus) return;
    const buffer = this.sounds.get(`sfx:${slot}`);
    if (!buffer) return;
    // Polyphonic, no added latency: buffer is already decoded.
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = new GainNode(this.ctx, { gain: DB(gainDb) });
    source.connect(gain);
    gain.connect(this.mixBus);
    source.start();
  }

  // -------------------------------------------------------------------
  // Echo (hold-to-activate send)
  // -------------------------------------------------------------------

  echoDown() {
    if (!this.echoWet || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.echoWet.gain.cancelScheduledValues(now);
    this.echoWet.gain.setValueAtTime(this.echoWet.gain.value, now);
    this.echoWet.gain.linearRampToValueAtTime(0.6, now + 0.03);
  }

  echoUp() {
    if (!this.echoWet || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.echoWet.gain.cancelScheduledValues(now);
    this.echoWet.gain.setValueAtTime(this.echoWet.gain.value, now);
    // Ramps to zero over 250ms - lets the delay's natural tail ring out
    // rather than cutting it off abruptly.
    this.echoWet.gain.linearRampToValueAtTime(0, now + 0.25);
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /** Stop/resume without closing the AudioContext, so the sample clock never
   * loses continuity (acceptance criterion 7). Caller is responsible for
   * pausing/resuming the WAV worker and MediaRecorder around this. */
  async suspend() {
    await this.ctx?.suspend();
  }
  async resume() {
    await this.ctx?.resume();
  }

  dispose() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
  }
}
