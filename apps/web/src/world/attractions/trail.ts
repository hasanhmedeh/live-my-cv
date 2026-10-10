import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shadowed, staticBox, staticCylinder, std, type Attraction, type Ctx } from '../context';
import type { Input } from '../input';
import { LAYOUT } from '../layout';
import { mulberry } from '../random';
import { crateTexture, DISPLAY_FONT, BODY_FONT, glowTexture, hdr, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';
import type { TrailBoard } from '../../account/api';
import { boardListHtml, medal, msUntil, rankFor, resetClock, resetIn, trailTime } from '../../account/leaderboard';
import {
  BERM,
  BUMPS,
  CHECKPOINTS,
  deltaS,
  GRID_S,
  headingOf,
  heightAt,
  locate,
  patchAt,
  PATCHES,
  START_S,
  TRAIL,
  TRAIL_BOUNDS,
  TRAIL_HALF,
  trailPoint,
  WALL,
  wrapS,
  type Patch,
} from './trail-track';

// The Rally Trail: a time trial in a bouncy dune buggy round a dirt loop on the meadow outside the
// park's south fence, after the circuit in Bruno Simon's portfolio. One lap against the clock:
// skip over the whoops, clear the big jump (or case the landing), splash through the water, keep
// out of the mud, smash the crate walls or weave through them, time the spinner and fly off the
// table-top. Three checkpoints show your split against your best, a ghost buggy drives your best
// run beside you, and the time goes on the daily leaderboard (noon to noon, Beirut time). The
// layout never changes, so every time compares. The buggy drives on arcade physics like the
// speedway's karts, plus the vertical: it follows the ground, takes off when the ground falls away
// faster than gravity can follow, and lands with a thump.

const CAR_R = 1.1; // collision radius
const VMAX = 21; // m/s (76 km/h) flat out on the dirt
const NITRO_K = 1.22;
const BOOST_K = 1.32;
const ACCEL = 11;
const BRAKE = 22;
const REV_ACC = 6;
const REV_MAX = 7;
const STEER = 2.4; // rad/s of yaw at low speed; less as the speed rises
const AIR_YAW = 0.9; // a little steering in the air
const G = 16; // a floaty, arcade gravity
/** How quickly the body's rise and fall catches up with the ground's (1/s): soft enough to soak up a log. */
const SUSPENSION = 22;
/** How quickly the springs bring a body hovering over the ground back down onto it (1/s). */
const SETTLE = 12;
/** The axles, this far ahead of and behind the middle. */
const AXLE = 0.85;
const NITRO_DRAIN = 1 / 2.5; // a full tank lasts 2.5 s…
const NITRO_FILL = 0.05; // …and refills in 20 s
const AI_LAT = 14; // m/s² the demo driver corners at
const GRID_TIME = 3.6; // lights out after this long on the grid
const COOLDOWN = 5; // seconds after the line before you're back at the garage
const RECORD_KEY = 'fair-trail';
const GHOST_KEY = 'fair-trail-ghost';
/** The ghost is recorded (and played back) at this rate. */
const GHOST_DT = 1 / 15;
/** A ghost or a record from another layout of the trail doesn't count: this changes with any of it. */
const TRAIL_VERSION = (() => {
  const text = JSON.stringify([Math.round(TRAIL.length * 10), BUMPS, PATCHES, CHECKPOINTS]);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
})();

type Surface = 'dirt' | 'grass' | 'mud' | 'water';
/** How each surface drives: top speed (fraction), grip, and drag (1/s, on top of rolling resistance). */
const SURFACES: Record<Surface, { speed: number; grip: number; drag: number }> = {
  dirt: { speed: 1, grip: 7.5, drag: 0 },
  grass: { speed: 0.62, grip: 4.5, drag: 0.15 },
  mud: { speed: 0.5, grip: 2, drag: 0.9 },
  water: { speed: 0.72, grip: 5, drag: 0.6 },
};
const DRIFT_GRIP = 2.2;

type Cam = 'chase' | 'far' | 'hood';
const CAM_LABEL: Record<Cam, string> = { chase: 'Chase', far: 'Far', hood: 'Hood' };
type Phase = 'idle' | 'grid' | 'run' | 'done';
type Kind = 'crate' | 'barrel' | 'cone' | 'bale';

interface Wheel {
  pivot: THREE.Group;
  spin: THREE.Group;
  /** Where it sits on the buggy (local x, z; nose to −z), its radius and its suspension's rest height. */
  lx: number;
  lz: number;
  r: number;
  rest: number;
  front: boolean;
  /** How far the suspension is pushed up (+) or hangs down (−) right now. */
  travel: number;
}

interface Car {
  root: THREE.Group;
  body: THREE.Group;
  wheels: Wheel[];
  head: THREE.Object3D;
  x: number;
  z: number;
  /** Height of the buggy's base above the meadow, and its vertical speed. */
  y: number;
  vy: number;
  h: number;
  vx: number;
  vz: number;
  yawRate: number;
  steer: number;
  pitch: number;
  roll: number;
  /** Nearest trail sample, arc length and lateral offset (positive = left). */
  i: number;
  s: number;
  d: number;
  /**
   * The ground under it now, as the body feels it: the ground under the middle, averaged with the
   * ground under each axle (so a log lifts it a little at a time, not all at once), and the
   * ground under each axle on its own.
   */
  gnd: number;
  gF: number;
  gB: number;
  air: boolean;
  airT: number;
  /** Metres past the start line (negative on the grid). */
  prog: number;
  surface: Surface;
  nitro: number;
  nitroOn: boolean;
  boostT: number;
  crashT: number;
  slide: number;
  wrongT: number;
  // this frame's controls
  throttle: number;
  steerIn: number;
  handbrake: boolean;
  wantNitro: boolean;
}

interface Thing {
  kind: Kind;
  /** Things in one stack go down together (−1: on its own). */
  group: number;
  x: number;
  z: number;
  y: number;
  h: number;
  /** Collision radius, and the height of its top (a buggy flying higher clears it). */
  r: number;
  top: number;
  home: { x: number; y: number; z: number; h: number };
  down: boolean;
  resting: boolean;
  /** Just came to rest: its resting pose still has to be drawn. */
  settled: boolean;
  vx: number;
  vy: number;
  vz: number;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  i: number;
}

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  age: number;
  vx: number;
  vy: number;
  vz: number;
  grow: number;
  /** Spray falls back down; dust just drifts. */
  fall: number;
}

interface TrailRecord {
  /** The fastest run in this browser (s), and its checkpoint splits. */
  best: number;
  splits: number[];
  runs: number;
  version: string;
}

const $ = (id: string) => document.getElementById(id)!;
const yawMax = (v: number) => (STEER * Math.min(1, Math.abs(v) / 4)) / (1 + Math.abs(v) / 20);
const signed = (s: number) => `${s < 0 ? '−' : '+'}${Math.abs(s).toFixed(2)}`;

/** Where the spinner turns, and how: a bar across the trail on a post in the middle. */
const SPINNER = { s: 380, half: 3.5, w: 1.25 };

/** The things on the trail: [kind, s, d], and crate pyramids (six crates that go down together). */
const PYRAMIDS: [number, number][] = [
  [62, 2.3],
  [70, -2.3],
];
const SINGLES: [Kind, number, number][] = [
  // hay bales on the inside of the first bend, for anyone cutting it
  ['bale', 108, -3.5],
  ['bale', 115, -3.5],
  // barrels either side of the splash
  ['barrel', 222, 3.7],
  ['barrel', 222, -3.7],
  ['barrel', 242, 3.7],
  ['barrel', 242, -3.7],
  // a slalom of cones up the S
  ...[0, 1, 2, 3, 4, 5].map((j): [Kind, number, number] => ['cone', 300 + j * 6, j % 2 ? 1.8 : -1.8]),
  // two crate walls in the infield: the gap is on the right, then on the left
  ...[3.8, 2.85, 1.9, 0.95, 0].map((d): [Kind, number, number] => ['crate', 348, d]),
  ...[-3.8, -2.85, -1.9, -0.95, 0].map((d): [Kind, number, number] => ['crate', 358, d]),
  // bales on the inside of the hairpin, barrels on the outside of the last bend
  ['bale', 410, 3.5],
  ['bale', 418, 3.5],
  ['barrel', 500, 3.7],
  ['barrel', 508, 3.7],
];
const CRATE = 0.9;

