import * as THREE from 'three';
import { projects } from '../../data/cv';
import { shadowed, staticBox, staticCylinder, std, type Attraction, type Ctx } from '../context';
import { hdr, signMaterial, signTexture, PALETTE, stripeTexture } from '../textures';
import { escapeHtml } from '../ui';

const UP = new THREE.Vector3(0, 1, 0);

// Closed loop, west side of the fair. Station straight runs along x = -26.
const CONTROL: [number, number, number][] = [
  [-26, 1.5, 10],
  [-26, 1.5, -6],
  [-27, 4, -16],
  [-30, 12, -28],
  [-36, 18, -36],
  [-46, 14, -42],
  [-58, 3, -44],
  [-70, 8, -36],
  [-74, 13, -22],
  [-70, 5, -8],
  [-62, 3, 2],
  [-66, 9, 14],
  [-58, 11, 24],
  [-46, 5, 28],
  [-36, 3, 24],
  [-29, 2, 18],
];

interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  side: THREE.Vector3;
  up: THREE.Vector3;
}

export class Coaster implements Attraction {
  private curve: THREE.CatmullRomCurve3;
  private length: number;
  private cart = new THREE.Group();
  private uStart: number;
  private uCrest: number;
  private uLiftStart: number;
  private signsU: number[] = [];
  private s = 0; // distance travelled this ride
  private v = 0;
  private clackTimer = 0;
  private currentSign = -1;
  private lookTarget = new THREE.Vector3();
  active = false;
  onFinish: (() => void) | null = null;
  private seen = new Set<number>();

  constructor(private ctx: Ctx) {
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
    );
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();

    this.uStart = this.nearestU(new THREE.Vector3(-26, 1.5, 4));
    this.uLiftStart = this.nearestU(new THREE.Vector3(-26, 1.5, -6));
    this.uCrest = this.nearestU(new THREE.Vector3(-36, 18, -36));

