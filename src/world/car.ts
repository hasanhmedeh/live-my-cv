import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { std, type Ctx } from './context';
import type { Input } from './input';
import { hdr, PALETTE } from './textures';
import { LAYOUT } from './layout';

const MAX_SPEED = 13;
const BOOST_SPEED = 20;
const REVERSE_SPEED = 6;

const WHEEL_R = 0.47;
const WHEEL_X = 1.06;
const AXLE_FRONT = -1.3; // car faces -z
const AXLE_REAR = 1.25;

const TAIL = new THREE.Color('#ff2a3a');
const REVERSE = new THREE.Color('#fff6e6');

/** Extrudes a side profile (u = metres towards the nose, v = height) across the car's width, nose facing -z. */
function profile(shape: THREE.Shape, width: number, bevel: number) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 4,
    curveSegments: 18,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** An arcade sports car: we steer the physics body directly and let it shove props around. */
export class Car {
  group = new THREE.Group();
  body: CANNON.Body;
  speed = 0;
  private visual = new THREE.Group();
  /** Everything sprung on the suspension (rolls / pitches); the wheels stay planted. */
  private chassis = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private frontPivots: THREE.Object3D[] = [];
  private wheelSteer: THREE.Object3D;
  private tailMat: THREE.MeshBasicMaterial;
  private reverseMat: THREE.MeshBasicMaterial;
  private spin = 0;
  private pitch = 0;
  private roll = 0;
  private heading = new CANNON.Vec3();
  private lastImpact = 0;
  enabled = true;

  constructor(private ctx: Ctx) {
    // --- visual ---
    // metallic candy paint under a glossy clearcoat, tinted (opaque) glass that mirrors the sky, real chrome and rubber
    const paint = new THREE.MeshPhysicalMaterial({
      color: PALETTE.candy,
      roughness: 0.32,
      metalness: 0.45,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#1a2333',
      roughness: 0.06,
      metalness: 0.75,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    const trim = std('#15121c', { roughness: 0.55 });
    const rubber = std('#1b1b1f', { roughness: 0.95 });
    const chrome = std('#e6e2f0', { roughness: 0.12, metalness: 1 });
    const alloy = std('#dfe2ea', { roughness: 0.3, metalness: 0.55 });

    // lower body: one side profile with both wheel arches cut out of the sill
    const s = new THREE.Shape();
    s.moveTo(-2.02, 0.42);
    s.lineTo(-1.92, 0.36);
    s.absarc(-AXLE_REAR, 0.5, 0.62, Math.PI, 0, true);
    s.lineTo(-0.63, 0.36);
    s.lineTo(0.68, 0.36);
    s.absarc(-AXLE_FRONT, 0.5, 0.62, Math.PI, 0, true);
    s.lineTo(2.0, 0.38);
    s.lineTo(2.1, 0.46);
    s.quadraticCurveTo(2.2, 0.66, 2.1, 0.84); // nose
    s.quadraticCurveTo(1.55, 1.06, 0.72, 1.13); // bonnet
    s.lineTo(-1.45, 1.17); // beltline
    s.quadraticCurveTo(-1.95, 1.16, -2.06, 0.96); // boot lid
    s.lineTo(-2.1, 0.6);
    s.closePath();
    const shell = new THREE.Mesh(profile(s, 2.3, 0.12), paint);

    // greenhouse: smoked glass with a painted roof and pillars
    const c = new THREE.Shape();
    c.moveTo(0.78, 1.1);
    c.quadraticCurveTo(0.35, 1.58, 0.02, 1.8); // windscreen
    c.lineTo(-0.88, 1.82);
    c.quadraticCurveTo(-1.32, 1.62, -1.6, 1.12); // rear window
    c.closePath();
    const cabin = new THREE.Mesh(profile(c, 1.86, 0.07), glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.07, 0.98), paint);
    roof.position.set(0, 1.87, 0.43);
    const pillarGeo = new THREE.BoxGeometry(0.07, 0.7, 0.16);
    for (const x of [-0.92, 0.92]) {
      const b = new THREE.Mesh(pillarGeo, paint);
      b.position.set(x, 1.48, 0.38);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.09), paint);
      a.position.set(x * 0.98, 1.45, -0.42);
      a.rotation.x = 0.82; // follows the windscreen rake
      this.chassis.add(b, a);
    }