export class Trail implements Attraction {
  private car!: Car;
  private ghost!: { root: THREE.Group; wheels: THREE.Object3D[] };
  private things: Thing[] = [];
  private meshes!: Record<Kind, THREE.InstancedMesh>;
  private thingsMoving = false;
  /** Target speed round the trail for the demo driver (from the curvature, with braking zones). */
  private profile = new Float32Array(TRAIL.n);
  private lamps: THREE.MeshBasicMaterial[] = [];
  private arches: THREE.MeshStandardMaterial[] = [];
  private boostTex!: THREE.Texture;
  private waterTex!: THREE.Texture;
  private spinner!: THREE.Group;
  private spinAngle = 0;
  private spinPos = { x: 0, z: 0 };
  private display!: THREE.Group;
  private boards: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D }[] = [];
  private boardMinute = -1;
  private puffs: Puff[] = [];
  private puffNext = 0;
  private puffT = 0;
  private phase: Phase = 'idle';
  private phaseT = 0;
  private raceT = 0;
  private beat = -1;
  private cpNext = 0;
  private cpTimes: number[] = [];
  private cam: Cam = 'chase';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private hudTimer = 0;
  private toastTimer = 0;
  private splitTimer = 0;
  private introTimer = 0;
  private rescueT = 0;
  private record: TrailRecord = { best: 0, splits: [], runs: 0, version: TRAIL_VERSION };
  private stats = { crates: 0, crashes: 0, air: 0, bigAir: 0, rescues: 0 };
  /** This round's top speed (m/s), the finished run's time, and its stats as they stood when you left. */
  private topSpeed = 0;
  private finishTime: number | null = null;
  /** When it crossed the line (performance.now()), so the server can tell which board the run belongs to. */
  private lineAt = 0;
  private final: Record<string, number> | null = null;
  /** The best run's ghost: x, y, z, heading, pitch every GHOST_DT. */
  private ghostRun: { time: number; pts: number[] } | null = null;
  private recording: number[] = [];
  private recordT = 0;
  private board: TrailBoard | null = null;
  private loc = { i: 0, s: 0, d: 0 };
  private wloc = { i: 0, s: 0, d: 0 };
  private pt = { x: 0, z: 0, tx: 0, tz: 0 };
  active = false;
  /** The demo buggy may be heard from the park (not while you're on another ride with an engine of its own). */
  ambient = true;
  input: Input | null = null;
  onFinish: (() => void) | null = null;
  /** The run is over and the cool-down is done: time to go back to the park. */
  onComplete: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    this.loadRecord();
    this.buildProfile();
    this.buildGround();
    this.buildDirt();
    this.buildPatches();
    this.buildFences();
    this.buildStart();
    this.buildCheckpoints();
    this.buildFeatures();
    this.buildSpinner();
    this.buildThings();
    this.buildScenery();
    this.buildGarage();
    this.buildPuffs();
    this.car = this.makeCar();
    this.ghost = this.makeGhost();
    this.toGrid();
    // while nobody's driving, the demo buggy laps the trail (from a little way round, so it's moving)
    this.car.prog = -1e9;
  }

  // ------------------------------------------------------------------ records

  private loadRecord() {
    try {
      const r = JSON.parse(localStorage.getItem(RECORD_KEY) ?? 'null') as Partial<TrailRecord> | null;
      if (r && r.version === TRAIL_VERSION && typeof r.best === 'number') this.record = { ...this.record, ...r };
      const g = JSON.parse(localStorage.getItem(GHOST_KEY) ?? 'null') as { version?: string; time?: number; pts?: number[] } | null;
      if (g && g.version === TRAIL_VERSION && Array.isArray(g.pts) && typeof g.time === 'number') this.ghostRun = { time: g.time, pts: g.pts };
    } catch {
      /* storage unavailable */
    }
  }

  private saveRecord() {
    try {
      localStorage.setItem(RECORD_KEY, JSON.stringify(this.record));
    } catch {
      /* storage unavailable */
    }
  }

  private saveGhost() {
    if (!this.ghostRun) return;
    try {
      localStorage.setItem(GHOST_KEY, JSON.stringify({ version: TRAIL_VERSION, time: this.ghostRun.time, pts: this.ghostRun.pts }));
    } catch {
      /* storage unavailable (or full): the ghost lasts this visit */
    }
  }

  // ------------------------------------------------------------------ building the trail

  private buildProfile() {
    const C = TRAIL;
    const v = this.profile;
    for (let i = 0; i < C.n; i++) v[i] = Math.min(VMAX * 0.9, Math.sqrt(AI_LAT / Math.max(1e-4, Math.abs(C.k[i]))));
    // slow down in time for what's coming (twice round, for the wrap)
    for (let pass = 0; pass < 2; pass++)
      for (let q = C.n - 1; q >= 0; q--) v[q] = Math.min(v[q], Math.sqrt(v[(q + 1) % C.n] ** 2 + 2 * 10 * C.ds));
  }

  /** A mown meadow round the trail, its edge feathered into the country. */
  private buildGround() {
    const b = TRAIL_BOUNDS;
    const m = 10;
    const x0 = b.x0 - m, x1 = b.x1 + m, z0 = b.z0 - m, z1 = b.z1 + m;
    const k = this.ctx.mobile || this.ctx.quality.tier === 'lowest' ? 3 : 4;
    const w = Math.ceil((x1 - x0) * k);
    const h = Math.ceil((z1 - z0) * k);
    const X = (x: number) => (x - x0) * k;
    const Z = (z: number) => (z - z0) * k;
    const C = TRAIL;
    const trace = (g: CanvasRenderingContext2D) => {
      g.beginPath();
      for (let i = 0; i <= C.n; i++) {
        const p = trailPoint(i * C.ds, 0, this.pt);
        if (i) g.lineTo(X(p.x), Z(p.z));
        else g.moveTo(X(p.x), Z(p.z));
      }
      g.closePath();
    };
    const { c, g } = canvas(w, h);
    g.fillStyle = '#4a8a4f';
    g.fillRect(0, 0, w, h);
    // mowing stripes across the meadow
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-Math.PI / 5);
    g.fillStyle = 'rgba(160, 215, 120, 0.1)';
    const diag = Math.hypot(w, h);
    for (let y = -diag; y < diag; y += 14 * k) g.fillRect(-diag, y, diag * 2, 7 * k);
    g.restore();
    const rnd = mulberry(17);
    for (let i = 0; i < (w * h) / 50; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(130,190,110,0.16)' : 'rgba(20,60,40,0.18)';
      const s = (0.15 + rnd() * 0.25) * k;
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
    // wild flowers dotted about
    for (let i = 0; i < (w * h) / 900; i++) {
      g.fillStyle = ['#ffd75e', '#ffffff', '#ff8fb0', '#b9a2ff'][Math.floor(rnd() * 4)];
      g.fillRect(rnd() * w, rnd() * h, 0.18 * k, 0.18 * k);
    }
    // the mask: the infield and a band round the fence, feathered at the edge
    const mask = canvas(w, h);
    const mg = mask.g;
    mg.lineCap = mg.lineJoin = 'round';
    mg.fillStyle = mg.strokeStyle = '#fff';
    trace(mg);
    mg.fill('evenodd');
    for (let j = 0; j < 6; j++) {
      mg.globalAlpha = 0.32;
      mg.lineWidth = 2 * (WALL + 2 + j * 1.2) * k;
      trace(mg);
      mg.stroke();
    }
    mg.globalAlpha = 1;
    mg.lineWidth = 2 * (WALL + 1.5) * k;
    trace(mg);
    mg.stroke();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask.c, 0, 0);
    g.globalCompositeOperation = 'source-over';
    const tex = finish(c);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2),
      std('#ffffff', { map: tex, roughness: 0.95, transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    patch.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    patch.receiveShadow = true;
    this.ctx.scene.add(patch);
  }

  /**
   * A ribbon along the trail between offsets dl (left) and dr (right), following the ground's
   * height (plus `lift`), from s0 to s1, with rows every `step` metres. `uv` maps (across 0–1, along
   * in metres).
   */
  private ribbon(dl: number, dr: number, lift: number, s0: number, s1: number, step: number, vScale: number, flat = false) {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const rows = Math.max(1, Math.ceil((s1 - s0) / step));
    // across: the edges and, for the dirt, the tops of the berms (so the height follows the shape)
    const cuts = flat ? [dl, dr] : [dl, Math.min(dl, TRAIL_HALF), Math.max(dr, -TRAIL_HALF), dr].filter((d, i, a) => i === 0 || d < a[i - 1] - 1e-6);
    const cols = cuts.length;
    for (let r = 0; r <= rows; r++) {
      const s = s0 + ((s1 - s0) * r) / rows;
      for (const d of cuts) {
        const p = trailPoint(s, d, this.pt);
        pos.push(p.x, (flat ? 0 : heightAt(s, d)) + lift, p.z);
        uv.push((dl - d) / (dl - dr), (s - s0) / vScale);
      }
      if (r < rows)
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** The dirt: rutted down the middle, grassy and ragged at the edges, rising over every bump. */
  private buildDirt() {
    const W = TRAIL_HALF + BERM;
    const dirt = new THREE.Mesh(
      this.ribbon(W, -W, 0.035, 0, TRAIL.length, 0.25, 9),
      std('#ffffff', { map: dirtTexture(), roughness: 0.95, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    dirt.receiveShadow = true;
    this.ctx.scene.add(dirt);
  }

  /** Mud, water and boost pads, laid over the dirt. */
  private buildPatches() {
    this.boostTex = chevronTexture();
    this.waterTex = rippleTexture();
    const mud = std('#ffffff', { map: mudTexture(), roughness: 0.25, metalness: 0.1, transparent: true, alphaTest: 0.05, polygonOffset: true, polygonOffsetFactor: -4 });
    const water = new THREE.MeshStandardMaterial({
      color: '#5fb6d6',
      map: this.waterTex,
      transparent: true,
      opacity: 0.78,
      roughness: 0.08,
      metalness: 0.25,
      depthWrite: false,
    });
    const boost = new THREE.MeshBasicMaterial({ map: this.boostTex, color: hdr('#ffffff', 2.2), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
    for (const p of PATCHES) {
      const len = deltaS(p.s0, p.s1);
      const mat = p.kind === 'mud' ? mud : p.kind === 'water' ? water : boost;
      const geo = this.ribbon(p.d1, p.d0, p.kind === 'water' ? 0.16 : p.kind === 'mud' ? 0.05 : 0.06, p.s0, p.s0 + len, 0.5, p.kind === 'boost' ? 2 : 6, p.kind === 'water');
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = p.kind !== 'boost';
      mesh.renderOrder = p.kind === 'water' ? 2 : 1;
      this.ctx.scene.add(mesh);
    }
  }

  /** A ranch fence along both sides: posts every few metres and two rails, open behind the start gantry's feet. */
  private buildFences() {
    const C = TRAIL;
    const step = 2.6;
    const n = Math.floor(C.length / step);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 1.15, 6).translate(0, 0.575, 0), std('#7a5a3c', { roughness: 0.9 }), n * 2);
    const m = new THREE.Matrix4();
    let c = 0;
    for (const side of [-1, 1])
      for (let j = 0; j < n; j++) {
        const p = trailPoint(j * step, side * WALL, this.pt);
        posts.setMatrixAt(c++, m.makeTranslation(p.x, 0, p.z));
      }
    posts.castShadow = true;
    this.ctx.scene.add(posts);
    // the rails: thin strips, seen from both sides (red flags of tape on the top one)
    const rail = (y0: number, y1: number) => {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (const side of [-1, 1]) {
        const base = pos.length / 3;
        for (let j = 0; j <= C.n; j++) {
          const s = j * C.ds;
          const p = trailPoint(s, side * (WALL - 0.1), this.pt);
          pos.push(p.x, y0, p.z, p.x, y1, p.z);
          uv.push(s / 3, 0, s / 3, 1);
          if (j < C.n) {
            const a = base + j * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };
    const wood = std('#b08a5e', { roughness: 0.85, side: THREE.DoubleSide });
    const tape = std('#ffffff', { map: stripeTexture(PALETTE.candy, PALETTE.cream, 8), roughness: 0.6, side: THREE.DoubleSide });
    (tape.map as THREE.Texture).repeat.set(1, 1);
    const low = new THREE.Mesh(rail(0.38, 0.5), wood);
    const high = new THREE.Mesh(rail(0.88, 1.02), tape);
    low.castShadow = high.castShadow = true;
    this.ctx.scene.add(low, high);
  }

  /** The chequered line and the gantry with its start lights and the trail's name. */
  private buildStart() {
    const scene = this.ctx.scene;
    const p = trailPoint(START_S, 0, { x: 0, z: 0, tx: 0, tz: 0 });
    const yaw = headingOf(p.tx, p.tz);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAIL_HALF * 2, 1.2).rotateX(-Math.PI / 2),
      std('#ffffff', { map: checkerTexture(12, 2), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    line.position.set(p.x, 0.045, p.z);
    line.rotation.y = yaw;
    line.receiveShadow = true;
    scene.add(line);

    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = yaw; // local −z runs down the trail, local x to the right
    const timber = std('#6b4a30', { roughness: 0.85 });
    const span = WALL + 1;
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 0.7), timber);
      pillar.position.set(sx * span, 3.2, 0);
      g.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 1.3, 0.55), timber);
    beam.position.y = 6.2;
    g.add(beam);
    const signTex = signTexture('RALLY TRAIL', { sub: 'Time trial · start / finish', border: PALETTE.orange, width: 1536, height: 288 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(9.2, 1.8, 0.1), std(PALETTE.ink));
    board.position.set(0, 7.75, 0);
    g.add(board);
    for (const face of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.69), signMaterial(signTex));
      sign.position.set(0, 7.75, face * 0.06);
      if (face < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    const housing = std('#141218', { roughness: 0.5 });
    for (let j = 0; j < 3; j++) {
      const mat = new THREE.MeshBasicMaterial({ color: hdr('#3a1418', 1) });
      this.lamps.push(mat);
      for (const sx of [-1, 1]) {
        const x = sx * (0.9 + j * 1.1);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.3), housing);
        box.position.set(x, 6.2, 0.4);
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), mat);
        lamp.position.set(x, 6.2, 0.56);
        g.add(box, lamp);
      }
    }
    shadowed(g);
    scene.add(g);

    // the leaderboard by the start, between the trail and the park: its face to the drivers, its back to the fence
    // (a group turned by headingOf + π/2 has its local +z to the right of the trail, turned a little towards the oncoming buggy)
    const q = trailPoint(START_S - 16, WALL + 3.5, { x: 0, z: 0, tx: 0, tz: 0 });
    this.addBoard(q.x, q.z, headingOf(q.tx, q.tz) + Math.PI / 2 - 0.35, 1);
  }

  /** An inflatable arch over each checkpoint, flashing when you pass. */
  private buildCheckpoints() {
    const r = WALL - 0.3;
    const arch = new THREE.TorusGeometry(r, 0.42, 10, 40, Math.PI);
    CHECKPOINTS.forEach((offset, i) => {
      const p = trailPoint(START_S + offset, 0, { x: 0, z: 0, tx: 0, tz: 0 });
      const mat = std(i % 2 ? PALETTE.mustard : PALETTE.teal, { roughness: 0.45, emissive: '#000000' });
      this.arches.push(mat);
      const m = new THREE.Mesh(arch, mat);
      m.scale.y = 0.62; // an arch about 5 m tall
      m.position.set(p.x, 0, p.z);
      m.rotation.y = headingOf(p.tx, p.tz);
      m.castShadow = true;
      this.ctx.scene.add(m);
      // the number on a little flag on top
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), signMaterial(signTexture(`CHECKPOINT ${i + 1}`, { border: PALETTE.ink, width: 768, height: 384, fontSize: 92 }), { side: THREE.DoubleSide, emissiveIntensity: 1.4 }));
      flag.position.set(p.x, r * 0.62 + 0.9, p.z);
      flag.rotation.y = headingOf(p.tx, p.tz);
      this.ctx.scene.add(flag);
    });
  }

  /** The logs across the dirt, warning signs before the jumps, and chevrons round the tightest bends. */
  private buildFeatures() {
    const scene = this.ctx.scene;
    const bark = std('#6e4b2e', { roughness: 0.95 });
    const ring = std('#d8b98a', { roughness: 0.8 });
    for (const b of BUMPS) {
      if (b.kind !== 'log') continue;
      const p = trailPoint(b.s, 0, this.pt);
      const len = (TRAIL_HALF + BERM * 0.6) * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r * 1.05, len, 12), [bark, ring, ring]);
      log.rotation.order = 'YXZ';
      log.rotation.y = headingOf(p.tx, p.tz);
      log.rotation.z = Math.PI / 2;
      log.position.set(p.x, b.r, p.z);
      shadowed(log, true);
      scene.add(log);
    }
    // signs on posts just outside the fence, facing the oncoming buggy
    const sign = (s: number, side: number, title: string, sub: string, color: string) => {
      const p = trailPoint(s, side * (WALL + 1.3), { x: 0, z: 0, tx: 0, tz: 0 });
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = headingOf(p.tx, p.tz) + Math.PI; // the face (local +z) looks back down the trail
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), std('#3a3340', { metalness: 0.5 }));
      post.position.y = 1.2;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1), signMaterial(signTexture(title, { sub, border: color, width: 768, height: 296, fontSize: 104 }), { emissiveIntensity: 1.5 }));
      board.position.set(0, 2.2, 0.05);
      g.add(post, board);
      shadowed(g);
      scene.add(g);
    };
    sign(132, 1, 'WHOOPS!', 'Skip over the bumps', PALETTE.mustard);
    sign(160, 1, 'BIG JUMP', 'Full throttle!', PALETTE.candy);
    sign(214, -1, 'SPLASH', 'Water ahead', PALETTE.teal);
    sign(338, 1, 'CRATES', 'Smash or weave', PALETTE.orange);
    sign(368, -1, 'SPINNER', 'Time it!', PALETTE.violet);
    sign(452, 1, 'LOGS', 'Then the table-top', PALETTE.mustard);
    // chevrons on the outside of the tight bends
    const chevron = chevronBoardTexture();
    const chevMat = signMaterial(chevron, { emissiveIntensity: 1.2 });
    for (const [s0, s1, side] of [
      [395, 432, -1],
      [262, 300, 1],
      [486, 532, 1],
    ] as const)
      for (let s = s0; s <= s1; s += 9) {
        const p = trailPoint(s, side * (WALL + 0.9), { x: 0, z: 0, tx: 0, tz: 0 });
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), chevMat);
        board.position.set(p.x, 1.25, p.z);
        // face the inside of the bend, chevrons pointing along the trail
        board.rotation.y = headingOf(p.tx, p.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        if (side < 0) board.scale.x = -1;
        scene.add(board);
      }
  }

  /** The spinner: a striped bar on a post in the middle of the trail, sweeping round. */
  private buildSpinner() {
    const p = trailPoint(SPINNER.s, 0, { x: 0, z: 0, tx: 0, tz: 0 });
    this.spinPos = { x: p.x, z: p.z };
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.4, 16), std('#2c2834', { metalness: 0.6, roughness: 0.4 }));
    post.position.y = 0.7;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.18, 20), std('#ffffff', { map: stripeTexture(PALETTE.mustard, PALETTE.ink, 12) }));
    base.position.y = 0.09;
    this.spinner = new THREE.Group();
    this.spinner.position.y = 0.95;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(SPINNER.half * 2, 0.4, 0.4), std('#ffffff', { map: stripeTexture(PALETTE.candy, PALETTE.cream, 14), roughness: 0.5 }));
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), std(PALETTE.violet, { roughness: 0.4 }));
    for (const sx of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 14), std('#1d1b22', { roughness: 0.9 }));
      pad.rotation.z = Math.PI / 2;
      pad.position.x = sx * SPINNER.half;
      this.spinner.add(pad);
    }
    this.spinner.add(bar, hub);
    g.add(post, base, this.spinner);
    shadowed(g, true);
    this.ctx.scene.add(g);
  }

  private buildThings() {
    const crate = new THREE.BoxGeometry(CRATE, CRATE, CRATE);
    const crateMesh = new THREE.InstancedMesh(crate, std('#ffffff', { map: crateTexture('★', '#c98a4b'), roughness: 0.8 }), 32);
    const barrel = mergeGeometries([new THREE.CylinderGeometry(0.36, 0.36, 0.95, 16, 1, true), new THREE.CircleGeometry(0.36, 16).rotateX(-Math.PI / 2).translate(0, 0.475, 0)], true)!;
    barrel.translate(0, 0.475, 0);
    const stripes = stripeTexture(PALETTE.candy, PALETTE.cream, 6, true);
    const barrelMesh = new THREE.InstancedMesh(barrel, [std('#ffffff', { map: stripes, roughness: 0.5, metalness: 0.3 }), std('#8d8796', { metalness: 0.6, roughness: 0.4 })], 16);
    const cone = mergeGeometries(
      [
        new THREE.ConeGeometry(0.2, 0.62, 14, 1, true).translate(0, 0.37, 0),
        new THREE.CylinderGeometry(0.115, 0.15, 0.12, 14, 1, true).translate(0, 0.42, 0),
        new THREE.BoxGeometry(0.46, 0.05, 0.46).translate(0, 0.025, 0),
      ],
      true,
    )!;
    const orange = std(PALETTE.orange, { roughness: 0.5 });
    const coneMesh = new THREE.InstancedMesh(cone, [orange, std('#ffffff', { roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.15 }), orange], 16);
    const bale = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 18).rotateZ(Math.PI / 2).translate(0, 0.75, 0);
    const baleMesh = new THREE.InstancedMesh(bale, std('#ffffff', { map: hayTexture(), roughness: 0.95 }), 8);
    this.meshes = { crate: crateMesh, barrel: barrelMesh, cone: coneMesh, bale: baleMesh };
    for (const im of Object.values(this.meshes)) {
      im.count = 0;
      im.frustumCulled = false; // spread round the whole trail
      im.castShadow = true;
      im.receiveShadow = true;
      this.ctx.scene.add(im);
    }

    const counts: Record<Kind, number> = { crate: 0, barrel: 0, cone: 0, bale: 0 };
    let groups = 0;
    const add = (kind: Kind, s: number, d: number, y: number, group: number) => {
      const p = trailPoint(s, d, this.pt);
      const h = headingOf(p.tx, p.tz);
      const r = kind === 'crate' ? 0.58 : kind === 'barrel' ? 0.42 : kind === 'cone' ? 0.3 : 0.85;
      const top = kind === 'crate' ? y + CRATE / 2 : kind === 'barrel' ? 0.95 : kind === 'cone' ? 0.62 : 1.5;
      this.things.push({
        kind,
        group,
        x: p.x,
        z: p.z,
        y,
        h,
        r,
        top,
        home: { x: p.x, y, z: p.z, h },
        down: false,
        resting: false,
        settled: false,
        vx: 0,
        vy: 0,
        vz: 0,
        q: new THREE.Quaternion(),
        axis: new THREE.Vector3(),
        spin: 0,
        i: counts[kind]++,
      });
    };
    for (const [s, d] of PYRAMIDS) {
      const g = groups++;
      for (const off of [-0.95, 0, 0.95]) add('crate', s, d + off, CRATE / 2, g);
      for (const off of [-0.475, 0.475]) add('crate', s, d + off, CRATE * 1.5, g);
      add('crate', s, d, CRATE * 2.5, g);
    }
    for (const [kind, s, d] of SINGLES) add(kind, s, d, kind === 'crate' ? CRATE / 2 : 0, -1);
    for (const k of Object.keys(counts) as Kind[]) this.meshes[k].count = counts[k];
    this.resetThings();
  }

  /** Everything back where it started (a new run, or the demo buggy coming round again). */
  private resetThings() {
    for (const t of this.things) {
      Object.assign(t, { ...t.home, down: false, resting: false, settled: false, vx: 0, vy: 0, vz: 0, spin: 0 });
      t.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.h);
    }
    this.syncThings(true);
  }

  /** Writes the things' transforms into the instanced meshes (only the moving ones after the first time). */
  private syncThings(all = false) {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let moving = false;
    for (const t of this.things) {
      // after the first time: only what's flying, and what has just come to rest (drawn once more, lying still)
      if (!all && (!t.down || (t.resting && !t.settled))) continue;
      t.settled = false;
      moving ||= t.down && !t.resting;
      this.meshes[t.kind].setMatrixAt(t.i, m.compose(p.set(t.x, t.y, t.z), t.q, one));
      this.meshes[t.kind].instanceMatrix.needsUpdate = true;
    }
    this.thingsMoving = moving;
  }

  /** Rocks and bushes in the infield, and a few pines beyond the fence. */
  private buildScenery() {
    const rnd = mulberry(23);
    const rocks: THREE.Matrix4[] = [];
    const bushes: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const b = TRAIL_BOUNDS;
    for (let i = 0; i < 260 && (rocks.length < 26 || bushes.length < 40); i++) {
      const x = b.x0 + rnd() * (b.x1 - b.x0);
      const z = b.z0 + rnd() * (b.z1 - b.z0);
      const loc = locate(x, z, -1, 10, this.wloc);
      // clear of the fence, on either side, and not too far out on the meadow
      if (Math.abs(loc.d) < WALL + 2 || Math.abs(loc.d) > WALL + 16) continue;
      const s = 0.4 + rnd() * 0.9;
      q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * 6, rnd() * 0.4));
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(x, s * 0.25, z), q, new THREE.Vector3(s * (1 + rnd()), s * (0.6 + rnd() * 0.5), s * (1 + rnd())));
      if (rnd() < 0.4 && rocks.length < 26) rocks.push(mtx);
      else if (bushes.length < 40) bushes.push(mtx);
    }
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std('#a59a8f', { roughness: 0.9, flatShading: true }), rocks.length);
    rocks.forEach((m, i) => rockMesh.setMatrixAt(i, m));
    const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), std('#3f7a45', { roughness: 0.9 }), bushes.length);
    bushes.forEach((m, i) => bushMesh.setMatrixAt(i, m));
    for (const im of [rockMesh, bushMesh]) {
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.ctx.scene.add(im);
    }
    // flags along the start straight, in the fair's colours
    const cols = [PALETTE.candy, PALETTE.mustard, PALETTE.teal, PALETTE.violet];
    for (let j = 0; j < 8; j++) {
      const p = trailPoint(START_S + 6 + j * 7, -(WALL + 0.6), this.pt);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 6), std('#3a3340', { metalness: 0.6 }));
      pole.position.set(p.x, 1.7, p.z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), std(cols[j % 4], { side: THREE.DoubleSide, roughness: 0.7 }));
      flag.position.set(p.x + 0.45, 3.1, p.z);
      this.ctx.scene.add(pole, flag);
    }
  }

  /**
   * The trail's shed inside the park, at the end of its path: a counter under a gable roof, the
   * trail's sign, a show buggy on a dirt mound and today's leaderboard on a big board beside it.
   */
  private buildGarage() {
    const L = LAYOUT.trail;
    const root = new THREE.Group();
    root.position.set(L.x, 0, L.z);
    root.rotation.y = Math.PI; // the counter (local +z) faces the path, north
    const plank = std('#c9874a', { roughness: 0.85 });
    const hut = new THREE.Mesh(new THREE.BoxGeometry(5, 2.8, 3.2), plank);
    hut.position.y = 1.4;
    // a gable roof: two sloping boards meeting over the middle
    const tiles = std(PALETTE.candy, { roughness: 0.6 });
    for (const sz of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.14, 2.15), tiles);
      half.position.set(0, 3.25, sz * 0.86);
      half.rotation.x = sz * 0.5;
      root.add(half);
    }
    const gable = new THREE.Shape([new THREE.Vector2(-1.6, 0), new THREE.Vector2(1.6, 0), new THREE.Vector2(0, 0.95)]);
    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.ShapeGeometry(gable).rotateY(Math.PI / 2), std('#b97a42', { roughness: 0.85, side: THREE.DoubleSide }));
      end.position.set(sx * 2.49, 2.8, 0);
      root.add(end);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 0.8), std(PALETTE.cream));
    counter.position.set(0, 1.2, 1.9);
    const window_ = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), new THREE.MeshBasicMaterial({ color: hdr('#ffb46b', 1.4) }));
    window_.position.set(0, 1.9, 1.61);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.8), signMaterial(signTexture('RALLY TRAIL', { sub: 'Time trial · daily leaderboard', border: PALETTE.orange })));
    sign.position.set(0, 4.5, 1.2);
    sign.rotation.x = -0.1;
    root.add(hut, counter, window_, sign);
    // tyres stacked by the door, a chequered flag
    for (let j = 0; j < 3; j++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.16, 8, 18), std(j === 1 ? PALETTE.orange : '#1d1b22', { roughness: 0.85 }));
      t.rotation.x = Math.PI / 2;
      t.position.set(-3.1, 0.16 + j * 0.32, 1.4);
      root.add(t);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4), std('#2c2834', { metalness: 0.6 }));
    pole.position.set(2.9, 2, 1.5);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), std('#ffffff', { map: checkerTexture(6, 4), side: THREE.DoubleSide }));
    flag.position.set(3.5, 3.6, 1.5);
    root.add(pole, flag);
    // the show buggy on its mound, turning slowly
    const mound = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), std('#9b7a52', { roughness: 0.95 }));
    mound.scale.y = 0.28;
    mound.position.set(5.6, 0, 1.2);
    this.display = new THREE.Group();
    this.display.position.set(5.6, 0.5, 1.2);
    this.display.add(buggyModel(PALETTE.orange).root);
    root.add(mound, this.display);
    shadowed(root, true);
    this.ctx.scene.add(root);
    // colliders, in world space (the root is turned half round: local x and z both flip)
    const at = (lx: number, lz: number) => [L.x - lx, L.z - lz] as const;
    const [hx, hz] = at(0, 0.2);
    staticBox(this.ctx, hx, 1.4, hz, 2.5, 1.4, 1.9);
    const [mx, mz] = at(5.6, 1.2);
    staticCylinder(this.ctx, mx, mz, 1.9, 1.3);
    const [tx, tz] = at(-3.1, 1.4);
    staticCylinder(this.ctx, tx, tz, 0.55, 1);
    // the big leaderboard, west of the shed, angled to the path
    const [bx, bz] = at(-7.4, 0.6);
    this.addBoard(bx, bz, Math.PI + 0.3, 1.15);
    staticBox(this.ctx, bx, 1.5, bz, 2.9, 1.5, 0.35, Math.PI + 0.3);
  }

  /** A leaderboard on two posts, its face (local +z) turned to `yaw`. All of them show the same board. */
  private addBoard(x: number, z: number, yaw: number, scale: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    g.scale.setScalar(scale);
    const steel = std('#2c2834', { metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.6, 0.28), steel);
      post.position.set(sx * 2.4, 2.3, -0.1);
      g.add(post);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 4.2, 0.18), std(PALETTE.ink, { roughness: 0.6 }));
    frame.position.set(0, 3.6, -0.1);
    const c = canvas(1024, 768);
    const tex = finish(c.c);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 3.83), signMaterial(tex, { emissiveIntensity: 1.6 }));
    face.position.set(0, 3.6, 0.01);
    const backTex = signTexture('RALLY TRAIL', { sub: 'Today’s fastest · round the other side', border: PALETTE.orange, width: 1024, height: 768, fontSize: 150 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 3.83), signMaterial(backTex, { emissiveIntensity: 1.2 }));
    back.position.set(0, 3.6, -0.2);
    back.rotation.y = Math.PI;
    g.add(frame, face, back);
    shadowed(g);
    this.ctx.scene.add(g);
    this.boards.push({ tex, g: c.g });
    this.drawBoards();
  }

  /** Paints today's top eight (and the time to the turnover) on every leaderboard. */
  private drawBoards() {
    const b = this.board;
    for (const { tex, g } of this.boards) {
      const W = 1024;
      const H = 768;
      g.clearRect(0, 0, W, H);
      g.fillStyle = PALETTE.ink;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = PALETTE.orange;
      g.lineWidth = 14;
      g.strokeRect(14, 14, W - 28, H - 28);
      g.textBaseline = 'middle';
      g.fillStyle = PALETTE.mustard;
      g.font = `92px ${DISPLAY_FONT}`;
      g.textAlign = 'center';
      g.fillText('TODAY’S FASTEST', W / 2, 92);
      g.font = `700 34px ${BODY_FONT}`;
      g.fillStyle = PALETTE.cream;
      g.fillText(b ? `Rally Trail · new board in ${resetIn(msUntil(b.resetsAt))} (12:00 Beirut)` : 'Rally Trail · daily leaderboard', W / 2, 160);
      const rows = b?.entries.slice(0, 8) ?? [];
      if (!rows.length) {
        g.font = `64px ${DISPLAY_FONT}`;
        g.fillStyle = PALETTE.cream;
        g.fillText(b ? 'No times yet today' : 'Loading…', W / 2, 400);
        g.font = `700 36px ${BODY_FONT}`;
        g.fillStyle = PALETTE.teal;
        if (b) g.fillText('Set the first one! 🏁', W / 2, 480);
      }
      rows.forEach((e, i) => {
        const y = 230 + i * 64;
        g.fillStyle = i % 2 ? 'rgba(255,245,227,0.05)' : 'rgba(255,245,227,0.1)';
        g.fillRect(60, y - 28, W - 120, 56);
        g.textAlign = 'left';
        g.font = `48px ${DISPLAY_FONT}`;
        g.fillStyle = i === 0 ? PALETTE.mustard : PALETTE.cream;
        g.fillText(i < 3 ? medal(e.rank) : `${e.rank}.`, 80, y + 2);
        g.font = `700 40px ${BODY_FONT}`;
        g.fillText(clip(g, e.username, 520), 180, y + 2);
        g.textAlign = 'right';
        g.font = `48px ${DISPLAY_FONT}`;
        g.fillText(trailTime(e.timeMs), W - 80, y + 2);
      });
      if (b && b.players > rows.length) {
        g.textAlign = 'center';
        g.font = `700 30px ${BODY_FONT}`;
        g.fillStyle = 'rgba(255,245,227,0.6)';
        g.fillText(`${b.players} drivers today`, W / 2, H - 52);
      }
      tex.needsUpdate = true;
    }
  }

  private buildPuffs() {
    const tex = glowTexture('#ffffff');
    for (let i = 0; i < 44; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: '#c7a77d', transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.ctx.scene.add(sprite);
      this.puffs.push({ sprite, mat, life: 1, age: 1, vx: 0, vy: 0, vz: 0, grow: 1, fall: 0 });
    }
  }

  private puff(x: number, y: number, z: number, color: string, size: number, vx: number, vy: number, vz: number, life: number, fall = 0.3) {
    const p = this.puffs[this.puffNext];
    this.puffNext = (this.puffNext + 1) % this.puffs.length;
    p.sprite.position.set(x, y, z);
    p.sprite.scale.setScalar(size);
    p.sprite.visible = true;
    p.mat.color.set(color);
    Object.assign(p, { life, age: 0, vx, vy, vz, grow: size * 1.6, fall });
  }

  private makeCar(): Car {
    const m = buggyModel(PALETTE.candy);
    m.root.rotation.order = 'YXZ';
    shadowed(m.root);
    this.ctx.scene.add(m.root);
    return {
      root: m.root,
      body: m.body,
      wheels: m.wheels,
      head: m.head,
      x: 0,
      z: 0,
      y: 0,
      vy: 0,
      h: 0,
      vx: 0,
      vz: 0,
      yawRate: 0,
      steer: 0,
      pitch: 0,
      roll: 0,
      i: 0,
      s: 0,
      d: 0,
      gnd: 0,
      gF: 0,
      gB: 0,
      air: false,
      airT: 0,
      prog: 0,
      surface: 'dirt',
      nitro: 1,
      nitroOn: false,
      boostT: 0,
      crashT: 0,
      slide: 0,
      wrongT: 0,
      throttle: 0,
      steerIn: 0,
      handbrake: false,
      wantNitro: false,
    };
  }

  private makeGhost() {
    const m = buggyModel(PALETTE.teal, true);
    m.root.rotation.order = 'YXZ';
    m.root.visible = false;
    this.ctx.scene.add(m.root);
    return { root: m.root, wheels: m.wheels.map((w) => w.spin) };
  }

  // ------------------------------------------------------------------ run control

  /** On the grid, a few metres behind the line, facing down the trail. */
  private toGrid() {
    const k = this.car;
    const p = trailPoint(GRID_S, 0, this.pt);
    Object.assign(k, {
      x: p.x,
      z: p.z,
      y: 0,
      vy: 0,
      h: headingOf(p.tx, p.tz),
      vx: 0,
      vz: 0,
      yawRate: 0,
      steer: 0,
      pitch: 0,
      roll: 0,
      gnd: 0,
      gF: 0,
      gB: 0,
      air: false,
      airT: 0,
      prog: GRID_S - START_S,
      nitro: 1,
      boostT: 0,
      crashT: 0,
      wrongT: 0,
    });
    locate(k.x, k.z, -1, 0, this.loc);
    k.i = this.loc.i;
    k.s = this.loc.s;
    k.d = this.loc.d;
    for (const w of k.wheels) w.travel = 0;
    this.pose(k, 0);
  }

  start() {
    this.active = true;
    this.final = null;
    this.cam = 'chase';
    this.toStart();
    $('trail-hud').hidden = false;
    $('tr-toast').hidden = true;
    $('tr-cam').textContent = CAM_LABEL[this.cam];
    $('tr-restart').innerHTML = this.ctx.mobile ? '↺ Start again' : '↺ Start again <kbd>T</kbd>';
    $('tr-keys').innerHTML = this.ctx.mobile
      ? 'Stick drive · push all the way for nitro · <kbd>E</kbd> camera'
      : '<kbd>W</kbd>/<kbd>S</kbd> drive · brake, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Shift</kbd> nitro, <kbd>Space</kbd> slide, <kbd>R</kbd> back on the trail, <kbd>C</kbd> camera';
    document.body.classList.add('is-racing');
    this.renderBoard();
    this.hudTimer = 0;
    this.updateHud(0);
    // the intro opens by itself the first time (then steps aside); after that it's behind the ℹ️
    const shown = this.ctx.ui.setIntro('trail-intro', 'Rally Trail', this.introHtml(), { accent: PALETTE.orange });
    this.introTimer = shown ? 9 : 0;
    this.ctx.sfx.chime();
  }

  /** A fresh run (its numbers from zero): everything back in place, on the grid, the lights about to come on. */
  private toStart() {
    this.topSpeed = 0;
    this.stats = { crates: 0, crashes: 0, air: 0, bigAir: 0, rescues: 0 };
    this.resetThings();
    this.toGrid();
    this.phase = 'grid';
    this.phaseT = 0;
    this.raceT = 0;
    this.beat = -1;
    this.cpNext = 0;
    this.cpTimes = [];
    this.finishTime = null;
    this.recording = [];
    this.recordT = 0;
    for (const m of this.lamps) m.color.copy(hdr('#3a1418', 1));
    for (const m of this.arches) m.emissive.set('#000000');
    const k = this.car;
    const f = this.forward(k);
    this.camPos.set(k.x - f.x * 7, 3, k.z - f.z * 7);
    this.camLook.set(k.x, 1, k.z);
    this.ghost.root.visible = false;
    $('tr-split').hidden = true;
    this.splitTimer = 0;
    this.ctx.ui.countdown(null);
  }

  /** T (or the HUD's button): back to the grid for another go, before the run's done. The ticket covers it. */
  restart() {
    if (!this.active || (this.phase !== 'grid' && this.phase !== 'run')) return;
    if (this.phase === 'grid' && this.phaseT < 1) return;
    this.toStart();
    this.toast('Back to the start ↺');
    this.ctx.sfx.pop();
  }

  private introHtml() {
    const controls = this.ctx.mobile
      ? 'Push the joystick <strong>up</strong> to drive, <strong>down</strong> to brake, sideways to steer, all the way for <strong>nitro</strong>. <kbd>E</kbd> switches camera; the ↺ button starts again.'
      : '<kbd>W</kbd> drive · <kbd>S</kbd> brake / reverse · <kbd>A</kbd> <kbd>D</kbd> steer · <kbd>Shift</kbd> nitro · <kbd>Space</kbd> slide · <kbd>R</kbd> back on the trail · <kbd>T</kbd> start again · <kbd>C</kbd> camera.';
    const reset = this.board ? resetClock(this.board) : '12:00 Beirut time';
    return `<p class="eyebrow">Rally Trail · one lap · against the clock</p><h2>Fastest time of the day wins! 🏁</h2><p>Skip over the <strong>whoops</strong>, fly the <strong>big jump</strong> (go flat out or you'll case the landing), splash through the <strong>water</strong>, keep out of the <strong>mud</strong>, smash the <strong>crates</strong> or weave through them, time the <strong>spinner</strong> and fly off the <strong>table-top</strong>. ⚡ Boost pads fire you forward.</p><p>Three checkpoints show your split against your best, and a ghost buggy drives your best run beside you. Your time goes on <strong>today's leaderboard</strong>, which starts again every day at ${reset}.</p><p>${controls}</p>`;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.final = this.measure();
    this.phase = 'idle';
    $('trail-hud').hidden = true;
    document.body.classList.remove('is-racing');
    this.ctx.ui.countdown(null);
    this.ctx.sfx.setKart(0, 0, 0, 0, 0);
    this.car.head.visible = true;
    this.ghost.root.visible = false;
    const cam = this.ctx.camera;
    cam.fov = cam.aspect < 0.8 ? 58 : 42;
    cam.updateProjectionMatrix();
    // the demo buggy takes over from here
    this.car.prog = -1e9;
    this.onFinish?.();
  }

  /** The run's over (past the line): leaving now isn't leaving early. */
  get finished() {
    return this.active && this.phase === 'done';
  }

  /** This round's run crossed the line (it stays so through the fade back to the park). */
  get crossedLine() {
    return this.active && this.finishTime !== null;
  }

  /** This run's numbers (see account/stats.ts): the trail time only if you crossed the line. */
  roundStats(): Record<string, number> {
    return this.final ?? this.measure();
  }

  private measure() {
    const stats: Record<string, number> = {};
    if (this.finishTime !== null) stats.runTimeS = this.finishTime;
    Object.assign(stats, {
      topSpeedKmh: this.topSpeed * 3.6,
      airS: this.stats.air,
      bigAirS: this.stats.bigAir,
      cratesSmashed: this.stats.crates,
      crashes: this.stats.crashes,
      rescues: this.stats.rescues,
    });
    // how long ago it crossed the line (the cool-down, the fade): the board is the one open then
    if (this.finishTime !== null) stats.lineAgoS = (performance.now() - this.lineAt) / 1000;
    return stats;
  }

  cycleCamera() {
    const order: Cam[] = ['chase', 'far', 'hood'];
    this.cam = order[(order.indexOf(this.cam) + 1) % order.length];
    $('tr-cam').textContent = CAM_LABEL[this.cam];
    this.ctx.sfx.pop();
  }

  /** R: back onto the middle of the trail where you are, facing the right way, at a standstill. */
  rescue() {
    if (!this.active || this.phase !== 'run' || this.rescueT > 0) return;
    const k = this.car;
    const p = trailPoint(k.s, THREE.MathUtils.clamp(k.d, -2.5, 2.5), this.pt);
    locate(p.x, p.z, k.i, 6, this.loc);
    const g = heightAt(this.loc.s, this.loc.d);
    Object.assign(k, { x: p.x, z: p.z, y: g, gnd: g, gF: g, gB: g, vy: 0, air: false, h: headingOf(p.tx, p.tz), vx: 0, vz: 0, yawRate: 0, crashT: 0, wrongT: 0 });
    this.rescueT = 2;
    this.stats.rescues++;
    this.toast('Back on the trail 🔧');
    this.ctx.sfx.pop();
  }

  /** Today's board (from the server): the HUD and the boards in the park follow it. */
  setBoard(board: TrailBoard | null) {
    this.board = board;
    this.drawBoards();
    if (this.active) this.renderBoard();
  }

  // ------------------------------------------------------------------ the loop

  update(dt: number) {
    this.boostTex.offset.y = (this.boostTex.offset.y - dt * 1.6) % 1;
    this.waterTex.offset.x = (this.waterTex.offset.x + dt * 0.05) % 1;
    this.waterTex.offset.y = (this.waterTex.offset.y + dt * 0.08) % 1;
    this.display.rotation.y += dt * 0.5;
    this.spinAngle = (this.spinAngle + SPINNER.w * dt) % (Math.PI * 2);
    this.spinner.rotation.y = -this.spinAngle;
    if (this.rescueT > 0) this.rescueT -= dt;
    // the boards' countdown, once a minute
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.boardMinute) {
      this.boardMinute = minute;
      this.drawBoards();
    }

    const k = this.car;
    if (this.active) this.runControl(dt);
    if (this.active && this.phase !== 'done') this.driverControls(k);
    else this.demoControls(k);
    const frozen = this.active && this.phase === 'grid';
    const sub = 3;
    for (let j = 0; j < sub; j++) if (!frozen) this.step(k, dt / sub);
    this.track(k, dt);
    if (!frozen) {
      this.hitThings(k);
      this.hitSpinner(k);
    }
    this.pose(k, dt);
    if (this.thingsMoving) this.flyThings(dt);
    this.dust(k, dt);
    this.ghostPlay(dt);
    this.engineSound();
    if (this.active) {
      if (this.phase === 'run') this.topSpeed = Math.max(this.topSpeed, Math.abs(this.forwardSpeed(k)));
      this.updateHud(dt);
      if (this.introTimer > 0) {
        this.introTimer -= dt;
        if (this.introTimer <= 0 && this.ctx.ui.panelOpenKey === 'trail-intro') this.ctx.ui.hidePanel();
      }
    }
  }

  /** The start lights and the countdown, the clock, the ghost's recording, the checkpoints and the line. */
  private runControl(dt: number) {
    this.phaseT += dt;
    if (this.phase === 'grid') {
      const beat = Math.floor((this.phaseT - 0.6) / 1);
      if (beat !== this.beat && beat >= 0) {
        this.beat = beat;
        if (beat < 3) {
          this.ctx.ui.countdown(String(3 - beat));
          this.lamps[beat].color.copy(hdr('#ff2a2a', 6));
          this.ctx.sfx.beep(false);
        }
      }
      if (this.phaseT >= GRID_TIME) {
        this.phase = 'run';
        this.phaseT = 0;
        this.ctx.ui.countdown('GO!');
        for (const m of this.lamps) m.color.copy(hdr('#39ff7a', 6));
        this.ctx.sfx.beep(true);
        this.ctx.sfx.whoosh();
      }
      return;
    }
    if (this.phase === 'run') {
      this.raceT += dt;
      if (this.phaseT > 1.2 && this.phaseT - dt <= 1.2) this.ctx.ui.countdown(null);
      if (this.phaseT > 4 && this.phaseT - dt <= 4) for (const m of this.lamps) m.color.copy(hdr('#3a1418', 1));
      // the ghost of this run, in case it's the best yet
      this.recordT += dt;
      while (this.recordT >= 0) {
        this.recordT -= GHOST_DT;
        const k = this.car;
        this.recording.push(round2(k.x), round2(k.y), round2(k.z), round3(k.h), round3(k.pitch));
      }
    }
    if (this.phase === 'done' && this.phaseT > COOLDOWN) {
      this.phase = 'idle'; // fire once
      this.onComplete?.();
    }
  }

  private driverControls(k: Car) {
    const inp = this.input;
    if (!inp) return this.demoControls(k);
    k.throttle = inp.throttle;
    k.steerIn = inp.steer;
    k.handbrake = inp.lift > 0;
    k.wantNitro = inp.boost && inp.throttle > 0;
  }

  /** The demo driver (and the autopilot after the line): pure pursuit down the middle, at the profile's pace. */
  private demoControls(k: Car) {
    const v = this.forwardSpeed(k);
    const ld = 4 + Math.abs(v) * 0.35;
    const p = trailPoint(k.s + ld, 0, this.pt);
    const f = this.forward(k);
    const dx = p.x - k.x;
    const dz = p.z - k.z;
    const alpha = Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z);
    const omega = (Math.max(v, 3) * 2 * Math.sin(alpha)) / ld;
    k.steerIn = THREE.MathUtils.clamp(omega / Math.max(0.3, yawMax(Math.max(v, 3))), -1, 1);
    k.handbrake = false;
    k.wantNitro = false;
    const pace = this.active && this.phase === 'done' ? 0.45 : 0.85;
    const target = this.profile[Math.floor(wrapS(k.s + Math.max(0, v) * 0.35) / TRAIL.ds) % TRAIL.n] * pace;
    k.throttle = k.air ? 0 : v < target - 0.4 ? 1 : v > target + 3 ? -1 : v > target + 1.5 ? -0.5 : 0.25;
  }

  private forward(k: Car) {
    return { x: -Math.sin(k.h), z: -Math.cos(k.h) };
  }

  private forwardSpeed(k: Car) {
    return -k.vx * Math.sin(k.h) - k.vz * Math.cos(k.h);
  }

  /** One physics step: engine and brakes, steering and grip on whatever's underfoot, the fences, and the ground (or the air). */
  private step(k: Car, dt: number) {
    const fx = -Math.sin(k.h);
    const fz = -Math.cos(k.h);
    const lx = fz; // left of the nose
    const lz = -fx;
    let vf = k.vx * fx + k.vz * fz;
    let vl = k.vx * lx + k.vz * lz;
    const stunned = k.crashT > 0;
    const thr = stunned ? k.throttle * 0.3 : k.throttle;

    k.nitroOn = k.wantNitro && k.nitro > 0 && !stunned && !k.air;
    if (k.nitroOn) k.nitro = Math.max(0, k.nitro - NITRO_DRAIN * dt);
    else k.nitro = Math.min(1, k.nitro + NITRO_FILL * dt);
    if (k.boostT > 0) k.boostT -= dt;
    if (k.crashT > 0) k.crashT -= dt;

    if (!k.air) {
      const surf = SURFACES[k.surface];
      const vmax = VMAX * surf.speed * (k.nitroOn ? NITRO_K : 1) * (k.boostT > 0 ? BOOST_K : 1);
      if (thr > 0) {
        if (vf < -0.5) vf += BRAKE * thr * dt;
        else vf += ACCEL * (k.nitroOn || k.boostT > 0 ? 1.6 : 1) * thr * Math.max(0, 1 - (vf / vmax) ** 2) * dt;
      } else if (thr < 0) {
        if (vf > 0.5) vf = Math.max(0, vf + BRAKE * thr * dt);
        else vf = Math.max(-REV_MAX, vf + REV_ACC * thr * dt);
      } else {
        const roll = (0.6 + 0.012 * vf * vf) * dt;
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), roll);
      }
      vf *= Math.exp(-surf.drag * dt);
      if (vf > vmax) vf -= (vf - vmax) * Math.min(1, (k.surface === 'dirt' ? 1.2 : 2.5) * dt);
      if (k.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 4 * dt);
      // steering: the wheel eases toward the stick; yaw follows the wheel, faster at low speed
      k.steer += (k.steerIn - k.steer) * Math.min(1, dt * 10);
      let yaw = k.steer * yawMax(vf) * Math.sign(vf || 1);
      if (k.handbrake && Math.abs(vf) > 6) yaw *= 1.5;
      k.yawRate += (yaw - k.yawRate) * Math.min(1, dt * 9);
      // grip bleeds off sideways speed: the less of it there is, the more the buggy slides
      vl *= Math.exp(-(k.handbrake ? DRIFT_GRIP : surf.grip) * dt);
    } else {
      // in the air: it carries on as it left the ground, with a little steering to line up the landing
      k.steer += (k.steerIn - k.steer) * Math.min(1, dt * 6);
      k.yawRate += (k.steer * AIR_YAW - k.yawRate) * Math.min(1, dt * 2);
    }
    k.slide = k.air ? 0 : Math.abs(vl);
    k.h += k.yawRate * dt;
    k.vx = fx * vf + lx * vl;
    k.vz = fz * vf + lz * vl;
    const px = k.x;
    const pz = k.z;
    k.x += k.vx * dt;
    k.z += k.vz * dt;

    // the fences
    locate(k.x, k.z, k.i, 6, this.loc);
    k.i = this.loc.i;
    const lim = WALL - 0.4 - CAR_R * 0.8;
    if (Math.abs(this.loc.d) > lim) {
      const side = Math.sign(this.loc.d);
      const nx = TRAIL.tz[k.i] * side; // outward
      const nz = -TRAIL.tx[k.i] * side;
      const pen = Math.abs(this.loc.d) - lim;
      k.x -= nx * pen;
      k.z -= nz * pen;
      this.loc.d -= side * pen;
      const vn = k.vx * nx + k.vz * nz;
      if (vn > 0) {
        k.vx -= nx * vn * 1.3;
        k.vz -= nz * vn * 1.3;
        if (vn > 5) {
          k.vx *= 0.75;
          k.vz *= 0.75;
          this.bump(k, vn, 'Into the fence! 🪵');
        }
      }
    }

    // the ground: follow it on the springs, leave it when it falls away faster than gravity follows, land on it
    const f2x = -Math.sin(k.h);
    const f2z = -Math.cos(k.h);
    const gF = this.groundUnder(k.x + f2x * AXLE, k.z + f2z * AXLE, k.i);
    const gB = this.groundUnder(k.x - f2x * AXLE, k.z - f2z * AXLE, k.i);
    const gs = (gF + 2 * heightAt(this.loc.s, this.loc.d) + gB) / 4;
    const gOld = k.gnd;
    const gFOld = k.gF;
    k.gnd = gs;
    k.gF = gF;
    k.gB = gB;
    if (k.air) {
      k.vy -= G * dt;
      k.y += k.vy * dt;
      k.airT += dt;
      if (k.y <= gs) this.land(k, gs);
      return;
    }
    // a steep face under the front wheels (the back of the landing ramp) is a crash, not a climb
    const moved = Math.hypot(k.x - px, k.z - pz);
    if (moved > 0.02 && gF > 0.6 && (gF - gFOld) / moved > 1.1 && vf > 5) {
      k.vx *= 0.55;
      k.vz *= 0.55;
      this.bump(k, vf * 0.6, 'Cased it! 💥');
    }
    // the body rises and falls with the ground through its springs (which also settle it back
    // down onto the ground); only gravity can pull it down faster than that
    const follow = THREE.MathUtils.clamp((gs - gOld) / dt, -30, 30) - (k.y - gs) * SETTLE;
    k.vy = Math.max(k.vy + (follow - k.vy) * Math.min(1, dt * SUSPENSION), k.vy - G * dt);
    k.y += k.vy * dt;
    if (k.y < gs) k.y = gs;
    else if (k.y > gs + 0.05) {
      k.air = true;
      k.airT = 0;
    }
  }

  /** Touchdown: a thump, a puff of dust, and the airtime counted. */
  private land(k: Car, g: number) {
    const impact = -k.vy;
    const air = k.airT;
    k.y = g;
    k.vy = 0;
    k.air = false;
    k.airT = 0;
    const mine = k === this.car && this.active && this.phase === 'run';
    if (air > 0.25) {
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * Math.PI * 2;
        const wet = k.surface === 'water';
        this.puff(k.x + Math.cos(a) * 1.2, g + 0.3, k.z + Math.sin(a) * 1.2, wet ? '#e6f6ff' : '#c7a77d', 1.4, Math.cos(a) * 2, wet ? 3 : 1, Math.sin(a) * 2, 0.9, wet ? 6 : 0.3);
      }
    }
    if (!mine) return;
    if (air > 0.3) {
      this.stats.air += air;
      this.stats.bigAir = Math.max(this.stats.bigAir, air);
    }
    if (impact > 3) this.ctx.sfx.thunk(Math.min(10, impact));
    this.shake = Math.max(this.shake, Math.min(0.5, impact * 0.035));
    if (impact > 12.5) {
      k.vx *= 0.8;
      k.vz *= 0.8;
      this.bump(k, impact * 0.5, 'Ouch! Hard landing 😵');
    } else if (air > 0.6) {
      this.toast(`Big air! ${air.toFixed(1)} s 🚀`);
      this.ctx.sfx.chime();
    }
  }

  /** Where the buggy is on the trail: the surface under it, the run's progress, checkpoints, the line, the wrong way. */
  private track(k: Car, dt: number) {
    const prevS = k.s;
    const prevProg = k.prog;
    locate(k.x, k.z, k.i, 6, this.loc);
    k.i = this.loc.i;
    k.s = this.loc.s;
    k.d = this.loc.d;
    const patch: Patch | null = k.air ? null : patchAt(k.s, k.d);
    if (patch?.kind === 'boost' && k.boostT < 1.2) this.boost(k);
    k.surface = patch?.kind === 'mud' ? 'mud' : patch?.kind === 'water' ? 'water' : Math.abs(k.d) > TRAIL_HALF + BERM * 0.5 ? 'grass' : 'dirt';
    if (k.prog < -1e8) {
      // the demo buggy: everything back in place each time it comes past the start
      if (!this.active && deltaS(START_S, prevS) < 0 && deltaS(START_S, k.s) >= 0) this.resetThings();
      return;
    }
    k.prog += deltaS(prevS, k.s);
    if (!this.active || this.phase !== 'run') return;
    // the checkpoints, in order (the fences keep the run on the trail, so progress can't skip one)
    while (this.cpNext < CHECKPOINTS.length && k.prog >= CHECKPOINTS[this.cpNext]) this.onCheckpoint(this.cpNext++);
    if (this.cpNext === CHECKPOINTS.length && k.prog >= TRAIL.length) {
      // the moment it crossed, between this frame and the last
      const over = (k.prog - TRAIL.length) / Math.max(1e-6, k.prog - prevProg);
      this.onLine(this.raceT - THREE.MathUtils.clamp(over, 0, 1) * dt);
    }
    const along = k.vx * TRAIL.tx[k.i] + k.vz * TRAIL.tz[k.i];
    k.wrongT = along < -2 ? k.wrongT + dt : Math.min(0, k.wrongT + dt);
    if (k.wrongT > 1.2) {
      k.wrongT = -3; // nag every few seconds at most
      this.toast(this.ctx.mobile ? 'Wrong way! ↩️' : 'Wrong way! ↩️ Press R to turn round');
    }
  }

  private boost(k: Car) {
    k.boostT = 1.4;
    k.nitro = Math.min(1, k.nitro + 0.25);
    const f = this.forward(k);
    const vf = this.forwardSpeed(k);
    const want = VMAX * 1.15;
    if (vf < want) {
      k.vx += f.x * (want - vf) * 0.6;
      k.vz += f.z * (want - vf) * 0.6;
    }
    if (k === this.car && this.active) {
      this.toast('Boost! ⚡');
      this.ctx.sfx.whoosh();
    }
  }

  private onCheckpoint(i: number) {
    const t = this.raceT;
    this.cpTimes[i] = t;
    this.arches[i].emissive.copy(hdr(i % 2 ? PALETTE.mustard : PALETTE.teal, 0.8));
    this.ctx.sfx.chime();
    const best = this.record.splits[i];
    const el = $('tr-split');
    el.hidden = false;
    if (best) {
      const d = t - best;
      el.textContent = `Checkpoint ${i + 1} · ${trailTime(t * 1000)} · ${signed(d)}`;
      el.className = `tr-split ${d < 0 ? 'is-ahead' : 'is-behind'}`;
    } else {
      el.textContent = `Checkpoint ${i + 1} · ${trailTime(t * 1000)}`;
      el.className = 'tr-split';
    }
    this.splitTimer = 3;
  }

  /** Over the line: the time, the record, the ghost, and where it would put you today. */
  private onLine(time: number) {
    this.finishTime = time;
    this.lineAt = performance.now();
    this.phase = 'done';
    this.phaseT = 0;
    this.record.runs++;
    const best = !this.record.best || time < this.record.best;
    const prev = this.record.best;
    if (best) {
      this.record = { ...this.record, best: time, splits: [...this.cpTimes] };
      this.ghostRun = { time, pts: this.recording };
      this.saveGhost();
    }
    this.saveRecord();
    let line = `🏁 ${trailTime(time * 1000)}`;
    if (best && prev) line += ` · ${signed(time - prev)} 🏆`;
    this.ctx.ui.countdown(line);
    const rank = this.board ? rankFor(this.board, Math.round(time * 1000)) : null;
    const today = this.board?.me;
    let msg = best ? (prev ? 'Your best ever! 🏆' : 'Your first time on the trail! 🏁') : `Your best is ${trailTime(this.record.best * 1000)}`;
    if (rank !== null && (!today || time * 1000 < today.timeMs)) msg += ` · #${rank} today${rank === 1 ? ' 👑' : ''}`;
    else if (today) msg += ` · you're #${today.rank} today`;
    this.toast(msg);
    this.ctx.sfx.ding();
    this.ctx.sfx.chime();
  }

  /** Crates, barrels, cones and bales under (or in front of) the buggy, unless it's flying over them. */
  private hitThings(k: Car) {
    const mine = k === this.car && this.active;
    for (const t of this.things) {
      if (t.down) continue;
      const dx = k.x - t.x;
      const dz = k.z - t.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      if (k.y > t.top + 0.1) continue; // cleared it
      const d = Math.hypot(dx, dz);
      const reach = t.r + CAR_R * 0.8;
      if (d >= reach) continue;
      if (t.kind !== 'bale') {
        this.knock(t, k);
        continue;
      }
      // bales don't budge: bounce off them
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      k.x += nx * (reach - d);
      k.z += nz * (reach - d);
      const vn = -(k.vx * nx + k.vz * nz);
      if (vn > 0) {
        k.vx += nx * vn * 1.3;
        k.vz += nz * vn * 1.3;
        if (vn > 4) {
          k.vx *= 0.45;
          k.vz *= 0.45;
          this.bump(k, vn, mine ? 'Hay bale! 🌾' : undefined);
        }
      }
    }
  }

  /** Sent flying, tumbling, the way the buggy was going (a crate stack all at once, the top ones less hard). */
  private knock(hit: Thing, k: Car) {
    const mine = k === this.car && this.active;
    const sp = Math.hypot(k.vx, k.vz);
    let n = 0;
    for (const t of this.things) {
      if (t.down || (t !== hit && (hit.group < 0 || t.group !== hit.group))) continue;
      const kick = t === hit ? 1 : 0.55 + Math.random() * 0.3;
      t.down = true;
      t.resting = false;
      t.vx = k.vx * 0.85 * kick + (Math.random() - 0.5) * 3;
      t.vz = k.vz * 0.85 * kick + (Math.random() - 0.5) * 3;
      t.vy = (t.kind === 'barrel' ? 2 : 3) + sp * 0.25 * kick;
      t.axis.set(-t.vz, Math.random() - 0.5, t.vx).normalize();
      t.spin = (t.kind === 'barrel' ? 4 : 6) + sp * 0.5 * kick;
      n++;
    }
    if (!n) return;
    this.thingsMoving = true;
    const slow = hit.kind === 'cone' ? 0.95 : hit.kind === 'barrel' ? 0.82 : 0.88;
    k.vx *= slow;
    k.vz *= slow;
    if (!mine) return;
    if (hit.kind === 'crate') this.stats.crates += n;
    this.ctx.sfx.thunk(hit.kind === 'cone' ? 4 : 7);
    if (hit.kind !== 'cone') this.shake = Math.max(this.shake, 0.18);
    if (n >= 4) this.toast(`Crate smash! ×${n} 💥`);
  }

  /** The spinner's bar sweeps round over the middle of the trail: it shoves whatever's in its way. */
  private hitSpinner(k: Car) {
    const px = this.spinPos.x;
    const pz = this.spinPos.z;
    const rx = k.x - px;
    const rz = k.z - pz;
    if (rx * rx + rz * rz > (SPINNER.half + CAR_R + 1) ** 2 || k.y > 1.6) return;
    const ux = Math.cos(this.spinAngle);
    const uz = Math.sin(this.spinAngle);
    const along = THREE.MathUtils.clamp(rx * ux + rz * uz, -SPINNER.half, SPINNER.half);
    const cx = px + ux * along;
    const cz = pz + uz * along;
    let dx = k.x - cx;
    let dz = k.z - cz;
    const dist = Math.hypot(dx, dz) || 1e-3;
    const reach = CAR_R * 0.85 + 0.3;
    if (dist >= reach) return;
    dx /= dist;
    dz /= dist;
    k.x = cx + dx * reach;
    k.z = cz + dz * reach;
    // the bar's own speed where it touches (it turns at w rad/s)
    const bvx = -SPINNER.w * along * uz;
    const bvz = SPINNER.w * along * ux;
    const vn = (k.vx - bvx) * dx + (k.vz - bvz) * dz;
    if (vn < 0) {
      k.vx -= dx * vn * 1.5;
      k.vz -= dz * vn * 1.5;
      if (-vn > 3) this.bump(k, -vn, k === this.car && this.active ? 'Spun out! 🌀' : undefined);
    }
    if (k === this.car && this.active) k.yawRate += (Math.random() < 0.5 ? -1 : 1) * Math.min(3, Math.abs(vn) * 0.3);
  }

  /** A hard knock: the buggy's stunned for a moment (and you feel it, if it's yours). */
  private bump(k: Car, speed: number, msg?: string) {
    k.crashT = Math.min(0.7, 0.2 + speed * 0.04);
    if (k !== this.car || !this.active || this.phase !== 'run') return;
    this.stats.crashes++;
    this.shake = Math.min(0.6, 0.15 + speed * 0.03);
    this.ctx.sfx.whack();
    if (msg) this.toast(msg);
  }

  private flyThings(dt: number) {
    const dq = new THREE.Quaternion();
    for (const t of this.things) {
      if (!t.down || t.resting) continue;
      t.vy -= 20 * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.z += t.vz * dt;
      t.q.premultiply(dq.setFromAxisAngle(t.axis, t.spin * dt));
      const loc = locate(t.x, t.z, -1, 0, this.wloc);
      const rest = t.kind === 'crate' ? CRATE / 2 : t.kind === 'barrel' ? 0.36 : 0.2;
      const g = heightAt(loc.s, loc.d) + rest;
      if (t.y <= g && t.vy < 0) {
        t.y = g;
        if (t.vy < -3) {
          t.vy *= -0.3;
          t.vx *= 0.55;
          t.vz *= 0.55;
          t.spin *= 0.5;
        } else {
          // come to rest: crates flat on a face, barrels and cones on their side
          t.resting = true;
          const yaw = Math.atan2(t.vx, t.vz);
          if (t.kind === 'crate') t.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          else t.q.setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'));
          t.settled = true;
        }
      }
      // the fences stop them leaving the trail
      if (Math.abs(loc.d) > WALL - 0.4) {
        t.vx *= -0.3;
        t.vz *= -0.3;
        const p = trailPoint(loc.s, Math.sign(loc.d) * (WALL - 0.45), this.pt);
        t.x = p.x;
        t.z = p.z;
      }
    }
    this.syncThings();
  }

  /** Dust off the back wheels on the dirt, mud thrown up in the mud, spray through the water; and the puffs drifting off. */
  private dust(k: Car, dt: number) {
    const sp = Math.abs(this.forwardSpeed(k));
    this.puffT -= dt;
    if (!k.air && sp > 4 && this.puffT <= 0) {
      this.puffT = k.surface === 'water' ? 0.04 : 0.07 - Math.min(0.04, sp * 0.0015);
      const f = this.forward(k);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = k.x - f.x * 1.2 + f.z * side * 0.8;
      const z = k.z - f.z * 1.2 - f.x * side * 0.8;
      const color = k.surface === 'water' ? '#eaf8ff' : k.surface === 'mud' ? '#5a3f28' : k.surface === 'grass' ? '#9fb37a' : '#c7a77d';
      const size = k.surface === 'water' ? 1.3 : 0.8 + sp * 0.03;
      const wet = k.surface === 'water';
      this.puff(x, k.y + 0.3, z, color, size, -f.x * sp * 0.15 + (Math.random() - 0.5), wet ? 2.5 : 0.6, -f.z * sp * 0.15 + (Math.random() - 0.5), wet ? 0.6 : 1.1, wet ? 6 : 0.3);
      if (k.surface === 'water' && this.active && Math.random() < 0.2) this.ctx.sfx.swish();
    }
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        continue;
      }
      const u = p.age / p.life;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.vy -= p.fall * dt;
      p.sprite.scale.setScalar(p.grow * (0.6 + u * 0.8));
      p.mat.opacity = 0.55 * (1 - u) * Math.min(1, u * 6);
    }
  }

  /** Your best run, driven beside you as a see-through buggy. */
  private ghostPlay(dt: number) {
    const g = this.ghost.root;
    const run = this.ghostRun;
    if (!this.active || this.phase !== 'run' || !run || run.pts.length < 10) {
      g.visible = false;
      return;
    }
    const f = this.raceT / GHOST_DT;
    const i = Math.floor(f);
    const n = run.pts.length / 5;
    if (i >= n - 1) {
      g.visible = false;
      return;
    }
    const t = f - i;
    const a = i * 5;
    const b = a + 5;
    const P = run.pts;
    g.visible = true;
    g.position.set(P[a] + (P[b] - P[a]) * t, P[a + 1] + (P[b + 1] - P[a + 1]) * t, P[a + 2] + (P[b + 2] - P[a + 2]) * t);
    let dh = P[b + 3] - P[a + 3];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    g.rotation.set(P[a + 4] + (P[b + 4] - P[a + 4]) * t, P[a + 3] + dh * t, 0);
    const v = Math.hypot(P[b] - P[a], P[b + 2] - P[a + 2]) / GHOST_DT;
    for (const w of this.ghost.wheels) w.rotation.x -= (v / 0.42) * dt;
  }

  /** Puts the model where the physics says: pitched with the ground (or the flight), leaning into turns, wheels on their springs. */
  private pose(k: Car, dt: number) {
    const f = this.forward(k);
    const vf = this.forwardSpeed(k);
    const pitch = k.air ? THREE.MathUtils.clamp(Math.atan2(k.vy, Math.max(4, Math.abs(vf))) * 0.6, -0.5, 0.45) : Math.atan2(k.gF - k.gB, AXLE * 2);
    k.pitch += (pitch - k.pitch) * Math.min(1, dt * (k.air ? 3 : 14));
    const lat = vf * k.yawRate; // sideways acceleration
    k.roll += (THREE.MathUtils.clamp(lat * 0.008, -0.12, 0.12) - k.roll) * Math.min(1, dt * 8);
    k.root.position.set(k.x, k.y, k.z);
    k.root.rotation.set(k.pitch, k.h, k.roll);
    k.body.position.y = k.surface !== 'dirt' && !k.air ? Math.sin(this.ctx.time.t * 38 + k.x) * 0.025 * Math.min(1, Math.abs(vf) / 6) : 0;
    // each wheel on its spring: pushed up over a bump, hanging down in the air
    const sinP = Math.sin(k.pitch);
    for (const w of k.wheels) {
      let travel = -0.2;
      if (!k.air) {
        // local x runs to the right of the nose (−f.z, f.x), local z to the back (−f.x, −f.z)
        const wx = k.x - f.z * w.lx - f.x * w.lz;
        const wz = k.z + f.x * w.lx - f.z * w.lz;
        const gw = this.groundUnder(wx, wz, k.i);
        travel = THREE.MathUtils.clamp(gw - (k.y - w.lz * sinP), -0.2, 0.24);
      }
      w.travel += (travel - w.travel) * Math.min(1, dt * 18);
      w.pivot.position.y = w.rest + w.travel;
      w.spin.rotation.x -= (vf / w.r) * dt;
      if (w.front) w.pivot.rotation.y = k.steer * 0.42;
    }
  }

  private groundUnder(x: number, z: number, hint: number) {
    const loc = locate(x, z, hint, 4, this.wloc);
    return heightAt(loc.s, loc.d);
  }

  private engineSound() {
    const sfx = this.ctx.sfx;
    const k = this.car;
    const vf = Math.abs(this.forwardSpeed(k));
    if (this.active) {
      const rev = this.phase === 'grid' ? Math.max(0, this.input?.throttle ?? 0) * 0.7 : 0;
      const rpm = Math.max(rev, Math.min(1.2, vf / VMAX + (k.air ? 0.25 * Math.max(0, k.throttle) : 0)));
      sfx.setKart(rpm, Math.max(0, k.throttle) * (k.nitroOn ? 1.3 : 1), Math.min(1, Math.max(0, k.slide - 2) / 6), k.air ? 0 : k.surface === 'dirt' ? Math.min(0.5, vf / 30) : Math.min(1, vf / 12));
      return;
    }
    // heard from the park: the demo buggy, faintly (the speedway's karts share the engine sound)
    if (!this.ambient) return;
    const cam = this.ctx.camera.position;
    const d = Math.hypot(k.x - cam.x, k.z - cam.z, cam.y - k.y);
    if (d < 60) sfx.setKart(Math.min(1, vf / VMAX), 0.6, 0, 0.3, Math.max(0, 1 - d / 60) * 0.5);
  }

  // ------------------------------------------------------------------ HUD and camera

  private toast(text: string) {
    const el = $('tr-toast');
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this.toastTimer = 2.8;
  }

  /** The HUD's list: today's top ten, and how long the board has left. */
  private renderBoard() {
    $('tr-board').innerHTML = boardListHtml(this.board, 10, 'No times yet today: set the first! 🏁');
    this.renderReset();
  }

  private renderReset() {
    const b = this.board;
    $('tr-reset').textContent = b ? `New board in ${resetIn(msUntil(b.resetsAt))}` : '';
  }

  private updateHud(dt: number) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('tr-toast').hidden = true;
    }
    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) $('tr-split').hidden = true;
    }
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.05;
    const k = this.car;
    $('tr-time').textContent = trailTime((this.finishTime ?? this.raceT) * 1000);
    $('tr-cp').textContent = `${this.cpNext}/${CHECKPOINTS.length}`;
    $('tr-speed').textContent = `${Math.round(Math.abs(this.forwardSpeed(k)) * 3.6)} km/h`;
    $('tr-best').textContent = this.record.best ? trailTime(this.record.best * 1000) : '—';
    const me = this.board?.me;
    $('tr-today').textContent = me ? `#${me.rank} · ${trailTime(me.timeMs)}` : '—';
    const bar = $('tr-nitro');
    (bar.firstElementChild as HTMLElement).style.width = `${k.nitro * 100}%`;
    bar.classList.toggle('is-on', k.nitroOn || k.boostT > 0);
    if (Math.floor(this.raceT) !== Math.floor(this.raceT - 0.05)) this.renderReset();
  }

  /** What the camera follows (for shadows and grass LOD). */
  get focus() {
    return new THREE.Vector3(this.car.x, 0, this.car.z);
  }

  /** Your buggy, for the minimap. */
  get position() {
    return this.car.root.position;
  }

  get yaw() {
    return this.car.h;
  }

  /** The buggy, for the minimap (the demo one, when nobody's driving it). */
  get marker() {
    return { x: this.car.x, z: this.car.z, color: PALETTE.orange };
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const k = this.car;
    const f = this.forward(k);
    const v = this.forwardSpeed(k);
    camera.up.set(0, 1, 0);
    k.head.visible = this.cam !== 'hood';
    if (this.cam === 'hood') {
      const eye = new THREE.Vector3(k.x + f.x * 0.25, k.y + 1.45, k.z + f.z * 0.25);
      camera.position.copy(eye);
      camera.lookAt(eye.x + f.x * 10, eye.y - 0.4 + Math.sin(k.pitch) * 10, eye.z + f.z * 10);
      this.camPos.copy(eye);
      this.camLook.set(k.x, k.y + 1, k.z);
    } else {
      // behind the direction of travel when moving (so a spin doesn't whip the camera round)
      const sp = Math.hypot(k.vx, k.vz);
      const dirx = sp > 4 && v > 0 ? k.vx / sp : f.x;
      const dirz = sp > 4 && v > 0 ? k.vz / sp : f.z;
      const [back, up] = this.cam === 'far' ? [12.5, 6.5] : [6.6 + Math.max(0, v) * 0.05, 2.7];
      const want = new THREE.Vector3(k.x - dirx * back, 0, k.z - dirz * back);
      // keep it inside the fences on the hairpins…
      const at = locate(want.x, want.z, k.i, 16, { i: 0, s: 0, d: 0 });
      const lim = WALL - 0.8;
      if (Math.abs(at.d) > lim) {
        const p = trailPoint(at.s, Math.sign(at.d) * lim, this.pt);
        want.x = p.x;
        want.z = p.z;
      }
      // …and above the ground (a jump lifts it, but more gently than the buggy)
      want.y = Math.max(heightAt(at.s, at.d) + 1.3, k.y * 0.6 + up);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      this.camLook.lerp(new THREE.Vector3(k.x + f.x * 4, k.y + 0.9, k.z + f.z * 4), 1 - Math.exp(-dt * 10));
      camera.position.copy(this.camPos);
      camera.lookAt(this.camLook);
    }
    if (this.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * this.shake;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    // a wider view at speed, wider still on nitro
    const base = camera.aspect < 0.8 ? 58 : 42;
    const fov = base + Math.min(1, Math.max(0, v) / VMAX) * 6 + (k.nitroOn || k.boostT > 0 ? 6 : 0);
    const next = camera.fov + (fov - camera.fov) * Math.min(1, dt * 4);
    if (Math.abs(next - camera.fov) > 0.01) {
      camera.fov = next;
      camera.updateProjectionMatrix();
    }
  }
}

