import * as THREE from 'three';
import type { Ctx } from './context';
import { ZONES, type ZoneId } from './layout';
import { floatingTextTexture, hdr, makeSprite, PALETTE } from './textures';

interface Marker {
  id: ZoneId;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  label: THREE.Sprite;
  baseY: number;
}

/** Glowing ground rings: step onto one to get the "Press E" prompt. */
export class Zones {
  private markers: Marker[] = [];
  active: ZoneId | null = null;

  constructor(ctx: Ctx) {
    for (const [id, z] of Object.entries(ZONES) as [ZoneId, (typeof ZONES)[ZoneId]][]) {
      if (!z.radius) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(z.radius - 0.35, z.radius, 48),
        new THREE.MeshBasicMaterial({ color: hdr(PALETTE.mustard, 2.4), transparent: true, opacity: 0.95 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, 0.04, z.z);
      const fill = new THREE.Mesh(
        new THREE.CircleGeometry(z.radius - 0.35, 48),
        new THREE.MeshBasicMaterial({ color: PALETTE.mustard, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(z.x, 0.03, z.z);
      const label = makeSprite(floatingTextTexture(z.title, z.action), 7);
      label.position.set(z.x, 3.4, z.z);
      ctx.scene.add(ring, fill, label);
      this.markers.push({ id, ring, fill, label, baseY: 3.4 });
    }
  }

  setVisible(v: boolean) {
    for (const m of this.markers) m.label.visible = v;
  }

  update(carPos: THREE.Vector3, t: number) {
    let found: ZoneId | null = null;
    for (const m of this.markers) {
      const z = ZONES[m.id];
      const inside = Math.hypot(carPos.x - z.x, carPos.z - z.z) < z.radius;
      if (inside) found = m.id;
      const k = inside ? 1 : 0;
      (m.fill.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.lerp((m.fill.material as THREE.MeshBasicMaterial).opacity, 0.12 + k * 0.3, 0.15);
      m.ring.scale.setScalar(1 + Math.sin(t * 3 + z.x) * 0.03 + k * 0.05);
      m.label.position.y = m.baseY + Math.sin(t * 2 + z.z) * 0.15;
      // fade labels that are far away so the scene stays readable
      const d = Math.hypot(carPos.x - z.x, carPos.z - z.z);
      (m.label.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp(1.4 - d / 45, 0.25, 1);
    }
    this.active = found;
    return found;
  }
}
