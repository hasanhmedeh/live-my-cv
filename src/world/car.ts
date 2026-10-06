import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { std, type Ctx } from './context';
import type { Input } from './input';
import { hdr, PALETTE } from './textures';
import { LAYOUT } from './layout';

const MAX_SPEED = 13;
const BOOST_SPEED = 20;
const REVERSE_SPEED = 6;

/** An arcade bumper car: we steer the physics body directly and let it shove props around. */
export class Car {
  group = new THREE.Group();
  body: CANNON.Body;
  speed = 0;
  private visual = new THREE.Group();
  private flag: THREE.Mesh;
  private wheelSteer: THREE.Object3D;
  private sparks: THREE.Mesh;
  private heading = new CANNON.Vec3();
  private lastImpact = 0;
  enabled = true;

  constructor(private ctx: Ctx) {
    // --- visual ---
    // fairground paint: glossy clearcoat over a candy base, real chrome, rubber bumper
    const red = new THREE.MeshPhysicalMaterial({ color: PALETTE.candy, roughness: 0.4, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 });
    const cream = std(PALETTE.cream, { roughness: 0.6 });
    const dark = std('#2a2238', { roughness: 0.9 });
    const chrome = std('#e6e2f0', { roughness: 0.12, metalness: 1 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.35, 28), dark);
    base.scale.set(1, 1, 1.25);
    base.position.y = 0.3;
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.2, 10, 36), std('#222', { roughness: 0.6 }));
    bumper.rotation.x = Math.PI / 2;
    bumper.scale.set(1, 1.25, 1);
    bumper.position.y = 0.42;

    const shellShape = new THREE.Shape();
    shellShape.moveTo(-1.1, -1.5);
    shellShape.lineTo(1.1, -1.5);
    shellShape.quadraticCurveTo(1.3, 0, 1.0, 1.4);
    shellShape.quadraticCurveTo(0, 1.9, -1.0, 1.4);
    shellShape.quadraticCurveTo(-1.3, 0, -1.1, -1.5);
    const shell = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shellShape, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.16, bevelSegments: 3 }),
      red,
    );
    shell.rotation.x = Math.PI / 2;
    shell.position.y = 1.15;

    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.35), cream);
    seat.position.set(0, 1.35, 0.85);
    seat.rotation.x = -0.15;

    // front cowl with a number plate
    const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), red);
    cowl.scale.set(1.3, 0.7, 0.9);
    cowl.position.set(0, 1.15, -0.8);

    this.wheelSteer = new THREE.Group();
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 20), dark);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6), chrome);
    column.rotation.x = Math.PI / 2;
    column.position.z = 0.3;
    this.wheelSteer.add(wheel, column);
    this.wheelSteer.position.set(0, 1.75, -0.25);
    this.wheelSteer.rotation.x = -0.9;

    // the driver
    const driver = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.45, 4, 12), std(PALETTE.teal));
    torso.position.y = 0.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), std('#e8b48a'));
    head.position.y = 1.0;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), std('#2b1a12'));
    hair.position.y = 1.04;
    hair.rotation.x = 0.25;
    driver.add(torso, head, hair);
    driver.position.set(0, 1.25, 0.35);

    // pole + spark + pennant (classic bumper car antenna)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6), chrome);
    pole.position.set(0, 2.4, 1.3);
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4), std(PALETTE.mustard, { side: THREE.DoubleSide }));
    this.flag.position.set(0, 3.4, 1.65);
    this.flag.rotation.y = Math.PI / 2;
    this.sparks = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshBasicMaterial({ color: hdr('#bfefff', 12) }),
    );
    this.sparks.position.set(0, 3.75, 1.3);

    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: hdr('#fff3d0', 9) }));
    const hl2 = headlight.clone();
    headlight.position.set(-0.55, 0.95, -1.95);
    hl2.position.set(0.55, 0.95, -1.95);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: hdr('#ff2a3a', 4) }));
    const tail2 = tail.clone();
    tail.position.set(-0.6, 0.95, 1.92);
    tail2.position.set(0.6, 0.95, 1.92);
    this.visual.add(tail, tail2);
    if (ctx.quality.extraLights) {
      // one real spotlight for the headlights: lights the path and the letters at dusk
      const spot = new THREE.SpotLight('#ffe9c4', 55, 30, 0.62, 0.65, 1.6);
      spot.position.set(0, 1.0, -1.7);
      spot.target.position.set(0, 0, -12);
      this.visual.add(spot, spot.target);
    }

    this.visual.add(base, bumper, shell, seat, cowl, this.wheelSteer, driver, pole, this.flag, this.sparks, headlight, hl2);
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
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(1.3, 0.55, 1.75)), new CANNON.Vec3(0, 0, 0));
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
    const accel = throttle === 0 ? 5 : Math.sign(target - currentFwdSpeed) !== Math.sign(currentFwdSpeed) ? 22 : 11;
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

    // --- visual flourishes ---
    const t = this.ctx.time.t;
    this.wheelSteer.rotation.z = THREE.MathUtils.lerp(this.wheelSteer.rotation.z, steer * 0.8, 0.2);
    this.visual.rotation.z = THREE.MathUtils.lerp(this.visual.rotation.z, -steer * Math.min(1, Math.abs(newFwd) / MAX_SPEED) * 0.08, 0.15);
    this.visual.rotation.x = THREE.MathUtils.lerp(this.visual.rotation.x, (delta > 0 ? 1 : -1) * Math.min(Math.abs(delta), 6) * 0.008, 0.1);
    this.flag.rotation.y = Math.PI / 2 + Math.sin(t * 9) * 0.25 * (0.3 + Math.abs(newFwd) / MAX_SPEED);
    const spark = Math.abs(newFwd) > 1 && Math.random() > 0.6;
    this.sparks.scale.setScalar(spark ? 1 + Math.random() * 1.5 : 0.6);

    this.ctx.sfx.setEngine(Math.min(1, Math.abs(newFwd) / BOOST_SPEED), this.enabled);
    this.sync();
  }

  sync() {
    this.group.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.group.quaternion.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w);
  }
}
