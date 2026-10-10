// The Rally Trail's dirt loop: a time trial on the meadow outside the park's south fence. Like the
// kart circuit it's built once, up front, so the trees and the horizon hills can keep clear of it
// and the minimap can draw it. The layout is fixed (every run is on the same trail, so the times on
// the daily leaderboard compare), and so is the ground's shape along it: the jumps, the whoops and
// the logs are a height profile along the centre line.
import * as THREE from 'three';
import { headingOf } from './speedway-track';

export { headingOf };

/** Half the dirt's width: 8.4 m of trail. */
export const TRAIL_HALF = 4.2;
/** Beyond the dirt's edge the ground slopes back down to the meadow over this far. */
export const BERM = 1.8;
/** The ranch fence, this far either side of the centre line. */
export const WALL = 8.5;

/**
 * Control points in world metres (x east, z south), clockwise seen from above: the start straight
 * along the fence, a fast sweep down the east side (whoops, then the big jump), the water splash and
 * the mud along the bottom, a twisty infield (crates, the spinner) and the logs and a table-top on
 * the way home. No two stretches come within 26 m of each other; the tightest bend has a 14 m radius.
 */
const CONTROL: [number, number][] = [
  [4, 113], [30, 108], [62, 108], [94, 116], [111, 138], [112, 168], [102, 200], [80, 226], [50, 236], [24, 226],
  [12, 202], [26, 182], [56, 180], [78, 170], [86, 150], [70, 134], [40, 141], [14, 150], [-4, 144], [-8, 127],
];

export interface Trail {
  /** Number of samples (spaced `ds` apart along the centre line). */
  n: number;
  ds: number;
  length: number;
  px: Float32Array;
  pz: Float32Array;
  /** Unit tangent, in the direction of the run. */
  tx: Float32Array;
  tz: Float32Array;
  /** Signed curvature, smoothed (1/m, positive = turning left). */
  k: Float32Array;
}

function build(): Trail {
  const pts = CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const length = curve.getLength();
  const n = Math.round(length);
  const ds = length / n;
  const spaced = curve.getSpacedPoints(n);
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = spaced[i].x;
    pz[i] = spaced[i].z;
  }
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = px[b] - px[a];
    const dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz);
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  // curvature from the change of tangent, projected on the left normal (tz, -tx)
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n;
    const b = (i + 2) % n;
    raw[i] = ((tx[b] - tx[a]) * tz[i] - (tz[b] - tz[a]) * tx[i]) / (4 * ds);
  }
  const k = new Float32Array(n);
  const W = 4;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -W; j <= W; j++) sum += raw[(i + j + n) % n];
    k[i] = sum / (2 * W + 1);
  }
  return { n, ds, length, px, pz, tx, tz, k };
}

export const TRAIL = build();

/** Wraps an arc length into [0, length). */
export const wrapS = (s: number) => ((s % TRAIL.length) + TRAIL.length) % TRAIL.length;

/** The signed shortest distance along the loop from arc length a to b. */
export function deltaS(a: number, b: number) {
  const L = TRAIL.length;
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  return d;
}

/** A point on the trail: arc length `s`, `d` metres to the left of the centre line. */
export function trailPoint(s: number, d: number, out = { x: 0, z: 0, tx: 0, tz: 0 }) {
  const C = TRAIL;
  const f = wrapS(s) / C.ds;
  const i = Math.floor(f) % C.n;
  const j = (i + 1) % C.n;
  const t = f - Math.floor(f);
  let tx = C.tx[i] + (C.tx[j] - C.tx[i]) * t;
  let tz = C.tz[i] + (C.tz[j] - C.tz[i]) * t;
  const l = Math.hypot(tx, tz);
  tx /= l;
  tz /= l;
  out.x = C.px[i] + (C.px[j] - C.px[i]) * t + tz * d;
  out.z = C.pz[i] + (C.pz[j] - C.pz[i]) * t - tx * d;
  out.tx = tx;
  out.tz = tz;
  return out;
}

/**
 * Where (x, z) sits relative to the trail: the nearest sample `i` (searched within `window` samples
 * of `hint`, or everywhere when there's no hint), the arc length `s` and the signed lateral offset
 * `d` (positive = left of the centre line).
 */
