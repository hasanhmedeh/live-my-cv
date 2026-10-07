import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shadowed, staticBox, staticCylinder, std, type Attraction, type Ctx } from '../context';
import type { Input } from '../input';
import { LAYOUT } from '../layout';
import { mulberry } from '../random';
import { hdr, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';
import { CIRCUIT, CIRCUIT_BOUNDS, circuitPoint, CURB_W, deltaS, headingOf, LAPS, locate, ROAD_HALF, START_S, WALL, wrapS } from './speedway-track';

// The Turbo Speedway: a kart race against three rivals over three laps of the circuit outside the
// park's south-west fence. Every race lays out a fresh set of obstacles: cones to scatter, hay bales
// and tyre stacks to crash into, oil slicks that spin you round and boost pads that fire you
// forward. Karts drive on simple arcade physics: an engine and brakes along the nose, grip that
// bleeds off sideways speed (less of it on grass, under the handbrake or on oil), and tyre walls
// either side of the track. The rivals drive the same karts: they follow a speed profile worked out
// from the track's curvature and pick lanes around whatever lies ahead.

const KART_R = 1; // collision radius
const VMAX = 24; // m/s (86 km/h) flat out
const NITRO_K = 1.25;
const BOOST_K = 1.3;
const ACCEL = 10;
const BRAKE = 20;
const REV_ACC = 6;
const REV_MAX = 7;
const STEER = 2.3; // rad/s of yaw at low speed; less as the speed rises
const GRIP = { road: 10, grass: 5, drift: 2.4, spin: 0.8 };
const GRASS_K = 0.55; // top speed on the grass
const NITRO_DRAIN = 1 / 3; // a full tank lasts 3 s…
const NITRO_FILL = 0.06; // …and refills in about 17 s
const AI_LAT = 19; // m/s² the rivals dare to corner at
const AI_BRAKE = 12;
const GRID_TIME = 3.6; // lights out after this long on the grid
const COOLDOWN = 6; // seconds after the flag before you're back at the garage
const STORAGE_KEY = 'fair-speedway';

type Cam = 'chase' | 'driver' | 'high';
const CAM_LABEL: Record<Cam, string> = { chase: 'Chase', driver: 'Driver', high: 'High' };
type Phase = 'idle' | 'grid' | 'race' | 'done';
type Kind = 'cone' | 'bale' | 'tyres' | 'oil' | 'boost';

interface Kart {
  name: string;
  color: string;
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  steerers: THREE.Object3D[];
  head: THREE.Object3D;
  x: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
  yawRate: number;
  steer: number;
  /** Nearest circuit sample, arc length and lateral offset (positive = left). */
  i: number;
  s: number;
  d: number;
  /** Metres past the start line, counting every lap (negative on the grid). */
  prog: number;
  laps: number;
  lapStart: number;
  bestLap: number;
  finished: number | null;
  nitro: number;
  nitroOn: boolean;
  boostT: number;
  spinT: number;
  spinDir: number;
  crashT: number;
  offroad: boolean;
  slide: number;
  wrongT: number;
  /** The rival's pace (fraction of the profile), its preferred lane and the lane it's steering for. */
  skill: number;
  pref: number;
  lane: number;
  /** The side a rival has committed to for each hazard it's dodging (hazard index → lane). */
  dodge: Map<number, number>;
  // this frame's controls
  throttle: number;
  steerIn: number;
  handbrake: boolean;
  wantNitro: boolean;
}

interface Thing {
  kind: Kind;
  s: number;
  d: number;
  x: number;
  z: number;
  h: number;
  r: number;
  // knocked cones fly
  down: boolean;
  resting: boolean;
  y: number;
  vx: number;
  vy: number;
  vz: number;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
}

interface Hazard {
  s0: number;
  s1: number;
  dmin: number;
  dmax: number;
  boost: boolean;
}

const RIVALS = [
  { name: 'Dizzy Dee', color: PALETTE.mustard, skill: 0.95 },
  { name: 'Turbo Tina', color: PALETTE.teal, skill: 0.92 },
  { name: 'Max Volt', color: PALETTE.violet, skill: 0.88 },
];

const $ = (id: string) => document.getElementById(id)!;
const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
const ordinal = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const yawMax = (v: number) => (STEER * Math.min(1, Math.abs(v) / 4)) / (1 + Math.abs(v) / 18);

export class Speedway implements Attraction {
  private karts: Kart[] = [];
  private things: Thing[] = [];
  private hazards: Hazard[] = [];
  private meshes!: Record<Kind, THREE.InstancedMesh>;
  private conesMoving = false;
  /** Target speed round the circuit for a rival with skill 1 (from the curvature, with braking zones). */
  private profile = new Float32Array(CIRCUIT.n);
  private lamps: THREE.MeshBasicMaterial[] = [];
  private boostTex!: THREE.Texture;
  private fans!: THREE.InstancedMesh;
  private fanSeats: THREE.Matrix4[] = [];
  private display!: THREE.Group;
  private phase: Phase = 'idle';
  private phaseT = 0;
  private raceT = 0;
  private beat = -1;
  private cam: Cam = 'chase';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private hudTimer = 0;
  private toastTimer = 0;
  private introTimer = 0;
  private rescueT = 0;
  private record = { race: 0, lap: 0, wins: 0 };
  private stats = { cones: 0, crashes: 0, spins: 0, boosts: 0 };
  private place = 0;
  private newRecord = false;
  private seed = 1;
  private loc = { i: 0, s: 0, d: 0 };
  private pt = { x: 0, z: 0, tx: 0, tz: 0 };
  active = false;
  input: Input | null = null;
  onFinish: (() => void) | null = null;
  /** The race is over and the cool-down lap is done: time to go back to the park. */
  onComplete: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    try {
      Object.assign(this.record, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    } catch {
      /* storage unavailable */
    }
    this.buildProfile();
    this.buildGround();
    this.buildRoad();
    this.buildCurbs();
    this.buildWalls();
    this.buildStart();
    this.buildGrandstand();
    this.buildObstacleMeshes();
    this.buildGarage();
    this.karts.push(this.makeKart('You', PALETTE.candy, 1, 0.9));
    RIVALS.forEach((r, i) => this.karts.push(this.makeKart(r.name, r.color, i + 2, r.skill)));
    this.layObstacles();
    this.toGrid();
    // ghost race: the rivals (and an extra kart in your colours) lap the circuit while nobody's racing
    for (const k of this.karts) k.prog = -1e9;
  }

  // ------------------------------------------------------------------ building the circuit

  private buildProfile() {
    const C = CIRCUIT;
    const v = this.profile;
    for (let i = 0; i < C.n; i++) v[i] = Math.min(VMAX, Math.sqrt(AI_LAT / Math.max(1e-4, Math.abs(C.k[i]))));
    // brake in time: no faster than you can slow down for what's coming (twice round, for the wrap)
    for (let pass = 0; pass < 2; pass++)
      for (let q = C.n - 1; q >= 0; q--) {
        const next = v[(q + 1) % C.n];
        v[q] = Math.min(v[q], Math.sqrt(next * next + 2 * AI_BRAKE * C.ds));
      }
  }

  /** Mown grass, gravel traps on the outside of the corners, fading out into the country. */
  private buildGround() {
    const b = CIRCUIT_BOUNDS;
    const m = 14;
    const x0 = b.x0 - m, x1 = b.x1 + m, z0 = b.z0 - m, z1 = b.z1 + m;
    const k = this.ctx.mobile || this.ctx.quality.tier === 'lowest' ? 3 : 5;
    const w = Math.ceil((x1 - x0) * k);
    const h = Math.ceil((z1 - z0) * k);
    const X = (x: number) => (x - x0) * k;
    const Z = (z: number) => (z - z0) * k;
    const C = CIRCUIT;
    const trace = (g: CanvasRenderingContext2D, d: number) => {
      g.beginPath();
      for (let i = 0; i <= C.n; i++) {
        const p = circuitPoint(i * C.ds, d, this.pt);
        if (i) g.lineTo(X(p.x), Z(p.z));
        else g.moveTo(X(p.x), Z(p.z));
      }
      g.closePath();
    };

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.lineCap = g.lineJoin = 'round';
    g.fillStyle = '#3f8150';
    g.fillRect(0, 0, w, h);
    // mowing stripes, 6 m wide, across the main straight
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = 'rgba(150, 210, 120, 0.12)';
    const diag = Math.hypot(w, h);
    for (let y = -diag; y < diag; y += 12 * k) g.fillRect(-diag, y, diag * 2, 6 * k);
    g.restore();
    // speckle
    const rnd = mulberry(5);
    for (let i = 0; i < (w * h) / 60; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(120,190,110,0.16)' : 'rgba(20,60,40,0.16)';
      const s = (0.15 + rnd() * 0.2) * k;
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
    // gravel traps: on the outside of each corner, from the kerb out to the tyre wall
    const inner = ROAD_HALF + CURB_W;
    const grain = canvas(64, 64);
    grain.g.fillStyle = '#d6c193';
    grain.g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) {
      grain.g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(90,70,40,0.35)';
      grain.g.fillRect(rnd() * 64, rnd() * 64, 1.5, 1.5);
    }
    g.strokeStyle = g.createPattern(grain.c, 'repeat')!;
    g.lineWidth = (WALL - inner + 0.6) * k;
    for (let i = 0; i < C.n; i++) {
      const kk = C.k[i];
      if (Math.abs(kk) < 1 / 45) continue;
      const side = -Math.sign(kk); // outside of the turn
      const a = circuitPoint(i * C.ds, side * (inner + WALL) / 2, this.pt);
      const ax = X(a.x), az = Z(a.z);
      const bb = circuitPoint((i + 1.5) * C.ds, side * (inner + WALL) / 2, this.pt);
      g.beginPath();
      g.moveTo(ax, az);
      g.lineTo(X(bb.x), Z(bb.z));
      g.stroke();
    }

    // the mask: the infield and a band around the circuit, feathered at the edge
    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const mg = mask.getContext('2d')!;
    mg.lineCap = mg.lineJoin = 'round';
    mg.fillStyle = mg.strokeStyle = '#fff';
    trace(mg, 0);
    mg.fill('evenodd');
    const steps = 7;
    for (let j = 0; j < steps; j++) {
      mg.globalAlpha = 0.32;
      mg.lineWidth = 2 * (WALL + 3 + j * 1.6) * k;
      trace(mg, 0);
      mg.stroke();
    }
    mg.globalAlpha = 1;
    mg.lineWidth = 2 * (WALL + 2) * k;
    trace(mg, 0);
    mg.stroke();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2),
      std('#ffffff', { map: tex, roughness: 0.95, transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    patch.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    patch.receiveShadow = true;
    this.ctx.scene.add(patch);
  }

  /** A ribbon along the circuit between lateral offsets dl (left) and dr (right). */
  private ribbon(dl: number, dr: number, y: number, vScale: number) {
    const C = CIRCUIT;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= C.n; i++) {
      const s = i * C.ds;
      const a = circuitPoint(s, dl, this.pt);
      pos.push(a.x, y, a.z);
      const b = circuitPoint(s, dr, this.pt);
      pos.push(b.x, y, b.z);
      uv.push(0, s / vScale, 1, s / vScale);
      if (i < C.n) {
        const q = i * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildRoad() {
    const road = new THREE.Mesh(
      this.ribbon(ROAD_HALF, -ROAD_HALF, 0.035, ROAD_HALF * 2),
      std('#ffffff', { map: asphaltTexture(), roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    road.receiveShadow = true;
    this.ctx.scene.add(road);
  }

  /** Red-and-white kerbs on both edges wherever the circuit turns. */
  private buildCurbs() {
    const C = CIRCUIT;
    const pos: number[] = [];
    const col: number[] = [];
    const red = new THREE.Color(PALETTE.candy);
    const white = new THREE.Color('#f4efe6');
    const p = { x: 0, z: 0, tx: 0, tz: 0 };
    for (let i = 0; i < C.n; i++) {
      const k = Math.max(Math.abs(C.k[i]), Math.abs(C.k[(i + 1) % C.n]));
      if (k < 1 / 55) continue;
      const c = Math.floor((i * C.ds) / 1.3) % 2 ? red : white;
      for (const side of [-1, 1]) {
        const corners: number[][] = [];
        for (const [s, d, y] of [
          [i, ROAD_HALF, 0.04],
          [i, ROAD_HALF + CURB_W, 0.09],
          [i + 1, ROAD_HALF, 0.04],
          [i + 1, ROAD_HALF + CURB_W, 0.09],
        ]) {
          circuitPoint(s * C.ds, side * d, p);
          corners.push([p.x, y, p.z]);
        }
        const [a, b, cc, dd] = corners;
        // wind both triangles to face up, whichever side of the road they're on
        const tri = side > 0 ? [a, cc, b, b, cc, dd] : [a, b, cc, b, dd, cc];
        for (const v of tri) {
          pos.push(...v);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const curbs = new THREE.Mesh(geo, std('#ffffff', { vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
    curbs.receiveShadow = true;
    this.ctx.scene.add(curbs);
  }

  /** Tyre walls along both sides: a low wall of painted tyres, open at the start gantry's feet. */
  private buildWalls() {
    const C = CIRCUIT;
    const H = 0.85;
    const T = 0.35;
    const pos: number[] = [];
    const uv: number[] = [];
    const sideIdx: number[] = [];
    const topIdx: number[] = [];
    const p = { x: 0, z: 0, tx: 0, tz: 0 };
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= C.n; i++) {
        const s = i * C.ds;
        const u = s / 2.8;
        // four rails: outer-bottom, outer-top, inner-top, inner-bottom (inner faces the track)
        for (const [d, y, v] of [
          [WALL + T, 0, 0],
          [WALL + T, H, 1],
          [WALL - T, H, 1],
          [WALL - T, 0, 0],
        ]) {
          circuitPoint(s, side * d, p);
          pos.push(p.x, y, p.z);
          uv.push(u, v);
        }
        if (i === C.n) break;
        const a = base + i * 4;
        const b = a + 4;
        const quad = (out: number[], p0: number, p1: number, q0: number, q1: number) => out.push(p0, q0, p1, p1, q0, q1);
        // outer face, top, inner face (winding flips with the side)
        if (side < 0) {
          quad(sideIdx, a, a + 1, b, b + 1);
          quad(topIdx, a + 1, a + 2, b + 1, b + 2);
          quad(sideIdx, a + 2, a + 3, b + 2, b + 3);
        } else {
          quad(sideIdx, a + 1, a, b + 1, b);
          quad(topIdx, a + 2, a + 1, b + 2, b + 1);
          quad(sideIdx, a + 3, a + 2, b + 3, b + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex([...sideIdx, ...topIdx]);
    geo.addGroup(0, sideIdx.length, 0);
    geo.addGroup(sideIdx.length, topIdx.length, 1);
    geo.computeVertexNormals();
    const walls = new THREE.Mesh(geo, [std('#ffffff', { map: tyreWallTexture(), roughness: 0.85 }), std('#1c1a21', { roughness: 0.9 })]);
    walls.castShadow = walls.receiveShadow = true;
    this.ctx.scene.add(walls);
  }

  /** The chequered line, grid boxes and the gantry with its start lights. */
  private buildStart() {
    const scene = this.ctx.scene;
    const p = circuitPoint(START_S, 0, { x: 0, z: 0, tx: 0, tz: 0 });
    const yaw = headingOf(p.tx, p.tz);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 1.2).rotateX(-Math.PI / 2),
      std('#ffffff', { map: checkerTexture(12, 2), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    line.position.set(p.x, 0.04, p.z);
    line.rotation.y = yaw;
    line.receiveShadow = true;
    scene.add(line);
    // grid boxes: a white bar ahead of each slot
    const bar = new THREE.PlaneGeometry(2.2, 0.22).rotateX(-Math.PI / 2);
    const paint = std('#f4efe6', { roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let j = 0; j < 4; j++) {
      const g = this.gridSlot(j);
      const q = circuitPoint(g.s + 1.6, g.d, { x: 0, z: 0, tx: 0, tz: 0 });
      const m = new THREE.Mesh(bar, paint);
      m.position.set(q.x, 0.04, q.z);
      m.rotation.y = yaw;
      scene.add(m);
    }

    // the gantry: two pillars outside the tyre walls and a beam with the sign and the lights
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = yaw; // local -z runs down the track, local x to the right
    const steel = std('#2c2834', { metalness: 0.6, roughness: 0.4 });
    const span = WALL + 1;
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.6, 0.6), steel);
      pillar.position.set(sx * span, 3.3, 0);
      g.add(pillar);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), std('#8d8796'));
      foot.position.set(sx * span, 0.15, 0);
      g.add(foot);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.5, 0.5), steel);
    beam.position.y = 6.4;
    g.add(beam);
    const checker = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 0.35, 0.52), std('#ffffff', { map: checkerTexture(48, 2), roughness: 0.6 }));
    checker.position.y = 5.5;
    g.add(checker);
    const signTex = signTexture('TURBO SPEEDWAY', { sub: '3 laps · start / finish', border: PALETTE.candy, width: 1536, height: 288 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(9.2, 1.8, 0.1), std(PALETTE.ink));
    board.position.set(0, 7.9, 0);
    g.add(board);
    for (const face of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.69), signMaterial(signTex));
      sign.position.set(0, 7.9, face * 0.06);
      if (face < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    // three start lights either side of the middle, facing the grid (behind the line: local +z)
    const housing = std('#141218', { roughness: 0.5 });
    for (let j = 0; j < 3; j++) {
      const mat = new THREE.MeshBasicMaterial({ color: hdr('#3a1418', 1) });
      this.lamps.push(mat);
      for (const sx of [-1, 1]) {
        const x = sx * (0.9 + j * 1.1);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.3), housing);
        box.position.set(x, 6.4, 0.4);
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), mat);
        lamp.position.set(x, 6.4, 0.56);
        g.add(box, lamp);
      }
    }
    shadowed(g);
    scene.add(g);
  }

  /** A covered grandstand beside the main straight, its back to the park with the circuit's name on it. */
  private buildGrandstand() {
    const len = 34;
    const p = circuitPoint(START_S - 14, WALL + 4.6, { x: 0, z: 0, tx: 0, tz: 0 });
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    // local +z faces the track (to the right of the race, the stand is on the left), local x runs with the race
    g.rotation.y = Math.atan2(-p.tz, p.tx);
    const concrete = std('#b9b3bf', { roughness: 0.85 });
    const tiers = 5;
    for (let j = 0; j < tiers; j++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5 + j * 0.55, 1.1), concrete);
      step.position.set(0, (0.5 + j * 0.55) / 2, 2.2 - j * 1.1);
      g.add(step);
    }
    // seats in the circuit's colours, guests on some of them
    const seatCols = [PALETTE.candy, PALETTE.mustard, PALETTE.teal, PALETTE.violet];
    const seatGeo = new THREE.BoxGeometry(0.5, 0.3, 0.45);
    const perRow = 40;
    const seats = new THREE.InstancedMesh(seatGeo, std('#ffffff', { roughness: 0.6 }), tiers * perRow);
    const fanGeo = mergeGeometries([new THREE.CapsuleGeometry(0.2, 0.45, 4, 8).translate(0, 0.45, 0), new THREE.SphereGeometry(0.16, 10, 8).translate(0, 0.98, 0)])!;
    this.fans = new THREE.InstancedMesh(fanGeo, std('#ffffff', { roughness: 0.75 }), tiers * perRow);
    const rnd = mulberry(31);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    let f = 0;
    for (let j = 0; j < tiers; j++)
      for (let i = 0; i < perRow; i++) {
        const x = (i - (perRow - 1) / 2) * (len / perRow);
        const y = 0.5 + j * 0.55 + 0.15;
        const z = 2.2 - j * 1.1 + 0.1;
        seats.setMatrixAt(n, m.makeTranslation(x, y, z));
        seats.setColorAt(n++, col.set(seatCols[(i >> 2) % seatCols.length]));
        if (rnd() < 0.45) {
          const fm = new THREE.Matrix4().makeTranslation(x, y - 0.05, z - 0.05);
          this.fanSeats.push(fm);
          this.fans.setMatrixAt(f, fm);
          this.fans.setColorAt(f++, col.setHSL(rnd(), 0.55, 0.45 + rnd() * 0.2));
        }
      }
    this.fans.count = f;
    // the roof: poles at the back, a striped canopy sloping toward the track
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.15, 6.4), std('#ffffff', { map: stripeTexture(PALETTE.candy, PALETTE.cream, 16) }));
    roof.position.set(0, 5.6, -0.6);
    roof.rotation.x = 0.12;
    g.add(roof);
    for (let i = 0; i <= 4; i++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.6, 8), std('#2c2834', { metalness: 0.6, roughness: 0.4 }));
      pole.position.set((i / 4 - 0.5) * len, 2.8, -2.9);
      g.add(pole);
    }
    // the back wall faces the park: a big sign that says what's over the fence
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 0.2), std(PALETTE.ink));
    back.position.set(0, 1.5, -3.0);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 3),
      signMaterial(signTexture('TURBO SPEEDWAY', { sub: 'Kart racing · garage by the south-west lawn', border: PALETTE.mustard, width: 1536, height: 288 })),
    );
    sign.position.set(0, 3.2, -3.12);
    sign.rotation.y = Math.PI;
    g.add(back, sign, seats, this.fans);
    shadowed(g, true);
    this.ctx.scene.add(g);
  }

  private buildObstacleMeshes() {
    const cone = mergeGeometries(
      [
        new THREE.ConeGeometry(0.2, 0.62, 14, 1, true).translate(0, 0.37, 0),
        new THREE.CylinderGeometry(0.115, 0.15, 0.12, 14, 1, true).translate(0, 0.42, 0),
        new THREE.BoxGeometry(0.46, 0.05, 0.46).translate(0, 0.025, 0),
      ],
      true,
    )!;
    const orange = std(PALETTE.orange, { roughness: 0.5 });
    const coneMesh = new THREE.InstancedMesh(cone, [orange, std('#ffffff', { roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.15 }), orange], 80);
    // a round hay bale on its side, its axis across the track
    const bale = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 18).rotateZ(Math.PI / 2).translate(0, 0.75, 0);
    const baleMesh = new THREE.InstancedMesh(bale, std('#ffffff', { map: hayTexture(), roughness: 0.95 }), 24);
    // three tyres, the middle one painted red
    const tyre = (y: number) => new THREE.TorusGeometry(0.34, 0.14, 8, 18).rotateX(Math.PI / 2).translate(0, y, 0);
    const tyres = mergeGeometries([mergeGeometries([tyre(0.14), tyre(0.7)])!, tyre(0.42)], true)!;
    const tyreMesh = new THREE.InstancedMesh(tyres, [std('#1d1b22', { roughness: 0.9 }), std(PALETTE.candy, { roughness: 0.7 })], 40);
    const oilMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2),
      std('#ffffff', { map: oilTexture(), transparent: true, roughness: 0.08, metalness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 }),
      16,
    );
    this.boostTex = chevronTexture();
    const boostMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2.8, 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.boostTex, color: hdr('#ffffff', 2.2), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 }),
      16,
    );
    this.meshes = { cone: coneMesh, bale: baleMesh, tyres: tyreMesh, oil: oilMesh, boost: boostMesh };
    for (const im of Object.values(this.meshes)) {
      im.count = 0;
      im.frustumCulled = false; // instances are spread round the whole circuit
      this.ctx.scene.add(im);
    }
    coneMesh.castShadow = baleMesh.castShadow = tyreMesh.castShadow = true;
    oilMesh.receiveShadow = boostMesh.receiveShadow = true;
  }

  /** The garage inside the park: a counter, the circuit's sign and a show kart on a turntable. */
  private buildGarage() {
    const root = new THREE.Group();
    root.position.set(LAYOUT.speedway.x, 0, LAYOUT.speedway.z);
    root.rotation.y = (3 * Math.PI) / 4; // the counter (local +z) faces the path, north-east
    const hut = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3, 3), std(PALETTE.ink));
    hut.position.y = 1.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 3.4), std(PALETTE.cream));
    roof.position.y = 3.15;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.8), std(PALETTE.cream));
    counter.position.set(0, 1.25, 1.75);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.3), std('#ffffff', { map: stripeTexture('#8d8796', '#b9b3bf', 10, true), roughness: 0.5, metalness: 0.4 }));
    door.position.set(0, 2.05, 1.51);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.06, 1.3), std('#ffffff', { map: checkerTexture(16, 4) }));
    awning.position.set(0, 2.9, 2.1);
    awning.rotation.x = 0.28;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 1.8),
      signMaterial(signTexture('TURBO SPEEDWAY', { sub: 'Kart racing · 3 laps · mind the cones!', border: PALETTE.candy })),
    );
    sign.position.set(0, 4.2, 0.7);
    root.add(hut, roof, counter, door, awning, sign);
    // chequered flags crossed above the sign
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), std('#2c2834', { metalness: 0.6 }));
      pole.position.set(sx * 2.7, 4.6, 0.7);
      pole.rotation.z = -sx * 0.35;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.7), std('#ffffff', { map: checkerTexture(5, 3), side: THREE.DoubleSide }));
      flag.position.set(sx * 3.3, 5.35, 0.7);
      flag.rotation.z = -sx * 0.35;
      root.add(pole, flag);
    }
    // the show kart, slowly turning on its podium
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.3, 32), std('#ffffff', { map: checkerTexture(16, 16), roughness: 0.5 }));
    podium.position.set(4.6, 0.15, 0.6);
    this.display = new THREE.Group();
    this.display.position.set(4.6, 0.3, 0.6);
    this.display.add(kartModel(PALETTE.candy, 1).root);
    const stack = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 8, 18), std(j === 1 ? PALETTE.candy : '#1d1b22', { roughness: 0.85 }));
      t.rotation.x = Math.PI / 2;
      t.position.y = 0.14 + j * 0.28;
      stack.add(t);
    }
    stack.position.set(-3, 0, 1.6);
    root.add(podium, this.display, stack);
    shadowed(root, true);
    this.ctx.scene.add(root);
    // colliders, in world space
    const c = Math.cos(root.rotation.y);
    const s = Math.sin(root.rotation.y);
    const at = (lx: number, lz: number) => [LAYOUT.speedway.x + lx * c + lz * s, LAYOUT.speedway.z - lx * s + lz * c] as const;
    const [hx, hz] = at(0, 0.2);
    staticBox(this.ctx, hx, 1.5, hz, 2.3, 1.5, 1.8, root.rotation.y);
    const [px, pz] = at(4.6, 0.6);
    staticCylinder(this.ctx, px, pz, 1.8, 1.2);
    const [tx, tz] = at(-3, 1.6);
    staticCylinder(this.ctx, tx, tz, 0.5, 0.9);
  }

  private makeKart(name: string, color: string, num: number, skill: number): Kart {
    const m = kartModel(color, num);
    shadowed(m.root);
    this.ctx.scene.add(m.root);
    return {
      name,
      color,
      root: m.root,
      body: m.body,
      wheels: m.wheels,
      steerers: m.steerers,
      head: m.head,
      x: 0,
      z: 0,
      h: 0,
      vx: 0,
      vz: 0,
      yawRate: 0,
      steer: 0,
      i: 0,
      s: 0,
      d: 0,
      prog: 0,
      laps: 0,
      lapStart: 0,
      bestLap: 0,
      finished: null,
      nitro: 1,
      nitroOn: false,
      boostT: 0,
      spinT: 0,
      spinDir: 1,
      crashT: 0,
      offroad: false,
      slide: 0,
      wrongT: 0,
      skill,
      pref: 0,
      lane: 0,
      dodge: new Map(),
      throttle: 0,
      steerIn: 0,
      handbrake: false,
      wantNitro: false,
    };
  }

  // ------------------------------------------------------------------ obstacles

  /** Lays a fresh set of obstacles round the circuit (clear of the grid and the run to turn one). */
  private layObstacles() {
    const rnd = mulberry(this.seed++ * 7919 + 13);
    this.things = [];
    this.hazards = [];
    const L = CIRCUIT.length;
    const edge = ROAD_HALF - 0.7;
    let s = START_S + 48;
    const end = START_S + L - 30;
    const add = (kind: Kind, s: number, d: number) => {
      const r = kind === 'cone' ? 0.3 : kind === 'bale' ? 0.85 : kind === 'tyres' ? 0.5 : kind === 'oil' ? 1.5 : 1.4;
      const p = circuitPoint(s, d, this.pt);
      this.things.push({
        kind,
        s: wrapS(s),
        d,
        x: p.x,
        z: p.z,
        h: headingOf(p.tx, p.tz),
        r,
        down: false,
        resting: false,
        y: kind === 'oil' || kind === 'boost' ? 0.045 : 0,
        vx: 0,
        vy: 0,
        vz: 0,
        q: new THREE.Quaternion(),
        axis: new THREE.Vector3(),
        spin: 0,
      });
    };
    const kinds: [Kind, number][] = [
      ['cone', 0.34],
      ['bale', 0.18],
      ['tyres', 0.14],
      ['oil', 0.16],
      ['boost', 0.18],
    ];
    let last: Kind | null = null;
    while (s < end) {
      let roll = rnd();
      let kind: Kind = 'cone';
      for (const [k, w] of kinds) {
        if (roll < w) {
          kind = k;
          break;
        }
        roll -= w;
      }
      if (kind === last && kind !== 'cone') kind = 'cone';
      // nothing solid (or slippery) on a corner's apex, where you can't see it in time
      let bend = 0;
      for (let q = -12; q <= 8; q += 2) bend = Math.max(bend, Math.abs(CIRCUIT.k[Math.floor(wrapS(s + q) / CIRCUIT.ds) % CIRCUIT.n]));
      if ((kind === 'bale' || kind === 'tyres') && bend > 1 / 35) kind = 'cone';
      if (kind === 'oil' && bend > 1 / 25) kind = 'cone';
      last = kind;
      // each solid block of obstacles is one hazard for the rivals: its extent along and across the road
      let from = this.things.length;
      let span = 0;
      const close = () => {
        let s0 = Infinity, s1 = -Infinity, dmin = Infinity, dmax = -Infinity;
        for (let j = from; j < this.things.length; j++) {
          const t = this.things[j];
          const along = s + deltaS(wrapS(s), t.s);
          s0 = Math.min(s0, along - t.r);
          s1 = Math.max(s1, along + t.r);
          dmin = Math.min(dmin, t.d - t.r);
          dmax = Math.max(dmax, t.d + t.r);
        }
        this.hazards.push({ s0: wrapS(s0), s1: wrapS(s1), dmin, dmax, boost: kind === 'boost' });
        span = Math.max(span, s1 - s0);
        from = this.things.length;
      };
      const side = rnd() < 0.5 ? -1 : 1;
      if (kind === 'cone') {
        const pattern = rnd();
        if (pattern < 0.4)
          // a lane closure: a diagonal line of cones from one edge in toward the middle
          for (let j = 0; j < 5; j++) add('cone', s + j * 1.8, side * (edge - j * 0.75));
        else if (pattern < 0.75)
          // a slalom down the middle
          for (let j = 0; j < 5; j++) add('cone', s + j * 4, (j % 2 ? 1 : -1) * 1.6 + side * 0.4);
        // a gate: cones at both edges, a gap in the middle (two hazards, one each side)
        else
          for (const sd of [-1, 1]) {
            for (let j = 0; j < 3; j++) add('cone', s + j * 0.9, sd * (edge - j * 0.7));
            if (sd < 0) close();
          }
      } else if (kind === 'bale') {
        const d = side * (rnd() * 2.2 + 0.4);
        add('bale', s, d);
        if (rnd() < 0.5) add('bale', s, d - side * 1.6);
      } else if (kind === 'tyres') {
        const d = (rnd() * 2 - 1) * 3;
        add('tyres', s, d);
        add('tyres', s + 0.6, d + (d > 0 ? -1 : 1));
      } else if (kind === 'oil') add('oil', s, (rnd() * 2 - 1) * 2.6);
      else add('boost', s, (rnd() * 2 - 1) * 2.8);
      close();
      s += Math.max(24, span + 18) + rnd() * 14;
    }
    this.syncObstacles(true);
  }

  /** Writes obstacle transforms into the instanced meshes (only moving cones after the first time). */
  private syncObstacles(all = false) {
    const counts: Record<Kind, number> = { cone: 0, bale: 0, tyres: 0, oil: 0, boost: 0 };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let moving = false;
    for (const t of this.things) {
      const n = counts[t.kind]++;
      if (!all && (t.kind !== 'cone' || !t.down || t.resting)) continue;
      if (t.kind === 'cone' && t.down) {
        moving ||= !t.resting;
        q.copy(t.q);
      } else q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.h);
      this.meshes[t.kind].setMatrixAt(n, m.compose(p.set(t.x, t.y, t.z), q, one));
      this.meshes[t.kind].instanceMatrix.needsUpdate = true;
    }
    for (const k of Object.keys(counts) as Kind[]) this.meshes[k].count = counts[k];
    this.conesMoving = moving;
  }

  // ------------------------------------------------------------------ race control

  private gridSlot(j: number) {
    return { s: START_S - 7 - j * 6, d: j % 2 ? -2.4 : 2.4 };
  }

  /** Lines everyone up on the grid: the rivals in front, fastest on pole, you at the back. */
  private toGrid() {
    const order = [1, 2, 3, 0];
    order.forEach((ki, j) => {
      const k = this.karts[ki];
      const g = this.gridSlot(j);
      const p = circuitPoint(g.s, g.d, this.pt);
      Object.assign(k, {
        x: p.x,
        z: p.z,
        h: headingOf(p.tx, p.tz),
        vx: 0,
        vz: 0,
        yawRate: 0,
        steer: 0,
        prog: g.s - START_S,
        laps: 0,
        lapStart: 0,
        bestLap: 0,
        finished: null,
        nitro: 1,
        boostT: 0,
        spinT: 0,
        crashT: 0,
        wrongT: 0,
        pref: g.d * 0.6,
        lane: g.d,
      });
      k.dodge.clear();
      locate(k.x, k.z, -1, 0, this.loc);
      k.i = this.loc.i;
      k.s = this.loc.s;
      k.d = this.loc.d;
      this.pose(k, 0);
    });
  }

  start() {
    this.active = true;
    this.layObstacles();
    this.toGrid();
    this.phase = 'grid';
    this.phaseT = 0;
    this.raceT = 0;
    this.beat = -1;
    this.place = 0;
    this.newRecord = false;
    this.stats = { cones: 0, crashes: 0, spins: 0, boosts: 0 };
    for (const m of this.lamps) m.color.copy(hdr('#3a1418', 1));
    this.cam = 'chase';
    const me = this.me;
    const back = this.forward(me);
    this.camPos.set(me.x - back.x * 7, 3, me.z - back.z * 7);
    this.camLook.set(me.x, 1, me.z);
    $('race-hud').hidden = false;
    $('rc-toast').hidden = true;
    $('rc-cam').textContent = CAM_LABEL[this.cam];
    $('rc-best').textContent = this.record.lap ? fmt(this.record.lap) : '—';
    $('rc-keys').innerHTML = this.ctx.mobile
      ? 'Stick drive · push all the way for nitro · <kbd>E</kbd> camera'
      : '<kbd>W</kbd>/<kbd>S</kbd> drive · brake, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Shift</kbd> nitro, <kbd>Space</kbd> drift, <kbd>C</kbd> camera, <kbd>R</kbd> back on track';
    document.body.classList.add('is-racing');
    this.hudTimer = 0;
    this.updateHud(0);
    this.ctx.ui.panel('speedway-intro', this.introHtml(), { accent: PALETTE.candy });
    this.introTimer = 8;
    this.ctx.sfx.chime();
  }

  private introHtml() {
    const controls = this.ctx.mobile
      ? 'Push the joystick <strong>up</strong> to drive, <strong>down</strong> to brake, sideways to steer. Push it all the way for <strong>nitro</strong>. <kbd>E</kbd> switches camera.'
      : '<kbd>W</kbd> drive · <kbd>S</kbd> brake / reverse · <kbd>A</kbd> <kbd>D</kbd> steer · <kbd>Shift</kbd> nitro · <kbd>Space</kbd> handbrake drift · <kbd>C</kbd> camera · <kbd>R</kbd> back on track.';
    return `<p class="eyebrow">Turbo Speedway · ${LAPS} laps · 4 karts</p><h2>Start from the back, finish first! 🏁</h2><p>Scatter the 🟧 <strong>cones</strong>, dodge the <strong>hay bales</strong> and <strong>tyre stacks</strong>, steer clear of ⚫ <strong>oil slicks</strong> and hit the ⚡ <strong>boost pads</strong>. Every race lays the obstacles out differently.</p><p>${controls}</p>`;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.phase = 'idle';
    $('race-hud').hidden = true;
    document.body.classList.remove('is-racing');
    this.ctx.ui.countdown(null);
    this.ctx.sfx.setKart(0, 0, 0, 0, 0);
    this.me.head.visible = true;
    const cam = this.ctx.camera;
    cam.fov = cam.aspect < 0.8 ? 58 : 42;
    cam.updateProjectionMatrix();
    this.ctx.ui.panel('speedway-summary', this.summaryHtml(), { accent: PALETTE.candy });
    // back to ghost laps
    for (const k of this.karts) Object.assign(k, { prog: -1e9, finished: null, nitro: 1 });
    this.onFinish?.();
  }

  private summaryHtml() {
    const me = this.me;
    const s = this.stats;
    const extras = `<li>Cones scattered: <strong>${s.cones}</strong> · crashes: <strong>${s.crashes}</strong> · spins: <strong>${s.spins}</strong> · boosts: <strong>${s.boosts}</strong></li>`;
    if (me.finished === null)
      return `<p class="eyebrow">Turbo Speedway · Retired</p><h2>Back to the pits 🔧</h2><p>You pulled in ${
        me.laps ? `after ${me.laps} lap${me.laps > 1 ? 's' : ''}` : 'before the end of the first lap'
      }. The karts are fuelled up whenever you want another go.</p><ul>${me.bestLap ? `<li>Best lap: <strong>${fmt(me.bestLap)}</strong></li>` : ''}${extras}</ul>`;
    const medal = ['🥇', '🥈', '🥉', '🏁'][this.place - 1];
    const standings = this.standings()
      .map((k) => `<li>${k === me ? '<strong>You</strong>' : k.name}${k.finished !== null ? ` · ${fmt(k.finished)}` : ' · still racing'}</li>`)
      .join('');
    return `<p class="eyebrow">Turbo Speedway · Results</p><h2>${medal} ${this.place}${ordinal(this.place)} place${this.place === 1 ? '!' : ''}</h2><p>${
      this.place === 1 ? 'Chequered flag, first across the line. The grandstand is on its feet!' : 'Not bad from the back of the grid. Fancy a rematch?'
    }${this.newRecord ? ' <strong>New personal best! 🏆</strong>' : ''}</p><ol>${standings}</ol><ul><li>Race time: <strong>${fmt(me.finished)}</strong>${
      this.record.race ? ` · best ever ${fmt(this.record.race)}` : ''
    }</li><li>Best lap: <strong>${fmt(me.bestLap)}</strong>${this.record.wins ? ` · wins so far: <strong>${this.record.wins}</strong>` : ''}</li>${extras}</ul>`;
  }

  cycleCamera() {
    const order: Cam[] = ['chase', 'driver', 'high'];
    this.cam = order[(order.indexOf(this.cam) + 1) % order.length];
    $('rc-cam').textContent = CAM_LABEL[this.cam];
    this.ctx.sfx.pop();
  }

  /** R: back onto the middle of the track where you are, facing the right way. */
  rescue() {
    if (!this.active || this.phase !== 'race' || this.rescueT > 0) return;
    const k = this.me;
    const p = circuitPoint(k.s, THREE.MathUtils.clamp(k.d, -2.5, 2.5), this.pt);
    Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), vx: 0, vz: 0, yawRate: 0, spinT: 0, crashT: 0, wrongT: 0 });
    this.rescueT = 2;
    this.toast('Back on track 🔧');
    this.ctx.sfx.pop();
  }

  private get me() {
    return this.karts[0];
  }

  /** Who's ahead: finishers by time, then everyone by distance covered. */
  private standings() {
    return [...this.karts].sort((a, b) => {
      if (a.finished !== null || b.finished !== null) return (a.finished ?? Infinity) - (b.finished ?? Infinity);
      return b.prog - a.prog;
    });
  }

  // ------------------------------------------------------------------ the loop

  update(dt: number, t: number) {
    this.boostTex.offset.y = (this.boostTex.offset.y - dt * 1.6) % 1;
    this.display.rotation.y += dt * 0.5;
    if (this.rescueT > 0) this.rescueT -= dt;
    const racing = this.active && this.phase !== 'grid';

    if (this.active) this.raceControl(dt);
    for (const k of this.karts) {
      if (k === this.me && this.active) this.driverControls(k);
      else this.aiControls(k, dt);
    }
    // two physics substeps per frame
    const h = dt / 2;
    for (let j = 0; j < 2; j++) {
      for (const k of this.karts) {
        if (this.active && this.phase === 'grid') continue;
        this.step(k, h);
      }
      this.collideKarts();
    }
    for (const k of this.karts) {
      this.track(k, racing, dt);
      this.hitThings(k);
      this.pose(k, dt);
    }
    if (this.conesMoving) this.flyCones(dt);
    this.cheer(t);
    this.engineSound();
    if (this.active) {
      this.updateHud(dt);
      if (this.introTimer > 0) {
        this.introTimer -= dt;
        if (this.introTimer <= 0 && this.ctx.ui.panelOpenKey === 'speedway-intro') this.ctx.ui.hidePanel();
      }
    }
  }

  /** The start lights, the countdown, lap times and the flag. */
  private raceControl(dt: number) {
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
        this.phase = 'race';
        this.phaseT = 0;
        this.ctx.ui.countdown('GO!');
        for (const m of this.lamps) m.color.copy(hdr('#39ff7a', 6));
        this.ctx.sfx.beep(true);
        this.ctx.sfx.whoosh();
      }
      return;
    }
    if (this.phase === 'race' || this.phase === 'done') this.raceT += dt;
    if (this.phase === 'race' && this.phaseT > 1.2 && this.phaseT - dt <= 1.2) this.ctx.ui.countdown(null);
    if (this.phase === 'race' && this.phaseT > 4 && this.phaseT - dt <= 4) for (const m of this.lamps) m.color.copy(hdr('#3a1418', 1));
    if (this.phase === 'done' && this.phaseT > COOLDOWN) {
      this.phase = 'idle'; // fire once
      this.onComplete?.();
    }
  }

  private driverControls(k: Kart) {
    const inp = this.input;
    if (!inp || this.phase === 'done') return this.aiControls(k, 1 / 60);
    k.throttle = inp.throttle;
    k.steerIn = inp.steer;
    k.handbrake = inp.lift > 0;
    k.wantNitro = inp.boost && inp.throttle > 0;
  }

  /** A rival's (or the autopilot's) controls: pick a lane round what's ahead, then chase the profile. */
  private aiControls(k: Kart, dt: number) {
    const C = CIRCUIT;
    const v = this.forwardSpeed(k);
    const look = 22 + Math.max(0, v) * 1.1;
    let lane = k.pref;
    let laneSet = false;
    let caution = 1;
    const room = ROAD_HALF - 1.2;
    const need = KART_R + 0.8;
    // nearest first: only the next block of obstacles (things side by side) steers the kart; the
    // ones after it get their turn once it's behind
    const ahead = this.hazards
      .map((hz, idx) => ({ hz, idx, ahead: deltaS(k.s, hz.s0), behind: deltaS(k.s, hz.s1) }))
      .filter((a) => a.behind >= -1 && a.ahead <= look)
      .sort((a, b) => a.ahead - b.ahead);
    for (const key of k.dodge.keys()) if (!ahead.some((a) => a.idx === key)) k.dodge.delete(key);
    let block = Infinity;
    // the side that also clears whatever comes next scores better
    const clears = (lane: number, from: number) => {
      const next = ahead.find((a) => !a.hz.boost && a.ahead > from + 8);
      return !next || next.ahead > from + 35 || lane <= next.hz.dmin - need || lane >= next.hz.dmax + need;
    };
    for (const { hz, idx, ahead: dist } of ahead) {
      if (hz.boost) {
        // take the pad (if nothing's in the way first), unless it would fire you into a bend
        const after = this.profile[Math.floor(wrapS(hz.s1 + 25) / C.ds) % C.n];
        if (!laneSet && after >= VMAX * 0.85) lane = (hz.dmin + hz.dmax) / 2;
        laneSet = true;
        continue;
      }
      if (block === Infinity) block = dist;
      else if (dist > block + 8) break;
      let pick = k.dodge.get(idx);
      if (pick === undefined && lane > hz.dmin - need && lane < hz.dmax + need) {
        const left = hz.dmax + need;
        const right = hz.dmin - need;
        const okL = left <= room;
        const okR = right >= -room;
        // the wider gap, unless the other one is much nearer where the kart already is
        const scoreL = ROAD_HALF - hz.dmax - 0.25 * Math.abs(left - k.d) + (clears(left, dist) ? 0 : -4);
        const scoreR = hz.dmin + ROAD_HALF - 0.25 * Math.abs(right - k.d) + (clears(right, dist) ? 0 : -4);
        if (okL && (!okR || scoreL > scoreR)) pick = left;
        else if (okR) pick = right;
        else pick = Math.abs(left) < Math.abs(right) ? Math.min(left, room) : Math.max(right, -room);
        k.dodge.set(idx, pick);
      }
      if (pick !== undefined) {
        lane = pick;
        // not lined up yet and it's close: lift
        if (dist < 14 && Math.abs(k.d - pick) > 0.8) caution = Math.min(caution, 0.7);
      }
      laneSet = true;
    }
    k.lane += (lane - k.lane) * Math.min(1, dt * 7);

    // pure pursuit: a point a little way up the road, in the chosen lane
    const ld = 4 + Math.abs(v) * 0.35;
    const p = circuitPoint(k.s + ld, k.lane, this.pt);
    const f = this.forward(k);
    const dx = p.x - k.x;
    const dz = p.z - k.z;
    const fwd = dx * f.x + dz * f.z;
    const left = dx * f.z - dz * f.x;
    const alpha = Math.atan2(left, fwd);
    const omega = (Math.max(v, 3) * 2 * Math.sin(alpha)) / ld;
    k.steerIn = THREE.MathUtils.clamp(omega / Math.max(0.3, yawMax(Math.max(v, 3))), -1, 1);
    k.handbrake = false;

    // pace: the profile a little way ahead, scaled by skill (and a touch of rubber band in a race)
    let pace = k.skill * caution;
    if (this.active && this.phase !== 'done' && k !== this.me) {
      const gap = k.prog - this.me.prog;
      pace *= THREE.MathUtils.clamp(1 - gap / 900, 0.93, 1.05);
    }
    if (k.finished !== null || (this.active && this.phase === 'done' && k === this.me)) pace *= 0.6;
    const target = this.profile[Math.floor(wrapS(k.s + Math.max(0, v) * 0.35) / C.ds) % C.n] * pace;
    k.throttle = v < target - 0.4 ? 1 : v > target + 3 ? -1 : v > target + 1.5 ? -0.6 : 0.25;
    // nitro on the straights, once they're up to speed
    const clear = this.profile[Math.floor(wrapS(k.s + 40) / C.ds) % C.n] >= VMAX * 0.98;
    k.wantNitro = clear && v > VMAX * 0.8 * pace && k.nitro > 0.5 && k.finished === null && this.phase !== 'idle';
  }

  private forward(k: Kart) {
    return { x: -Math.sin(k.h), z: -Math.cos(k.h) };
  }

  private forwardSpeed(k: Kart) {
    return -k.vx * Math.sin(k.h) - k.vz * Math.cos(k.h);
  }

  /** One physics step: engine and brakes along the nose, steering, grip, the tyre walls. */
  private step(k: Kart, dt: number) {
    const fx = -Math.sin(k.h);
    const fz = -Math.cos(k.h);
    const lx = fz; // left of the nose
    const lz = -fx;
    let vf = k.vx * fx + k.vz * fz;
    let vl = k.vx * lx + k.vz * lz;
    const stunned = k.spinT > 0 || k.crashT > 0;
    const thr = stunned ? k.throttle * 0.3 : k.throttle;

    k.nitroOn = k.wantNitro && k.nitro > 0 && !stunned && this.phase !== 'grid';
    if (k.nitroOn) k.nitro = Math.max(0, k.nitro - NITRO_DRAIN * dt);
    else k.nitro = Math.min(1, k.nitro + NITRO_FILL * dt);
    if (k.boostT > 0) k.boostT -= dt;
    if (k.spinT > 0) k.spinT -= dt;
    if (k.crashT > 0) k.crashT -= dt;

    const vmax = VMAX * (k.offroad ? GRASS_K : 1) * (k.nitroOn ? NITRO_K : 1) * (k.boostT > 0 ? BOOST_K : 1);
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
    if (vf > vmax) vf -= (vf - vmax) * Math.min(1, (k.offroad ? 2.5 : 1.2) * dt);
    if (k.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 5 * dt);

    // steering: the wheel eases toward the stick; yaw follows the wheel, faster at low speed
    k.steer += (k.steerIn - k.steer) * Math.min(1, dt * 10);
    let yaw = k.steer * yawMax(vf) * Math.sign(vf || 1);
    if (k.handbrake && Math.abs(vf) > 6) yaw *= 1.5;
    if (k.spinT > 0) yaw = k.spinDir * 7 * Math.min(1, k.spinT * 2);
    k.yawRate += (yaw - k.yawRate) * Math.min(1, dt * 9);
    k.h += k.yawRate * dt;

    // grip bleeds off sideways speed: the less of it there is, the more the kart slides
    const grip = k.spinT > 0 ? GRIP.spin : k.handbrake ? GRIP.drift : k.offroad ? GRIP.grass : GRIP.road;
    vl *= Math.exp(-grip * dt);
    k.slide = Math.abs(vl);
    k.vx = fx * vf + lx * vl;
    k.vz = fz * vf + lz * vl;
    k.x += k.vx * dt;
    k.z += k.vz * dt;

    // the tyre walls
    locate(k.x, k.z, k.i, 6, this.loc);
    k.i = this.loc.i;
    const lim = WALL - 0.4 - KART_R * 0.8;
    if (Math.abs(this.loc.d) > lim) {
      const side = Math.sign(this.loc.d);
      const C = CIRCUIT;
      const nx = C.tz[k.i] * side; // outward
      const nz = -C.tx[k.i] * side;
      const pen = Math.abs(this.loc.d) - lim;
      k.x -= nx * pen;
      k.z -= nz * pen;
      const vn = k.vx * nx + k.vz * nz;
      if (vn > 0) {
        k.vx -= nx * vn * 1.3;
        k.vz -= nz * vn * 1.3;
        if (vn > 5) {
          k.vx *= 0.75;
          k.vz *= 0.75;
          this.bump(k, vn);
        }
      }
    }
  }

  /** Karts shove each other apart (a gentle, mostly inelastic nudge). */
  private collideKarts() {
    const ks = this.karts;
    for (let a = 0; a < ks.length; a++)
      for (let b = a + 1; b < ks.length; b++) {
        const A = ks[a];
        const B = ks[b];
        const dx = A.x - B.x;
        const dz = A.z - B.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 4 * KART_R * KART_R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const pen = 2 * KART_R - d;
        A.x += nx * pen * 0.5;
        A.z += nz * pen * 0.5;
        B.x -= nx * pen * 0.5;
        B.z -= nz * pen * 0.5;
        const rel = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
        if (rel >= 0) continue;
        const j = (-(1 + 0.3) * rel) / 2;
        A.vx += nx * j;
        A.vz += nz * j;
        B.vx -= nx * j;
        B.vz -= nz * j;
        if ((A === this.me || B === this.me) && this.active && -rel > 3) {
          this.ctx.sfx.thunk(-rel);
          this.shake = Math.max(this.shake, 0.15);
        }
      }
  }

  /** Where each kart is on the circuit: laps, the grass, going the wrong way. */
  private track(k: Kart, racing: boolean, dt: number) {
    const prevS = k.s;
    locate(k.x, k.z, k.i, 6, this.loc);
    k.i = this.loc.i;
    k.s = this.loc.s;
    k.d = this.loc.d;
    k.offroad = Math.abs(k.d) > ROAD_HALF + CURB_W * 0.6;
    if (!racing || k.prog < -1e8) return;
    k.prog += deltaS(prevS, k.s);
    const L = CIRCUIT.length;
    const done = Math.floor(k.prog / L);
    if (done > k.laps && k.finished === null) {
      k.laps = done;
      const lap = this.raceT - k.lapStart;
      k.lapStart = this.raceT;
      if (!k.bestLap || lap < k.bestLap) k.bestLap = lap;
      if (k === this.me) this.onMyLap(lap);
      if (k.laps >= LAPS) this.onFlag(k);
    }
    if (k === this.me && this.phase === 'race') {
      const C = CIRCUIT;
      const along = k.vx * C.tx[k.i] + k.vz * C.tz[k.i];
      k.wrongT = along < -2 ? k.wrongT + dt : Math.min(0, k.wrongT + dt);
      if (k.wrongT > 1.2) {
        k.wrongT = -3; // nag every few seconds at most
        this.toast(this.ctx.mobile ? 'Wrong way! ↩️' : 'Wrong way! ↩️ Press R to turn round');
      }
    }
  }

  private onMyLap(lap: number) {
    const me = this.me;
    let msg = `Lap ${me.laps} · ${fmt(lap)}`;
    if (!this.record.lap || lap < this.record.lap) {
      this.record.lap = lap;
      this.newRecord = true;
      msg = `Best lap ever! ${fmt(lap)} 🏆`;
      this.save();
    }
    if (me.laps === LAPS - 1) msg += ' · Final lap! 🏁';
    if (me.laps < LAPS) this.toast(msg);
    this.ctx.sfx.chime();
    $('rc-best').textContent = fmt(this.record.lap);
  }

  private onFlag(k: Kart) {
    const time = this.raceT;
    k.finished = time;
    if (k !== this.me || !this.active) return;
    this.place = this.karts.filter((o) => o.finished !== null && o.finished <= time).length;
    if (this.place === 1) this.record.wins++;
    if (!this.record.race || time < this.record.race) {
      this.record.race = time;
      this.newRecord = true;
    }
    this.save();
    this.phase = 'done';
    this.phaseT = 0;
    this.ctx.ui.countdown(this.place === 1 ? '🏁 WINNER!' : `🏁 ${this.place}${ordinal(this.place)}`);
    this.toast(`Finished ${this.place}${ordinal(this.place)} · ${fmt(time)}`);
    this.ctx.sfx.ding();
    this.ctx.sfx.chime();
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.record));
    } catch {
      /* storage unavailable */
    }
  }

  /** Cones, bales, tyres, oil and boost pads under (or in front of) a kart. */
  private hitThings(k: Kart) {
    const mine = k === this.me && this.active;
    for (const t of this.things) {
      if (t.kind === 'cone' && t.down) continue;
      const dx = k.x - t.x;
      const dz = k.z - t.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      if (t.kind === 'boost') {
        if (Math.abs(deltaS(t.s, k.s)) < 2.2 && Math.abs(k.d - t.d) < 1.6 && k.boostT < 1.2) {
          k.boostT = 1.5;
          k.nitro = Math.min(1, k.nitro + 0.25);
          const f = this.forward(k);
          const vf = this.forwardSpeed(k);
          if (vf < VMAX * 1.15) {
            k.vx += f.x * (VMAX * 1.15 - vf);
            k.vz += f.z * (VMAX * 1.15 - vf);
          }
          if (mine) {
            this.stats.boosts++;
            this.toast('Boost! ⚡');
            this.ctx.sfx.whoosh();
          }
        }
        continue;
      }
      const d = Math.hypot(dx, dz);
      if (t.kind === 'oil') {
        if (d < t.r && k.spinT <= 0 && Math.abs(this.forwardSpeed(k)) > 6) {
          k.spinT = 1;
          k.spinDir = Math.random() < 0.5 ? -1 : 1;
          k.vx *= 0.75;
          k.vz *= 0.75;
          if (mine) {
            this.stats.spins++;
            this.toast('Oil slick! 🌀');
            this.ctx.sfx.swish();
          }
        }
        continue;
      }
      const reach = t.r + KART_R * 0.8;
      if (d >= reach) continue;
      if (t.kind === 'cone') {
        // sent flying, tumbling, in the direction the kart was going
        const sp = Math.hypot(k.vx, k.vz);
        t.down = true;
        t.resting = false;
        t.vx = k.vx * 0.9 + (Math.random() - 0.5) * 3;
        t.vz = k.vz * 0.9 + (Math.random() - 0.5) * 3;
        t.vy = 3 + sp * 0.25;
        t.axis.set(-t.vz, 0, t.vx).normalize();
        t.spin = 6 + sp * 0.6;
        t.q.identity();
        k.vx *= 0.93;
        k.vz *= 0.93;
        this.conesMoving = true;
        if (mine) {
          this.stats.cones++;
          this.ctx.sfx.thunk(4);
        }
        continue;
      }
      // bales and tyres don't budge: bounce off them
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      k.x += nx * (reach - d);
      k.z += nz * (reach - d);
      const vn = -(k.vx * nx + k.vz * nz);
      if (vn > 0) {
        k.vx += nx * vn * (t.kind === 'tyres' ? 1.5 : 1.3);
        k.vz += nz * vn * (t.kind === 'tyres' ? 1.5 : 1.3);
        if (vn > 4) {
          k.vx *= 0.45;
          k.vz *= 0.45;
          this.bump(k, vn, t.kind === 'bale' ? 'Hay bale! 🌾' : 'Boing! Tyre wall 🛞');
        }
      }
    }
  }

  /** A hard knock: the kart's stunned for a moment (and you feel it, if it's yours). */
  private bump(k: Kart, speed: number, msg?: string) {
    k.crashT = Math.min(0.7, 0.2 + speed * 0.04);
    if (k !== this.me || !this.active) return;
    this.stats.crashes++;
    this.shake = Math.min(0.6, 0.15 + speed * 0.03);
    this.ctx.sfx.whack();
    if (msg) this.toast(msg);
  }

  private flyCones(dt: number) {
    const dq = new THREE.Quaternion();
    for (const t of this.things) {
      if (t.kind !== 'cone' || !t.down || t.resting) continue;
      t.vy -= 20 * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.z += t.vz * dt;
      t.q.premultiply(dq.setFromAxisAngle(t.axis, t.spin * dt));
      if (t.y <= 0.2 && t.vy < 0) {
        t.y = 0.2;
        if (t.vy < -3) {
          t.vy *= -0.3;
          t.vx *= 0.5;
          t.vz *= 0.5;
          t.spin *= 0.5;
        } else {
          // come to rest lying on its side
          t.resting = true;
          t.y = 0.2;
          const yaw = Math.atan2(t.vx, t.vz);
          t.q.setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'));
        }
      }
      // tyre walls stop them leaving the circuit
      const loc = locate(t.x, t.z, Math.round(t.s / CIRCUIT.ds), 14, this.loc);
      if (Math.abs(loc.d) > WALL - 0.5) {
        t.vx *= -0.3;
        t.vz *= -0.3;
      }
    }
    this.syncObstacles();
  }

  /** Puts the model where the physics says, leaning into turns and spinning the wheels. */
  private pose(k: Kart, dt: number) {
    k.root.position.set(k.x, 0, k.z);
    k.root.rotation.y = k.h;
    const vf = this.forwardSpeed(k);
    const lat = vf * k.yawRate; // sideways acceleration
    k.body.rotation.z += (THREE.MathUtils.clamp(-lat * 0.006, -0.08, 0.08) - k.body.rotation.z) * Math.min(1, dt * 8);
    k.body.rotation.x += (THREE.MathUtils.clamp(k.throttle * 0.03, -0.03, 0.03) - k.body.rotation.x) * Math.min(1, dt * 6);
    k.body.position.y = k.offroad ? Math.sin(this.ctx.time.t * 40 + k.x) * 0.02 * Math.min(1, Math.abs(vf) / 6) : 0;
    for (const w of k.wheels) w.rotation.x -= (vf / 0.26) * dt;
    for (const s of k.steerers) s.rotation.y = k.steer * 0.45;
  }

  /** The grandstand jumps up when the karts come past. */
  private cheer(t: number) {
    let near = 0;
    const p = circuitPoint(START_S - 14, 0, this.pt);
    for (const k of this.karts) near = Math.max(near, 1 - Math.hypot(k.x - p.x, k.z - p.z) / 30);
    if (near <= 0 && !this.fans.userData.up) return;
    this.fans.userData.up = near > 0;
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.fans.count; i++) {
      m.copy(this.fanSeats[i]);
      m.elements[13] += Math.max(0, Math.sin(t * 9 + i * 1.7)) * 0.16 * near;
      this.fans.setMatrixAt(i, m);
    }
    this.fans.instanceMatrix.needsUpdate = true;
  }

  private engineSound() {
    const sfx = this.ctx.sfx;
    if (this.active) {
      const k = this.me;
      const vf = Math.abs(this.forwardSpeed(k));
      const rev = this.phase === 'grid' ? Math.max(0, this.input?.throttle ?? 0) * 0.7 : 0;
      const rpm = Math.max(rev, Math.min(1.2, vf / VMAX));
      sfx.setKart(rpm, Math.max(0, k.throttle) * (k.nitroOn ? 1.3 : 1), Math.min(1, Math.max(0, k.slide - 2) / 6), k.offroad ? Math.min(1, vf / 12) : 0);
      return;
    }
    // heard from the side of the track: the nearest kart
    const cam = this.ctx.camera.position;
    let best: Kart | null = null;
    let bd = Infinity;
    for (const k of this.karts) {
      const d = Math.hypot(k.x - cam.x, k.z - cam.z, cam.y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    const vol = Math.max(0, 1 - bd / 70) * 0.6;
    if (best) sfx.setKart(Math.min(1, Math.abs(this.forwardSpeed(best)) / VMAX), 0.6, 0, 0, vol);
  }

  // ------------------------------------------------------------------ HUD and camera

  private toast(text: string) {
    const el = $('rc-toast');
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this.toastTimer = 2.6;
  }

  private updateHud(dt: number) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('rc-toast').hidden = true;
    }
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.1;
    const me = this.me;
    const order = this.standings();
    const pos = this.place || order.indexOf(me) + 1;
    $('rc-pos').textContent = String(pos);
    $('rc-pos-suf').textContent = ordinal(pos);
    $('rc-lap').textContent = `${Math.min(LAPS, Math.max(1, me.laps + 1))}/${LAPS}`;
    $('rc-time').textContent = fmt(me.finished ?? this.raceT);
    $('rc-speed').textContent = `${Math.round(Math.abs(this.forwardSpeed(me)) * 3.6)} km/h`;
    const bar = $('rc-nitro');
    (bar.firstElementChild as HTMLElement).style.width = `${me.nitro * 100}%`;
    bar.classList.toggle('is-on', me.nitroOn || me.boostT > 0);
    $('rc-board').innerHTML = order
      .map((k, i) => `<li class="${k === me ? 'is-me' : ''}"><i style="background:${k.color}"></i>${i + 1}. ${k === me ? 'You' : k.name}</li>`)
      .join('');
  }

  /** What the camera follows (for shadows and grass LOD). */
  get focus() {
    return new THREE.Vector3(this.me.x, 0, this.me.z);
  }

  /** Your kart, for the minimap. */
  get position() {
    return this.me.root.position;
  }

  get yaw() {
    return this.me.h;
  }

  /** Every kart (yours first), for the minimap. */
  get markers() {
    return this.karts.map((k) => ({ x: k.x, z: k.z, color: k.color }));
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const k = this.me;
    const f = this.forward(k);
    const v = this.forwardSpeed(k);
    camera.up.set(0, 1, 0);
    k.head.visible = this.cam !== 'driver';
    if (this.cam === 'driver') {
      const eye = new THREE.Vector3(k.x + f.x * 0.15, 1.12, k.z + f.z * 0.15);
      camera.position.copy(eye);
      camera.lookAt(eye.x + f.x * 10, 0.8, eye.z + f.z * 10);
      this.camPos.copy(eye);
      this.camLook.set(k.x, 1, k.z);
    } else {
      // behind the direction of travel when moving (so a spin doesn't whip the camera round)
      const sp = Math.hypot(k.vx, k.vz);
      const dirx = sp > 4 && v > 0 ? k.vx / sp : f.x;
      const dirz = sp > 4 && v > 0 ? k.vz / sp : f.z;
      const [back, up] = this.cam === 'high' ? [13, 9] : [6.2 + Math.max(0, v) * 0.05, 2.5];
      const want = new THREE.Vector3(k.x - dirx * back, up, k.z - dirz * back);
      // keep it inside the tyre walls on the hairpins
      const at = locate(want.x, want.z, k.i, 16, { i: 0, s: 0, d: 0 });
      const lim = WALL - 0.8;
      if (Math.abs(at.d) > lim) {
        const p = circuitPoint(at.s, Math.sign(at.d) * lim, this.pt);
        want.x = p.x;
        want.z = p.z;
      }
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      this.camLook.lerp(new THREE.Vector3(k.x + f.x * 4, 0.9, k.z + f.z * 4), 1 - Math.exp(-dt * 10));
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

/** A racing kart, nose to −z: chassis, side pods, nose cone with its number, wing, driver and wheels. */
function kartModel(color: string, num: number) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
  const dark = std('#26222d', { roughness: 0.55, metalness: 0.4 });
  const metal = std('#b9bcc4', { metalness: 0.85, roughness: 0.3 });
  const rubber = std('#17151b', { roughness: 0.9 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.x = rx;
    body.add(b);
    return b;
  };
  box(1.15, 0.07, 1.9, dark, 0, 0.16, 0); // floor tray
  for (const sx of [-1, 1]) box(0.26, 0.2, 0.85, paint, sx * 0.6, 0.29, 0.12); // side pods
  box(1.1, 0.2, 0.42, paint, 0, 0.27, -0.86); // front bumper fairing
  box(0.55, 0.26, 0.5, paint, 0, 0.36, -0.55, -0.35); // nose cone, sloping up to the wheel
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.3), std('#ffffff', { map: numberTexture(num), roughness: 0.5 }));
  plate.position.set(0, 0.495, -0.6);
  plate.rotation.x = -1.2;
  plate.rotation.y = Math.PI;
  plate.rotation.order = 'YXZ';
  body.add(plate);
  box(0.5, 0.5, 0.1, dark, 0, 0.47, 0.42, -0.25); // seat back
  box(0.5, 0.08, 0.5, dark, 0, 0.24, 0.2); // seat pan
  box(0.34, 0.3, 0.36, metal, 0.36, 0.36, 0.62); // engine
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), metal);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.48, 0.4, 0.9);
  body.add(exhaust);
  box(1.3, 0.1, 0.12, dark, 0, 0.27, 0.98); // rear bumper
  const wing = box(1.15, 0.04, 0.32, paint, 0, 0.86, 0.86, 0.12);
  wing.castShadow = true;
  for (const sx of [-1, 1]) box(0.04, 0.5, 0.14, dark, sx * 0.4, 0.62, 0.86);
  // the driver
  const suit = std(color, { roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.28, 4, 10), suit);
  torso.position.set(0, 0.6, 0.24);
  torso.rotation.x = -0.25;
  body.add(torso);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.38, 4, 8), suit);
    arm.position.set(sx * 0.19, 0.64, -0.02);
    arm.rotation.x = 1.15;
    arm.rotation.z = sx * 0.25;
    body.add(arm);
  }
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 6, 16), dark);
  wheel.position.set(0, 0.62, -0.24);
  wheel.rotation.x = -0.9;
  body.add(wheel);
  const head = new THREE.Group();
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), std('#f4efe6', { roughness: 0.3, metalness: 0.1 }));
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.192, 16, 12, 0, Math.PI * 2, 0, 0.5), paint);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.195, 16, 10, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.26),
    std('#14141c', { roughness: 0.05, metalness: 0.6 }),
  );
  head.add(helmet, stripe, visor);
  head.position.set(0, 0.98, 0.16);
  body.add(head);
  // wheels: steerable at the front, a wider pair at the back
  const wheels: THREE.Object3D[] = [];
  const steerers: THREE.Object3D[] = [];
  for (const [sx, z, r, w, front] of [
    [-1, -0.64, 0.24, 0.2, true],
    [1, -0.64, 0.24, 0.2, true],
    [-1, 0.64, 0.27, 0.3, false],
    [1, 0.64, 0.27, 0.3, false],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (front ? 0.62 : 0.66), r, z);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2), rubber);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 6).rotateZ(Math.PI / 2), metal);
    const spin = new THREE.Group();
    spin.add(tyre, hub);
    pivot.add(spin);
    root.add(pivot);
    wheels.push(spin);
    if (front) steerers.push(pivot);
  }
  return { root, body, wheels, steerers, head };
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

