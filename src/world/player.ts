import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Ctx } from './context';
import type { Input } from './input';
import { LAYOUT } from './layout';
import { smoothSkinned } from './subdivide';

// The visitor is "Casual Character" by Quaternius (CC0, via Poly Pizza): a rigged glTF with
// motion clips. We blend Idle / Walk / Run by speed and layer one-shot moves on top.
export const VISITOR_URL = `${import.meta.env.BASE_URL}models/visitor.glb`;

const WALK_SPEED = 2.4; // m/s, a brisk stroll
const RUN_SPEED = 7;
const ROLL_SPEED = 7.5;
const ACCEL = 16;
const HEIGHT = 1.78;
const BODY_R = 0.42; // lower collision sphere: its centre sits this high when standing
// ground speed each clip was animated for, so playback rate can follow the real speed
const WALK_CLIP_SPEED = 1.9;
const RUN_CLIP_SPEED = 6.2;
// bones that belong to the upper body: the wave plays on these only, so legs keep walking
const UPPER = /Abdomen|Torso|Chest|Neck|Head|Shoulder|Arm|Wrist|Index|Middle|Ring|Pinky|Thumb/;

type Move = 'roll' | 'kick' | 'interact';

/** The visitor: a rigged, motion-animated person who walks, runs, rolls, kicks and waves. */
export class Player {
  group = new THREE.Group();
  body: CANNON.Body;
  speed = 0;
  enabled = true;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private run: THREE.AnimationAction;
  private waveAction: THREE.AnimationAction;
  private moves: Record<Move, THREE.AnimationAction>;
  private move: Move | null = null;
  private moveT = 0;
  private kicked = false;
  private waveT = 0;
  private heading = 0;
  private turnRate = 0;
  private phase = 0;
  private gait = 0;
  private runK = 0;
  private lastStep = 0;
  private lastImpact = 0;
  private vel = new THREE.Vector2();
  private lean = new THREE.Group();

