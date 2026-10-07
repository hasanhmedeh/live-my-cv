import type { Environment, TimeMode } from './environment';

const STORAGE_KEY = 'funfair-time';

/**
 * The HUD clock and its time panel: drag the slider to pick any time of day, play / pause the
 * 10-minute day cycle, or follow the visitor's real local time. The choice is remembered.
 */
export class TimeControl {
  private pill = document.getElementById('clock') as HTMLButtonElement;
  private panel = document.getElementById('time-panel')!;
  private slider = document.getElementById('time-slider') as HTMLInputElement;
  private readout = document.getElementById('time-readout')!;
  private playBtn = document.getElementById('time-play') as HTMLButtonElement;
  private localBtn = document.getElementById('time-local') as HTMLButtonElement;
  private dragging = false;
  private pillText = '';
  private readoutText = '';

  constructor(private env: Environment) {
    this.restore();
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggle(false));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.toggle(false);
    });

    this.slider.addEventListener('input', () => {
      this.dragging = true;
      // picking a time takes over from the local clock; a running cycle keeps running from there
      if (this.env.timeMode === 'local') this.env.timeMode = 'paused';
      this.env.setHour(Number(this.slider.value) / 60);
      this.save();
    });
    this.slider.addEventListener('change', () => (this.dragging = false));
    this.playBtn.addEventListener('click', () => {
      this.env.timeMode = this.env.timeMode === 'cycle' ? 'paused' : 'cycle';
      this.save();
    });
    this.localBtn.addEventListener('click', () => {
      this.env.timeMode = this.env.timeMode === 'local' ? 'paused' : 'local';
      this.save();
    });
  }

  private toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.pill.setAttribute('aria-expanded', String(open));
    if (open) this.slider.focus({ preventScroll: true });
  }

  private restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { mode: TimeMode; hour: number } | null;
      if (!saved) return;
      if (saved.mode === 'cycle' || saved.mode === 'paused' || saved.mode === 'local') this.env.timeMode = saved.mode;
      if (saved.mode === 'paused' && Number.isFinite(saved.hour)) this.env.setHour(saved.hour);
    } catch {
      /* storage unavailable */
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: this.env.timeMode, hour: this.env.hours }));
    } catch {
      /* storage unavailable */
    }
  }

  /** Called every frame: keeps the pill, slider and buttons in sync with the clock. */
  update() {
    const h = this.env.hours;
    const mode = this.env.timeMode;
    const icon = h >= 5.5 && h < 7.5 ? '🌅' : h >= 7.5 && h < 17.5 ? '☀️' : h >= 17.5 && h < 19.5 ? '🌇' : '🌙';
    // the caret hints that the clock opens the time panel
    const pill = `${icon} ${this.env.clock}${mode === 'paused' ? ' ⏸' : ''} ${this.panel.hidden ? '▴' : '▾'}`;
    if (pill !== this.pillText) {
      this.pill.textContent = this.pillText = pill;
      this.pill.title = `${mode === 'local' ? 'Park time · your local time' : mode === 'paused' ? 'Park time · paused' : 'Park time · a full day every 10 minutes'} · click to change the time`;
    }
    if (this.panel.hidden) return;
    const label = mode === 'local' ? 'Following your local time' : mode === 'paused' ? 'Paused' : 'Running · 1 day = 10 min';
    const readout = `${this.env.clock} · ${label}`;
    if (readout !== this.readoutText) this.readout.textContent = this.readoutText = readout;
    if (!this.dragging) this.slider.value = String(Math.round(h * 60) % 1440);
    this.playBtn.textContent = mode === 'cycle' ? '⏸ Pause' : '▶ Play';
    this.playBtn.setAttribute('aria-pressed', String(mode === 'cycle'));
    this.localBtn.setAttribute('aria-pressed', String(mode === 'local'));
  }
}
