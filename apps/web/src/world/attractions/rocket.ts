import * as THREE from 'three';
import { rocketStages } from '../../data/fair';
import { shadowed, staticCylinder, std, type Attraction, type Ctx } from '../context';
import type { Environment } from '../environment';
import { LAYOUT } from '../layout';
import { floatingTextTexture, glowTexture, hdr, makeSprite, PALETTE, stripeTexture } from '../textures';
import { escapeHtml } from '../ui';

// Altitude of each stage ring (metres above the pad).
const ALTITUDES = [28, 90, 170, 260, 370, 500];
const ORBIT = ALTITUDES[ALTITUDES.length - 1];
const AUTO_ADVANCE = 9; // seconds before the next stage fires on its own
const ORBIT_STAY = 8; // seconds in orbit before the capsule brings you home

type Phase = 'idle' | 'countdown' | 'climb' | 'hold' | 'orbit' | 'home';

export class Rocket implements Attraction {
  private rocket = new THREE.Group();
  private booster = new THREE.Group();
  private flame: THREE.Mesh;
  private flameGlow: THREE.Sprite;
  private smoke: THREE.InstancedMesh;
  private smokeData: { p: THREE.Vector3; v: THREE.Vector3; life: number; size: number }[] = [];
  private smokeCursor = 0;
  private rings: THREE.Group[] = [];
  private pad = new THREE.Vector3(LAYOUT.rocket.x, 0, LAYOUT.rocket.z);
  private phase: Phase = 'idle';
  private phaseTime = 0;
  private altitude = 0;
  private velocity = 0;
  private stage = -1;
  private boosterDropped = false;
  private boosterFall = { v: new THREE.Vector3(), spin: 0 };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private lastCount = -1;
  /** This round: when it began, when the rocket reached orbit, and how fast it climbed. */
  private roundStart = 0;
  private orbitAt = 0;
  private topSpeed = 0;
  active = false;
  onFinish: (() => void) | null = null;
  /** Orbit reached and the stay is over (or the visitor asked to go home): the round is done. */
  onComplete: (() => void) | null = null;
  private engineLight: THREE.PointLight | null = null;

