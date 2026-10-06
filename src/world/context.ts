import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Sfx } from './audio';
import type { UI } from './ui';
import type { Quality } from './quality';

export interface Ctx {
  scene: THREE.Scene;
  world: CANNON.World;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  sfx: Sfx;
  ui: UI;
  mobile: boolean;
  mats: { ground: CANNON.Material; car: CANNON.Material; prop: CANNON.Material };
  quality: Quality;
  /** Meshes that mirror a physics body every frame. */
  dynamics: { mesh: THREE.Object3D; body: CANNON.Body }[];
  /** Global clock in seconds, updated by the game loop. */
  time: { t: number };
}

export interface Attraction {
  update(dt: number, t: number): void;
}

export const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });

/** Adds a static box collider (position = box centre). */
export function staticBox(ctx: Ctx, x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
  const b = new CANNON.Body({ mass: 0, material: ctx.mats.prop });
  b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
  b.position.set(x, y, z);
  b.quaternion.setFromEuler(0, rotY, 0);
  ctx.world.addBody(b);
  return b;
}

/** Adds a static upright cylinder collider standing on the ground. */
export function staticCylinder(ctx: Ctx, x: number, z: number, radius: number, height: number) {
  const b = new CANNON.Body({ mass: 0, material: ctx.mats.prop });
  b.addShape(new CANNON.Cylinder(radius, radius, height, 12));
  b.position.set(x, height / 2, z);
  ctx.world.addBody(b);
  return b;
}

export function shadowed<T extends THREE.Object3D>(o: T, receive = false): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      if (receive) c.receiveShadow = true;
    }
  });
  return o;
}
