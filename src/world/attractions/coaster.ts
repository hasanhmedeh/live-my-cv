import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { projects } from '../../data/cv';
import { shadowed, staticBox, staticCylinder, std, type Attraction, type Ctx } from '../context';
import type { Input } from '../input';
import { hdr, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';
import { escapeHtml } from '../ui';
import {
  buildTrack,
  CONNECTOR_ZONE,
  DS,
  LAYOUT_ELEMENTS,
  sampleTrack,
  STATION_HEADING,
  STATION_START,
  stepRide,
  zoneAt,
  type RideState,
  type TrackData,
} from './track';

/** Riders' hearts sit this far above the rails. */
const HEART = 1.0;
const CARS = 3;
const CAR_GAP = 2.75;
const START_S = 3;
const STRIP_BASE = new THREE.Color('#5ce1d6');

type CamMode = 'driver' | 'chase' | 'trackside';
const CAM_LABEL: Record<CamMode, string> = { driver: 'Driver', chase: 'Chase', trackside: 'Trackside' };

interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  u: THREE.Vector3;
  r: THREE.Vector3;
}
const frame = (): Frame => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3() });

const $ = (id: string) => document.getElementById(id)!;

/**
 * "The Stack": a launched steel coaster you drive yourself. Hold the throttle to power the
 * linear motors, brake, hit turbo — or coast and let gravity do it. When nobody is riding,
 * a ghost train keeps running laps so the park feels alive.
 */
