// The Career Museum's guided tour: the camera glides from frame to frame (attractions/museum.ts)
// and this sheet beside it tells each one's story: when, where, what was done, with what. The
// years along the top jump to where each one starts; ← / → (or the buttons, or E) step through.
import { PROFILE, SECTIONS, SKILLS, type SectionId } from '../data/museum';
import type { Sfx } from './audio';
import { STOPS, type MuseumStop } from './attractions/museum';
import { escapeHtml } from './ui';

export interface GalleryOptions {
  root: HTMLElement;
  sfx: Sfx;
  /** The tour moved to another stop (the camera follows). */
  onGo: (index: number) => void;
  /** Back to the fair (Esc, the button). */
  onLeave: () => void;
}

/** The year a stop belongs to, for the chips along the top ("toolbox" for the end wall, null outside). */
const yearOf = (s: MuseumStop): SectionId | 'toolbox' | null => (s.kind === 'exhibit' ? s.exhibit.section : s.kind === 'toolbox' ? 'toolbox' : null);

const link = (l: { label: string; href: string }) =>
  `<a class="museum-link" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)} ↗</a>`;

export class Gallery {
  isOpen = false;
  /** The stop on show (an index into STOPS). */
  index = 0;
  private eyebrow: HTMLElement;
  private title: HTMLElement;
  private years: HTMLElement;
  private body: HTMLElement;
  private count: HTMLElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;

