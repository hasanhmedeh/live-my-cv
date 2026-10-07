import * as CANNON from 'cannon-es';

/** A footprint on the ground: an upright circle, or a box turned about y. */
export type Obstacle = { kind: 'circle'; x: number; z: number; r: number } | { kind: 'box'; x: number; z: number; hx: number; hz: number; c: number; s: number };

const CELL = 8;

/**
 * Everything solid at walking height, read once from the static physics colliders, bucketed
 * into a coarse grid so each guest only checks what is near them.
 */
export class Obstacles {
  list: Obstacle[] = [];
  private grid = new Map<string, Obstacle[]>();

  constructor(world: CANNON.World) {
    for (const b of world.bodies) {
      if (b.mass !== 0) continue;
      b.shapes.forEach((shape, i) => {
        const off = b.shapeOffsets[i];
        const x = b.position.x + off.x;
        const z = b.position.z + off.z;
        const y = b.position.y + off.y;
        if (shape instanceof CANNON.Cylinder) {
          const h = shape.height / 2;
          if (y - h > 1.6 || y + h < 0.1) return; // overhead, or flush with the ground
          // big round rides have a skirt or platform wider than their collider
          this.add({ kind: 'circle', x, z, r: shape.radiusTop + (shape.radiusTop > 5 ? 0.9 : 0) });
        } else if (shape instanceof CANNON.Box) {
          const e = shape.halfExtents;
          if (y - e.y > 1.6 || y + e.y < 0.1) return;
          if (e.x > 60 || e.z > 60) return; // ground slabs
          // yaw of the body (static colliders are only ever turned about y)
          const q = b.quaternion;
          const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
          this.add({ kind: 'box', x, z, hx: e.x, hz: e.z, c: Math.cos(yaw), s: Math.sin(yaw) });
        } else if (shape instanceof CANNON.Sphere) {
          if (y - shape.radius > 1.6) return;
          this.add({ kind: 'circle', x, z, r: shape.radius });
        }
      });
    }
  }

  add(o: Obstacle) {
    this.list.push(o);
    const r = o.kind === 'circle' ? o.r : Math.hypot(o.hx, o.hz);
    for (let gx = Math.floor((o.x - r) / CELL); gx <= Math.floor((o.x + r) / CELL); gx++)
      for (let gz = Math.floor((o.z - r) / CELL); gz <= Math.floor((o.z + r) / CELL); gz++) {
        const k = `${gx},${gz}`;
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(o);
      }
  }

  near(x: number, z: number) {
    return this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  }

  /** How far (x, z) sits inside an obstacle grown by `margin`, and which way is out. */
  static depth(o: Obstacle, x: number, z: number, margin: number, out: { x: number; z: number }) {
    if (o.kind === 'circle') {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const pen = o.r + margin - d;
      if (pen <= 0) return 0;
      out.x = d > 1e-4 ? dx / d : 1;
      out.z = d > 1e-4 ? dz / d : 0;
      return pen;
    }
    // into the box frame (Euler yaw: local x = (c, -s), local z = (s, c))
    const dx = x - o.x;
    const dz = z - o.z;
    const lx = dx * o.c - dz * o.s;
    const lz = dx * o.s + dz * o.c;
    const px = o.hx + margin - Math.abs(lx);
    const pz = o.hz + margin - Math.abs(lz);
    if (px <= 0 || pz <= 0) return 0;
    let nx = 0;
    let nz = 0;
    if (px < pz) nx = Math.sign(lx) || 1;
    else nz = Math.sign(lz) || 1;
    out.x = nx * o.c + nz * o.s;
    out.z = -nx * o.s + nz * o.c;
    return Math.min(px, pz);
  }

  inside(x: number, z: number, margin: number) {
    const o = { x: 0, z: 0 };
    for (const ob of this.near(x, z) ?? []) if (Obstacles.depth(ob, x, z, margin, o) > 0) return ob;
    return null;
  }

  /** Does the straight line a→b stay clear (sampled every half metre)? */
  clear(ax: number, az: number, bx: number, bz: number, margin: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
    for (let i = 0; i <= n; i++) if (this.inside(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, margin)) return false;
    return true;
  }

  /** Push a point out of anything it overlaps. */
  push(p: { x: number; z: number }, margin: number) {
    const o = { x: 0, z: 0 };
    for (const ob of this.near(p.x, p.z) ?? []) {
      const d = Obstacles.depth(ob, p.x, p.z, margin, o);
      if (d > 0) {
        p.x += o.x * d;
        p.z += o.z * d;
      }
    }
  }
}
