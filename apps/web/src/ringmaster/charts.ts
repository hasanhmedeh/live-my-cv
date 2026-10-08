// One-series bar charts for the office: thin bars with rounded data-ends on the baseline, a
// recessive grid, sparse axis labels, and a tooltip on hover and keyboard focus. Drawn at the
// container's real width (and redrawn when it changes), so the text never scales.
import { esc, num } from './util';

export interface BarChart {
  /** Read out by screen readers: what the chart shows. */
  label: string;
  values: number[];
  /** Under the bars; only some are drawn when they would crowd. */
  ticks: string[];
  /** The tooltip for each bar (plain text, one or two lines). */
  tips: string[];
  height?: number;
}

const PAD = { top: 10, right: 4, bottom: 22, left: 34 };
const observed = new WeakMap<HTMLElement, BarChart>();
const resize = new ResizeObserver((entries) => {
  for (const e of entries) {
    const chart = observed.get(e.target as HTMLElement);
    if (chart) draw(e.target as HTMLElement, chart);
  }
});

/** Draws `chart` into `el`, and keeps it fitted to `el`'s width. */
export function renderBarChart(el: HTMLElement, chart: BarChart) {
  observed.set(el, chart);
  resize.observe(el);
  draw(el, chart);
}

function draw(el: HTMLElement, chart: BarChart) {
  const width = Math.max(240, Math.floor(el.clientWidth));
  const height = chart.height ?? 180;
  const n = chart.values.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...chart.values));
  const band = plotW / Math.max(1, n);
  // thin bars, at least a 2px gap between neighbours
  const barW = Math.max(1, Math.min(28, band * 0.7, band - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = max * f;
      const gy = y(v);
      return `<line class="grid-line" x1="${PAD.left}" x2="${width - PAD.right}" y1="${gy}" y2="${gy}"/><text class="axis-label" x="${PAD.left - 6}" y="${gy + 4}" text-anchor="end">${esc(short(v))}</text>`;
    })
    .join('');

  // a tick label every few bars, so they never collide (about 56 px apart)
  const every = Math.max(1, Math.ceil(56 / band));
  const ticks = chart.ticks
    .map((t, i) => (i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2) ? `<text class="axis-label" x="${PAD.left + band * i + band / 2}" y="${height - 6}" text-anchor="middle">${esc(t)}</text>` : ''))
    .join('');

  const bars = chart.values
    .map((v, i) => {
      const x = PAD.left + band * i + (band - barW) / 2;
      const top = y(v);
      const h = PAD.top + plotH - top;
      const tip = chart.tips[i] ?? `${num(v)}`;
      // the hit area is the whole column, wider and taller than the bar
      const hit = `<rect class="hit" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${plotH}" tabindex="0" role="img" aria-label="${esc(tip.replace('\n', ': '))}" data-tip="${esc(tip)}"/>`;
      return hit + (v > 0 ? `<path class="bar-mark" d="${roundedTop(x, top, barW, h)}"/>` : '');
    })
    .join('');

  el.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(chart.label)}">${grid}${bars}${ticks}</svg>`;
}

/** A bar with 4 px rounded corners at its data end, square on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  const base = y + h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/** The axis top: a round number at or above `v`. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

const short = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(v * 10) / 10));

// ---------- The shared tooltip ----------
const tip = document.getElementById('tip')!;

function showTip(target: Element, x: number, y: number) {
  const text = target.getAttribute('data-tip');
  if (!text) return;
  const [first, ...rest] = text.split('\n');
  tip.innerHTML = `<b>${esc(first)}</b>${rest.map((l) => `<br>${esc(l)}`).join('')}`;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

document.addEventListener('pointermove', (e) => {
  const t = (e.target as Element | null)?.closest?.('[data-tip]');
  if (t) showTip(t, e.clientX, e.clientY);
  else tip.hidden = true;
});
document.addEventListener('focusin', (e) => {
  const t = (e.target as Element | null)?.closest?.('[data-tip]');
  if (!t) return;
  const r = t.getBoundingClientRect();
  showTip(t, r.left + r.width / 2, r.top + 24);
});
document.addEventListener('focusout', () => (tip.hidden = true));
document.addEventListener('scroll', () => (tip.hidden = true), true);
