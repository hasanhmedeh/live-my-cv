import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { smoothSkinned } from '../subdivide';

// Dogs are Quaternius' animated Shiba Inu and Husky (CC0, via Poly Pizza), smoothed and
// recoloured. They trot along beside their owners on a leash, stop to sniff, and sit.

export const DOG_URLS = { shiba: `${import.meta.env.BASE_URL}models/dog-shiba.glb`, husky: `${import.meta.env.BASE_URL}models/dog-husky.glb` };
export type DogKind = keyof typeof DOG_URLS;

/** Shoulder-ish height (top of the head) of each breed, and their coat colours by material. */
const BREEDS: Record<DogKind, { height: number; coat: Record<string, string> }> = {
  shiba: { height: 0.62, coat: { Main: '#c8722e', Main_Light: '#f1e4cf', Black: '#1d1714' } },
  husky: { height: 0.78, coat: { Material: '#5b5f66', 'Material.001': '#eeeeec', 'Material.006': '#1a1a1a' } },
};

interface DogTemplate {
  root: THREE.Object3D;
  scale: number;
  clips: Map<string, THREE.AnimationClip>;
}

export class DogFactory {
  private t = new Map<DogKind, DogTemplate>();

  constructor(models: Record<DogKind, GLTF>) {
    for (const kind of Object.keys(models) as DogKind[]) {
      const g = models[kind];
      const breed = BREEDS[kind];
      g.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        // the asset is faceted: round it off like the visitor
        if (m.geometry.getAttribute('position').count > 60) m.geometry = smoothSkinned(m.geometry);
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        const c = breed.coat[mat.name];
        if (c) mat.color.set(c);
        mat.flatShading = false;
        mat.roughness = 0.85;
        mat.metalness = 0;
        // a short-haired coat: soft sheen at grazing angles
        m.material = mat;
        m.castShadow = true;
        m.frustumCulled = false;
      });
      const box = new THREE.Box3().setFromObject(g.scene, true);
      this.t.set(kind, { root: g.scene, scale: breed.height / (box.max.y - box.min.y), clips: new Map(g.animations.map((a) => [a.name, a])) });
    }
  }

  create(kind: DogKind) {
    return new Dog(this.t.get(kind)!);
  }
}

const WALK_CLIP = 1.05; // m/s the clips cover at the breed's size (by eye: no foot sliding)
const GALLOP_CLIP = 3.6;

/** One dog: steering toward a spot near its owner, gait blending, idle sniffing and sitting. */
export class Dog {
  root = new THREE.Group();
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private sniff: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private gallop: THREE.AnimationAction;
  private idleW = 1;
  private moveW = 0;
  private runW = 0;
  private sniffT = 0;
  private sniffCool = 3 + Math.random() * 5;
  readonly neck: THREE.Object3D;
  private size: number;

  constructor(t: DogTemplate) {
    const model = cloneSkinned(t.root);
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(t.scale);
    holder.rotation.y = Math.PI; // the model faces +z; the park's convention is -z forward
    this.root.add(holder);
    this.size = t.scale;
    this.neck = model.getObjectByName('Neck3') ?? model.getObjectByName('Head')!;
    this.mixer = new THREE.AnimationMixer(model);
    const loop = (n: string, w = 0) => {
      const a = this.mixer.clipAction(t.clips.get(n) ?? t.clips.get('Idle')!);
      a.play();
      a.setEffectiveWeight(w);
      a.time = Math.random() * a.getClip().duration;
      return a;
    };
    this.idle = loop('Idle', 1);
    this.sniff = loop('Idle_2_HeadLow');
    this.walk = loop('Walk');
    this.gallop = loop('Gallop');
  }

  place(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
  }

  /** Trot toward (tx, tz); `hurry` lets the dog break into a gallop to catch up. */
  steer(dt: number, tx: number, tz: number, ownerSpeed: number) {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    // match the owner's pace, faster when left behind, settle when close
    let want = d < 0.25 ? 0 : Math.min(5, ownerSpeed + Math.max(0, d - 0.4) * 2.2);
    if (d < 0.6 && ownerSpeed < 0.1) want = Math.min(want, d * 1.5);
    this.speed += (want - this.speed) * Math.min(1, dt * 4);
    if (d > 0.05 && this.speed > 0.05) {
      let turn = Math.atan2(-dx, -dz) - this.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.heading += THREE.MathUtils.clamp(turn, -6 * dt, 6 * dt);
      const step = Math.min(d, this.speed * dt);
      this.x += -Math.sin(this.heading) * step;
      this.z += -Math.cos(this.heading) * step;
    }
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.heading;
  }

  /** Turn to face a point while standing (e.g. look at the owner). */
  face(x: number, z: number, dt: number) {
    let turn = Math.atan2(-(x - this.x), -(z - this.z)) - this.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.heading += THREE.MathUtils.clamp(turn, -2 * dt, 2 * dt);
    this.root.rotation.y = this.heading;
  }

  animate(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    const big = this.size / 0.2; // clip speeds scale with the dog's size
    const moving = this.speed > 0.12 ? 1 : 0;
    const run = THREE.MathUtils.smoothstep(this.speed, 1.6 * big, 2.4 * big);
    this.moveW += (moving - this.moveW) * k;
    this.runW += (run - this.runW) * k;
    // now and then, a good sniff of the ground
    if (!moving) {
      this.sniffCool -= dt;
      if (this.sniffCool < 0 && this.sniffT <= 0) {
        this.sniffT = 2 + Math.random() * 3;
        this.sniffCool = 5 + Math.random() * 8;
      }
    }
    this.sniffT -= dt;
    const sniffing = this.sniffT > 0 && !moving ? 1 : 0;
    this.idleW += (1 - sniffing - this.idleW) * k;
    const still = 1 - this.moveW;
    this.idle.setEffectiveWeight(this.idleW * still);
    this.sniff.setEffectiveWeight((1 - this.idleW) * still);
    this.walk.setEffectiveWeight(this.moveW * (1 - this.runW));
    this.gallop.setEffectiveWeight(this.moveW * this.runW);
    this.walk.timeScale = Math.max(0.3, this.speed / (WALK_CLIP * big));
    this.gallop.timeScale = Math.max(0.5, this.speed / (GALLOP_CLIP * big));
    this.mixer.update(dt);
  }

  setShadows(on: boolean) {
    this.root.traverse((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).castShadow = on));
  }
}

/** A leash: a sagging line from the owner's hand to the dog's collar. */
export class Leash {
  line: THREE.Line;
  private pts: Float32Array;
  private static N = 10;

  constructor(color = '#c0392b') {
    this.pts = new Float32Array(Leash.N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pts, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
    this.line.frustumCulled = false;
  }

  update(a: THREE.Vector3, b: THREE.Vector3, length = 1.7) {
    const d = a.distanceTo(b);
    const sag = Math.max(0.02, (length - d) * 0.45);
    for (let i = 0; i < Leash.N; i++) {
      const t = i / (Leash.N - 1);
      this.pts[i * 3] = a.x + (b.x - a.x) * t;
      this.pts[i * 3 + 1] = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      this.pts[i * 3 + 2] = a.z + (b.z - a.z) * t;
    }
    this.line.geometry.getAttribute('position').needsUpdate = true;
  }
}