// ------------------------------------------------------------------ models and textures

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The longest start of `text` that fits in `max` pixels (with an ellipsis if it had to be cut). */
function clip(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * A chunky dune buggy, nose to −z: a wedge of a body on a dark chassis, a roll cage, a driver in
 * a helmet, a spare tyre on the back and four big knobbly wheels on springs. `ghost` makes it a
 * see-through teal one.
 */
function buggyModel(color: string, ghost = false) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const see = new THREE.MeshBasicMaterial({ color: hdr(color, 1.1), transparent: true, opacity: 0.32, depthWrite: false });
  const paint = ghost ? see : new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
  const dark = ghost ? see : std('#26222d', { roughness: 0.55, metalness: 0.4 });
  const cage = ghost ? see : std('#e8e2d8', { roughness: 0.3, metalness: 0.6 });
  const rubber = ghost ? see : std('#17151b', { roughness: 0.9 });
  const metal = ghost ? see : std('#b9bcc4', { metalness: 0.85, roughness: 0.3 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.x = rx;
    body.add(b);
    return b;
  };
  box(1.35, 0.14, 2.3, dark, 0, 0.48, 0); // chassis tray
  box(1.5, 0.32, 1.25, paint, 0, 0.7, 0.25); // the tub
  box(1.42, 0.24, 0.9, paint, 0, 0.66, -0.78, 0.22); // the nose, sloping down
  box(1.55, 0.12, 0.25, dark, 0, 0.55, -1.25); // front bumper
  box(1.55, 0.14, 0.2, dark, 0, 0.62, 1.0); // rear bumper
  for (const sx of [-1, 1]) box(0.08, 0.36, 0.7, paint, sx * 0.79, 0.72, 0.3); // side panels
  if (!ghost)
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), new THREE.MeshBasicMaterial({ color: hdr('#fff2c4', 3) }));
      lamp.position.set(sx * 0.5, 0.74, -1.18);
      lamp.rotation.y = Math.PI;
      body.add(lamp);
    }
  // the roll cage: four uprights and a hoop over the top
  const tube = (len: number) => new THREE.CylinderGeometry(0.045, 0.045, len, 8);
  for (const sx of [-1, 1])
    for (const [z, rx] of [
      [-0.32, 0.38],
      [0.68, -0.08],
    ] as const) {
      const up = new THREE.Mesh(tube(0.9), cage);
      up.position.set(sx * 0.62, 1.22, z);
      up.rotation.x = rx;
      body.add(up);
    }
  for (const z of [-0.5, 0.72]) {
    const bar = new THREE.Mesh(tube(1.24), cage);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.64, z);
    body.add(bar);
  }
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(tube(1.26), cage);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(sx * 0.62, 1.64, 0.11);
    body.add(rail);
  }
  // the driver
  const suit = ghost ? see : std(PALETTE.ink, { roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.3, 4, 10), suit);
  torso.position.set(0, 1.05, 0.3);
  torso.rotation.x = -0.2;
  body.add(torso);
  const head = new THREE.Group();
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), ghost ? see : std(PALETTE.mustard, { roughness: 0.3, metalness: 0.1 }));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 10, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.26), ghost ? see : std('#14141c', { roughness: 0.05, metalness: 0.6 }));
  head.add(helmet, visor);
  head.position.set(0, 1.45, 0.22);
  body.add(head);
  // the spare tyre on the back
  const spare = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.12, 8, 16), rubber);
  spare.position.set(0, 0.95, 1.1);
  body.add(spare);
  // big knobbly wheels on springs (the pivot moves up and down; the front ones steer)
  const wheels: Wheel[] = [];
  for (const [sx, z, front] of [
    [-1, -0.82, true],
    [1, -0.82, true],
    [-1, 0.86, false],
    [1, 0.86, false],
  ] as const) {
    const r = 0.42;
    const pivot = new THREE.Group();
    const rest = r;
    pivot.position.set(sx * 0.9, rest, z);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.36, 18).rotateZ(Math.PI / 2), rubber);
    const tread = new THREE.Mesh(new THREE.TorusGeometry(r - 0.02, 0.05, 6, 18).rotateY(Math.PI / 2), rubber);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.38, 6).rotateZ(Math.PI / 2), ghost ? see : std(color, { metalness: 0.4, roughness: 0.4 }));
    const spin = new THREE.Group();
    spin.add(tyre, tread, hub);
    pivot.add(spin);
    if (!ghost) {
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), metal);
      spring.position.set(-sx * 0.25, 0.25, 0);
      spring.rotation.z = sx * 0.6;
      pivot.add(spring);
    }
    root.add(pivot);
    wheels.push({ pivot, spin, lx: sx * 0.9, lz: z, r, rest, front, travel: 0 });
  }
  return { root, body, wheels, head };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Packed dirt across the trail (u) and 9 m along it (v): two tyre ruts, pebbles, grassy ragged edges. */
