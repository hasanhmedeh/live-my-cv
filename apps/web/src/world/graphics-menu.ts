import { TIER_LABELS, TIERS, saveQualityChoice, type Quality, type QualityChoice } from './quality';

const HINTS: Record<QualityChoice, string> = {
  auto: 'Picked for this device',
  high: 'Everything on, the biggest crowd',
  medium: 'Lighter shadows and grass, a smaller crowd',
  low: 'No ambient occlusion, sparse grass, fewer guests',
  lowest: 'No shadows, grass or glow, a handful of guests — for older devices',
};

/**
 * The HUD graphics button and its panel. Most quality settings (shadow maps, grass, lights)
 * are baked in when the park is built, so a new choice is saved and the page reloads.
 */
export class GraphicsMenu {
  private btn = document.getElementById('gfx-toggle') as HTMLButtonElement;
  private panel = document.getElementById('gfx-panel')!;

  constructor(q: Quality) {
    const list = this.panel.querySelector('.gfx-options')!;
    const choices: QualityChoice[] = ['auto', ...TIERS];
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gfx-option';
      b.setAttribute('aria-pressed', String(c === q.choice));
      const name = c === 'auto' ? `Auto (${TIER_LABELS[q.detected]})` : TIER_LABELS[c];
      b.innerHTML = `<strong>${name}</strong><span>${HINTS[c]}</span>`;
      b.addEventListener('click', () => this.pick(c, q));
      list.appendChild(b);
    }

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggle(false));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.toggle(false);
    });
  }

  private toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.btn.setAttribute('aria-expanded', String(open));
  }

  private pick(c: QualityChoice, q: Quality) {
    if (c === q.choice) return this.toggle(false);
    saveQualityChoice(c);
    this.panel.querySelector('.gfx-note')!.textContent = 'Rebuilding the park…';
    // drop a ?quality= override so the saved choice takes effect
    const url = new URL(location.href);
    url.searchParams.delete('quality');
    location.replace(url.toString());
  }
}