/** Asphalt across the road (u) and 11 m along it (v): grain, tyre-darkened lines and white edges. */
function asphaltTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#4a4752';
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry(9);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + rnd() * 50;
    g.fillStyle = `rgba(${v}, ${v}, ${v + 6}, 0.5)`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // rubbered-in racing lines
  g.fillStyle = 'rgba(20, 18, 24, 0.18)';
  for (const x of [80, 160]) g.fillRect(x, 0, 26, 256);
  g.fillStyle = '#f2ede4';
  g.fillRect(5, 0, 7, 256);
  g.fillRect(244, 0, 7, 256);
  return finish(c, true);
}

/** Tyres seen side-on, stacked three high, every other column painted red. */
function tyreWallTexture() {
  const { c, g } = canvas(256, 80);
  g.fillStyle = '#121116';
  g.fillRect(0, 0, 256, 80);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 3; row++) {
      const x = col * 64;
      const y = row * 26 + 1;
      g.fillStyle = col % 2 ? '#e8e2d8' : PALETTE.candy;
      g.beginPath();
      g.roundRect(x + 2, y + 2, 60, 22, 10);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 6, y + 15, 52, 4);
    }
  return finish(c, true);
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
  // twine bands
  g.fillStyle = 'rgba(90, 60, 30, 0.6)';
  for (const y of [30, 94]) g.fillRect(0, y, 128, 3);
  return finish(c, true);
}