function dirtTexture() {
  const { c, g } = canvas(256, 512);
  const W = TRAIL_HALF + BERM;
  const U = (d: number) => ((W - d) / (2 * W)) * 256; // d from +W (u = 0) to −W (u = 256)
  g.fillStyle = '#a07c52';
  g.fillRect(0, 0, 256, 512);
  const rnd = mulberry(31);
  for (let i = 0; i < 9000; i++) {
    const v = rnd();
    g.fillStyle = v > 0.6 ? 'rgba(200,170,120,0.35)' : v > 0.3 ? 'rgba(110,80,50,0.35)' : 'rgba(230,215,190,0.4)';
    g.fillRect(rnd() * 256, rnd() * 512, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  // the ruts the buggies have worn in
  g.fillStyle = 'rgba(70, 50, 30, 0.22)';
  for (const d of [1.6, -1.6]) g.fillRect(U(d) - 9, 0, 18, 512);
  // grass creeping in from the edges, ragged (the alpha test cuts the outermost bits away)
  for (const side of [-1, 1]) {
    for (let y = 0; y < 512; y += 2) {
      const reach = (BERM * 0.7 + Math.sin(y * 0.07) * 0.25 + rnd() * 0.5) / (2 * W) * 256;
      const edge = side < 0 ? 0 : 256;
      const grad = g.createLinearGradient(edge, 0, edge - side * reach * 1.6, 0);
      grad.addColorStop(0, 'rgba(74, 138, 79, 1)');
      grad.addColorStop(1, 'rgba(74, 138, 79, 0)');
      g.fillStyle = grad;
      g.fillRect(side < 0 ? 0 : 256 - reach * 1.6, y, reach * 1.6, 2);
    }
  }
  // the very edge: transparent in tufts
  const img = g.getImageData(0, 0, 256, 512);
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 256; x++) {
      const e = Math.min(x, 255 - x) / 256;
      const cut = 0.035 + Math.abs(Math.sin(y * 0.21 + x * 0.05)) * 0.025 + rnd() * 0.02;
      if (e < cut) img.data[(y * 256 + x) * 4 + 3] = 0;
    }
  g.putImageData(img, 0, 0);
  return finish(c, true);
}

/** Wet dark mud, glossy, with a ragged edge. */
function mudTexture() {
  const { c, g } = canvas(128, 256);
  g.fillStyle = '#4b331f';
  g.fillRect(0, 0, 128, 256);
  const rnd = mulberry(44);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(30,20,12,0.45)' : 'rgba(120,90,60,0.3)';
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 256, 1 + rnd() * 4, 0, Math.PI * 2);
    g.fill();
  }
  const img = g.getImageData(0, 0, 128, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 128; x++) {
      const e = Math.min(x, 127 - x, y, 255 - y) / 128;
      if (e < 0.06 + Math.abs(Math.sin(x * 0.3 + y * 0.17)) * 0.05) img.data[(y * 128 + x) * 4 + 3] = 0;
    }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/** Soft ripples for the splash. */
