import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shadowed, staticBox, std, type Attraction, type Ctx } from '../context';
import type { Input } from '../input';
import { FLIP_YAW, LAYOUT } from '../layout';
import { hdr, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';

// A giant "XXL"-style swing ride: one long arm on a tower, a gondola of twelve outward-facing seats
// on one end and a counterweight on the other. The motor pumps the arm like a pendulum until it
// swings over the top, then it loops while the gondola spins on its own axle, flipping the riders
// head over heels. Scaled up so the gondola tops out at 125 m: half the height of the giant wheel.
// The ride is built in a local frame: the arm turns in the x-y plane, and +z faces the park.
const PIVOT_Y = 65; // the arm's axle, on top of the tower
const ARM = 60; // axle → gondola: the gondola's centre sweeps from 5 m up to 125 m
const COUNTER = 34; // axle → counterweight
const ARM_Z = 3.6; // the arm turns in a plane just in front of the tower
const GONDOLA_Z = 9; // the gondola hangs beside the arm's tip, centred here
const ROW = 6; // seats per row; two rows back to back
const SEAT_PITCH = 1.05;
const HOOP = 3; // radius of the gondola's two hoops
const HOOP_Z = 3.6; // hoops either side of the gondola's centre

// Arm dynamics (rad/s²): gravity for a pendulum this size, and the most the motor can give.
const GRAV = 9.81 / 61;
const MOTOR = 0.14;
const LOOP_SPEED = 0.92; // rad/s through the bottom once looping (~200 km/h at the gondola)
const E_LOOP = 0.5 * LOOP_SPEED ** 2;
const FLIP_RATE = 1.4; // the gondola's own spin while looping, rad/s
// The programme, in seconds: about 80 s from the first swing back to the platform.
const BOARD = 4;
const PUMP = 16;
const LOOP = 22;
const BRAKE = 12;
const REST = 14; // pause between cycles when nobody is aboard

type Phase = 'rest' | 'board' | 'pump' | 'loop' | 'brake' | 'settle' | 'done';
type Cam = 'seat' | 'chase' | 'wide';
const CAM_LABEL: Record<Cam, string> = { seat: 'Seat', chase: 'Chase', wide: 'Wide' };

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

/** Matrix for a unit cylinder (height 1 along y) stretched between a and b. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, out = new THREE.Matrix4()) {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  return out.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
}

/** A box, already placed, with every vertex painted one colour (for merged vertex-coloured meshes). */
function paintedBox(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation) {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A seated rider facing local +x (side = 1) or -x (side = -1), centred on the seat at z. */
function riderGeometry(side: number, z: number, shirt: THREE.ColorRepresentation, skin: THREE.ColorRepresentation) {
  const head = paint(new THREE.SphereGeometry(0.17, 10, 8).translate(side * 0.72, 0.42, z), skin);
  return mergeGeometries([
    paintedBox(0.36, 0.7, 0.42, side * 0.7, -0.15, z, shirt),
    head,
    paintedBox(0.45, 0.16, 0.36, side * 1.0, -0.5, z, '#2f3550'), // thighs
    paintedBox(0.15, 0.5, 0.32, side * 1.2, -0.82, z, '#2f3550'), // shins, dangling
    paintedBox(0.12, 0.42, 0.1, side * 0.86, -0.12, z + 0.25, shirt), // arms on the restraint
    paintedBox(0.12, 0.42, 0.1, side * 0.86, -0.12, z - 0.25, shirt),
  ])!;
}

export class SkyFlip implements Attraction {
  private root = new THREE.Group();
  private arm = new THREE.Group();
  private gondola = new THREE.Group();
  private you: THREE.Mesh;
  private eye = new THREE.Object3D();
  private armLeds: THREE.InstancedMesh;
  private hoopLeds: THREE.InstancedMesh;
  /** Each arm LED's distance from the axle, for the chase pattern. */
  private ledStep: number[] = [];
  private theta = 0; // arm angle; 0 = gondola at the bottom
  private omega = 0;
  private psi = 0; // gondola angle in the arm's plane; 0 = seats upright
  private psiVel = 0;
  private psiRest = 0;
  private spinDir = 1;
  private phase: Phase = 'rest';
  private phaseTime = 0;
  private riding = false;
  private cam: Cam = 'seat';
  private yaw = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private prevEye = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  private gforce = 1;
  private lastSin = 0;
  private topAltitude = 0;
  private topSpeed = 0;
  private lastDt = 0;
  private flips = 0;
  private loops = 0;
  private maxG = 1;
  private roundStart = 0;
  input: Input | null = null;
  onFinish: (() => void) | null = null;
  /** The cycle is over and the gondola is back at the platform: the round is done. */
  onComplete: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    this.root.position.set(LAYOUT.flip.x, 0, LAYOUT.flip.z);
    this.root.rotation.y = FLIP_YAW;

    this.buildTower();
    this.armLeds = this.buildArm();
    const { you, leds } = this.buildGondola();
    this.you = you;
    this.hoopLeds = leds;
    this.buildPlatform();

    shadowed(this.root);
    this.armLeds.castShadow = this.hoopLeds.castShadow = false;
    ctx.scene.add(this.root);
    this.pose();
  }

  // ---------------------------------------------------------------- construction

  private buildTower() {
    const g = new THREE.Group();
    const steel = std('#e9edf2', { metalness: 0.75, roughness: 0.32 });
    const unit = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
    const stripes = stripeTexture(PALETTE.orange, PALETTE.mustard, 8, true);
    stripes.repeat.set(1, 6);
    const livery = std('#ffffff', { map: stripes, metalness: 0.25, roughness: 0.45 });

    // the column, tapering up to the machine house that carries the arm's axle
    const colH = PIVOT_Y - 2;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, colH, 28), livery);
    column.position.y = colH / 2;
    const house = new THREE.Mesh(new THREE.BoxGeometry(4.6, 6, 4), std(PALETTE.ink, { metalness: 0.4, roughness: 0.5 }));
    house.position.set(0, PIVOT_Y - 0.5, -0.6);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 5.6, 32), steel);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, PIVOT_Y, 1.4);
    g.add(column, house, hub);

    // two raking legs and a back strut, so the tower stands the swing of a 94 m arm
    const legs = new THREE.InstancedMesh(unit, steel, 5);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    legs.setMatrixAt(0, strut(v(-15, 0, -0.8), v(0, 34, -0.6), 0.85));
    legs.setMatrixAt(1, strut(v(15, 0, -0.8), v(0, 34, -0.6), 0.85));
    legs.setMatrixAt(2, strut(v(0, 0, -7), v(0, 30, -1.2), 0.75));
    legs.setMatrixAt(3, strut(v(-9.3, 13, -0.75), v(9.3, 13, -0.75), 0.5));
    legs.setMatrixAt(4, strut(v(0, 13, -4.2), v(0, 13, 0), 0.4));
    g.add(legs);
    const concrete = std('#b9b2a6', { roughness: 0.9 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 1.2, 24), concrete);
    plinth.position.y = 0.6;
    g.add(plinth);
    for (const [x, z] of [[-15, -0.8], [15, -0.8], [0, -7]] as const) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 1, 14), concrete);
      pad.position.set(x, 0.5, z);
      g.add(pad);
    }

    // glowing rings up the column, and a ring round the axle's cap
    const palette = [PALETTE.candy, PALETTE.mustard, PALETTE.teal, PALETTE.violet];
    for (let i = 0, y = 6; y < PIVOT_Y - 5; y += 6, i++) {
      const r = 2.6 - (0.9 * y) / colH + 0.1;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.13, 6, 40), new THREE.MeshBasicMaterial({ color: hdr(palette[i % 4], 4) }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      ring.castShadow = false;
      g.add(ring);
    }
    const cap = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: hdr(PALETTE.mustard, 5) }));
    cap.position.set(0, PIVOT_Y, 4.25);
    g.add(cap);
    this.root.add(g);
  }

  /** The arm and counterweight; returns the LED strips along it. */
  private buildArm() {
    this.arm.position.y = PIVOT_Y;
    this.root.add(this.arm);
    const stripes = stripeTexture(PALETTE.candy, PALETTE.violet, 8, true);
    stripes.repeat.set(1, 7);
    const livery = std('#ffffff', { map: stripes, metalness: 0.3, roughness: 0.4 });
    // square-section beams: thick at the axle, tapering to each end
    const lower = new THREE.CylinderGeometry(1.9, 1.0, ARM, 4, 1).rotateY(Math.PI / 4).translate(0, -ARM / 2, ARM_Z);
    const upper = new THREE.CylinderGeometry(1.25, 1.9, COUNTER, 4, 1).rotateY(Math.PI / 4).translate(0, COUNTER / 2, ARM_Z);
    this.arm.add(new THREE.Mesh(lower, livery), new THREE.Mesh(upper, livery));

    // counterweight, with the ride's name on it, facing the park
    const weight = new THREE.Mesh(new THREE.BoxGeometry(7.5, 5, 3), std(PALETTE.violet, { metalness: 0.35, roughness: 0.45 }));
    weight.position.set(0, COUNTER, ARM_Z + 1.2);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(8.1, 5.6, 2.2), std(PALETTE.mustard, { metalness: 0.5, roughness: 0.4 }));
    trim.position.copy(weight.position);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 2.6),
      signMaterial(signTexture('SKY FLIP', { sub: '125 m · 360° · flips', border: PALETTE.candy, width: 1024, height: 380 }), { emissiveIntensity: 2.4 }),
    );
    sign.position.set(0, COUNTER, ARM_Z + 2.72);
    this.arm.add(weight, trim, sign);

    // two LED strips down the arm's park-facing side
    const spots: THREE.Vector3[] = [];
    const half = (d: number, r0: number, r1: number, len: number) => (r0 + ((r1 - r0) * d) / len) / Math.SQRT2;
    for (let d = 2.5; d < ARM - 1; d += 1.5) {
      const h = half(d, 1.9, 1.0, ARM);
      for (const s of [-1, 1]) spots.push(new THREE.Vector3(s * (h - 0.15), -d, ARM_Z + h + 0.06));
      this.ledStep.push(d, d);
    }
    for (let d = 2.5; d < COUNTER - 3; d += 1.5) {
      const h = half(d, 1.9, 1.25, COUNTER);
      for (const s of [-1, 1]) spots.push(new THREE.Vector3(s * (h - 0.15), d, ARM_Z + h + 0.06));
      this.ledStep.push(-d, -d);
    }
    const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((p, i) => {
      leds.setMatrixAt(i, m.makeTranslation(p));
      leds.setColorAt(i, hdr('#ffffff', 4));
    });
    leds.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.arm.add(leds);
    return leds;
  }

  /** The gondola: two rows of six seats back to back between two hoops, on an axle off the arm's tip. */
  private buildGondola() {
    this.gondola.position.y = -ARM;
    this.arm.add(this.gondola);
    const steel = std('#d9dee6', { metalness: 0.8, roughness: 0.3 });
    const dark = std('#3a3346', { metalness: 0.5, roughness: 0.5 });
    const span = ROW * SEAT_PITCH + 0.5;

    // the axle stub out of the arm, a bearing, and the spine the seats hang on
    const axleLen = GONDOLA_Z - span / 2 - ARM_Z;
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, axleLen, 16).rotateX(Math.PI / 2), steel);
    axle.position.z = ARM_Z + axleLen / 2;
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 20).rotateX(Math.PI / 2), dark);
    bearing.position.z = GONDOLA_Z - span / 2 - 0.25;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, span), dark);
    spine.position.z = GONDOLA_Z;
    this.gondola.add(axle, bearing, spine);

    // hoops with spokes, and LEDs round them
    const unit = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    const hoopMat = std(PALETTE.mustard, { metalness: 0.45, roughness: 0.35 });
    const spokes = new THREE.InstancedMesh(unit, hoopMat, 8);
    const LEDS_PER_HOOP = 28;
    const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), LEDS_PER_HOOP * 2);
    const m = new THREE.Matrix4();
    const palette = [PALETTE.candy, PALETTE.teal, PALETTE.mustard, '#ffffff'];
    [-1, 1].forEach((s, j) => {
      const z = GONDOLA_Z + s * HOOP_Z;
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(HOOP, 0.17, 8, 48), hoopMat);
      hoop.position.z = z;
      this.gondola.add(hoop);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        spokes.setMatrixAt(j * 4 + k, strut(new THREE.Vector3(0, 0, z), new THREE.Vector3(Math.cos(a) * HOOP, Math.sin(a) * HOOP, z), 0.12));
      }
      for (let k = 0; k < LEDS_PER_HOOP; k++) {
        const a = (k / LEDS_PER_HOOP) * TAU;
        const i = j * LEDS_PER_HOOP + k;
        leds.setMatrixAt(i, m.makeTranslation(Math.cos(a) * HOOP, Math.sin(a) * HOOP, z + s * 0.2));
        leds.setColorAt(i, hdr(palette[k % palette.length], 5));
      }
    });
    // the spine also ties into each hoop at its ends
    this.gondola.add(spokes, leds);

    // seats: backrest on the spine, a pan, and a padded over-shoulder restraint
    const frames: THREE.BufferGeometry[] = [];
    const pads: THREE.BufferGeometry[] = [];
    const bars: THREE.BufferGeometry[] = [];
    const riders: THREE.BufferGeometry[] = [];
    const shirts = [PALETTE.candy, PALETTE.teal, PALETTE.mustard, PALETTE.violet, '#4f8fe8', '#f2f2f2', PALETTE.orange];
    const skins = ['#f1c8a4', '#d9a77f', '#a8714f', '#7a4e33', '#e8b896'];
    let you: THREE.Mesh | null = null;
    let n = 0;
    for (const side of [1, -1])
      for (let k = 0; k < ROW; k++) {
        const z = GONDOLA_Z + (k - (ROW - 1) / 2) * SEAT_PITCH;
        frames.push(new THREE.BoxGeometry(0.5, 0.12, 0.82).translate(side * 0.6, -0.72, z)); // seat bracket
        pads.push(new THREE.BoxGeometry(0.16, 1.3, 0.8).translate(side * 0.44, 0.05, z)); // backrest
        pads.push(new THREE.BoxGeometry(0.6, 0.14, 0.8).translate(side * 0.75, -0.6, z)); // seat pan
        bars.push(new THREE.BoxGeometry(0.62, 0.14, 0.7).translate(side * 0.78, 0.62, z)); // yoke over the shoulders
        bars.push(new THREE.BoxGeometry(0.12, 1.0, 0.62).translate(side * 1.08, 0.1, z)); // chest bar
        const rider = riderGeometry(side, z, shirts[(n * 3) % shirts.length], skins[(n * 2) % skins.length]);
        n++;
        // the middle seat of the front row is yours: a mesh of its own, so the seat cam can hide it
        if (side === 1 && k === 2) {
          you = new THREE.Mesh(rider, std('#ffffff', { vertexColors: true, roughness: 0.7 }));
          this.eye.position.set(0.8, 0.45, z);
        } else riders.push(rider);
      }
    this.gondola.add(
      new THREE.Mesh(mergeGeometries(frames), dark),
      new THREE.Mesh(mergeGeometries(pads), std(PALETTE.ink, { roughness: 0.6 })),
      new THREE.Mesh(mergeGeometries(bars), std(PALETTE.mustard, { roughness: 0.4, metalness: 0.2 })),
      new THREE.Mesh(mergeGeometries(riders), std('#ffffff', { vertexColors: true, roughness: 0.7 })),
      you!,
      this.eye,
    );
    return { you: you!, leds };
  }

  /** The boarding deck under the gondola, the safety fence round the swing, and the entrance sign. */
  private buildPlatform() {
    const g = new THREE.Group();
    const cream = std(PALETTE.cream, { roughness: 0.8 });
    const ink = std(PALETTE.ink, { roughness: 0.5 });
    // deck (below the gondola's lowest sweep at 2 m), and steps down to the front
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 1.3, 9), cream);
    deck.position.set(0, 0.65, GONDOLA_Z + 0.1);
    g.add(deck);
    for (let i = 0; i < 3; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(4, 0.43 * (3 - i), 0.65), cream);
      step.position.set(0, (0.43 * (3 - i)) / 2, GONDOLA_Z + 4.6 + 0.32 + i * 0.65);
      g.add(step);
    }
    // operator's booth beside the deck
    const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 2.6), std(PALETTE.candy, { roughness: 0.6 }));
    booth.position.set(10, 1.3, GONDOLA_Z + 2);
    const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 3.2), ink);
    boothRoof.position.set(10, 2.75, GONDOLA_Z + 2);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshBasicMaterial({ color: hdr('#ffd59a', 1.8) }));
    pane.position.set(10, 1.75, GONDOLA_Z + 3.31);
    g.add(booth, boothRoof, pane);

    // fence: along the front and both sides of the swing's footprint
    const FRONT = 16;
    const SIDE = 26;
    const BACK = -4;
    const runs: [number, number, number, number][] = [
      [-SIDE, FRONT, SIDE, FRONT],
      [-SIDE, BACK, -SIDE, FRONT],
      [SIDE, BACK, SIDE, FRONT],
    ];
    const posts: THREE.Vector3[] = [];
    const rails: THREE.Matrix4[] = [];
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const count = Math.round(len / 2);
      for (let i = 0; i <= count; i++) posts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / count, 0.6, z0 + ((z1 - z0) * i) / count));
      for (const y of [0.55, 1.1]) rails.push(strut(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1), 0.05));
      // colliders (world space), so visitors can't wander under the swing
      const c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).applyAxisAngle(UP, FLIP_YAW).add(this.root.position);
      const along = x0 === x1 ? Math.PI / 2 : 0;
      staticBox(this.ctx, c.x, 0.7, c.z, len / 2, 0.7, 0.12, FLIP_YAW + along);
    }
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), std(PALETTE.candy, { roughness: 0.6 }), posts.length);
    posts.forEach((p, i) => postMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p)));
    const railMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), std(PALETTE.cream, { metalness: 0.3, roughness: 0.5 }), rails.length);
    rails.forEach((m, i) => railMesh.setMatrixAt(i, m));
    g.add(postMesh, railMesh);

    // entrance sign beside the gate, facing the path
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3.4),
      signMaterial(signTexture('SKY FLIP', { sub: 'Swing 125 m up · loop the loop · flip head over heels', border: PALETTE.orange, width: 1280, height: 360 }), {
        emissiveIntensity: 2,
      }),
    );
    sign.position.set(-10, 5, FRONT + 0.4);
    for (const x of [-15.5, -4.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6.6), ink);
      post.position.set(x, 3.3, FRONT + 0.3);
      g.add(post);
    }
    g.add(sign);
    g.traverse((o) => (o.receiveShadow = true));
    this.root.add(g);
  }

  // ---------------------------------------------------------------- motion

  private go(phase: Phase) {
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'loop') this.spinDir = Math.sign(this.omega) || 1;
    // catch the gondola at the next upright position it reaches
    if (phase === 'brake') this.psiRest = Math.round((this.psi + this.psiVel) / TAU) * TAU;
    if (!this.riding) return;
    if (phase === 'pump') this.ctx.sfx.clack();
    if (phase === 'loop') this.ctx.ui.countdown('OVER THE TOP!');
    if (phase === 'brake') this.ctx.ui.countdown(null);
  }

  /** Moves the programme on: rest → pump → loop → brake → settle → rest. */
  private advance() {
    const t = this.phaseTime;
    switch (this.phase) {
      case 'rest':
        if (!this.riding && t > REST) this.go('pump');
        break;
      case 'board':
        if (t > BOARD) this.go('pump');
        break;
      case 'pump':
        if ((t > PUMP && Math.abs(this.theta) > Math.PI) || t > PUMP + 20) this.go('loop');
        break;
      case 'loop':
        if (this.riding && t > 1.6 && t < 2.5) this.ctx.ui.countdown(null);
        if (t > LOOP && Math.cos(this.theta) > 0.99) this.go('brake');
        break;
      case 'brake':
        if (this.energy < 0.05) this.go('settle');
        break;
      case 'settle': {
        const rest = Math.round(this.theta / TAU) * TAU;
        const still = Math.abs(this.omega) < 0.005 && Math.abs(this.theta - rest) < 0.003 && Math.abs(this.psiVel) < 0.01 && Math.abs(this.psi - this.psiRest) < 0.01;
        if (still) {
          this.theta = this.omega = this.psi = this.psiVel = this.psiRest = 0;
          this.go(this.riding ? 'done' : 'rest');
        }
        break;
      }
      case 'done':
        // fired once, as the 2 s mark passes
        if (t > 2 && t - this.lastDt <= 2) this.onComplete?.();
        break;
    }
  }

  private get energy() {
    return 0.5 * this.omega ** 2 + GRAV * (1 - Math.cos(this.theta));
  }

  private step(h: number) {
    const p = this.phase;
    if (p === 'rest' || p === 'board' || p === 'done') return;
    // the motor pushes with the swing (or, at a standstill, with gravity) to reach a target energy
    const w = this.omega;
    const s = Math.abs(w) > 0.04 ? Math.sign(w) : Math.abs(Math.sin(this.theta)) < 0.05 ? 1 : -Math.sign(Math.sin(this.theta));
    const toward = (target: number) => THREE.MathUtils.clamp(0.4 * (target - this.energy), -MOTOR, MOTOR) * s;
    const t = this.phaseTime;
    let u = 0;
    if (p === 'pump') u = toward(E_LOOP * Math.min(1, t / PUMP));
    else if (p === 'loop') u = toward(E_LOOP);
    else if (p === 'brake') u = toward(E_LOOP * Math.max(0, 1 - t / BRAKE));
    else u = -0.12 * (this.theta - Math.round(this.theta / TAU) * TAU) - 0.7 * w; // settle
    this.omega += (-GRAV * Math.sin(this.theta) + u) * h;
    this.theta += this.omega * h;

    // the gondola: spun by its own motor while looping (flips!), otherwise it hangs level,
    // dragged a little by the arm so it lags behind the swing
    let a: number;
    if (p === 'loop') a = 1.5 * (-this.spinDir * FLIP_RATE - this.psiVel);
    else a = -1.6 * (this.psi - this.psiRest) - 2 * this.psiVel + 0.8 * (this.omega - this.psiVel);
    this.psiVel += a * h;
    this.psi += this.psiVel * h;
  }

  private pose() {
    this.arm.rotation.z = this.theta;
    this.gondola.rotation.z = this.psi - this.theta;
  }

  /** Height of the gondola's centre above the ground. */
  get altitude() {
    return PIVOT_Y - ARM * Math.cos(this.theta);
  }

  /** Ground point under the gondola (for shadows and grass LOD). */
  get focus() {
    return this.gondola.getWorldPosition(new THREE.Vector3()).setY(0);
  }

  update(dt: number, t: number) {
    this.phaseTime += dt;
    this.lastDt = dt;
    this.advance();
    // small fixed steps: the motor's controller is stiff around the turning points
    const n = Math.ceil(dt * 120);
    for (let i = 0; i < n; i++) this.step(dt / n);
    this.pose();

    // chase the arm LEDs out along the arm; faster while looping
    const rate = this.phase === 'loop' ? 40 : 12;
    const palette = [PALETTE.candy, PALETTE.mustard, PALETTE.teal, PALETTE.violet];
    const c = new THREE.Color();
    this.ledStep.forEach((d, i) => {
      const k = Math.floor((Math.abs(d) - t * rate) / 4.5);
      this.armLeds.setColorAt(i, c.set(palette[((k % 4) + 4) % 4]).multiplyScalar(5));
    });
    this.armLeds.instanceColor!.needsUpdate = true;

    if (this.riding) this.updateRider(dt);
  }

  private updateRider(dt: number) {
    this.root.updateMatrixWorld();
    const p = this.eye.getWorldPosition(new THREE.Vector3());
    if (dt > 0) {
      const v = p.clone().sub(this.prevEye).divideScalar(dt);
      const acc = v.clone().sub(this.prevVel).divideScalar(dt);
      // what the rider feels: acceleration minus gravity, in G
      const g = acc.add(new THREE.Vector3(0, 9.81, 0)).length() / 9.81;
      this.gforce += (g - this.gforce) * (1 - Math.exp(-dt * 4));
      this.maxG = Math.max(this.maxG, this.gforce);
      this.prevVel.copy(v);
    }
    this.prevEye.copy(p);
    this.yaw += (this.input?.steer ?? 0) * dt * 1.4;
    this.yaw = THREE.MathUtils.clamp(this.yaw, -1.4, 1.4);

    // whoosh through the bottom
    const sin = Math.sin(this.theta);
    if (Math.sign(sin) !== Math.sign(this.lastSin) && Math.cos(this.theta) > 0.5 && Math.abs(this.omega) > 0.45) this.ctx.sfx.whoosh();
    this.lastSin = sin;

    const kmh = Math.abs(this.omega) * ARM * 3.6;
    this.topAltitude = Math.max(this.topAltitude, this.altitude);
    this.topSpeed = Math.max(this.topSpeed, kmh);
    // counted as the ride goes: the angles are zeroed once it settles back at the platform
    this.flips = Math.max(this.flips, Math.floor(Math.abs(this.psi) / TAU));
    this.loops = Math.max(this.loops, Math.floor(Math.abs(this.theta) / TAU));
    const status =
      this.phase === 'board' ? 'Restraints locked…' : this.phase === 'done' ? 'Welcome back!' : `${Math.round(this.altitude)} m · ${Math.round(kmh)} km/h · ${this.gforce.toFixed(1)} G`;
    this.ctx.ui.score(`🌀 ${status} · ${this.loops} loops · ${this.flips} flips · ${CAM_LABEL[this.cam]} cam`);
  }

  // ---------------------------------------------------------------- riding

  start() {
    this.riding = true;
    this.theta = this.omega = this.psi = this.psiVel = this.psiRest = 0;
    this.go('board');
    this.cam = 'seat';
    this.yaw = 0;
    this.gforce = 1;
    this.topAltitude = 0;
    this.topSpeed = 0;
    this.maxG = 1;
    this.roundStart = this.ctx.time.t;
    this.flips = this.loops = 0;
    this.lastSin = 0;
    this.pose();
    this.root.updateMatrixWorld();
    this.eye.getWorldPosition(this.prevEye);
    this.prevVel.set(0, 0, 0);
    this.you.visible = false;
    // opens by itself the first time; after that it's behind the ℹ️
    this.ctx.ui.setIntro(
      'flip-intro',
      'Sky Flip',
      `<p class="eyebrow">Sky Flip · giant swing</p><h2>Hold on to something!</h2><p>The arm swings higher and higher until it goes <strong>right over the top</strong>, then loops while your gondola spins on its own: <strong>head over heels, 125 m up</strong> (half the height of the giant wheel).</p><p>${
        this.ctx.mobile ? 'Joystick <strong>left/right</strong> looks around. Tap <kbd>E</kbd> to switch camera.' : '<kbd>A</kbd>/<kbd>D</kbd> look around · <kbd>C</kbd> camera.'
      }</p>`,
      { accent: PALETTE.orange },
    );
    this.ctx.sfx.chime();
  }

  exit() {
    if (!this.riding) return;
    this.riding = false;
    this.you.visible = true;
    // if you jump off mid-ride, the gondola carries on with its cycle
    if (this.phase === 'done' || this.phase === 'board') this.go('rest');
    this.ctx.ui.countdown(null);
    this.ctx.ui.score(null);
    this.onFinish?.();
  }

  /** This round's numbers (see account/stats.ts). */
  roundStats(): Record<string, number> {
    return {
      durationS: this.ctx.time.t - this.roundStart,
      maxHeightM: this.topAltitude,
      topSpeedKmh: this.topSpeed,
      maxG: this.maxG,
      loops: this.loops,
      flips: this.flips,
    };
  }

  cycleCamera() {
    const order: Cam[] = ['seat', 'chase', 'wide'];
    this.cam = order[(order.indexOf(this.cam) + 1) % order.length];
    this.you.visible = this.cam !== 'seat';
    this.ctx.sfx.pop();
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    this.root.updateMatrixWorld();
    if (this.cam === 'seat') {
      // in your seat, facing out of the gondola: the horizon rolls right round as you flip
      const m = this.gondola.matrixWorld;
      const eye = this.eye.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(Math.cos(this.yaw), -0.22, Math.sin(this.yaw)).transformDirection(m);
      camera.up.set(0, 1, 0).transformDirection(m);
      camera.position.copy(eye);
      camera.lookAt(eye.clone().add(dir));
      this.camPos.copy(eye);
      this.camLook.copy(eye).add(dir);
      return;
    }
    camera.up.set(0, 1, 0);
    if (this.cam === 'chase') {
      // hovering beside the gondola on the park side, riding along with it
      const g = this.gondola.getWorldPosition(new THREE.Vector3());
      const out = new THREE.Vector3(Math.sin(FLIP_YAW), 0, Math.cos(FLIP_YAW));
      this.camPos.copy(g).addScaledVector(out, 26).add(new THREE.Vector3(0, 4, 0));
      this.camLook.copy(g);
    } else {
      // from across the park: the whole swing, from the ground to 125 m
      const k = 1 - Math.exp(-dt * 3);
      this.camPos.lerp(this.root.localToWorld(new THREE.Vector3(22, 18, 175)), k);
      this.camLook.lerp(this.root.localToWorld(new THREE.Vector3(0, 62, 0)), k);
    }
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }
}