    this.buildTrack();
    this.buildStation();
    this.buildCart();
    this.buildSigns();
    this.placeCart(this.uStart);
  }

  private nearestU(target: THREE.Vector3) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 1000; i++) {
      const u = i / 1000;
      const d = this.curve.getPointAt(u).distanceToSquared(target);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  frame(u: number): Frame {
    u = ((u % 1) + 1) % 1;
    const p = this.curve.getPointAt(u);
    const t = this.curve.getTangentAt(u).normalize();
    const side = new THREE.Vector3().crossVectors(t, UP).normalize();
    const up = new THREE.Vector3().crossVectors(side, t).normalize();
    return { p, t, side, up };
  }

  private buildTrack() {
    const N = 900;
    const left: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    const spine: THREE.Vector3[] = [];
    const tieMatrices: THREE.Matrix4[] = [];
    const supports: { x: number; z: number; h: number }[] = [];
    const m = new THREE.Matrix4();
    const tieEvery = Math.max(1, Math.round(N / (this.length / 1.0)));
    const supportEvery = Math.round(N / (this.length / 6));
    const colliderEvery = Math.round(N / (this.length / 2));

    for (let i = 0; i < N; i++) {
      const u = i / N;
      const f = this.frame(u);
      left.push(f.p.clone().addScaledVector(f.side, 0.55));
      right.push(f.p.clone().addScaledVector(f.side, -0.55));
      spine.push(f.p.clone().addScaledVector(f.up, -0.38));
      if (i % tieEvery === 0) {
        const z = f.t.clone().negate();
        const x = new THREE.Vector3().crossVectors(f.up, z);
        m.makeBasis(x, f.up, z).setPosition(f.p.clone().addScaledVector(f.up, -0.12));
        tieMatrices.push(m.clone());
      }
      const inStation = f.p.z > -7 && f.p.z < 11 && Math.abs(f.p.x + 26) < 1;
      if (i % supportEvery === 0 && f.p.y > 2.2 && !inStation) supports.push({ x: f.p.x, z: f.p.z, h: f.p.y - 0.5 });
      // low sections become solid so the bumper car can't drive through them
      if (i % colliderEvery === 0 && f.p.y < 4.6) staticBox(this.ctx, f.p.x, f.p.y / 2, f.p.z, 0.9, f.p.y / 2, 0.9);
    }

    // painted steel: metallic enough to catch the sunset along the rails
    const railMat = std(PALETTE.candy, { roughness: 0.28, metalness: 0.65 });
    const spineMat = std(PALETTE.mustard, { roughness: 0.35, metalness: 0.55 });
    for (const [pts, r, mat] of [
      [left, 0.08, railMat],
      [right, 0.08, railMat],
      [spine, 0.17, spineMat],
    ] as const) {
      const c = new THREE.CatmullRomCurve3(pts as THREE.Vector3[], true);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(c, N, r, 6, true), mat);
      mesh.castShadow = true;
      this.ctx.scene.add(mesh);
    }

    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1.35, 0.1, 0.22), std('#3a2f4a'), tieMatrices.length);
    tieMatrices.forEach((mm, i) => ties.setMatrixAt(i, mm));
    ties.castShadow = true;
    this.ctx.scene.add(ties);

    const supGeo = new THREE.CylinderGeometry(0.13, 0.18, 1, 8);
    supGeo.translate(0, 0.5, 0);
    const sup = new THREE.InstancedMesh(supGeo, std(PALETTE.cream, { metalness: 0.3, roughness: 0.5 }), supports.length);
    const footGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.3, 10);
    const feet = new THREE.InstancedMesh(footGeo, std('#8d8a99'), supports.length);
    supports.forEach((s, i) => {
      m.makeScale(1, s.h, 1).setPosition(s.x, 0, s.z);
      sup.setMatrixAt(i, m);
      m.makeTranslation(s.x, 0.15, s.z);
      feet.setMatrixAt(i, m);
      staticCylinder(this.ctx, s.x, s.z, 0.35, 3);
    });
    sup.castShadow = true;
    this.ctx.scene.add(sup, feet);
  }

  private buildStation() {
    const g = new THREE.Group();
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 16), std('#b98a5a'));
    platform.position.set(-23.6, 0.55, 2);
    platform.receiveShadow = true;
    g.add(platform);
    staticBox(this.ctx, -23.6, 0.55, 2, 1.1, 0.55, 8);
    staticBox(this.ctx, -26, 1, 2, 1.1, 1, 8.5);

    const roofTex = stripeTexture(PALETTE.candy, PALETTE.cream, 10);
    roofTex.repeat.set(4, 1);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, 17), std('#ffffff', { map: roofTex }));
    roof.position.set(-24.8, 5.4, 2);
    g.add(roof);
    for (const z of [-5.5, 2, 9.5])
      for (const x of [-27.8, -22.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.3), std(PALETTE.cream));
        post.position.set(x, 2.65, z);
        g.add(post);
        if (x > -23) staticCylinder(this.ctx, x, z, 0.25, 5);
      }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.6),
      signMaterial(signTexture('PROJECTS COASTER', { sub: 'Ride through what I have built' })),
    );
    sign.position.set(-22.4, 7, 2);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    // marquee bulbs along the station roof edge
    const roofBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: hdr('#ffe2a0', 6) }), 34);
    for (let i = 0; i < 34; i++) roofBulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-21.55, 5.2, -6.2 + i * 0.5));
    g.add(roofBulbs);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.8, 9.2), std(PALETTE.candyDark));
    signBack.position.set(-22.55, 7, 2);
    g.add(signBack);
    shadowed(g, true);
    this.ctx.scene.add(g);
  }

  private buildCart() {
    const body = new THREE.MeshPhysicalMaterial({ color: PALETTE.mustard, roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 });
    const accent = new THREE.MeshPhysicalMaterial({ color: PALETTE.candy, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 });
    const seat = std(PALETTE.ink);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 2.6), body);
    shell.position.y = 0.55;
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 16, 1, false, 0, Math.PI), accent);
    nose.rotation.z = Math.PI / 2;
    nose.rotation.y = Math.PI / 2;
    nose.position.set(0, 0.55, -1.3);
    nose.scale.set(1, 1, 0.9);
    for (const z of [-0.45, 0.7]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 0.8), seat);
      s.position.set(0, 0.95, z);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.15), accent);
      back.position.set(0, 1.25, z + 0.38);
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 6, 16, Math.PI), std('#d9d4e6', { metalness: 0.9, roughness: 0.2 }));
      bar.position.set(0, 1.0, z - 0.35);
      bar.rotation.y = 0;
      this.cart.add(s, back, bar);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.15, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const x of [-0.7, 0.7])
      for (const z of [-0.9, 0.9]) {
        const w = new THREE.Mesh(wheelGeo, std('#2a2238'));
        w.position.set(x, 0.12, z);
        this.cart.add(w);
      }
    this.cart.add(shell, nose);
    shadowed(this.cart);
    this.ctx.scene.add(this.cart);
  }

  private buildSigns() {
    // Two signs on the slow lift hill, the rest spread over the ride.
    const liftSpan = (this.uCrest - this.uLiftStart + 1) % 1;
    const us = [this.uLiftStart + liftSpan * 0.35, this.uLiftStart + liftSpan * 0.8];
    const restStart = this.uCrest + 0.04;
    const restEnd = this.uStart + 1 - 0.07;
    const n = projects.length - 2;
    for (let i = 0; i < n; i++) us.push(restStart + ((restEnd - restStart) * i) / Math.max(1, n - 1));

    const colors = [PALETTE.candy, PALETTE.teal, PALETTE.violet, PALETTE.mustard];
    projects.forEach((p, i) => {
      const u = us[i] % 1;
      this.signsU.push(u);
      const f = this.frame(u);
      const sideSign = i % 2 ? 1 : -1;
      const pos = f.p.clone().addScaledVector(f.side, sideSign * 4.2);
      const boardY = Math.max(f.p.y + 1.6, 3.2);
      const g = new THREE.Group();
      const tex = signTexture(p.name, { sub: `${p.where} · ${p.tags.join(' · ')}`, border: colors[i % colors.length], width: 1024, height: 400 });
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 2.35),
        signMaterial(tex),
      );
      const back = new THREE.Mesh(new THREE.BoxGeometry(6.1, 2.45, 0.12), std('#3a2f4a'));
      back.position.z = -0.08;
      g.add(board, back);
      for (const x of [-2.4, 2.4]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, boardY), std('#3a2f4a'));
        pole.position.set(x, -boardY / 2, -0.15);
        g.add(pole);
      }
      g.position.set(pos.x, boardY, pos.z);
      // Face the approaching rider.
      const look = f.p.clone().addScaledVector(f.t, -14);
      g.lookAt(look.x, boardY, look.z);
      shadowed(g);
      this.ctx.scene.add(g);
      const r = new THREE.Vector3(2.4, 0, 0).applyQuaternion(g.quaternion);
      staticCylinder(this.ctx, pos.x + r.x, pos.z + r.z, 0.2, 3);
      staticCylinder(this.ctx, pos.x - r.x, pos.z - r.z, 0.2, 3);
    });
  }

  private placeCart(u: number) {
    const f = this.frame(u);
    const z = f.t.clone().negate();
    const x = new THREE.Vector3().crossVectors(f.up, z);
    this.cart.matrixAutoUpdate = true;
    this.cart.position.copy(f.p).addScaledVector(f.up, 0.05);
    this.cart.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, f.up, z));
    return f;
  }

  start() {
    this.active = true;
    this.s = 0;
    this.v = 0;
    this.currentSign = -1;
    this.seen.clear();
    const f = this.frame(this.uStart);
    this.lookTarget.copy(f.p).addScaledVector(f.t, 10);
    this.ctx.ui.panel(
      'coaster-intro',
      `<p class="eyebrow">Projects Coaster</p><h2>Hold on tight!</h2><p>Watch the billboards along the track — each one is a project I've built. Cards appear here as you pass them.</p>`,
      { accent: PALETTE.mustard, closable: false },
    );
    this.ctx.sfx.chime();
  }

  exit() {
    this.active = false;
    this.placeCart(this.uStart);
    this.ctx.ui.panel('coaster-summary', this.summaryHtml(), { accent: PALETTE.mustard });
    this.onFinish?.();
  }

  private summaryHtml() {
    return `<p class="eyebrow">Projects Coaster · Ride recap</p><h2>What I've built</h2>${projects
      .map(
        (p) =>
          `<h3>${escapeHtml(p.name)}</h3><p class="sub">${escapeHtml(p.where)}</p><p>${escapeHtml(p.text)}</p><ul class="tags">${p.tags
            .map((t) => `<li>${escapeHtml(t)}</li>`)
            .join('')}</ul>`,
      )
      .join('')}`;
  }

  update(dt: number) {
    if (!this.active) return;
    const g = 9.8;
    const uNow = (this.uStart + this.s / this.length) % 1;
    const f = this.frame(uNow);
    const liftEndS = (((this.uCrest - this.uStart) % 1) + 1) % 1 * this.length;
    const crestY = this.curve.getPointAt(this.uCrest).y;
    const remaining = this.length - this.s;

    if (this.s < liftEndS) {
      // station roll-out, then the chain lift
      this.v = THREE.MathUtils.lerp(this.v, this.s < 14 ? 7 : 5, dt * 2);
      this.clackTimer -= dt;
      if (this.clackTimer < 0 && this.s > 14) {
        this.clackTimer = 0.18;
        this.ctx.sfx.clack();
      }
    } else {
      // energy conservation with a little friction
      this.v = Math.max(4, Math.sqrt(16 + 2 * g * Math.max(0, crestY - f.p.y)) * 0.92);
    }
    if (remaining < 22) this.v = Math.min(this.v, 1.2 + remaining * 0.45);
    this.s += this.v * dt;

    this.placeCart(uNow);

    // which billboard are we passing?
    for (let i = 0; i < this.signsU.length; i++) {
      const du = (((this.signsU[i] - uNow) % 1) + 1) % 1;
      if (du * this.length < 16 && !this.seen.has(i)) {
        this.seen.add(i);
        this.currentSign = i;
        const p = projects[i];
        this.ctx.ui.panel(
          `coaster-${i}`,
          `<p class="eyebrow">Project ${i + 1} / ${projects.length}</p><h2>${escapeHtml(p.name)}</h2><p class="sub">${escapeHtml(p.where)}</p><p>${escapeHtml(
            p.text,
          )}</p><ul class="tags">${p.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul><div class="progress-dots">${projects
            .map((_, j) => `<span class="${j <= i ? 'on' : ''}"></span>`)
            .join('')}</div>`,
          { accent: PALETTE.mustard, closable: false },
        );
        this.ctx.sfx.pop();
      }
    }

    if (remaining <= 0.05) this.exit();
  }

  /** Front-seat camera. */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const uNow = (this.uStart + this.s / this.length) % 1;
    const f = this.frame(uNow);
    const ahead = this.frame(uNow + 9 / this.length);
    camera.position.copy(f.p).addScaledVector(f.up, 2.35).addScaledVector(f.t, -0.2);
    const target = ahead.p.clone().addScaledVector(ahead.up, 1.9);
    this.lookTarget.lerp(target, Math.min(1, dt * 6));
    camera.lookAt(this.lookTarget);
  }

  get stationPosition() {
    return this.curve.getPointAt(this.uStart);
  }

  get currentProject() {
    return this.currentSign;
  }
}