function rippleTexture() {
  const { c, g } = canvas(128, 128);
  g.fillStyle = '#9fd6ea';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry(52);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.15 + rnd() * 0.3})`;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath();
    g.ellipse(rnd() * 128, rnd() * 128, 6 + rnd() * 18, 3 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
    g.stroke();
  }
  const t = finish(c, true);
  t.repeat.set(3, 2);
  return t;
}

function checkerTexture(cols: number, rows: number) {
  const s = 32;
  const { c, g } = canvas(cols * s, rows * s);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      g.fillStyle = (i + j) % 2 ? '#15131a' : '#f4efe6';
      g.fillRect(i * s, j * s, s, s);
    }
  return finish(c);
}

function hayTexture() {
  const { c, g } = canvas(128, 128);
  g.fillStyle = '#d4ad55';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry(4);
  for (let i = 0; i < 500; i++) {
    g.strokeStyle = rnd() > 0.5 ? 'rgba(255, 230, 150, 0.6)' : 'rgba(140, 100, 40, 0.5)';
    g.lineWidth = 1;
    const x = rnd() * 128;
    const y = rnd() * 128;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 6, y + 6 + rnd() * 10);
    g.stroke();
  }
  g.fillStyle = 'rgba(90, 60, 30, 0.6)';
  for (const y of [30, 94]) g.fillRect(0, y, 128, 3);
  return finish(c, true);
}

/** Glowing chevrons pointing up the texture (down the trail once laid flat). */
function chevronTexture() {
  const { c, g } = canvas(128, 128);
  g.fillStyle = 'rgba(30, 120, 115, 0.55)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#7ff0e4';
  g.lineWidth = 16;
  g.lineJoin = 'miter';
  for (const y of [40, 104]) {
    g.beginPath();
    g.moveTo(14, y + 22);
    g.lineTo(64, y - 18);
    g.lineTo(114, y + 22);
    g.stroke();
  }
  return finish(c, true);
}

/** A roadside chevron board: white arrows on red, pointing right. */
function chevronBoardTexture() {
  const { c, g } = canvas(256, 160);
  g.fillStyle = PALETTE.candy;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 26;
  g.lineJoin = 'miter';
  for (const x of [70, 160]) {
    g.beginPath();
    g.moveTo(x - 30, 24);
    g.lineTo(x + 30, 80);
    g.lineTo(x - 30, 136);
    g.stroke();
  }
  g.strokeStyle = PALETTE.ink;
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 150);
  return finish(c);
}