    // front: grille, headlights, splitter, plate
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.08), trim);
    grille.position.set(0, 0.6, -2.25);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.3), trim);
    splitter.position.set(0, 0.36, -2.05);
    const plateGeo = new THREE.BoxGeometry(0.62, 0.16, 0.03);
    const plateMat = std('#f4f1e8', { roughness: 0.5 });
    const plateF = new THREE.Mesh(plateGeo, plateMat);
    plateF.position.set(0, 0.47, -2.23);
    const headMat = new THREE.MeshBasicMaterial({ color: hdr('#fff3d0', 9) });
    const headGeo = new THREE.CapsuleGeometry(0.08, 0.36, 4, 10);
    headGeo.rotateZ(Math.PI / 2);
    for (const x of [-0.72, 0.72]) {
      const h = new THREE.Mesh(headGeo, headMat);
      h.position.set(x, 0.8, -2.22);
      h.rotation.y = x * 0.25;
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.06), chrome);
      bezel.position.set(x, 0.8, -2.19);
      bezel.rotation.y = x * 0.25;
      this.chassis.add(bezel, h);
    }

    // rear: light bar, reversing lights, plate, exhaust
    this.tailMat = new THREE.MeshBasicMaterial({ color: TAIL.clone().multiplyScalar(2.5) });
    this.reverseMat = new THREE.MeshBasicMaterial({ color: REVERSE.clone().multiplyScalar(0.25) });
    for (const x of [-0.7, 0.7]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.05), this.tailMat);
      t.position.set(x, 0.96, 2.17);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.05), this.reverseMat);
      r.position.set(x * 0.5, 0.96, 2.18);
      this.chassis.add(t, r);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.25), trim);
    diffuser.position.set(0, 0.38, 2.02);
    const plateR = new THREE.Mesh(plateGeo, plateMat);
    plateR.position.set(0, 0.72, 2.21);
    const exhaustGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12);
    exhaustGeo.rotateX(Math.PI / 2);
    for (const x of [0.5, 0.68]) {
      const e = new THREE.Mesh(exhaustGeo, chrome);
      e.position.set(x, 0.4, 2.2);
      this.chassis.add(e);
    }

    // wing mirrors + door handles
    for (const side of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.08), trim);
      stalk.position.set(side * 1.05, 1.2, -0.62);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.26), paint);
      mirror.position.set(side * 1.2, 1.24, -0.62);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.22), chrome);
      handle.position.set(side * 1.16, 1.0, 0.1);
      this.chassis.add(stalk, mirror, handle);
    }

    // interior: seat, wheel, driver (left-hand drive), visible through the glass
    this.wheelSteer = new THREE.Group();
    const steering = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 20), trim);
    this.wheelSteer.add(steering);
    this.wheelSteer.position.set(-0.45, 1.32, -0.28);
    this.wheelSteer.rotation.x = -0.5;
    const seats = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.16), std(PALETTE.cream, { roughness: 0.7 }));
    seats.position.set(0, 1.3, 0.52);
    seats.rotation.x = -0.15;
    const driver = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 10), std(PALETTE.teal));
    torso.position.y = 0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), std('#e8b48a'));
    head.position.y = 0.42;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), std('#2b1a12'));
    hair.position.y = 0.45;
    hair.rotation.x = 0.25;
    driver.add(torso, head, hair);
    driver.position.set(-0.45, 1.18, 0.3);

    if (ctx.quality.extraLights) {
      // one real spotlight for the headlights: lights the path and the letters at dusk
      const spot = new THREE.SpotLight('#ffe9c4', 55, 30, 0.62, 0.65, 1.6);
      spot.position.set(0, 0.85, -2.1);
      spot.target.position.set(0, 0, -12);
      this.chassis.add(spot, spot.target);
    }

    this.chassis.add(shell, cabin, roof, grille, splitter, plateF, diffuser, plateR, seats, this.wheelSteer, driver);

    // wheels: tyre + dark rim + five alloy spokes; the fronts sit on steering pivots
    const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.36, 28);
    tyreGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.37, 24);
    rimGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.04, 0.56, 0.07);
    const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.4, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const rimMat = std('#4a4855', { roughness: 0.4, metalness: 0.5 });
    for (const [z, front] of [
      [AXLE_FRONT, true],
      [AXLE_REAR, false],
    ] as const)
      for (const side of [-1, 1]) {
        const wheel = new THREE.Group();
        wheel.add(new THREE.Mesh(tyreGeo, rubber), new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(hubGeo, chrome));
        for (let i = 0; i < 5; i++) {
          const spoke = new THREE.Mesh(spokeGeo, alloy);
          spoke.position.x = side * 0.17;
          spoke.rotation.x = (i / 5) * Math.PI;
          wheel.add(spoke);
        }
        this.wheels.push(wheel);
        const pivot = new THREE.Group();
        pivot.position.set(side * WHEEL_X, WHEEL_R + 0.03, z);
        pivot.add(wheel);
        if (front) this.frontPivots.push(pivot);
        this.visual.add(pivot);
      }

    this.visual.add(this.chassis);
    this.visual.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.visual.position.y = -0.6;
    this.group.add(this.visual);
    ctx.scene.add(this.group);

    // --- physics ---
    this.body = new CANNON.Body({
      mass: 260,
      material: ctx.mats.car,
      linearDamping: 0.05,
      angularDamping: 0.9,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(1.25, 0.55, 2.1)), new CANNON.Vec3(0, 0, 0));
    this.body.angularFactor.set(0, 1, 0); // never flip over
    this.body.allowSleep = false;
    ctx.world.addBody(this.body);
    this.body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v > 2.5 && ctx.time.t - this.lastImpact > 0.12) {
        this.lastImpact = ctx.time.t;
        ctx.sfx.thunk(v);
      }
    });
    this.reset(LAYOUT.spawn.x, LAYOUT.spawn.z, LAYOUT.spawn.heading);
  }

  reset(x: number, z: number, heading: number) {
    this.body.position.set(x, 0.8, z);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.quaternion.setFromEuler(0, heading, 0);
    this.speed = 0;
    this.sync();
  }

  get position() {
    return this.group.position;
  }

  update(dt: number, input: Input) {
    const b = this.body;
    // forward direction (car faces -z locally)
    b.quaternion.vmult(new CANNON.Vec3(0, 0, -1), this.heading);
    const fwd = this.heading;
    const currentFwdSpeed = b.velocity.x * fwd.x + b.velocity.z * fwd.z;

    const throttle = this.enabled ? input.throttle : 0;
    const steer = this.enabled ? input.steer : 0;
    const top = input.boost && throttle > 0 ? BOOST_SPEED : MAX_SPEED;

    const target = throttle > 0 ? throttle * top : throttle < 0 ? throttle * REVERSE_SPEED : 0;
    // braking feels snappier than coasting
    const braking = throttle !== 0 && Math.abs(currentFwdSpeed) > 0.5 && Math.sign(throttle) !== Math.sign(currentFwdSpeed);
    const accel = throttle === 0 ? 5 : braking ? 22 : 11;
    const delta = target - currentFwdSpeed;
    const newFwd = currentFwdSpeed + Math.sign(delta) * Math.min(Math.abs(delta), accel * dt);

    // Grip: kill most of the sideways velocity (a little drift is fun).
    const side = new CANNON.Vec3(-fwd.z, 0, fwd.x);
    const sideSpeed = b.velocity.x * side.x + b.velocity.z * side.z;
    const keptSide = sideSpeed * Math.max(0, 1 - 7 * dt);

    b.velocity.x = fwd.x * newFwd + side.x * keptSide;
    b.velocity.z = fwd.z * newFwd + side.z * keptSide;
    this.speed = newFwd;

    const steerPower = Math.min(1, Math.abs(newFwd) / 4) * Math.sign(newFwd || 1);
    const turnRate = 2.3 - Math.min(1, Math.abs(newFwd) / BOOST_SPEED) * 0.8;
    b.angularVelocity.y = THREE.MathUtils.lerp(b.angularVelocity.y, steer * turnRate * steerPower, Math.min(1, 12 * dt));

    // keep it inside the fair
    const r = Math.hypot(b.position.x, b.position.z);
    if (r > LAYOUT.boundary) {
      const k = LAYOUT.boundary / r;
      b.position.x *= k;
      b.position.z *= k;
      b.velocity.x *= -0.3;
      b.velocity.z *= -0.3;
    }
    if (b.position.y < -5) this.reset(LAYOUT.spawn.x, LAYOUT.spawn.z, 0);

    // --- visual: wheels, steering, suspension, lights ---
    const t = this.ctx.time.t;
    this.spin -= (newFwd * dt) / WHEEL_R;
    for (const w of this.wheels) w.rotation.x = this.spin;
    const steerAngle = steer * 0.42;
    for (const p of this.frontPivots) p.rotation.y = THREE.MathUtils.lerp(p.rotation.y, steerAngle, Math.min(1, 14 * dt));
    this.wheelSteer.rotation.z = THREE.MathUtils.lerp(this.wheelSteer.rotation.z, steer * 1.6, Math.min(1, 14 * dt));

    // body roll from cornering load, nose squat / dive from acceleration, on soft springs
    const lateral = b.angularVelocity.y * newFwd;
    const longitudinal = (newFwd - currentFwdSpeed) / Math.max(dt, 1e-4);
    const kSpring = 1 - Math.exp(-dt * 7);
    this.roll += (THREE.MathUtils.clamp(-lateral * 0.0035, -0.065, 0.065) - this.roll) * kSpring;
    this.pitch += (THREE.MathUtils.clamp(longitudinal * 0.0028, -0.05, 0.04) - this.pitch) * kSpring;
    this.chassis.rotation.set(this.pitch, 0, this.roll);
    // a little road texture through the springs
    const rumble = Math.min(1, Math.abs(newFwd) / MAX_SPEED);
    this.chassis.position.y = (Math.sin(t * 23) * 0.006 + Math.sin(t * 37 + 1.3) * 0.004) * rumble;

    const reversing = newFwd < -0.3 && throttle < 0;
    this.tailMat.color.copy(TAIL).multiplyScalar(braking ? 10 : 2.5);
    this.reverseMat.color.copy(REVERSE).multiplyScalar(reversing ? 8 : 0.25);

    this.ctx.sfx.setEngine(Math.min(1, Math.abs(newFwd) / BOOST_SPEED), this.enabled);
    this.sync();
  }

  sync() {
    this.group.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.group.quaternion.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w);
  }
}
