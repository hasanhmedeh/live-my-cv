// What a treat from the booth's shop does: a sugar rush (run faster), a power kick, or extra
// battery on the next drone flight. Each lasts a while (the catalog says how long) and survives a
// reload, kept in this browser. Little chips at the top of the HUD count them down.
import type { Perk } from '../account/api';

/** Running and walking speed with a sugar rush. */
export const SPEED_BOOST = 1.4;
/** How much harder a kick sends things flying. */
export const KICK_BOOST = 2;
/** Seconds of drone battery a fizzy soda adds to the next flight. */
export const DRONE_BONUS_S = 60;

const KEY = 'funfair.perks';
const LABEL: Record<Perk, string> = { speed: '🍭 Sugar rush', kick: '🍿 Power kick', drone: '🥤 Drone +60 s' };

class Perks {
  private until: Partial<Record<Perk, number>> = read();
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Draws the chips in `el` (#perks in the HUD) from now on. */
  mount(el: HTMLElement) {
    this.el = el;
    this.render();
  }

  /** A treat was eaten: the perk runs for `minutes` from now (topping up one already running). */
  grant(perk: Perk, minutes: number) {
    this.until[perk] = Date.now() + minutes * 60_000;
    this.save();
    this.render();
  }

  active(perk: Perk) {
    return (this.until[perk] ?? 0) > Date.now();
  }

  get speedMul() {
    return this.active('speed') ? SPEED_BOOST : 1;
  }

  get kickMul() {
    return this.active('kick') ? KICK_BOOST : 1;
  }

  /** The drone is taking off: the soda's extra seconds, used up (0 without one). */
  takeDroneBonus() {
    if (!this.active('drone')) return 0;
    delete this.until.drone;
    this.save();
    this.render();
    return DRONE_BONUS_S;
  }

  private render() {
    const now = Date.now();
    for (const p of Object.keys(this.until) as Perk[]) if ((this.until[p] ?? 0) <= now) delete this.until[p];
    const running = Object.entries(this.until) as [Perk, number][];
    if (this.el) {
      this.el.hidden = !running.length;
      this.el.innerHTML = running
        .map(([p, until]) => {
          const left = Math.max(0, Math.ceil((until - now) / 1000));
          const clock = left >= 3600 ? `${Math.floor(left / 3600)} h` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
          // the drone's lasts until its next flight (within the hour): no ticking clock for it
          return `<span class="perk-chip">${LABEL[p]}${p === 'drone' ? '' : ` <b>${clock}</b>`}</span>`;
        })
        .join('');
    }
    if (running.length && !this.timer) this.timer = setInterval(() => this.render(), 1000);
    if (!running.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.until));
    } catch {
      // not remembered: the perk still runs until the page is closed
    }
  }
}

function read(): Partial<Record<Perk, number>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out: Partial<Record<Perk, number>> = {};
    if (raw && typeof raw === 'object')
      for (const p of ['speed', 'kick', 'drone'] as const) {
        const v = (raw as Record<string, unknown>)[p];
        if (typeof v === 'number' && v > Date.now()) out[p] = v;
      }
    return out;
  } catch {
    return {};
  }
}

export const perks = new Perks();