/** A glossy black puddle with a rainbow sheen at its edge. */
function oilTexture() {
  const { c, g } = canvas(256, 256);
  const rnd = mulberry(12);
  g.translate(128, 128);
  const blob = (r: number) => {
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = r * (0.82 + 0.18 * Math.sin(a * 3 + 1) + 0.08 * Math.sin(a * 7));
      if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
  };
  const sheen = g.createRadialGradient(0, 0, 40, 0, 0, 120);
  sheen.addColorStop(0, 'rgba(10, 10, 16, 0.95)');
  sheen.addColorStop(0.75, 'rgba(60, 30, 120, 0.85)');
  sheen.addColorStop(0.88, 'rgba(30, 140, 130, 0.8)');
  sheen.addColorStop(1, 'rgba(160, 120, 40, 0.0)');
  g.fillStyle = sheen;
  blob(118);
  g.fill();
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(10, 10, 16, 0.9)';
    g.beginPath();
    g.arc((rnd() - 0.5) * 200, (rnd() - 0.5) * 200, 6 + rnd() * 10, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** Glowing chevrons pointing up the texture (down the track once laid flat). */
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

function numberTexture(num: number) {
  const { c, g } = canvas(128, 112);
  g.fillStyle = '#f4efe6';
  g.beginPath();
  g.roundRect(4, 4, 120, 104, 20);
  g.fill();
  g.fillStyle = PALETTE.ink;
  g.font = '86px "Lilita One", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 62);
  return finish(c);
}