  constructor(private o: GalleryOptions) {
    const r = o.root;
    this.eyebrow = r.querySelector('[data-museum-eyebrow]')!;
    this.title = r.querySelector('[data-museum-title]')!;
    this.years = r.querySelector('[data-museum-years]')!;
    this.body = r.querySelector('[data-museum-body]')!;
    this.count = r.querySelector('[data-museum-count]')!;
    this.prev = r.querySelector('[data-museum-step="-1"]')!;
    this.next = r.querySelector('[data-museum-step="1"]')!;

    // one chip per year (and the toolbox), each jumping to the first stop under it
    const chips: string[] = [];
    for (const id of Object.keys(SECTIONS) as SectionId[]) {
      const at = STOPS.findIndex((s) => yearOf(s) === id);
      if (at >= 0) chips.push(`<button type="button" data-museum-go="${at}" data-year="${id}" title="${escapeHtml(SECTIONS[id].title)}">${id}</button>`);
    }
    chips.push(`<button type="button" data-museum-go="${STOPS.length - 1}" data-year="toolbox" title="Skills and languages">🧰 Toolbox</button>`);
    this.years.innerHTML = chips.join('');

    r.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-museum-go], [data-museum-step], [data-museum-leave]');
      if (!b) return;
      if (b.dataset.museumGo) this.go(Number(b.dataset.museumGo));
      else if (b.dataset.museumStep) this.step(Number(b.dataset.museumStep));
      else this.o.onLeave();
      // the focus goes back to the sheet, so the arrow keys keep stepping
      if (!b.hasAttribute('data-museum-leave')) (b as HTMLButtonElement).blur();
    });
    // the arrow keys step through the collection wherever the focus is; Esc inside the sheet leaves
    // (the game's own keys don't reach the sheet, and outside it the game sends Esc itself)
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown') this.step(1);
      else if (k === 'ArrowLeft' || k === 'PageUp') this.step(-1);
      else if (k === 'Home') this.go(0);
      else if (k === 'End') this.go(STOPS.length - 1);
      else if (k === 'Escape' && r.contains(e.target as Node)) this.o.onLeave();
      else return;
      e.preventDefault();
    });
  }

  /** The visitor steps up to stop `i` (the porch, a frame, or the toolbox). */
  open(i: number) {
    this.isOpen = true;
    this.o.root.hidden = false;
    this.index = Math.max(0, Math.min(STOPS.length - 1, i));
    this.render();
    this.o.sfx.chime();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.o.root.hidden = true;
  }

  step(d: number) {
    this.go(this.index + d);
  }

  go(i: number) {
    const next = Math.max(0, Math.min(STOPS.length - 1, i));
    if (!this.isOpen || next === this.index) return;
    this.index = next;
    this.render();
    this.o.sfx.pop();
    this.o.onGo(next);
  }

  /**
   * How far to shift the picture so the frame shows beside the sheet, not under it: the sheet takes
   * the right of a wide screen, the bottom of a narrow one (as at the booth).
   */
  viewOffset(w: number, h: number) {
    const sheet = this.o.root.querySelector<HTMLElement>('.shop-sheet');
    if (!sheet) return { x: 0, y: 0 };
    const r = sheet.getBoundingClientRect();
    return w > 720 ? { x: Math.round(Math.min(r.width, w * 0.6) / 2), y: 0 } : { x: 0, y: Math.round(Math.min(r.height, h * 0.7) / 2) };
  }

  private render() {
    const s = STOPS[this.index];
    const year = yearOf(s);
    for (const b of this.years.querySelectorAll<HTMLElement>('[data-year]')) {
      const on = b.dataset.year === year;
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.count.textContent = `${this.index + 1} / ${STOPS.length}`;
    this.prev.disabled = this.index === 0;
    this.next.disabled = this.index === STOPS.length - 1;

    if (s.kind === 'facade') {
      this.eyebrow.textContent = 'Career Museum · Now showing';
      this.title.textContent = PROFILE.name;
      this.body.innerHTML = `<p class="museum-kicker">${escapeHtml(PROFILE.headline)}</p><p>${escapeHtml(PROFILE.summary)}</p><p class="museum-links">${PROFILE.links.map(link).join('')}</p><div class="museum-how"><p><strong>${STOPS.length - 2} framed pictures</strong> hang inside, from ${escapeHtml(PROFILE.since)} to today, a year at a time.</p><p>Press <kbd>→</kbd> (or <strong>Next</strong>) to walk through them, or leave the tour and wander the hall yourself: step up to any frame and press <kbd>E</kbd>.</p></div>`;
    } else if (s.kind === 'toolbox') {
      this.eyebrow.textContent = 'Career Museum · End wall';
      this.title.textContent = 'The Toolbox';
      this.body.innerHTML = `<p>Languages, frameworks and tools from the CV.</p><ul class="museum-tags museum-tags-big">${SKILLS.map((k) => `<li>${escapeHtml(k.name)}</li>`).join('')}</ul><h3>Languages</h3><ul class="museum-langs">${PROFILE.languages
        .map((l) => `<li><strong>${escapeHtml(l.name)}</strong> ${escapeHtml(l.level)}</li>`)
        .join('')}</ul><p class="museum-links">${PROFILE.links.map(link).join('')}</p>`;
    } else {
      const ex = s.exhibit;
      const sec = SECTIONS[ex.section];
      this.eyebrow.textContent = `${ex.section} · ${sec.title}`;
      this.title.textContent = ex.title;
      this.body.innerHTML = `<p class="museum-when" style="--accent: ${escapeHtml(ex.accent)}">📅 ${escapeHtml(ex.when)}</p><p class="museum-kicker">${escapeHtml(ex.org)}${
        ex.kicker ? ` <span>· ${escapeHtml(ex.kicker)}</span>` : ''
      }</p><ul class="museum-lines">${ex.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>${
        ex.tags.length ? `<ul class="museum-tags">${ex.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''
      }${ex.links?.length ? `<p class="museum-links">${ex.links.map(link).join('')}</p>` : ''}${
        ex.image ? (ex.credit ? `<p class="museum-credit">${escapeHtml(ex.credit)}</p>` : '') : '<p class="museum-credit">Picture to come: this frame holds a placeholder for now.</p>'
      }`;
    }
    this.body.scrollTop = 0;
  }
}