  constructor(private ctx: Ctx, gltf: GLTF) {
    const model = gltf.scene;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false; // skinned bounds don't follow the animation
      // the asset is faceted low-poly: round it off (tiny eye/brow cards stay crisp)
      if ((m as THREE.SkinnedMesh).isSkinnedMesh && m.geometry.getAttribute('position').count > 60) {
        const old = m.geometry;
        m.geometry = smoothSkinned(old);
        old.dispose();
      }
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat?.isMeshStandardMaterial) {
        mat.flatShading = false;
        mat.metalness = 0;
        mat.roughness = 0.72;
        // the jeans ship almost black; give them a denim blue
        if (mat.name === 'LightBlue') mat.color.setRGB(0.05, 0.09, 0.2);
      }
    });

    const clip = (name: string) => {
      const c = gltf.animations.find((a) => a.name === name || a.name.endsWith(`|${name}`));
      if (!c) throw new Error(`visitor.glb has no "${name}" clip`);
      return c;
    };
    this.mixer = new THREE.AnimationMixer(model);
    const loop = (name: string) => {
      const a = this.mixer.clipAction(clip(name));
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.idle = loop('Idle');
    this.walk = loop('Walk');
    this.run = loop('Run');
    // locomotion phase is driven by distance travelled, not by the mixer clock
    this.walk.timeScale = this.run.timeScale = 0;
    const once = (c: THREE.AnimationClip) => {
      const a = this.mixer.clipAction(c);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      return a;
    };
    const wave = clip('Wave').clone();
    wave.tracks = wave.tracks.filter((t) => UPPER.test(t.name.slice(0, t.name.lastIndexOf('.'))));
    this.waveAction = once(wave);
    this.moves = { roll: once(clip('Roll')), kick: once(clip('Kick_Right')), interact: once(clip('Interact')) };
    this.moves.roll.timeScale = 1.15;
    this.moves.kick.timeScale = 1.2;

    // measure the posed character and scale it to a real person's height, feet on the ground
    this.idle.setEffectiveWeight(1);
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    model.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.update());
    const box = new THREE.Box3().setFromObject(model, true);
    const k = HEIGHT / (box.max.y - box.min.y);
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(k);
    holder.position.y = -box.min.y * k - BODY_R;
    holder.rotation.y = Math.PI; // glTF faces +z; the park's convention is -z forward
    this.lean.add(holder);
    this.group.add(this.lean);
    ctx.scene.add(this.group);

    // ---- physics: two spheres (legs + chest) so the visitor can shove letters and crates ----
    this.body = new CANNON.Body({ mass: 90, material: ctx.mats.player, linearDamping: 0.05, fixedRotation: true });
    this.body.addShape(new CANNON.Sphere(BODY_R), new CANNON.Vec3(0, 0, 0));
    this.body.addShape(new CANNON.Sphere(0.32), new CANNON.Vec3(0, 0.82, 0));
    this.body.allowSleep = false;
    ctx.world.addBody(this.body);
    this.body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v > 3 && ctx.time.t - this.lastImpact > 0.2) {
        this.lastImpact = ctx.time.t;
        ctx.sfx.thunk(v * 0.6);
      }
    });
    this.reset(LAYOUT.spawn.x, LAYOUT.spawn.z, LAYOUT.spawn.heading);
  }

  reset(x: number, z: number, heading: number) {
    this.body.position.set(x, BODY_R + 0.05, z);
    this.body.velocity.setZero();
    this.vel.set(0, 0);
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  get position() {
    return this.group.position;
  }

  private get forward() {
    return new THREE.Vector2(-Math.sin(this.heading), -Math.cos(this.heading));
  }

  /** Wave with the right hand (upper body only, so it works while walking). */
  wave() {
    if (this.waveT > 0) return;
    this.waveAction.reset().setEffectiveWeight(4).fadeIn(0.2).play();
    this.waveT = this.waveAction.getClip().duration;
    this.ctx.sfx.whistle();
  }

  /** Dodge-roll forward. */
  roll() {
    if (this.startMove('roll')) this.ctx.sfx.swish();
  }

  /** Kick whatever is in front of you: crates, letters… */
  kick() {
    if (this.startMove('kick')) this.kicked = false;
  }

  /** A short "reach out" gesture when using an attraction. */
  interact() {
    this.startMove('interact');
  }

  private startMove(m: Move) {
    if (!this.enabled || this.move) return false;
    this.move = m;
    const a = this.moves[m];
    a.reset().setEffectiveWeight(1).fadeIn(0.12).play();
    this.moveT = a.getClip().duration / a.timeScale;
    return true;
  }

  update(dt: number, input: Input) {
    const b = this.body;
    // camera-relative movement: the camera always looks north, so W = north, D = east
    let mx = 0;
    let mz = 0;
    if (this.enabled) {
      mx = -input.steer;
      mz = -input.throttle;
    }
    const mag = Math.min(1, Math.hypot(mx, mz));
    const running = this.enabled && input.boost && mag > 0.1;
    let top = (running ? RUN_SPEED : WALK_SPEED) * mag;
    let tx = 0;
    let tz = 0;
    if (this.move === 'roll') {
      // committed to the roll: carry on forward, fading out at the end
      const f = this.forward;
      const k = ROLL_SPEED * Math.min(1, this.moveT * 2.5);
      tx = f.x * k;
      tz = f.y * k;
    } else {
      if (this.move) top *= 0.15; // planted while kicking / interacting
      if (mag > 0.05) {
        const k = top / Math.hypot(mx, mz);
        tx = mx * k;
        tz = mz * k;
        // turn to face where we're going (shortest way round)
        let d = Math.atan2(-mx, -mz) - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = THREE.MathUtils.clamp(d, -10 * dt, 10 * dt);
        this.heading += turn;
        this.turnRate = THREE.MathUtils.lerp(this.turnRate, turn / Math.max(dt, 1e-4), 0.2);
      } else {
        this.turnRate = THREE.MathUtils.lerp(this.turnRate, 0, 0.2);
      }
    }
    const dvx = tx - this.vel.x;
    const dvz = tz - this.vel.y;
    const dl = Math.hypot(dvx, dvz);
    const accel = this.move === 'roll' ? ACCEL * 2 : ACCEL;
    const step = Math.min(dl, accel * dt);
    if (dl > 1e-5) this.vel.add(new THREE.Vector2((dvx / dl) * step, (dvz / dl) * step));
    b.velocity.x = this.vel.x;
    b.velocity.z = this.vel.y;
    this.speed = this.vel.length();

    // keep inside the fair
    const r = Math.hypot(b.position.x, b.position.z);
    if (r > LAYOUT.boundary) {
      const k = LAYOUT.boundary / r;
      b.position.x *= k;
      b.position.z *= k;
      this.vel.multiplyScalar(0.3);
    }
    if (b.position.y < -5) this.reset(LAYOUT.spawn.x, LAYOUT.spawn.z, 0);

    this.animate(dt);
    this.ctx.sfx.setEngine(0, false);
    this.sync();
  }

  private animate(dt: number) {
    const s = this.speed;
    // ---- one-shot moves ----
    let moveW = 0;
    if (this.move) {
      this.moveT -= dt;
      const a = this.moves[this.move];
      if (this.moveT < 0.18 && a.getEffectiveWeight() > 0.99) a.fadeOut(0.18);
      if (this.move === 'kick' && !this.kicked && a.time > a.getClip().duration * 0.38) {
        this.kicked = true;
        this.kickProps();
      }
      moveW = a.getEffectiveWeight();
      if (this.moveT <= 0) {
        a.stop();
        this.move = null;
        moveW = 0;
      }
    }
    if (this.waveT > 0) {
      this.waveT -= dt;
      if (this.waveT < 0.25 && this.waveAction.getEffectiveWeight() > 3.9) this.waveAction.fadeOut(0.25);
      if (this.waveT <= 0) this.waveAction.stop();
    }

    // ---- locomotion: idle → walk → run, one shared stride phase so the blend never stutters ----
    const kk = 1 - Math.exp(-dt * 10);
    this.gait += (Math.min(1, s / (WALK_SPEED * 0.6)) - this.gait) * kk;
    this.runK += (THREE.MathUtils.clamp((s - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1) - this.runK) * kk;
    const walkDur = this.walk.getClip().duration;
    const runDur = this.run.getClip().duration;
    const rate = (1 - this.runK) * (s / WALK_CLIP_SPEED / walkDur) + this.runK * (s / RUN_CLIP_SPEED / runDur);
    this.phase = (this.phase + rate * dt) % 1;
    this.walk.time = this.phase * walkDur;
    this.run.time = this.phase * runDur;
    const loco = this.move === 'roll' ? 0 : 1 - moveW;
    this.idle.setEffectiveWeight((1 - this.gait) * loco);
    this.walk.setEffectiveWeight(this.gait * (1 - this.runK) * loco);
    this.run.setEffectiveWeight(this.gait * this.runK * loco);

    // footsteps: two per stride
    const stepIndex = Math.floor(this.phase * 2);
    if (stepIndex !== this.lastStep) {
      this.lastStep = stepIndex;
      if (s > 0.6 && !this.move) this.ctx.sfx.footstep(this.runK > 0.5);
    }

    // a little lean into turns at speed
    this.lean.rotation.z = THREE.MathUtils.lerp(this.lean.rotation.z, THREE.MathUtils.clamp(-this.turnRate * s * 0.01, -0.2, 0.2), kk);
    this.mixer.update(dt);
  }

  /** Launch every loose prop just in front of the kicking foot. */
  private kickProps() {
    const f = this.forward;
    const p = this.body.position;
    const foot = new THREE.Vector2(p.x + f.x * 0.9, p.z + f.y * 0.9);
    let hit = false;
    for (const { body } of this.ctx.dynamics) {
      if (body.mass <= 0 || body === this.body) continue;
      const dx = body.position.x - foot.x;
      const dz = body.position.z - foot.y;
      if (Math.hypot(dx, dz) > 1.7 || body.position.y > 3) continue;
      const m = body.mass;
      body.wakeUp();
      body.applyImpulse(new CANNON.Vec3(f.x * m * 9, m * 4.5, f.y * m * 9));
      body.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      hit = true;
    }
    if (hit) this.ctx.sfx.whack();
  }

  sync() {
    this.group.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.group.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.heading);
  }
}
