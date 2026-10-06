import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import fontJson from '../assets/lilita.typeface.json';
import { std, type Ctx } from './context';
import { PALETTE } from './textures';

export const font = new Font(fontJson as unknown as ConstructorParameters<typeof Font>[0]);

export function textMesh(text: string, size: number, depth: number, material: THREE.Material | THREE.Material[]) {
  const geo = new TextGeometry(text, { font, size, depth, curveSegments: 5, bevelEnabled: true, bevelThickness: depth * 0.12, bevelSize: size * 0.02, bevelSegments: 2 });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Big physical letters spelling a word — drive into them to knock them over. */
export function physicsWord(ctx: Ctx, word: string, origin: THREE.Vector3, size: number, colors: string[], rotY = 0) {
  const depth = size * 0.32;
  const gap = size * 0.12;
  const meshes: THREE.Mesh[] = [];
  let total = 0;
  for (const ch of word) {
    if (ch === ' ') {
      total += size * 0.5;
      continue;
    }
    // darker sides make the letter faces pop when seen from the high camera
    const base = new THREE.Color(colors[meshes.length % colors.length]);
    // glossy painted letters: clearcoat front faces, satin darker sides
    const mat = [
      new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
      std(base.clone().multiplyScalar(0.55), { roughness: 0.6 }),
    ];
    const m = textMesh(ch, size, depth, mat);
    meshes.push(m);
    const bb = m.geometry.boundingBox!;
    total += bb.max.x - bb.min.x + gap;
  }
  total -= gap;

  const dir = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
  let cursor = -total / 2;
  let mi = 0;
  const bodies: CANNON.Body[] = [];
  for (const ch of word) {
    if (ch === ' ') {
      cursor += size * 0.5;
      continue;
    }
    const m = meshes[mi++];
    const bb = m.geometry.boundingBox!;
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    const d = bb.max.z - bb.min.z;
    const center = origin.clone().addScaledVector(dir, cursor + w / 2);
    center.y = h / 2 + 0.02;

    const body = new CANNON.Body({ mass: 40 * size, material: ctx.mats.prop, linearDamping: 0.1, angularDamping: 0.2 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    body.position.set(center.x, center.y, center.z);
    body.quaternion.setFromEuler(0, rotY, 0);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.3;
    ctx.world.addBody(body);
    body.sleep();
    ctx.scene.add(m);
    ctx.dynamics.push({ mesh: m, body });
    bodies.push(body);
    cursor += w + gap;
  }
  return bodies;
}

export const NAME_COLORS = [PALETTE.cream, PALETTE.mustard, PALETTE.candy, PALETTE.teal];
