import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shadowed, std, type Attraction, type Ctx } from '../context';
import type { Input } from '../input';
import { LAYOUT } from '../layout';
import { hdr, PALETTE, signMaterial, signTexture } from '../textures';

// A full-size tribute to Ain Dubai (Bluewaters Island, Dubai), the world's tallest observation
// wheel: 250 m tall, a rim held by 192 cable spokes on a rotating hub, a fixed spindle carried
// by four 126 m legs welded into two A-frames, and 48 capsules (40 riders each) mounted
// outside the rim that stay level as it turns. One revolution takes 38 minutes.
// The published figures fix the overall size; member sizes (rim truss, leg tubes, capsule
// shape) are estimated from photos.
const HUB_Y = 126; // hub centre, on top of the 126 m legs
const RIM_INNER = 112; // rim truss: one inner chord…
const RIM_OUTER = 118; // …and two outer chords
const RIM_HALF = 3.2; // half-width of the truss (along the axle)
const CABIN_R = 121.6; // capsule centres, mounted outside the rim: tops reach 250 m
const CABINS = 48;
const SPOKES = 192;
const CABIN_RADIUS = 2.6;
const CABIN_LEN = 11; // about a double-decker bus
const SPINDLE_HALF = 22; // the hub + spindle assembly is ~40 m long
const LEG_FOOT = { x: 56, z: 40 }; // A-frame feet: spread along the wheel and out from it
const REV_REAL = 38 * 60; // seconds per revolution, as operated
const REV_RIDE = 150; // the ride is shown as a time-lapse: one revolution in 2.5 minutes

type Cam = 'cabin' | 'outside' | 'wide';
const CAM_LABEL: Record<Cam, string> = { cabin: 'Cabin', outside: 'Outside', wide: 'Wide' };

const UP = new THREE.Vector3(0, 1, 0);

