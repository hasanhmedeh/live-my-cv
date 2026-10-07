import { FLIP_YAW, LAYOUT, PATHS, PLAZAS, ZONES, type ZoneId } from './layout';
import { FALCON_TRACK, STACK_TRACK } from './rides';
import { PALETTE } from './textures';

const ICONS: Record<ZoneId, string> = {
  entrance: '🎪',
  coaster: '🎢',
  falcon: '🦅',
  rocket: '🚀',
  crates: '🥫',
  striker: '🔔',
  ferris: '🎡',
  booth: '🎟️',
  drone: '🚁',
  flip: '🌀',
  ship: '🛸',
};

/** Pixels per metre in the pre-rendered map sheet. */
const SHEET_SCALE = 3;
/** Metres visible from the centre to the edge of the minimap (normal / zoomed out). */
const VIEW = { near: 55, far: 150 };

/**
 * North-up circular minimap in the bottom-left corner. The whole fair is drawn once
 * into an offscreen sheet; each frame we just blit a window of it around the visitor.
 * Click / tap it to toggle a zoomed-out view; click an attraction icon to go there.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private sheet = document.createElement('canvas');
  private bounds = { x0: 0, z0: 0, x1: 0, z1: 0 };
  private sheetScale = 1;
  private view: number = VIEW.near;
  private targetView: number = VIEW.near;
  private size = 0;
  private dpr = 1;
  private centre = { x: 0, z: 0 };
  onGoto: ((id: ZoneId) => void) | null = null;

  constructor(private root: HTMLElement) {
    this.canvas = root.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
    this.drawSheet();
    root.querySelector('[data-map-zoom]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleZoom();
    });
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target as HTMLElement)?.closest?.('input, textarea')) this.toggleZoom();
    });
  }

  toggleZoom() {
    this.targetView = this.targetView === VIEW.near ? VIEW.far : VIEW.near;
    this.root.classList.toggle('is-far', this.targetView === VIEW.far);
  }

  private drawSheet() {
    // fit everything: the park itself plus both coaster tracks
    let x0 = -LAYOUT.boundary, x1 = LAYOUT.boundary, z0 = -LAYOUT.boundary, z1 = LAYOUT.boundary;
    for (const d of [STACK_TRACK, FALCON_TRACK])
      for (const p of d.pos) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
    const pad = VIEW.far;
    this.bounds = { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
    const w = Math.ceil((this.bounds.x1 - this.bounds.x0) * SHEET_SCALE);
    const h = Math.ceil((this.bounds.z1 - this.bounds.z0) * SHEET_SCALE);
    // stay well inside canvas limits on low-end devices
    const k = Math.min(1, 4096 / Math.max(w, h));
    this.sheet.width = Math.round(w * k);
    this.sheet.height = Math.round(h * k);
    const s = SHEET_SCALE * k;
    this.sheetScale = s;
    const g = this.sheet.getContext('2d')!;
    const X = (x: number) => (x - this.bounds.x0) * s;
    const Z = (z: number) => (z - this.bounds.z0) * s;

    // desert / outland
    g.fillStyle = '#c9a774';
    g.fillRect(0, 0, this.sheet.width, this.sheet.height);
    // the fair's lawn
    g.fillStyle = '#5c9a4e';
    g.beginPath();
    g.arc(X(0), Z(0), LAYOUT.boundary * s, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(29, 18, 56, 0.55)';
    g.lineWidth = 1.2 * s;
    g.stroke();

    // footpaths + plazas
    g.strokeStyle = g.fillStyle = '#efdcb6';
    g.lineCap = g.lineJoin = 'round';
    for (const p of PATHS) {
      g.lineWidth = p.width * s;
      g.beginPath();
      p.points.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      g.stroke();
    }
    for (const [x, z, r] of PLAZAS) {
      g.beginPath();
      g.arc(X(x), Z(z), r * s, 0, Math.PI * 2);
      g.fill();
    }

    // coaster tracks (dark casing under a coloured line so they read on any ground)
    for (const [d, color] of [
      [FALCON_TRACK, PALETTE.teal],
      [STACK_TRACK, PALETTE.candy],
    ] as const) {
      for (const [stroke, width] of [
        ['rgba(29, 18, 56, 0.6)', 2.6],
        [color, 1.4],
      ] as const) {
        g.strokeStyle = stroke;
        g.lineWidth = width * s;
        g.beginPath();
        d.pos.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
        g.closePath();
        g.stroke();
      }
    }

    // the giant wheel seen from above: the rim edge-on, the hub, and its two A-frames
    const wz = LAYOUT.ferris.z;
    g.strokeStyle = '#3a3f48';
    g.lineWidth = 1.6 * s;
    for (const side of [-1, 1])
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(LAYOUT.ferris.x + sx * 56), Z(wz + side * 40));
        g.lineTo(X(LAYOUT.ferris.x), Z(wz + side * 22));
        g.stroke();
      }
    g.strokeStyle = '#e9edf2';
    g.lineWidth = 3 * s;
    g.beginPath();
    g.moveTo(X(LAYOUT.ferris.x - 124), Z(wz));
    g.lineTo(X(LAYOUT.ferris.x + 124), Z(wz));
    g.stroke();

    // the Sky Flip from above: its fenced swing and the tower
    const along = { x: Math.cos(FLIP_YAW), z: -Math.sin(FLIP_YAW) };
    const out = { x: Math.sin(FLIP_YAW), z: Math.cos(FLIP_YAW) };
    const fp = (lx: number, lz: number) => [X(LAYOUT.flip.x + along.x * lx + out.x * lz), Z(LAYOUT.flip.z + along.z * lx + out.z * lz)] as const;
    g.fillStyle = 'rgba(255, 138, 61, 0.35)';
    g.beginPath();
    for (const [lx, lz] of [[-26, -4], [26, -4], [26, 16], [-26, 16]]) g.lineTo(...fp(lx, lz));
    g.fill();
    g.strokeStyle = PALETTE.candy;
    g.lineWidth = 2.4 * s;
    g.beginPath();
    g.moveTo(...fp(-60, 3.6));
    g.lineTo(...fp(60, 3.6));
    g.stroke();
    g.fillStyle = '#3a3f48';
    g.beginPath();
    g.arc(...fp(0, 0), 2.6 * s, 0, Math.PI * 2);
    g.fill();
  }
  private resize() {
    const size = this.canvas.clientWidth;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
  }

  /** Converts a world position to minimap CSS pixels (relative to the canvas). */
  private toMap(x: number, z: number) {
    const k = this.size / 2 / this.view;
    return { x: this.size / 2 + (x - this.centre.x) * k, y: this.size / 2 + (z - this.centre.z) * k };
  }

  private onClick(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: ZoneId | null = null;
    let bestD = 16;
    for (const id of Object.keys(ZONES) as ZoneId[]) {
      const p = this.toMap(ZONES[id].x, ZONES[id].z);
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best) this.onGoto?.(best);
    else this.toggleZoom();
  }

  update(dt: number, car: { x: number; z: number; heading: number }, trains: { x: number; z: number; color: string }[]) {
    this.resize();
    if (!this.size) return;
    this.view += (this.targetView - this.view) * Math.min(1, dt * 6);
    // when zoomed out, frame the park rather than follow the visitor
    const far = (this.view - VIEW.near) / (VIEW.far - VIEW.near);
    this.centre.x = car.x * (1 - far) + 30 * far;
    this.centre.z = car.z * (1 - far) + -10 * far;

    const g = this.g;
    const S = this.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.clip();

    // blit the window of the sheet around the centre
    const s = this.sheetScale;
    const sx = (this.centre.x - this.view - this.bounds.x0) * s;
    const sz = (this.centre.z - this.view - this.bounds.z0) * s;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.sheet, sx, sz, this.view * 2 * s, this.view * 2 * s, 0, 0, S, S);

    // moving coaster trains
    for (const t of trains) {
      const p = this.toMap(t.x, t.z);
      g.fillStyle = t.color;
      g.strokeStyle = '#1d1238';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // attraction icons
    const iconSize = Math.round(Math.max(12, Math.min(18, S / 11)));
    g.font = `${iconSize}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const id of Object.keys(ICONS) as ZoneId[]) {
      const p = this.toMap(ZONES[id].x, ZONES[id].z);
      if (p.x < -10 || p.y < -10 || p.x > S + 10 || p.y > S + 10) continue;
      g.fillStyle = 'rgba(255, 245, 227, 0.92)';
      g.beginPath();
      g.arc(p.x, p.y, iconSize * 0.72, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#000';
      g.fillText(ICONS[id], p.x, p.y + 1);
    }

    // the visitor: an arrow pointing where they're heading (heading 0 faces -z)
    const c = this.toMap(car.x, car.z);
    g.translate(c.x, c.y);
    g.rotate(-car.heading);
    g.fillStyle = PALETTE.candy;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // north marker
    g.fillStyle = 'rgba(255, 245, 227, 0.9)';
    g.font = `700 10px "DM Sans", sans-serif`;
    g.fillText('N', S / 2, 9);
  }
}