export class Coaster implements Attraction {
  private d: TrackData;
  private state: RideState = { s: START_S, v: 0, launching: false };
  private cars: THREE.Group[] = [];
  private armsUp: THREE.Object3D[] = [];
  private launchStrips: THREE.MeshBasicMaterial;
  private stripLevel = 1.5;
  private signS: number[] = [];
  private signOrder: number[] = [];
  private seen = new Set<number>();
  private f = frame();
  private f2 = frame();
  private camMode: CamMode = 'driver';
  private camUp = new THREE.Vector3(0, 1, 0);
  private camLook = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private trackside: THREE.Vector3[] = [];
  private prevVel = new THREE.Vector3();
  private gSmooth = 1;
  private lapStart = 0;
  private best = 0;
  private toastTimer = 0;
  private hudTimer = 0;
  private wasLaunching = false;
  input: Input | null = null;
  active = false;
  onFinish: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    this.d = buildTrack(STATION_START, STATION_HEADING, LAYOUT_ELEMENTS, CONNECTOR_ZONE);
    try {
      this.best = Number(localStorage.getItem('coaster-best')) || 0;
    } catch {
      /* storage unavailable */
    }
    this.launchStrips = new THREE.MeshBasicMaterial({ color: hdr(STRIP_BASE, this.stripLevel) });
    this.buildTrackMeshes();
    this.buildStation();
    this.buildTunnel();
    this.buildSigns();
    this.buildTrain();
    this.trackside = [
      new THREE.Vector3(-50, 3, 38), // loop
      new THREE.Vector3(-66, 4, 6), // banked turn + camelback
      new THREE.Vector3(-66, 6, -40), // high turn + roll
      new THREE.Vector3(-14, 9, -34), // helix
      new THREE.Vector3(-16, 4, 12), // station
    ];
    this.placeTrain();
  }

  // ------------------------------------------------------------------ geometry

  private railCenter(i: number, out: THREE.Vector3) {
    return out.copy(this.d.pos[i]).addScaledVector(this.d.up[i], -HEART);
  }

  private buildTrackMeshes() {
    const d = this.d;
    const n = d.pos.length;
    const left: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    const spine: THREE.Vector3[] = [];
    const c = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.railCenter(i, c);
      left.push(c.clone().addScaledVector(d.right[i], -0.55));
      right.push(c.clone().addScaledVector(d.right[i], 0.55));
      spine.push(c.clone().addScaledVector(d.up[i], -0.48));
    }
    const railMat = std(PALETTE.candy, { roughness: 0.28, metalness: 0.65 });
    const spineMat = std(PALETTE.mustard, { roughness: 0.35, metalness: 0.55 });
    for (const [pts, r, mat] of [
      [left, 0.075, railMat],
      [right, 0.075, railMat],
      [spine, 0.2, spineMat],
    ] as const) {
      const curve = new THREE.CatmullRomCurve3(pts as THREE.Vector3[], true, 'catmullrom', 0.0);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, n, r, 8, true), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.ctx.scene.add(mesh);
    }

    // cross-ties with a web down to the spine (one merged geometry, instanced)
    const tieGeo = mergeGeometries([
      new THREE.BoxGeometry(1.3, 0.08, 0.16).translate(0, -0.05, 0),
      new THREE.BoxGeometry(0.1, 0.4, 0.1).translate(0, -0.27, 0),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(-0.55, -0.1, 0),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0.55, -0.1, 0),
    ])!;
    const every = Math.round(1.2 / DS);
    const tieCount = Math.floor(n / every);
    const ties = new THREE.InstancedMesh(tieGeo, std('#3a2f4a', { metalness: 0.5, roughness: 0.45 }), tieCount);
    const m = new THREE.Matrix4();
    const back = new THREE.Vector3();
    for (let k = 0; k < tieCount; k++) {
      const i = k * every;
      this.railCenter(i, c);
      back.copy(d.tan[i]).negate();
      m.makeBasis(d.right[i], d.up[i], back).setPosition(c);
      ties.setMatrixAt(k, m);
    }
    ties.castShadow = true;
    this.ctx.scene.add(ties);

    // linear motors on the launch, copper fins on the brake run, glow strips beside the launch
    const finGeo = new THREE.BoxGeometry(0.05, 0.22, 0.8);
    const lsm: THREE.Matrix4[] = [];
    const brake: THREE.Matrix4[] = [];
    const strips: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i += 2) {
      const z = d.zone[i];
      if (z !== 'launch' && z !== 'brake') continue;
      this.railCenter(i, c);
      back.copy(d.tan[i]).negate();
      m.makeBasis(d.right[i], d.up[i], back).setPosition(c.clone().addScaledVector(d.up[i], 0.02));
      (z === 'launch' ? lsm : brake).push(m.clone());
      if (z === 'launch')
        for (const side of [-0.85, 0.85]) {
          m.makeBasis(d.right[i], d.up[i], back).setPosition(c.clone().addScaledVector(d.right[i], side).addScaledVector(d.up[i], -0.2));
          strips.push(m.clone());
        }
    }
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((mm, k) => im.setMatrixAt(k, mm));
      im.count = list.length;
      this.ctx.scene.add(im);
    };
    add(finGeo, std('#7f8794', { metalness: 0.9, roughness: 0.3 }), lsm);
    add(finGeo, std('#c46a2e', { metalness: 1, roughness: 0.3 }), brake);
    add(new THREE.BoxGeometry(0.08, 0.06, 0.9), this.launchStrips, strips);

    // supports: only under upright track with nothing else in the way
    const supports: { x: number; z: number; h: number; m: THREE.Matrix4 }[] = [];
    const stepS = Math.round(5.5 / DS);
    const worldUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i += stepS) {
      if (d.up[i].y < 0.75 || d.zone[i] === 'station') continue;
      this.railCenter(i, c);
      const bottom = c.y - 0.75;
      if (bottom < 1.2) continue;
      let blocked = false;
      for (let j = 0; j < n && !blocked; j += 2) {
        if (Math.abs(j - i) < 20 || Math.abs(j - i) > n - 20) continue;
        const pj = d.pos[j];
        if (Math.hypot(pj.x - c.x, pj.z - c.z) < 2.2 && pj.y < c.y) blocked = true;
      }
      if (blocked) continue;
      const across = new THREE.Vector3(d.right[i].x, 0, d.right[i].z).normalize();
      const head = new THREE.Matrix4().makeBasis(across, worldUp, new THREE.Vector3().crossVectors(across, worldUp));
      head.setPosition(c.x, bottom, c.z);
      supports.push({ x: c.x, z: c.z, h: bottom, m: head });
    }
    const colGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 10).translate(0, 0.5, 0);
    const steel = std(PALETTE.cream, { metalness: 0.4, roughness: 0.45 });
    const cols = new THREE.InstancedMesh(colGeo, steel, supports.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.22, 0.3), steel, supports.length);
    const feet = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.62, 0.35, 12), std('#8d8a99', { roughness: 0.9 }), supports.length);
    supports.forEach((s, k) => {
      cols.setMatrixAt(k, m.makeScale(1, s.h, 1).setPosition(s.x, 0, s.z));
      heads.setMatrixAt(k, s.m);
      feet.setMatrixAt(k, m.makeTranslation(s.x, 0.17, s.z));
      staticCylinder(this.ctx, s.x, s.z, 0.35, 3);
    });
    cols.castShadow = heads.castShadow = true;
    feet.receiveShadow = true;
    this.ctx.scene.add(cols, heads, feet);

    // low track is solid for the bumper car
    for (let i = 0; i < n; i += 4) {
      this.railCenter(i, c);
      if (c.y < 4.6 && d.up[i].y > 0.5 && d.zone[i] !== 'station') staticBox(this.ctx, c.x, c.y / 2, c.z, 0.9, c.y / 2, 0.9);
    }
  }

  private buildStation() {
    const g = new THREE.Group();
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 18), std('#b98a5a'));
    platform.position.set(-23.6, 0.55, 3);
    platform.receiveShadow = true;
    g.add(platform);
    staticBox(this.ctx, -23.6, 0.55, 3, 1.1, 0.55, 9);
    staticBox(this.ctx, -26, 1, 3, 1.1, 1, 9.5);

    const roofTex = stripeTexture(PALETTE.candy, PALETTE.cream, 10);
    roofTex.repeat.set(4, 1);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, 19), std('#ffffff', { map: roofTex }));
    roof.position.set(-24.8, 5.6, 3);
    g.add(roof);
    for (const z of [-5.5, 3, 11.5])
      for (const x of [-27.8, -22.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.5), std(PALETTE.cream));
        post.position.set(x, 2.75, z);
        g.add(post);
        if (x > -23) staticCylinder(this.ctx, x, z, 0.25, 5);
      }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), signMaterial(signTexture('THE STACK', { sub: 'Drive it yourself · launch · loop · roll' })));
    sign.position.set(-22.4, 7.2, 3);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.8, 9.2), std(PALETTE.candyDark));
    signBack.position.set(-22.55, 7.2, 3);
    g.add(signBack);
    const roofBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: hdr('#ffe2a0', 6) }), 38);
    for (let i = 0; i < 38; i++) roofBulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-21.55, 5.4, -6.2 + i * 0.5));
    g.add(roofBulbs);
    shadowed(g, true);
    roofBulbs.castShadow = false;
    this.ctx.scene.add(g);
  }

  /** A lit tunnel shell swept along the tunnel zone. */
  private buildTunnel() {
    const d = this.d;
    const idx: number[] = [];
    for (let i = 0; i < d.pos.length; i++) if (d.zone[i] === 'tunnel') idx.push(i);
    if (idx.length < 4) return;
    const R = 2.9;
    const segs = 16;
    const pos: number[] = [];
    const uv: number[] = [];
    const ind: number[] = [];
    const c = new THREE.Vector3();
    idx.forEach((i, row) => {
      this.railCenter(i, c);
      const center = c.clone().addScaledVector(d.up[i], 1.1);
      for (let k = 0; k <= segs; k++) {
        const a = -0.2 + (k / segs) * (Math.PI + 0.4);
        const p = center
          .clone()
          .addScaledVector(d.right[i], Math.cos(a) * R)
          .addScaledVector(d.up[i], Math.sin(a) * R);
        pos.push(p.x, p.y, p.z);
        uv.push(k / segs, row * 0.25);
      }
    });
    for (let r = 0; r < idx.length - 1; r++)
      for (let k = 0; k < segs; k++) {
        const a = r * (segs + 1) + k;
        const b = a + segs + 1;
        ind.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(ind);
    geo.computeVertexNormals();
    const tex = stripeTexture(PALETTE.violet, '#2a1f45', 8, true);
    const shell = new THREE.Mesh(geo, std('#ffffff', { map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    shell.castShadow = shell.receiveShadow = true;
    this.ctx.scene.add(shell);

    // glowing rings every few metres
    const ringGeo = new THREE.TorusGeometry(R - 0.12, 0.05, 6, 32, Math.PI + 0.4);
    const ringMat = new THREE.MeshBasicMaterial({ color: hdr('#ff7ad9', 5) });
    const back = new THREE.Vector3();
    for (let k = 0; k < idx.length; k += 8) {
      const i = idx[k];
      this.railCenter(i, c);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      back.copy(d.tan[i]).negate();
      ring.matrix.makeBasis(d.right[i], d.up[i], back).setPosition(c.clone().addScaledVector(d.up[i], 1.1));
      ring.matrix.multiply(new THREE.Matrix4().makeRotationZ(-0.2));
      ring.matrixAutoUpdate = false;
      this.ctx.scene.add(ring);
    }
  }

  /** Project billboards beside upright parts of the track, facing oncoming riders. */
  private buildSigns() {
    const d = this.d;
    const n = d.pos.length;
    const colors = [PALETTE.candy, PALETTE.teal, PALETTE.violet, PALETTE.mustard];
    const c = new THREE.Vector3();
    const used: number[] = [];
    const placed: { s: number; k: number }[] = [];
    projects.forEach((p, k) => {
      const target = Math.floor(((k + 0.6) / projects.length) * n);
      let pick = -1;
      let side = 1;
      for (let off = 0; off < n / 3 && pick < 0; off++) {
        for (const i of [(target + off) % n, (target - off + n) % n]) {
          if (d.up[i].y < 0.92 || d.zone[i] === 'station' || d.zone[i] === 'tunnel') continue;
          if (used.some((u) => Math.min(Math.abs(u - i), n - Math.abs(u - i)) < 40)) continue;
          for (const sd of [1, -1]) {
            this.railCenter(i, c);
            const spot = c.clone().addScaledVector(d.right[i], sd * 4.6);
            let ok = Math.hypot(spot.x, spot.z) < 86;
            for (let j = 0; j < n && ok; j += 2) if (Math.hypot(d.pos[j].x - spot.x, d.pos[j].z - spot.z) < 3.2) ok = false;
            if (ok) {
              pick = i;
              side = sd;
              break;
            }
          }
          if (pick >= 0) break;
        }
      }
      if (pick < 0) return;
      used.push(pick);
      placed.push({ s: pick * DS, k });
      this.railCenter(pick, c);
      const spot = c.clone().addScaledVector(d.right[pick], side * 4.6);
      const boardY = Math.max(c.y + 2.2, 3.4);
      const g = new THREE.Group();
      const tex = signTexture(p.name, { sub: `${p.where} · ${p.tags.join(' · ')}`, border: colors[k % colors.length], width: 1024, height: 400 });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.35), signMaterial(tex));
      const backing = new THREE.Mesh(new THREE.BoxGeometry(6.1, 2.45, 0.12), std('#3a2f4a'));
      backing.position.z = -0.08;
      g.add(board, backing);
      for (const x of [-2.4, 2.4]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, boardY), std('#3a2f4a', { metalness: 0.6, roughness: 0.4 }));
        pole.position.set(x, -boardY / 2, -0.15);
        g.add(pole);
      }
      g.position.set(spot.x, boardY, spot.z);
      const look = d.pos[(pick - 30 + n) % n];
      g.lookAt(look.x, boardY, look.z);
      shadowed(g);
      this.ctx.scene.add(g);
      const r = new THREE.Vector3(2.4, 0, 0).applyQuaternion(g.quaternion);
      staticCylinder(this.ctx, spot.x + r.x, spot.z + r.z, 0.2, 3);
      staticCylinder(this.ctx, spot.x - r.x, spot.z - r.z, 0.2, 3);
    });
    // keep signs in track order so "project k" matches what the rider sees
    placed.sort((a, b) => a.s - b.s);
    this.signS = placed.map((p) => p.s);
    this.signOrder = placed.map((p) => p.k);
  }

  private buildTrain() {
    const paint = [PALETTE.mustard, PALETTE.candy, PALETTE.teal];
    const seatMat = std(PALETTE.ink, { roughness: 0.7 });
    const chrome = std('#e6e2f0', { roughness: 0.12, metalness: 1 });
    const wheelMat = std('#2a2238', { roughness: 0.6 });
    const shirts = ['#5ce1d6', '#ff8a3d', '#a98bff', '#ffd23d', '#7ee2b8', '#ff5d7a'];
    const skins = ['#e8b48a', '#c98e62', '#8d5a3b', '#f1c9a5'];
    const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12).rotateZ(Math.PI / 2);
    let rider = 0;
    for (let k = 0; k < CARS; k++) {
      const car = new THREE.Group();
      const body = new THREE.MeshPhysicalMaterial({ color: paint[k % paint.length], roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 });
      const shell = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.3), body);
      shell.position.y = 0.42;
      car.add(shell);
      if (k === 0) {
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), body);
        nose.rotation.x = -Math.PI / 2;
        nose.scale.set(1, 1.1, 0.55);
        nose.position.set(0, 0.42, -1.15);
        car.add(nose);
        for (const x of [-0.42, 0.42]) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: hdr('#fff3d0', 8) }));
          lamp.position.set(x, 0.5, -1.62);
          car.add(lamp);
        }
      }
      for (const z of [-0.45, 0.6]) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.2, 0.7), seatMat);
        seat.position.set(0, 0.75, z);
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.8, 0.14), seatMat);
        back.position.set(0, 1.15, z + 0.36);
        car.add(seat, back);
        for (const x of [-0.36, 0.36]) {
          // over-the-shoulder restraint
          const bar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 12, Math.PI), chrome);
          bar.position.set(x, 1.32, z + 0.05);
          bar.rotation.y = Math.PI / 2;
          car.add(bar);
          // the front-left seat of the lead car is yours (the driver camera sits there)
          if (k === 0 && z < 0 && x < 0) continue;
          const person = new THREE.Group();
          const skin = std(skins[rider % skins.length]);
          const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 8), std(shirts[rider % shirts.length]));
          torso.position.y = 1.08;
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
          head.position.y = 1.5;
          person.add(torso, head);
          const arms = new THREE.Group();
          for (const ax of [-0.2, 0.2]) {
            const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 3, 6), skin);
            arm.position.set(ax, 0.28, 0);
            arms.add(arm);
          }
          arms.position.y = 1.22;
          person.add(arms);
          this.armsUp.push(arms);
          person.position.set(x, 0, z);
          car.add(person);
          rider++;
        }
      }
      for (const x of [-0.62, 0.62])
        for (const z of [-0.8, 0.8]) {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.position.set(x, 0.05, z);
          car.add(w);
        }
      shadowed(car);
      car.matrixAutoUpdate = false;
      car.traverse((o) => o !== car && o.updateMatrix());
      this.ctx.scene.add(car);
      this.cars.push(car);
    }
  }

  // ------------------------------------------------------------------ ride

  private placeTrain() {
    const back = new THREE.Vector3();
    const c = new THREE.Vector3();
    this.cars.forEach((car, k) => {
      sampleTrack(this.d, this.state.s - k * CAR_GAP, this.f2);
      c.copy(this.f2.p).addScaledVector(this.f2.u, -HEART);
      back.copy(this.f2.t).negate();
      car.matrix.makeBasis(this.f2.r, this.f2.u, back).setPosition(c);
      car.matrixWorldNeedsUpdate = true;
    });
  }

  start() {
    this.active = true;
    this.state = { s: START_S, v: 0, launching: false };
    this.seen.clear();
    this.lapStart = this.ctx.time.t;
    this.camMode = 'driver';
    this.prevVel.set(0, 0, 0);
    this.gSmooth = 1;
    sampleTrack(this.d, this.state.s, this.f);
    this.camUp.copy(this.f.u);
    this.camLook.copy(this.f.p).addScaledVector(this.f.t, 10);
    this.camPos.copy(this.f.p);
    this.placeTrain();
    $('ride-hud').hidden = false;
    $('rh-toast').hidden = true;
    document.body.classList.add('is-riding-coaster');
    this.updateHudStatic();
    const touch = this.ctx.mobile;
    this.ctx.ui.panel(
      'coaster-intro',
      `<p class="eyebrow">The Stack · You're the driver</p><h2>Hold on tight!</h2><p>${
        touch
          ? 'Push the joystick <strong>up</strong> for power, <strong>down</strong> to brake. Tap <kbd>E</kbd> to switch camera.'
          : 'Hold <kbd>W</kbd> for power, <kbd>S</kbd> to brake, <kbd>Shift</kbd> for turbo, <kbd>C</kbd> to switch camera.'
      } The launch fires automatically — brake too hard before the loop and you'll roll back!</p><p>Every billboard is a project I've built; its card pops up here as you pass.</p>`,
      { accent: PALETTE.mustard, closable: false },
    );
    this.ctx.sfx.chime();
  }

  exit() {
    this.active = false;
    $('ride-hud').hidden = true;
    $('gloc').style.opacity = '0';
    document.body.classList.remove('is-riding-coaster');
    this.ctx.ui.panel('coaster-summary', this.summaryHtml(), { accent: PALETTE.mustard });
    this.onFinish?.();
  }

  cycleCamera() {
    const order: CamMode[] = ['driver', 'chase', 'trackside'];
    this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
    if (this.camMode === 'chase') this.camPos.copy(this.f.p).add(new THREE.Vector3(0, 6, 0)).addScaledVector(this.f.t, -13);
    $('rh-cam').textContent = CAM_LABEL[this.camMode];
    this.ctx.sfx.pop();
  }

  private summaryHtml() {
    return `<p class="eyebrow">The Stack · Ride recap${this.best ? ` · best lap ${fmt(this.best)}` : ''}</p><h2>What I've built</h2>${projects
      .map(
        (p) =>
          `<h3>${escapeHtml(p.name)}</h3><p class="sub">${escapeHtml(p.where)}</p><p>${escapeHtml(p.text)}</p><ul class="tags">${p.tags
            .map((t) => `<li>${escapeHtml(t)}</li>`)
            .join('')}</ul>`,
      )
      .join('')}`;
  }

  update(dt: number) {
    const L = this.d.length;
    const inp = this.active && this.input ? { throttle: this.input.throttle, turbo: this.input.boost } : { throttle: 0, turbo: false };

    // two physics substeps per frame for stability at high speed
    const h = dt / 2;
    for (let i = 0; i < 2; i++) {
      sampleTrack(this.d, this.state.s, this.f);
      stepRide(this.d, this.state, inp, h, this.f.t);
    }
    if (this.state.s >= L) {
      this.state.s -= L;
      if (this.active) this.onLap();
    } else if (this.state.s < 0) this.state.s += L;

    sampleTrack(this.d, this.state.s, this.f);
    this.placeTrain();

    // felt G-force from the finite-difference acceleration
    const vel = this.f.t.clone().multiplyScalar(this.state.v);
    if (dt > 0) {
      const acc = vel.clone().sub(this.prevVel).divideScalar(dt);
      acc.y += 9.81;
      const g = acc.dot(this.f.u) / 9.81;
      if (Number.isFinite(g)) this.gSmooth += (THREE.MathUtils.clamp(g, -8, 16) - this.gSmooth) * Math.min(1, dt * 6);
    }
    this.prevVel.copy(vel);

    // riders throw their hands up on airtime and at big speed
    const hands = this.gSmooth < 0.4 || this.state.v > 22 ? -2.6 : -0.2;
    for (const a of this.armsUp) {
      a.rotation.x += (hands - a.rotation.x) * Math.min(1, dt * 6);
      a.updateMatrix();
    }

    // launch strips glow while the motors fire
    this.stripLevel += ((this.state.launching ? 14 : 1.5) - this.stripLevel) * Math.min(1, dt * 8);
    this.launchStrips.color.copy(STRIP_BASE).multiplyScalar(this.stripLevel);

    this.ctx.sfx.setCoaster(Math.min(1, Math.abs(this.state.v) / 30), this.state.launching, this.active);

    if (!this.active) return;

    if (this.state.launching && !this.wasLaunching) this.toast('LAUNCH! 🚀');
    this.wasLaunching = this.state.launching;
    if (zoneAt(this.d, this.state.s) === 'launch' && this.state.v < -0.5) this.toast('Rolled back! Hold W for power');

    // project cards
    for (let k = 0; k < this.signS.length; k++) {
      const ahead = (((this.signS[k] - this.state.s) % L) + L) % L;
      if (ahead < 18 && !this.seen.has(k) && this.state.v > 0) {
        this.seen.add(k);
        const p = projects[this.signOrder[k]];
        this.ctx.ui.panel(
          `coaster-${k}`,
          `<p class="eyebrow">Project ${k + 1} / ${this.signS.length}</p><h2>${escapeHtml(p.name)}</h2><p class="sub">${escapeHtml(p.where)}</p><p>${escapeHtml(
            p.text,
          )}</p><ul class="tags">${p.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul><div class="progress-dots">${this.signS
            .map((_, j) => `<span class="${this.seen.has(j) ? 'on' : ''}"></span>`)
            .join('')}</div>`,
          { accent: PALETTE.mustard, closable: false },
        );
        this.ctx.sfx.pop();
      }
    }
    this.updateHud(dt);
  }

  private onLap() {
    const t = this.ctx.time.t - this.lapStart;
    this.lapStart = this.ctx.time.t;
    if (t < 6) return;
    const record = !this.best || t < this.best;
    if (record) {
      this.best = t;
      try {
        localStorage.setItem('coaster-best', String(t));
      } catch {
        /* storage unavailable */
      }
    }
    this.toast(record ? `New best lap ${fmt(t)} 🏆` : `Lap ${fmt(t)}`);
    this.ctx.sfx.chime();
    this.seen.clear();
    this.updateHudStatic();
  }

  private toast(text: string) {
    const el = $('rh-toast');
    if (!el.hidden && el.textContent === text) return;
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this.toastTimer = 2.2;
  }

  private updateHudStatic() {
    $('rh-best').textContent = this.best ? fmt(this.best) : '—';
    $('rh-cam').textContent = CAM_LABEL[this.camMode];
  }

  private updateHud(dt: number) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('rh-toast').hidden = true;
    }
    // grey-out under heavy positive G, red-out under strong negative G
    const gl = $('gloc');
    const over = Math.max(0, (this.gSmooth - 5.5) / 4);
    const under = Math.max(0, (-this.gSmooth - 1) / 2);
    gl.classList.toggle('grey', over >= under);
    gl.style.opacity = String(Math.min(0.9, Math.max(over, under)));

    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.08;
    $('rh-speed').textContent = String(Math.round(Math.abs(this.state.v) * 3.6));
    const gEl = $('rh-g');
    gEl.textContent = this.gSmooth.toFixed(1);
    gEl.parentElement!.classList.toggle('hot', this.gSmooth > 4);
    gEl.parentElement!.classList.toggle('float', this.gSmooth < 0.3);
    $('rh-lap').textContent = fmt(this.ctx.time.t - this.lapStart);
    const thr = this.input?.throttle ?? 0;
    const bar = $('rh-throttle');
    bar.style.left = thr >= 0 ? '50%' : `${50 + thr * 50}%`;
    bar.style.width = `${Math.abs(thr) * 50}%`;
    bar.className = thr < 0 ? 'brake' : this.input?.boost && thr > 0 ? 'turbo' : '';
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const f = this.f;
    if (this.camMode === 'driver') {
      // front-left seat of the lead car; the horizon rolls with the track
      sampleTrack(this.d, this.state.s - 0.45, this.f2);
      const eye = this.f2.p.clone().addScaledVector(this.f2.u, 0.55).addScaledVector(this.f2.r, -0.36);
      sampleTrack(this.d, this.state.s + 9, this.f2);
      const look = this.f2.p.clone().addScaledVector(this.f2.u, 0.4);
      this.camUp.lerp(f.u, 1 - Math.exp(-dt * 10)).normalize();
      this.camLook.lerp(look, Math.min(1, dt * 12));
      camera.position.copy(eye);
      camera.up.copy(this.camUp);
      camera.lookAt(this.camLook);
    } else if (this.camMode === 'chase') {
      // behind and above, always world-up so loops stay readable
      const flat = new THREE.Vector3(f.t.x, 0, f.t.z);
      if (flat.lengthSq() < 0.01) flat.copy(f.p).sub(this.camPos).setY(0);
      flat.normalize();
      const want = f.p.clone().addScaledVector(flat, -13).add(new THREE.Vector3(0, 6, 0));
      want.y = Math.max(want.y, 2.5);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 3));
      this.camLook.lerp(f.p, 1 - Math.exp(-dt * 8));
      camera.up.set(0, 1, 0);
      camera.position.copy(this.camPos);
      camera.lookAt(this.camLook);
    } else {
      let best = this.trackside[0];
      for (const p of this.trackside) if (p.distanceToSquared(f.p) < best.distanceToSquared(f.p)) best = p;
      camera.up.set(0, 1, 0);
      camera.position.copy(best);
      this.camLook.lerp(f.p, 1 - Math.exp(-dt * 10));
      camera.lookAt(this.camLook);
      this.camPos.copy(best);
    }
  }

  /** Where the lead car is (for shadows / grass LOD while riding). */
  get trainPosition() {
    return this.f.p;
  }
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