/** Matrix for a unit cylinder (height 1 along y) stretched between a and b. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, out = new THREE.Matrix4()) {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  return out.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
}

export class GiantWheel implements Attraction {
  /** Hub centre in world space. */
  readonly centre = new THREE.Vector3(LAYOUT.ferris.x, HUB_Y, LAYOUT.ferris.z);
  private wheel = new THREE.Group();
  private shells: THREE.InstancedMesh;
  private frames: THREE.InstancedMesh;
  private floors: THREE.InstancedMesh;
  private angle = -Math.PI / 2; // cabin 0 starts at the boarding platform
  private riding = false;
  private rode = 0;
  private cam: Cam = 'cabin';
  private yaw = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  input: Input | null = null;
  onFinish: (() => void) | null = null;

  constructor(private ctx: Ctx, ground: (x: number, z: number) => number = () => 0) {
    const steel = std('#e9edf2', { metalness: 0.75, roughness: 0.32 });
    const darkSteel = std('#b8c0ca', { metalness: 0.8, roughness: 0.38 });
    const unit = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    const m = new THREE.Matrix4();

    // ---- rim: a triangular truss, three chords and diagonal lacing ----
    for (const [r, z, tube] of [
      [RIM_INNER, 0, 0.85],
      [RIM_OUTER, -RIM_HALF, 0.7],
      [RIM_OUTER, RIM_HALF, 0.7],
    ] as const) {
      const chord = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 480), steel);
      chord.position.z = z;
      this.wheel.add(chord);
    }
    const panels = SPOKES;
    const lacing = new THREE.InstancedMesh(unit, steel, panels * 4);
    const at = (r: number, a: number, z: number) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
    let k = 0;
    for (let i = 0; i < panels; i++) {
      const a0 = (i / panels) * Math.PI * 2;
      const a1 = ((i + 0.5) / panels) * Math.PI * 2;
      lacing.setMatrixAt(k++, strut(at(RIM_INNER, a0, 0), at(RIM_OUTER, a1, -RIM_HALF), 0.28, m));
      lacing.setMatrixAt(k++, strut(at(RIM_INNER, a0, 0), at(RIM_OUTER, a1, RIM_HALF), 0.28, m));
      lacing.setMatrixAt(k++, strut(at(RIM_OUTER, a0, -RIM_HALF), at(RIM_OUTER, a0, RIM_HALF), 0.24, m));
      lacing.setMatrixAt(k++, strut(at(RIM_INNER, a1, 0), at(RIM_OUTER, a1, -RIM_HALF), 0.2, m));
    }
    this.wheel.add(lacing);

    // ---- 192 cable spokes, alternating between the two hub flanges like a bicycle wheel ----
    const cables = new THREE.InstancedMesh(unit, std('#cfd5dd', { metalness: 0.7, roughness: 0.35 }), SPOKES);
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      const side = i % 2 ? 1 : -1;
      cables.setMatrixAt(i, strut(at(6.5, a, side * 9.5), at(RIM_INNER, a, 0), 0.11, m));
    }
    this.wheel.add(cables);

    // ---- rotating hub with its two spoke flanges ----
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 18, 32), darkSteel);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    for (const z of [-9.5, 9.5]) {
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 1.2, 32), steel);
      flange.rotation.x = Math.PI / 2;
      flange.position.z = z;
      this.wheel.add(flange);
    }

    // ---- capsule mounts (they turn with the rim) ----
    const mounts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), darkSteel, CABINS * 2);
    for (let i = 0; i < CABINS; i++) {
      const a = (i / CABINS) * Math.PI * 2;
      for (const [j, z] of [
        [0, -3.4],
        [1, 3.4],
      ] as const) {
        const p = at((RIM_OUTER + CABIN_R - CABIN_RADIUS) / 2 + 0.4, a, z);
        m.compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a), new THREE.Vector3(CABIN_R - CABIN_RADIUS - RIM_OUTER + 1.6, 0.9, 0.9));
        mounts.setMatrixAt(i * 2 + j, m);
      }
    }
    this.wheel.add(mounts);

    // ---- LED lighting along the outer chords ----
    const ledCount = 480;
    const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), ledCount * 2);
    const palette = [PALETTE.teal, PALETTE.violet, PALETTE.mustard, '#ffffff'];
    for (let i = 0; i < ledCount; i++)
      for (const [j, z] of [
        [0, -RIM_HALF - 0.8],
        [1, RIM_HALF + 0.8],
      ] as const) {
        m.makeTranslation(at(RIM_OUTER, (i / ledCount) * Math.PI * 2, z));
        leds.setMatrixAt(i * 2 + j, m);
        leds.setColorAt(i * 2 + j, hdr(palette[Math.floor(i / 20) % palette.length], 5));
      }
    this.wheel.add(leds);

    this.wheel.position.copy(this.centre);
    shadowed(this.wheel);
    leds.castShadow = false;
    ctx.scene.add(this.wheel);

    // ---- fixed spindle and the four 126 m legs, welded into an A-frame on each side ----
    const frame = new THREE.Group();
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, SPINDLE_HALF * 2, 24), darkSteel);
    spindle.rotation.x = Math.PI / 2;
    spindle.position.copy(this.centre);
    frame.add(spindle);
    const legGeo = new THREE.CylinderGeometry(1.7, 2.5, 1, 20, 1);
    for (const side of [-1, 1]) {
      const apex = this.centre.clone().add(new THREE.Vector3(0, 0, side * SPINDLE_HALF));
      const feet = [-1, 1].map((sx) => {
        const x = this.centre.x + sx * LEG_FOOT.x;
        const z = this.centre.z + side * LEG_FOOT.z;
        return new THREE.Vector3(x, ground(x, z) - 2, z);
      });
      for (const foot of feet) {
        const leg = new THREE.Mesh(legGeo, steel);
        leg.applyMatrix4(strut(foot, apex, 1));
        frame.add(leg);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 3, 16), std('#b9b2a6', { roughness: 0.9 }));
        pad.position.copy(foot).setY(foot.y + 2.5);
        frame.add(pad);
      }
      // horizontal tie across each A-frame, and a cap where the legs meet the spindle
      const tieH = 48;
      const tie = feet.map((f) => f.clone().lerp(apex, (tieH - f.y) / (apex.y - f.y)));
      const tieMesh = new THREE.Mesh(unit, steel);
      tieMesh.applyMatrix4(strut(tie[0], tie[1], 1.1));
      frame.add(tieMesh);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 14), darkSteel);
      cap.position.copy(apex);
      frame.add(cap);
    }

    // ---- boarding terminal under the lowest capsule, with a sign facing the park ----
    const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 2.4, 18), std(PALETTE.cream, { roughness: 0.8 }));
    deck.position.set(this.centre.x, 1.2, this.centre.z);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(36, 0.6, 6), std(PALETTE.ink, { roughness: 0.5 }));
    roof.position.set(this.centre.x, 8.4, this.centre.z + 12);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 6),
      signMaterial(signTexture('GIANT WHEEL', { sub: '250 m · 48 cabins · the tallest wheel on Earth', border: PALETTE.violet, width: 1280, height: 300 }), {
        emissiveIntensity: 2,
      }),
    );
    sign.position.set(this.centre.x, 12.6, this.centre.z + 15.2);
    for (const x of [-16, 16]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 8.4), darkSteel);
      post.position.set(this.centre.x + x, 4.2, this.centre.z + 14.5);
      frame.add(post);
    }
    frame.add(deck, roof, sign);
    shadowed(frame, true);
    ctx.scene.add(frame);

    // ---- 48 capsules: glass shells with ribs, a floor and a central bench; they stay level ----
    const shellGeo = new THREE.CapsuleGeometry(CABIN_RADIUS, CABIN_LEN - CABIN_RADIUS * 2, 8, 24);
    shellGeo.rotateX(Math.PI / 2);
    const ribs = [-3.8, 0, 3.8].map((z) => new THREE.TorusGeometry(CABIN_RADIUS + 0.06, 0.12, 6, 32).translate(0, 0, z));
    const floorGeo = mergeGeometries([
      new THREE.BoxGeometry(4.3, 0.25, CABIN_LEN - 2.4).translate(0, -1.65, 0),
      new THREE.BoxGeometry(1.1, 0.5, CABIN_LEN - 4.6).translate(0, -1.3, 0), // bench
    ]);
    // glass is only drawn from outside, so riders inside see straight out
    const glass = new THREE.MeshPhysicalMaterial({ color: '#8fb4cc', metalness: 0.7, roughness: 0.08, clearcoat: 1, side: THREE.FrontSide });
    this.shells = new THREE.InstancedMesh(shellGeo, glass, CABINS);
    this.frames = new THREE.InstancedMesh(mergeGeometries(ribs), steel, CABINS);
    this.floors = new THREE.InstancedMesh(floorGeo, std('#4a4458', { roughness: 0.7 }), CABINS);
    for (const im of [this.shells, this.frames, this.floors]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.frustumCulled = false; // instances move around the whole wheel
      ctx.scene.add(im);
    }
    this.placeCabins();
  }

  private cabinPos(i: number, out = new THREE.Vector3()) {
    const a = this.angle + (i / CABINS) * Math.PI * 2;
    return out.set(this.centre.x + Math.cos(a) * CABIN_R, this.centre.y + Math.sin(a) * CABIN_R, this.centre.z);
  }

  private placeCabins() {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < CABINS; i++) {
      m.makeTranslation(this.cabinPos(i, p));
      this.shells.setMatrixAt(i, m);
      this.frames.setMatrixAt(i, m);
      this.floors.setMatrixAt(i, m);
    }
    for (const im of [this.shells, this.frames, this.floors]) im.instanceMatrix.needsUpdate = true;
  }

  /** Height of the rider's cabin floor above the ground. */
  get altitude() {
    return this.cabinPos(0).y - 1.6;
  }

  start() {
    this.riding = true;
    this.rode = 0;
    this.angle = -Math.PI / 2; // our capsule (no. 0) is at the platform
    this.cam = 'cabin';
    this.yaw = 0;
    this.placeCabins();
    this.ctx.ui.panel(
      'wheel-intro',
      `<p class="eyebrow">Giant Wheel · tribute to Ain Dubai</p><h2>The tallest wheel on Earth</h2><p>250 m tall, 48 capsules of up to 40 riders, 192 cable spokes, on four 126 m legs. A real turn takes <strong>38 minutes</strong>; this ride shows it as a time-lapse.</p><p>${
        this.ctx.mobile
          ? 'Joystick <strong>left/right</strong> looks around, <strong>up</strong> fast-forwards. Tap <kbd>E</kbd> to switch camera.'
          : '<kbd>A</kbd>/<kbd>D</kbd> look around · hold <kbd>W</kbd> to fast-forward · <kbd>S</kbd> slows down · <kbd>C</kbd> camera.'
      }</p>`,
      { accent: PALETTE.violet },
    );
    this.ctx.sfx.chime();
  }

  exit() {
    if (!this.riding) return;
    this.riding = false;
    this.ctx.ui.score(null);
    this.ctx.ui.panel(
      'wheel-summary',
      `<p class="eyebrow">Giant Wheel · Ride recap</p><h2>250 m up and back</h2><p>You rode the tallest observation wheel on Earth, seeing the whole fair, both coasters and the Sky Falcon's cliff from the top.</p>`,
      { accent: PALETTE.violet },
    );
    this.onFinish?.();
  }

  cycleCamera() {
    const order: Cam[] = ['cabin', 'outside', 'wide'];
    this.cam = order[(order.indexOf(this.cam) + 1) % order.length];
    this.ctx.ui.score(null);
    this.ctx.sfx.pop();
  }

  update(dt: number) {
    let speed = (Math.PI * 2) / REV_REAL;
    if (this.riding) {
      const thr = this.input?.throttle ?? 0;
      speed = ((Math.PI * 2) / REV_RIDE) * (thr > 0 ? 1 + thr * 5 : thr < 0 ? 0.25 : 1);
      this.yaw += (this.input?.steer ?? 0) * dt * 1.2;
    }
    const step = speed * dt;
    this.angle += step;
    this.placeCabins();
    if (!this.riding) return;
    this.rode += step;
    const lapse = Math.round((speed * REV_REAL) / (Math.PI * 2)); // how many times faster than the real wheel
    this.ctx.ui.score(`🎡 ${Math.max(0, Math.round(this.altitude))} m · time-lapse ×${lapse} · ${CAM_LABEL[this.cam]} cam`);
    if (this.rode >= Math.PI * 2) this.exit();
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    camera.up.set(0, 1, 0);
    const c = this.cabinPos(0);
    if (this.cam === 'cabin') {
      // standing at the park end of the capsule, looking down at the fair; A/D turn your head
      const eye = c.clone().add(new THREE.Vector3(0, -0.1, 3.6));
      const dir = new THREE.Vector3(0, 0, 25).sub(eye).normalize().applyAxisAngle(UP, this.yaw);
      camera.position.copy(eye);
      camera.lookAt(eye.clone().add(dir));
      this.camPos.copy(eye);
      this.camLook.copy(eye).add(dir);
      return;
    }
    const k = 1 - Math.exp(-dt * 3);
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.cam === 'outside') {
      pos = c.clone().add(new THREE.Vector3(-26, 7, 34));
      look = c;
    } else {
      // from beyond the park's south side: the whole wheel behind the fair
      pos = new THREE.Vector3(this.centre.x + 70, 45, this.centre.z + 520);
      look = new THREE.Vector3(this.centre.x, 62, this.centre.z);
    }
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }

  /** Ground point under the rider (for shadows and grass LOD). */
  get focus() {
    return this.cabinPos(0).setY(0);
  }
}
