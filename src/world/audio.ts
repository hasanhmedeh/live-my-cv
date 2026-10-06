// Tiny WebAudio synth: every sound is generated, so there are no audio files to download.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ride: { rumble: GainNode; rumbleF: BiquadFilterNode; wind: GainNode; windF: BiquadFilterNode; whine: OscillatorNode; whineG: GainNode } | null = null;
  private lastThunk = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('fair-muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 40;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.engine = { osc, gain, filter };
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('fair-muted', m ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  /** speed01: 0..1 */
  setEngine(speed01: number, active: boolean) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(38 + speed01 * 70, t, 0.1);
    this.engine.filter.frequency.setTargetAtTime(220 + speed01 * 500, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(active ? 0.05 + speed01 * 0.07 : 0, t, 0.15);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, delay = 0, slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, freq: number, vol = 0.3, q = 1, delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return null;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    return { f, t };
  }

  /** Continuous coaster sounds: wheel rumble, wind and the launch motors' whine. */
  setCoaster(speed01: number, launching: boolean, active: boolean) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const c = this.ctx;
    if (!this.ride) {
      const mk = (type: BiquadFilterType, f: number) => {
        const src = c.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;
        const filt = c.createBiquadFilter();
        filt.type = type;
        filt.frequency.value = f;
        const g = c.createGain();
        g.gain.value = 0;
        src.connect(filt).connect(g).connect(this.master!);
        src.start();
        return { g, filt };
      };
      const r = mk('lowpass', 180);
      const w = mk('bandpass', 900);
      const whine = c.createOscillator();
      whine.type = 'sawtooth';
      const wf = c.createBiquadFilter();
      wf.type = 'bandpass';
      wf.frequency.value = 1200;
      wf.Q.value = 3;
      const whineG = c.createGain();
      whineG.gain.value = 0;
      whine.connect(wf).connect(whineG).connect(this.master);
      whine.start();
      this.ride = { rumble: r.g, rumbleF: r.filt, wind: w.g, windF: w.filt, whine, whineG };
    }
    const t = c.currentTime;
    const k = active ? 1 : 0.35; // the ghost train is quieter
    this.ride.rumble.gain.setTargetAtTime(Math.min(0.5, speed01 * 0.55) * k, t, 0.08);
    this.ride.rumbleF.frequency.setTargetAtTime(120 + speed01 * 380, t, 0.1);
    this.ride.wind.gain.setTargetAtTime(active ? Math.pow(speed01, 2) * 0.35 : 0, t, 0.1);
    this.ride.windF.frequency.setTargetAtTime(500 + speed01 * 1800, t, 0.1);
    this.ride.whine.frequency.setTargetAtTime(220 + speed01 * 900, t, 0.05);
    this.ride.whineG.gain.setTargetAtTime(launching ? 0.09 * k : 0, t, 0.06);
  }

  honk() {
    this.tone(392, 0.28, 'square', 0.12);
    this.tone(494, 0.28, 'square', 0.1);
  }

  thunk(strength: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastThunk < 0.08) return;
    this.lastThunk = now;
    const v = Math.min(0.35, strength * 0.05);
    this.tone(90 + Math.random() * 40, 0.18, 'triangle', v);
    this.noise(0.08, 900, v * 0.6, 2);
  }

  ding() {
    [0, 0.002].forEach((d, i) => this.tone(1320 * (i ? 2.01 : 1), 1.6, 'sine', 0.25, d));
    this.tone(1980, 1.2, 'sine', 0.08);
  }

  whack() {
    this.noise(0.15, 300, 0.5, 1.5);
    this.tone(70, 0.25, 'triangle', 0.4);
  }

  beep(high = false) {
    this.tone(high ? 880 : 520, high ? 0.5 : 0.18, 'square', 0.1);
  }

  rumble(dur: number) {
    const n = this.noise(dur, 120, 0.5, 0.6);
    if (n) n.f.frequency.exponentialRampToValueAtTime(600, n.t + dur);
  }

  whoosh() {
    const n = this.noise(1.1, 400, 0.25, 1.2);
    if (n) n.f.frequency.exponentialRampToValueAtTime(2400, n.t + 1);
  }

  clack() {
    this.noise(0.03, 2500, 0.08, 4);
  }

  pop() {
    this.tone(600, 0.12, 'sine', 0.2, 0, 1200);
  }

  chime() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.12, i * 0.09));
  }
}
