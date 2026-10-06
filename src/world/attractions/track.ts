// Coaster track builder, in the spirit of real coaster design tools: the track is a list of
// elements (straights, banked turns, hills, clothoid loops, heartline rolls, helices) that a
// "turtle" integrates into a heartline. Rails hang below the heartline, so rolls rotate
// around the riders the way real ones do. A Hermite connector closes the circuit.
//
// Self-contained (only depends on three) so the layout can be iterated from a Node script.
import * as THREE from 'three';

export type Element =
  | { t: 'straight'; len: number; zone?: Zone }
  | { t: 'turn'; angle: number; radius: number; bank?: number; zone?: Zone }
  | { t: 'pitch'; angle: number; radius: number; zone?: Zone }
  | { t: 'loop'; rBottom: number; rTop: number; shift: number; zone?: Zone }
  | { t: 'roll'; len: number; turns?: number; zone?: Zone };

/** Special track sections the ride physics and decoration care about. */
export type Zone = 'station' | 'launch' | 'brake' | 'tunnel';

export const DS = 0.5;
const DEG = Math.PI / 180;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface TrackData {
  /** Heartline points (where the riders' hearts are). */
  pos: THREE.Vector3[];
  tan: THREE.Vector3[];
  /** Up vector including banking/inversions. */
  up: THREE.Vector3[];
  right: THREE.Vector3[];
  zone: (Zone | null)[];
  length: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export function buildTrack(start: THREE.Vector3, heading: THREE.Quaternion, elements: Element[], connectorZone: Zone | null = null): TrackData {
  const pos: THREE.Vector3[] = [];
  const up: THREE.Vector3[] = [];
  const zone: (Zone | null)[] = [];
  const q = heading.clone();
  const p = start.clone();
  const qStep = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  const push = (bank: number, z: Zone | null) => {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (bank) u.applyAxisAngle(f, bank);
    pos.push(p.clone());
    up.push(u);
    zone.push(z);
  };
  const advance = () => p.add(new THREE.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(DS));
  const localRot = (x: number, y: number, z: number, angle: number) => {
    axis.set(x, y, z);
    qStep.setFromAxisAngle(axis, angle);
    q.multiply(qStep);
  };

  for (const e of elements) {
    const z = e.zone ?? null;
    if (e.t === 'straight') {
      const n = Math.round(e.len / DS);
      for (let i = 0; i < n; i++) {
        push(0, z);
        advance();
      }
    } else if (e.t === 'turn') {
      // yaw about WORLD up (keeps the current pitch, so turns while descending form helices)
      const total = e.angle * DEG;
      const len = Math.abs(total) * e.radius;
      const n = Math.max(1, Math.round(len / DS));
      const bankMax = (e.bank ?? 0) * DEG * -Math.sign(total); // lean into the turn
      for (let i = 0; i < n; i++) {
        const k = i / n;
        // ease bank in over the first quarter and out over the last quarter
        const env = k < 0.25 ? smooth(k / 0.25) : k > 0.75 ? smooth((1 - k) / 0.25) : 1;
        push(bankMax * env, z);
        advance();
        qStep.setFromAxisAngle(WORLD_UP, total / n);
        q.premultiply(qStep);
      }
    } else if (e.t === 'pitch') {
      const total = e.angle * DEG;
      const n = Math.max(1, Math.round((Math.abs(total) * e.radius) / DS));
      for (let i = 0; i < n; i++) {
        push(0, z);
        advance();
        localRot(1, 0, 0, total / n);
      }
    } else if (e.t === 'loop') {
      // clothoid-like loop: big radius at the bottom, tight at the top (lower G-forces)
      const right0 = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      let theta = 0;
      let traveled = 0;
      const estLen = Math.PI * (e.rBottom + e.rTop);
      while (theta < Math.PI * 2) {
        const r = e.rBottom + (e.rTop - e.rBottom) * (1 - Math.cos(theta)) * 0.5;
        const dTheta = Math.min(DS / r, Math.PI * 2 - theta);
        push(0, z);
        advance();
        // lateral drift so the exit runs beside the entry instead of through it
        const drift = (e.shift * (smooth(Math.min(1, traveled / estLen)) - smooth(Math.min(1, Math.max(0, traveled - DS) / estLen))));
        p.addScaledVector(right0, drift);
        localRot(1, 0, 0, dTheta);
        theta += dTheta;
        traveled += DS;
      }
    } else if (e.t === 'roll') {
      const turns = e.turns ?? 1;
      const n = Math.round(e.len / DS);
      let prev = 0;
      for (let i = 0; i < n; i++) {
        push(0, z);
        advance();
        const a = smooth((i + 1) / n) * Math.PI * 2 * turns;
        localRot(0, 0, -1, a - prev);
        prev = a;
      }
    }
  }

  // ---- close the circuit with a Hermite connector back to the start ----
  const endP = p.clone();
  const endT = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const startT = new THREE.Vector3(0, 0, -1).applyQuaternion(heading);
  const dist = endP.distanceTo(start);
  if (dist > DS) {
    const L = dist * 1.1;
    const h = (t: number) => {
      const t2 = t * t;
      const t3 = t2 * t;
      return endP
        .clone()
        .multiplyScalar(2 * t3 - 3 * t2 + 1)
        .addScaledVector(endT, (t3 - 2 * t2 + t) * L)
        .addScaledVector(start, -2 * t3 + 3 * t2)
        .addScaledVector(startT, (t3 - t2) * L);
    };
    // resample by arc length
    const fine: THREE.Vector3[] = [];
    for (let i = 0; i <= 400; i++) fine.push(h(i / 400));
    let acc = 0;
    let next = DS;
    for (let i = 1; i < fine.length; i++) {
      const d = fine[i].distanceTo(fine[i - 1]);
      while (acc + d >= next) {
        const k = (next - acc) / d;
        const pt = fine[i - 1].clone().lerp(fine[i], k);
        if (pt.distanceTo(start) > DS * 0.5) {
          pos.push(pt);
          up.push(WORLD_UP.clone());
          zone.push(connectorZone);
        }
        next += DS;
      }
      acc += d;
    }
  }

  // ---- derive tangents from the actual points; make frames orthonormal ----
  const n = pos.length;
  const tan: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pos[(i - 1 + n) % n];
    const b = pos[(i + 1) % n];
    const t = b.clone().sub(a).normalize();
    tan.push(t);
    const u = up[i].clone().addScaledVector(t, -up[i].dot(t)).normalize();
    up[i] = u;
    right.push(new THREE.Vector3().crossVectors(t, u).normalize());
  }
  // smooth up-vectors a little (removes kinks at element joins, e.g. connector start)
  for (let pass = 0; pass < 3; pass++) {
    const copy = up.map((v) => v.clone());
    for (let i = 0; i < n; i++) {
      const v = copy[(i - 1 + n) % n].clone().add(copy[i].clone().multiplyScalar(2)).add(copy[(i + 1) % n]);
      v.addScaledVector(tan[i], -v.dot(tan[i])).normalize();
      up[i] = v;
      right[i].crossVectors(tan[i], v).normalize();
    }
  }
  return { pos, tan, up, right, zone, length: n * DS };
}