  constructor(private ctx: Ctx, private env: Environment) {
    this.buildPad();
    this.buildRocket();
    this.buildRings();

    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.75, 4, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: hdr('#ffb347', 6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flame.rotation.x = Math.PI;
    this.flame.position.y = -2.2;
    this.flame.visible = false;
    this.rocket.add(this.flame);
    this.flameGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('#ffa94d'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    );
    this.flameGlow.scale.setScalar(9);
    this.flameGlow.position.y = -1;
    this.flameGlow.visible = false;
    this.rocket.add(this.flameGlow);
    if (ctx.quality.extraLights) {
      // always in the scene (intensity 0 when parked) so the light count never changes
      this.engineLight = new THREE.PointLight('#ff9a3c', 0, 70, 1.6);
      this.engineLight.position.y = -2;
      this.rocket.add(this.engineLight);
    }

    const count = 90;
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), std('#f2ebf5', { roughness: 1, flatShading: true }), count);
    this.smoke.frustumCulled = false;
    for (let i = 0; i < count; i++) this.smokeData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, size: 0 });
    this.hideSmoke();
    ctx.scene.add(this.smoke);
  }

  private buildPad() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 0.8, 32), std('#8d8a99'));
    base.position.y = 0.4;
    const stripes = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.12, 6, 48), std(PALETTE.mustard));
    stripes.rotation.x = Math.PI / 2;
    stripes.position.y = 0.82;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.6, 20), std('#4a4458'));
    deck.position.y = 1.1;
    g.add(base, stripes, deck);

    // gantry tower
    const tower = new THREE.Group();
    const steel = std(PALETTE.candy, { metalness: 0.4, roughness: 0.5 });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 22, 0.25), steel);
      leg.position.set(x, 11, z);
      tower.add(leg);
    }
    for (let y = 2; y < 22; y += 2.5) {
      for (const rot of [0, Math.PI / 2]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.15, 0.15), steel);
        brace.position.y = y;
        brace.rotation.y = rot;
        brace.position.x = rot ? 1 : 0;
        brace.position.z = rot ? 0 : 1;
        const brace2 = brace.clone();
        brace2.position.x = rot ? -1 : 0;
        brace2.position.z = rot ? 0 : -1;
        tower.add(brace, brace2);
      }
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 0.6), steel);
    arm.position.set(-2.2, 15, 0);
    tower.add(arm);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: hdr('#ff3b3b', 8) }));
    beacon.position.y = 22.3;
    tower.add(beacon);
    tower.position.set(5.2, 0.8, 0);
    g.add(tower);

    const label = makeSprite(floatingTextTexture('ROCKET RIDE', 'Launch into orbit'), 11);
    label.position.set(0, 26, 0);
    g.add(label);

    g.position.copy(this.pad);
    shadowed(g, true);
    this.ctx.scene.add(g);
    staticCylinder(this.ctx, this.pad.x, this.pad.z, 7.2, 1.6);
    staticCylinder(this.ctx, this.pad.x + 5.2, this.pad.z, 1.6, 22);
  }

  private buildRocket() {
    // polished hull with a lacquered clearcoat
    const white = new THREE.MeshPhysicalMaterial({ color: '#f7f3ee', roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    const red = new THREE.MeshPhysicalMaterial({ color: PALETTE.candy, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
    const stripeTex = stripeTexture(PALETTE.candy, '#f7f3ee', 6, true);

    // Booster (lower stage) — drops off at "stage separation".
    const boosterBody = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 5, 24), std('#ffffff', { map: stripeTex }));
    boosterBody.position.y = 2.5;
    this.booster.add(boosterBody);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 1.6), red);
      const a = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 1.4, 1.2, Math.sin(a) * 1.4);
      fin.rotation.y = -a;
      this.booster.add(fin);
    }
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 0.8, 16), std('#3a2f4a', { metalness: 0.7, roughness: 0.3 }));
    nozzle.position.y = -0.3;
    this.booster.add(nozzle);

    // Upper stage + capsule
    const upper = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 6, 24), white);
    body.position.y = 8;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.13, 1.13, 0.5, 24), red);
    band.position.y = 10.2;
    const windowRim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 20), std('#d9d4e6', { metalness: 0.9, roughness: 0.2 }));
    windowRim.position.set(0, 8.6, 1.13);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), std('#5ce1d6', { emissive: '#2ec4b6', emissiveIntensity: 0.6, roughness: 0.1 }));
    glass.position.set(0, 8.6, 1.16);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 24), red);
    nose.position.y = 12.6;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), std(PALETTE.mustard));
    tip.position.y = 14.2;
    upper.add(body, band, windowRim, glass, nose, tip);
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.9), std(PALETTE.teal));
      const a = (i / 3) * Math.PI * 2 + 0.5;
      fin.position.set(Math.cos(a) * 1.25, 5.6, Math.sin(a) * 1.25);
      fin.rotation.y = -a;
      upper.add(fin);
    }
    // a little HH monogram on the hull
    const mono = makeSprite(floatingTextTexture('FF'), 1.4);
    mono.position.set(0, 7, 1.3);
    mono.material.depthTest = true;
    upper.add(mono);

    this.rocket.add(this.booster, upper);
    this.rocket.position.copy(this.pad).setY(1.4);
    shadowed(this.rocket);
    this.ctx.scene.add(this.rocket);
  }

  private buildRings() {
    rocketStages.forEach((m, i) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(7, 0.22, 8, 64),
        new THREE.MeshBasicMaterial({ color: hdr([PALETTE.mustard, PALETTE.teal, PALETTE.candy, PALETTE.violet][i % 4], 3.5), fog: false }),
      );
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const label = makeSprite(floatingTextTexture(`${ALTITUDES[i]} m`, m.title), 14);
      label.position.set(13, 1, 0);
      label.material.fog = false;
      g.add(label);
      g.position.set(this.pad.x, ALTITUDES[i] + 8, this.pad.z);
      g.visible = false;
      this.ctx.scene.add(g);
      this.rings.push(g);
    });
  }

  start() {
    this.active = true;
    this.phase = 'countdown';
    this.phaseTime = 0;
    this.lastCount = -1;
    this.altitude = 0;
    this.velocity = 0;
    this.stage = -1;
    this.roundStart = this.ctx.time.t;
    this.orbitAt = 0;
    this.topSpeed = 0;
    this.rings.forEach((r) => (r.visible = true));
    this.camPos.set(this.pad.x - 26, 10, this.pad.z + 30);
    this.camLook.copy(this.pad).setY(8);
    // opens by itself the first time; after that it's behind the ℹ️
    this.ctx.ui.setIntro(
      'rocket-intro',
      'the Rocket Ride',
      `<p class="eyebrow">Rocket Ride</p><h2>T-minus 3…</h2><p>Each ring in the sky is a stage of the climb to orbit. Press <kbd>E</kbd> (or tap the button) to fire the next stage.</p>`,
      { accent: PALETTE.teal, left: true },
    );
  }

  /** E / tap: skip to the next stage; in orbit, head home. */
  action() {
    if (this.phase === 'hold') this.fireNextStage();
    else if (this.phase === 'orbit') this.complete();
  }

  private complete() {
    if (this.phase !== 'orbit') return;
    this.phase = 'home'; // fire once: the capsule is on its way back
    this.onComplete?.();
  }

  private fireNextStage() {
    this.phase = 'climb';
    this.phaseTime = 0;
    this.ctx.sfx.whoosh();
  }

  exit() {
    this.active = false;
    this.phase = 'idle';
    this.ctx.ui.countdown(null);
    this.resetRocket();
    this.env.setSpace(0);
    this.onFinish?.();
  }

  /** This round's numbers (see account/stats.ts); the time to orbit only if it got there. */
  roundStats(): Record<string, number> {
    const stats: Record<string, number> = {
      durationS: this.ctx.time.t - this.roundStart,
      stagesFired: this.stage + 1,
      maxAltitudeM: this.altitude,
      topSpeedKmh: this.topSpeed * 3.6,
    };
    if (this.orbitAt) stats.timeToOrbitS = this.orbitAt - this.roundStart;
    return stats;
  }

  private resetRocket() {
    this.rocket.position.copy(this.pad).setY(1.4);
    this.rocket.rotation.set(0, 0, 0);
    if (this.boosterDropped) {
      this.ctx.scene.remove(this.booster);
      this.booster.position.set(0, 0, 0);
      this.booster.rotation.set(0, 0, 0);
      this.rocket.add(this.booster);
      this.boosterDropped = false;
    }
    this.flame.visible = this.flameGlow.visible = false;
    if (this.engineLight) this.engineLight.intensity = 0;
    this.rings.forEach((r) => (r.visible = false));
    this.hideSmoke();
  }

  private milestonePanel(i: number) {
    const m = rocketStages[i];
    const last = i === rocketStages.length - 1;
    this.ctx.ui.panel(
      `rocket-${i}`,
      `<p class="eyebrow">Stage ${i + 1} / ${rocketStages.length} · ${ALTITUDES[i]} m</p><h2>${escapeHtml(m.title)}</h2><p class="sub">${escapeHtml(m.sub)}</p><p>${escapeHtml(
        m.text,
      )}</p><div class="progress-dots">${rocketStages.map((_, j) => `<span class="${j <= i ? 'on' : ''}"></span>`).join('')}</div><p style="margin-top:12px"><button class="btn btn-primary btn-small" type="button" data-rocket-next>${
        last ? 'Return to the fair' : 'Fire next stage 🔥'
      }</button></p>`,
      { accent: PALETTE.teal, left: true },
    );
    this.ctx.ui.panelElement.querySelector('[data-rocket-next]')?.addEventListener('click', () => this.action());
  }

  update(dt: number, t: number) {
    // idle bobbing beacon / nothing else when parked
    if (!this.active) return;
    this.phaseTime += dt;

    if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.phaseTime);
      if (n !== this.lastCount && n >= 0) {
        this.lastCount = n;
        this.ctx.ui.countdown(n === 0 ? 'LIFT-OFF!' : String(n));
        this.ctx.sfx.beep(n === 0);
        if (n === 0) this.ctx.sfx.rumble(4);
      }
      if (this.phaseTime > 1.5) this.emitSmoke(3, true);
      if (this.phaseTime > 3.6) {
        this.ctx.ui.countdown(null);
        this.phase = 'climb';
        this.phaseTime = 0;
        this.flame.visible = this.flameGlow.visible = true;
      }
    } else if (this.phase === 'climb') {
      const target = ALTITUDES[this.stage + 1];
      // accelerate, then ease into the milestone
      const dist = target - this.altitude;
      const desired = Math.min(70, Math.max(6, dist * 1.4));
      this.velocity = THREE.MathUtils.lerp(this.velocity, desired, Math.min(1, dt * 1.6));
      this.topSpeed = Math.max(this.topSpeed, this.velocity);
      this.altitude += this.velocity * dt;
      if (this.altitude < 60) this.emitSmoke(2, false);
      if (dist < 0.6) {
        this.altitude = target;
        this.stage++;
        this.phase = this.stage === rocketStages.length - 1 ? 'orbit' : 'hold';
        this.phaseTime = 0;
        if (this.phase === 'orbit') this.orbitAt = this.ctx.time.t;
        this.milestonePanel(this.stage);
        this.ctx.sfx.chime();
        if (this.stage === 2 && !this.boosterDropped) this.dropBooster();
      }
    } else if (this.phase === 'hold') {
      this.velocity = THREE.MathUtils.lerp(this.velocity, 0, dt * 3);
      if (this.phaseTime > AUTO_ADVANCE) this.fireNextStage();
    } else if (this.phase === 'orbit' || this.phase === 'home') {
      // gently pitch over into orbit
      this.rocket.rotation.z = THREE.MathUtils.lerp(this.rocket.rotation.z, -0.9, dt * 0.6);
      if (this.phase === 'orbit' && this.phaseTime > ORBIT_STAY) this.complete();
    }

    const hover = this.phase === 'hold' || this.phase === 'orbit' || this.phase === 'home' ? Math.sin(t * 1.5) * 0.4 : 0;
    this.rocket.position.set(this.pad.x, 1.4 + this.altitude + hover, this.pad.z);
    if (this.phase !== 'countdown') {
      this.rocket.rotation.x = Math.sin(t * 7) * 0.006;
    }
    // flame flicker
    const throttle = this.phase === 'climb' ? 1 : 0.45;
    this.flame.scale.set(1 + Math.random() * 0.1, throttle * (0.9 + Math.random() * 0.4), 1 + Math.random() * 0.1);
    this.flameGlow.material.opacity = 0.6 + Math.random() * 0.3;
    if (this.engineLight) this.engineLight.intensity = this.flame.visible ? (this.phase === 'climb' ? 900 : 400) * (0.85 + Math.random() * 0.3) : 0;
    this.flame.position.y = this.boosterDropped ? 3.6 : -2.2;
    this.flameGlow.position.y = this.boosterDropped ? 4.5 : -1;

    this.env.setSpace(THREE.MathUtils.smoothstep(this.altitude, 120, ORBIT - 40));

    if (this.boosterDropped) {
      this.boosterFall.v.y -= 9.8 * dt;
      this.booster.position.addScaledVector(this.boosterFall.v, dt);
      this.booster.rotation.z += this.boosterFall.spin * dt;
      this.booster.rotation.x += this.boosterFall.spin * 0.6 * dt;
      if (this.booster.position.y < -50) this.booster.visible = false;
    }

    this.updateSmoke(dt);
  }

  private dropBooster() {
    this.boosterDropped = true;
    const world = new THREE.Vector3();
    this.booster.getWorldPosition(world);
    this.rocket.remove(this.booster);
    this.booster.position.copy(world);
    this.booster.visible = true;
    this.ctx.scene.add(this.booster);
    this.boosterFall.v.set(2.5, -2, 1.5);
    this.boosterFall.spin = 1.2;
    this.ctx.sfx.pop();
  }

  private emitSmoke(n: number, ground: boolean) {
    for (let i = 0; i < n; i++) {
      const d = this.smokeData[this.smokeCursor];
      this.smokeCursor = (this.smokeCursor + 1) % this.smokeData.length;
      const a = Math.random() * Math.PI * 2;
      const base = this.rocket.position.clone();
      base.y = Math.max(1, base.y - 1);
      d.p.copy(base).add(new THREE.Vector3(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8));
      const out = ground ? 9 : 2;
      d.v.set(Math.cos(a) * out * Math.random(), ground ? 1 + Math.random() * 2 : -4 - Math.random() * 4, Math.sin(a) * out * Math.random());
      d.life = 1;
      d.size = 0.8 + Math.random() * 1.4;
    }
  }

  private updateSmoke(dt: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.smokeData.forEach((d, i) => {
      if (d.life <= 0) {
        m.makeScale(0, 0, 0);
      } else {
        d.life -= dt * 0.35;
        d.p.addScaledVector(d.v, dt);
        d.v.multiplyScalar(1 - dt * 0.8);
        if (d.p.y < 0.8) d.p.y = 0.8;
        const s = d.size * (1 + (1 - d.life) * 2.2) * Math.min(1, d.life * 3);
        m.compose(d.p, q, new THREE.Vector3(s, s, s));
      }
      this.smoke.setMatrixAt(i, m);
    });
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  private hideSmoke() {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    this.smokeData.forEach((d, i) => {
      d.life = 0;
      this.smoke.setMatrixAt(i, m);
    });
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const rp = this.rocket.position;
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.phase === 'countdown') {
      pos = new THREE.Vector3(this.pad.x - 24, 9, this.pad.z + 26);
      look = new THREE.Vector3(this.pad.x, 9, this.pad.z);
    } else {
      // chase cam: beside and slightly below, looking up at the rocket and its rings
      const orbitK = this.phase === 'orbit' || this.phase === 'home' ? 1 : 0;
      pos = new THREE.Vector3(rp.x - 22 - orbitK * 10, rp.y - 4 + orbitK * 6, rp.z + 24 + orbitK * 8);
      look = new THREE.Vector3(rp.x, rp.y + 8, rp.z);
    }
    const k = Math.min(1, dt * (this.phase === 'climb' ? 5 : 2.5));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }
}