export function locate(x: number, z: number, hint = -1, window = 10, out = { i: 0, s: 0, d: 0 }) {
  const C = TRAIL;
  let best = hint;
  let bd = Infinity;
  const from = hint < 0 ? 0 : hint - window;
  const to = hint < 0 ? C.n - 1 : hint + window;
  for (let q = from; q <= to; q++) {
    const i = ((q % C.n) + C.n) % C.n;
    const d = (C.px[i] - x) ** 2 + (C.pz[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const i = best;
  const dx = x - C.px[i];
  const dz = z - C.pz[i];
  out.i = i;
  out.s = wrapS(i * C.ds + dx * C.tx[i] + dz * C.tz[i]);
  out.d = dx * C.tz[i] - dz * C.tx[i];
  return out;
}

/** Spatial hash of the samples, for "is the trail near here?" queries. */
const CELL = 8;
const grid = new Map<string, number[]>();
for (let i = 0; i < TRAIL.n; i += 2) {
  const key = `${Math.floor(TRAIL.px[i] / CELL)},${Math.floor(TRAIL.pz[i] / CELL)}`;
  let list = grid.get(key);
  if (!list) grid.set(key, (list = []));
  list.push(i);
}

/** True if the trail's centre line passes within `r` metres of (x, z). */
export function nearTrail(x: number, z: number, r: number) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const span = Math.ceil(r / CELL);
  for (let i = cx - span; i <= cx + span; i++)
    for (let j = cz - span; j <= cz + span; j++) {
      const list = grid.get(`${i},${j}`);
      if (!list) continue;
      for (const k of list) if ((TRAIL.px[k] - x) ** 2 + (TRAIL.pz[k] - z) ** 2 < r * r) return true;
    }
  return false;
}

// ------------------------------------------------------------------ the run and its features

/** The start / finish line, in metres from the first sample (on the start straight). */
export const START_S = 24;
/** Where the buggy waits for the lights, a few metres behind the line. */
export const GRID_S = START_S - 7;
/**
 * The checkpoint gates, in metres past the start line, in the order they're driven (the finish is
 * the line itself, one whole loop on). A run counts once it has passed every one of them.
 */
export const CHECKPOINTS = [182, 296, 422];

/**
 * The ground's shape along the trail, metres from the first sample (the trail is driven towards
 * larger s): a kicker and its landing ramp, whoops (a row of rounded bumps), logs lying across the
 * dirt and a table-top. Heights are in metres above the meadow, the full width of the dirt; the
 * berms take them back down at the edges.
 */
export type Bump =
  | { kind: 'kicker'; s0: number; s1: number; h: number }
  | { kind: 'landing'; s0: number; s1: number; h: number }
  | { kind: 'whoops'; s0: number; s1: number; h: number; n: number }
  | { kind: 'log'; s: number; r: number }
  | { kind: 'table'; s0: number; s1: number; h: number; ramp: number };

export const BUMPS: Bump[] = [
  // the east side: whoops to skip over, then the big jump (clear the gap or case the landing)
  { kind: 'whoops', s0: 140, s1: 162, h: 0.65, n: 4 },
  { kind: 'kicker', s0: 170, s1: 177, h: 1.6 },
  { kind: 'landing', s0: 186, s1: 196, h: 1.3 },
  // the way home: three logs, then a table-top to fly off
  { kind: 'log', s: 456, r: 0.24 },
  { kind: 'log', s: 461, r: 0.24 },
  { kind: 'log', s: 466, r: 0.24 },
  { kind: 'table', s0: 471, s1: 487, h: 1.2, ramp: 5.5 },
];

/** Patches of the dirt that drive differently: from s0 to s1, between offsets d0 and d1 (left positive). */
export interface Patch {
  kind: 'mud' | 'water' | 'boost';
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}

export const PATCHES: Patch[] = [
  // a boost out of the first sweep, into the whoops and the jump: big air
  { kind: 'boost', s0: 124, s1: 128, d0: -1.4, d1: 1.4 },
  // the splash across the whole trail at the bottom, then mud on the inside of the long right-hander
  { kind: 'water', s0: 226, s1: 238, d0: -TRAIL_HALF - BERM, d1: TRAIL_HALF + BERM },
  { kind: 'mud', s0: 258, s1: 276, d0: -TRAIL_HALF - BERM, d1: -0.4 },
  // out of the hairpin onto the home straight, and the sprint to the line
  { kind: 'boost', s0: 446, s1: 450, d0: -1.4, d1: 1.4 },
  { kind: 'boost', s0: 6, s1: 10, d0: -1.4, d1: 1.4 },
];

/** The profile's spacing along the trail: fine enough for the logs and the jumps' faces. */
const DH = 0.25;
const PROFILE = (() => {
  const n = Math.ceil(TRAIL.length / DH);
  const h = new Float32Array(n + 1);
  const smooth = (u: number) => u * u * (3 - 2 * u);
  for (let q = 0; q <= n; q++) {
    const s = q * DH;
    let y = 0;
    for (const b of BUMPS) {
      if (b.kind === 'log') {
        // the log's own round top, so the wheels ride over the mesh lying there
        const x = (s - b.s) / (b.r * 2);
        if (Math.abs(x) < 1) y = Math.max(y, b.r * 2 * Math.sqrt(1 - x * x));
        continue;
      }
      if (s < b.s0 - 0.6 || s > b.s1 + 0.6) continue;
      const u = THREE.MathUtils.clamp((s - b.s0) / (b.s1 - b.s0), 0, 1);
      if (b.kind === 'kicker') {
        // a curved lip that throws you upward, then a steep face down at the end
        y = Math.max(y, s <= b.s1 ? b.h * u ** 1.6 : b.h * (1 - (s - b.s1) / 0.6));
      } else if (b.kind === 'landing') {
        // a steep back face, then a long smooth slope down: land on the slope, not the face
        y = Math.max(y, s < b.s0 ? b.h * (1 - (b.s0 - s) / 0.6) : b.h * 0.5 * (1 + Math.cos(Math.PI * u)));
      } else if (b.kind === 'whoops') {
        y = Math.max(y, s < b.s0 || s > b.s1 ? 0 : b.h * 0.5 * (1 - Math.cos(2 * Math.PI * b.n * u)));
      } else {
        const along = s - b.s0;
        const left = b.s1 - s;
        y = Math.max(y, b.h * smooth(THREE.MathUtils.clamp(Math.min(along, left) / b.ramp, 0, 1)));
      }
    }
    h[q] = Math.max(0, y);
  }
  return h;
})();

/** The dirt's height on the centre line at arc length `s`. */
export function heightAlong(s: number) {
  const f = wrapS(s) / DH;
  const i = Math.floor(f);
  const t = f - i;
  const n = PROFILE.length - 1;
  return PROFILE[i % n] + (PROFILE[(i + 1) % n] - PROFILE[i % n]) * t;
}

/** The ground's height at arc length `s`, `d` metres off the centre line (the berms slope it away to the meadow). */
export function heightAt(s: number, d: number) {
  const a = Math.abs(d);
  if (a >= TRAIL_HALF + BERM) return 0;
  const h = heightAlong(s);
  if (a <= TRAIL_HALF || h === 0) return h;
  const u = 1 - (a - TRAIL_HALF) / BERM;
  return h * u * u * (3 - 2 * u);
}

/** The patch under arc length `s`, `d` metres off the centre line, if any. */
export function patchAt(s: number, d: number): Patch | null {
  for (const p of PATCHES) if (deltaS(p.s0, s) >= 0 && deltaS(p.s1, s) <= 0 && d >= p.d0 && d <= p.d1) return p;
  return null;
}

/** The trail's footprint, fences included. */
export const TRAIL_BOUNDS = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < TRAIL.n; i++) {
    x0 = Math.min(x0, TRAIL.px[i]);
    x1 = Math.max(x1, TRAIL.px[i]);
    z0 = Math.min(z0, TRAIL.pz[i]);
    z1 = Math.max(z1, TRAIL.pz[i]);
  }
  return { x0: x0 - WALL, x1: x1 + WALL, z0: z0 - WALL, z1: z1 + WALL };
})();