/** Interpolated sample at arc-length s (wraps around). */
export function sampleTrack(d: TrackData, s: number, out: { p: THREE.Vector3; t: THREE.Vector3; u: THREE.Vector3; r: THREE.Vector3 }) {
  const n = d.pos.length;
  const x = (((s / DS) % n) + n) % n;
  const i = Math.floor(x);
  const j = (i + 1) % n;
  const k = x - i;
  out.p.copy(d.pos[i]).lerp(d.pos[j], k);
  out.t.copy(d.tan[i]).lerp(d.tan[j], k).normalize();
  out.u.copy(d.up[i]).lerp(d.up[j], k);
  out.u.addScaledVector(out.t, -out.u.dot(out.t)).normalize();
  out.r.crossVectors(out.t, out.u).normalize();
  return out;
}

export function zoneAt(d: TrackData, s: number): Zone | null {
  const n = d.pos.length;
  return d.zone[(((Math.round(s / DS) % n) + n) % n)];
}

// ---------------------------------------------------------------------------------------
// The layout of "The Stack" — Hasan's coaster. Station on x = -26, trains depart south
// and come home from the north, so the circuit never has to cross itself at ground level.
// ---------------------------------------------------------------------------------------
export const STATION_START = new THREE.Vector3(-26, 2.5, -6);
export const STATION_HEADING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // facing +z

export const LAYOUT_ELEMENTS: Element[] = [
  { t: 'straight', len: 18, zone: 'station' },
  { t: 'straight', len: 3 },
  // swing west onto the launch track
  { t: 'turn', angle: -90, radius: 9, bank: 25 },
  { t: 'straight', len: 24, zone: 'launch' },
  // clothoid vertical loop (exit drifts north, beside the entry)
  { t: 'loop', rBottom: 12, rTop: 6, shift: 4.5 },
  { t: 'straight', len: 3 },
  // banked turn north along the west edge
  { t: 'turn', angle: -90, radius: 10, bank: 50 },
  // airtime camelback heading north, finishing high
  { t: 'pitch', angle: 30, radius: 18 },
  { t: 'straight', len: 8 },
  { t: 'pitch', angle: -30, radius: 14 },
  { t: 'straight', len: 2 },
  // high over-banked turn east
  { t: 'turn', angle: -90, radius: 11, bank: 70 },
  { t: 'straight', len: 1.2 },
  // zero-g roll heading east, way up in the air
  { t: 'pitch', angle: 10, radius: 22 },
  { t: 'roll', len: 22 },
  { t: 'pitch', angle: -10, radius: 22 },
  // descending helix that unwinds right onto the station approach; its last quarter
  // dives through the tunnel, and the closing connector is the brake run
  { t: 'pitch', angle: -9, radius: 24 },
  { t: 'turn', angle: -360, radius: 10, bank: 55 },
  { t: 'turn', angle: -90, radius: 10, bank: 30, zone: 'tunnel' },
  { t: 'pitch', angle: 9, radius: 24, zone: 'tunnel' },
];
export const CONNECTOR_ZONE: Zone = 'brake';
