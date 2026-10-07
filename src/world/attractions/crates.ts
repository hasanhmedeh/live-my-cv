import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { shadowed, std, staticBox, type Attraction, type Ctx } from '../context';
import { LAYOUT } from '../layout';
import { crateTexture, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';

const SIZE = 1.5;
// points per crate by row (bottom → top): the high crates are worth the most
const ROW_POINTS = [10, 10, 25, 50];
const POINT_COLORS: Record<number, string> = { 10: PALETTE.teal, 25: PALETTE.candy, 50: PALETTE.violet };

interface Crate {
  points: number;
  mesh: THREE.Mesh;
  body: CANNON.Body;
  home: CANNON.Vec3;
  knocked: boolean;
}

/** "Knock 'em down" stall: ram the crates for points. */
export class Crates implements Attraction {
  private crates: Crate[] = [];
  private center = new THREE.Vector3(LAYOUT.crates.x, 0, LAYOUT.crates.z);
  onScore: ((n: number, total: number, points: number, score: number) => void) | null = null;

  constructor(private ctx: Ctx) {
    this.buildStall();
    // staggered wall: rows of 7, 6, 5, 4 (= 22 crates)
    const rows = [7, 6, 5, 4];
    rows.forEach((count, row) => {
      const points = ROW_POINTS[row];
      for (let c = 0; c < count; c++) {
        const x = this.center.x + (c - (count - 1) / 2) * (SIZE + 0.04);
        const y = SIZE / 2 + row * SIZE + 0.01;
        const z = this.center.z - 4;
        const tex = crateTexture(String(points), POINT_COLORS[points]);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), std('#ffffff', { map: tex, roughness: 0.7 }));
        mesh.castShadow = mesh.receiveShadow = true;
        const body = new CANNON.Body({ mass: 14, material: ctx.mats.prop, linearDamping: 0.05, angularDamping: 0.1 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2)));
        body.position.set(x, y, z);
        body.allowSleep = true;
        body.sleepSpeedLimit = 0.25;
        body.sleepTimeLimit = 0.4;
        ctx.world.addBody(body);
        body.sleep();
        ctx.scene.add(mesh);
        ctx.dynamics.push({ mesh, body });
        this.crates.push({ points, mesh, body, home: body.position.clone(), knocked: false });
      }
    });
  }

  private buildStall() {
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4), std(PALETTE.ink));
    back.position.set(0, 3.5, -7);
    const awningTex = stripeTexture(PALETTE.mustard, PALETTE.cream, 14);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.3, 3.4), std('#ffffff', { map: awningTex }));
    awning.position.set(0, 7.3, -5.6);
    awning.rotation.x = 0.25;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.6),
      signMaterial(signTexture('CRATE SMASH', { sub: 'Drive into the crates · 22 crates · 455 points', border: PALETTE.teal })),
    );
    sign.position.set(0, 9.2, -6.6);
    for (const x of [-6.8, 6.8]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8), std(PALETTE.cream));
      post.position.set(x, 4, -4.2);
      g.add(post);
      staticBox(this.ctx, this.center.x + x, 4, this.center.z - 4.2, 0.2, 4, 0.2);
    }
    // points legend on the back wall
    const legend = Object.keys(POINT_COLORS).map(Number);
    legend.forEach((pts, i) => {
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 1.1),
        signMaterial(signTexture(`${pts} POINTS`, { border: POINT_COLORS[pts], width: 768, height: 230, bulbs: false }), { emissiveIntensity: 1.5 }),
      );
      tile.position.set(-4.5 + i * 4.5, 6.3, -6.75);
      g.add(tile);
    });
    g.add(back, awning, sign);
    g.position.copy(this.center);
    shadowed(g, true);
    this.ctx.scene.add(g);
    staticBox(this.ctx, this.center.x, 3.5, this.center.z - 7, 7, 3.5, 0.3);
  }

  restack() {
    for (const c of this.crates) {
      c.body.position.copy(c.home);
      c.body.velocity.setZero();
      c.body.angularVelocity.setZero();
      c.body.quaternion.set(0, 0, 0, 1);
      c.body.sleep();
      c.knocked = false;
    }
    this.ctx.sfx.chime();
  }

  get knockedCount() {
    return this.crates.filter((c) => c.knocked).length;
  }

  get total() {
    return this.crates.length;
  }

  get score() {
    return this.crates.reduce((a, c) => a + (c.knocked ? c.points : 0), 0);
  }

  get maxScore() {
    return this.crates.reduce((a, c) => a + c.points, 0);
  }

  panelHtml() {
    const rows = Object.keys(POINT_COLORS)
      .map(Number)
      .map((pts) => {
        const items = this.crates.filter((c) => c.points === pts);
        const hit = items.filter((c) => c.knocked).length;
        return `<li class="${hit === items.length ? 'hit' : ''}">${pts} pts · ${hit} / ${items.length}</li>`;
      })
      .join('');
    return `<p class="eyebrow">Crate Smash · ${this.knockedCount} / ${this.total} knocked</p><h2>${this.score} / ${this.maxScore} points</h2><p>Ram the crates with the car. The higher the crate, the more it's worth. Press <kbd>E</kbd> in the ring to restack.</p><ul class="tags">${rows}</ul>`;
  }

  update() {
    for (const c of this.crates) {
      if (c.knocked) continue;
      const moved = c.body.position.distanceTo(c.home) > 0.7;
      const up = new CANNON.Vec3(0, 1, 0);
      c.body.quaternion.vmult(up, up);
      const tilted = up.y < 0.8;
      if (moved || tilted) {
        c.knocked = true;
        this.onScore?.(this.knockedCount, this.total, c.points, this.score);
      }
    }
  }
}
