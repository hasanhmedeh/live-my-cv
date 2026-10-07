import * as THREE from 'three';
import { strikerTiers } from '../../data/fair';
import { shadowed, staticBox, std, type Attraction, type Ctx } from '../context';
import { LAYOUT } from '../layout';
import { PALETTE, signMaterial, signTexture } from '../textures';
import { escapeHtml } from '../ui';

const HEIGHT = 9;

type Phase = 'idle' | 'aim' | 'fly' | 'result';

/** The classic "test your strength" high striker. Hit the bell to reach the top tier. */
export class Striker implements Attraction {
  private puck: THREE.Mesh;
  private bell: THREE.Mesh;
  private hammer = new THREE.Group();
  private origin = new THREE.Vector3(LAYOUT.striker.x, 0, LAYOUT.striker.z);
  private phase: Phase = 'idle';
  private power = 0;
  private meterT = 0;
  private flyT = 0;
  private best = 0;
  private bellShake = 0;
  private confetti: THREE.InstancedMesh;
  private confettiData: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler }[] = [];
  private confettiLife = 0;
  active = false;
  onFinish: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), std(PALETTE.ink));
    base.position.y = 0.3;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.3, 16), std(PALETTE.candy));
    pad.position.set(0, 0.75, 0.6);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, HEIGHT),
      new THREE.MeshStandardMaterial({ map: this.scaleTexture() }),
    );
    board.position.set(0, HEIGHT / 2 + 0.6, -0.2);
    const boardBack = new THREE.Mesh(new THREE.BoxGeometry(1.8, HEIGHT + 0.4, 0.3), std(PALETTE.candyDark));
    boardBack.position.set(0, HEIGHT / 2 + 0.6, -0.4);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HEIGHT), std('#d9d4e6', { metalness: 0.9, roughness: 0.2 }));
    rail.position.set(0, HEIGHT / 2 + 0.6, 0.15);
    this.bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      std('#ffcf5a', { metalness: 1, roughness: 0.18, side: THREE.DoubleSide }),
    );
    this.bell.position.set(0, HEIGHT + 1.1, 0.15);
    this.puck = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.35, 16), std(PALETTE.candy, { emissive: '#ff4d6d', emissiveIntensity: 2.5 }));
    this.puck.position.set(0, 0.9, 0.15);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.5),
      signMaterial(signTexture('HIGH STRIKER', { sub: 'Ring the bell, win a prize', border: PALETTE.mustard })),
    );
    sign.position.set(0, HEIGHT + 2.7, 0.2);

    // mallet
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2), std('#8a5a3a'));
    handle.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 14), std(PALETTE.candy));
    head.rotation.z = Math.PI / 2;
    head.position.y = 2.2;
    this.hammer.add(handle, head);
    this.hammer.position.set(1.0, 0.6, 1.6);
    this.hammer.rotation.x = -0.4;

    g.add(base, pad, board, boardBack, rail, this.bell, this.puck, sign, this.hammer);
    g.position.copy(this.origin);
    shadowed(g, true);
    ctx.scene.add(g);
    staticBox(ctx, this.origin.x, 2, this.origin.z - 0.2, 1.3, 2, 1.3);

    // confetti for the bell
    const n = 120;
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.18, 0.28), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), n);
    const colors = [PALETTE.candy, PALETTE.mustard, PALETTE.teal, PALETTE.violet, '#ffffff'];
    for (let i = 0; i < n; i++) {
      this.confetti.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      this.confettiData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler() });
    }
    this.confetti.visible = false;
    this.confetti.frustumCulled = false;
    ctx.scene.add(this.confetti);
  }

  private scaleTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 1440;
    const ctx = c.getContext('2d')!;
    const tiers = [...strikerTiers].reverse();
    const colors = [PALETTE.candy, PALETTE.orange, PALETTE.mustard, PALETTE.teal];
    const h = c.height / tiers.length;
    tiers.forEach((t, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(0, i * h, 256, h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, i * h, 256, 8);
      ctx.save();
      ctx.translate(128, i * h + h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = `64px "Lilita One", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.tier.toUpperCase(), 0, 0);
      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  start() {
    this.active = true;
    this.phase = 'aim';
    this.meterT = 0;
    this.puck.position.y = 0.9;
    this.renderAim();
  }

  private renderAim() {
    this.ctx.ui.panel(
      'striker-aim',
      `<p class="eyebrow">High Striker</p><h2>Test your strength!</h2><p>Press <kbd>E</kbd> / <kbd>Space</kbd> or tap when the marker is in the red to ring the bell. How high can you send the puck?</p><div class="meter"><i id="striker-marker"></i></div>${this.tiersHtml()}<p><button class="btn btn-primary btn-small" type="button" data-striker-hit>Swing! 🔨</button></p>`,
      { accent: PALETTE.mustard },
    );
    this.ctx.ui.panelElement.querySelector('[data-striker-hit]')?.addEventListener('click', () => this.action());
  }

  private tiersHtml() {
    const unlocked = Math.ceil(this.best * strikerTiers.length - 0.001);
    return `<ul>${strikerTiers
      .map((a, i) => (i < unlocked ? `<li><strong>${escapeHtml(a.tier)}:</strong> ${escapeHtml(a.text)}</li>` : `<li style="opacity:.45">🔒 ${escapeHtml(a.tier)} — hit higher to unlock</li>`))
      .join('')}</ul>`;
  }

  action() {
    if (this.phase === 'aim') {
      this.phase = 'fly';
      this.flyT = 0;
      // triangle wave 0..1 — a bit forgiving at the top
      this.power = Math.min(1, this.meterValue() * 1.06);
      this.ctx.sfx.whack();
    } else if (this.phase === 'result') {
      this.phase = 'aim';
      this.puck.position.y = 0.9;
      this.renderAim();
    }
  }

  private meterValue() {
    const x = (this.meterT * 0.9) % 2;
    return x < 1 ? x : 2 - x;
  }

  exit() {
    this.active = false;
    this.phase = 'idle';
    this.puck.position.y = 0.9;
    this.hammer.rotation.x = -0.4;
    this.onFinish?.();
  }

  update(dt: number) {
    if (this.bellShake > 0) {
      this.bellShake -= dt;
      this.bell.rotation.z = Math.sin(this.bellShake * 60) * this.bellShake * 0.4;
    }
    this.updateConfetti(dt);
    if (!this.active) return;

    if (this.phase === 'aim') {
      this.meterT += dt;
      const marker = document.getElementById('striker-marker');
      if (marker) marker.style.left = `${this.meterValue() * 100}%`;
      this.hammer.rotation.x = THREE.MathUtils.lerp(this.hammer.rotation.x, -1.1, dt * 4);
    } else if (this.phase === 'fly') {
      this.flyT += dt;
      this.hammer.rotation.x = THREE.MathUtils.lerp(this.hammer.rotation.x, 0.9, Math.min(1, dt * 25));
      const peak = 0.9 + this.power * HEIGHT;
      const up = 0.55;
      const y = this.flyT < up ? 0.9 + (peak - 0.9) * Math.sin((this.flyT / up) * (Math.PI / 2)) : peak - Math.pow(this.flyT - up, 2) * 18;
      this.puck.position.y = Math.max(0.9, y);
      if (this.flyT >= up && this.flyT - dt < up) this.onPeak();
      if (this.flyT > up && this.puck.position.y <= 0.9) {
        this.phase = 'result';
      }
    }
  }

  private onPeak() {
    const tier = Math.ceil(this.power * strikerTiers.length - 0.001);
    const rang = this.power >= 0.97;
    this.best = Math.max(this.best, this.power);
    if (rang) {
      this.ctx.sfx.ding();
      this.bellShake = 1.2;
      this.burstConfetti();
    } else {
      this.ctx.sfx.pop();
    }
    const heading = rang ? 'DING! You rang the bell! 🔔' : tier ? `Tier ${tier}: ${strikerTiers[tier - 1].tier}` : 'Almost — try again!';
    this.ctx.ui.panel(
      `striker-result-${Date.now()}`,
      `<p class="eyebrow">High Striker · Power ${Math.round(this.power * 100)}%</p><h2>${escapeHtml(heading)}</h2>${this.tiersHtml()}<p><button class="btn btn-primary btn-small" type="button" data-striker-again>Swing again 🔨</button></p>`,
      { accent: PALETTE.mustard },
    );
    this.ctx.ui.panelElement.querySelector('[data-striker-again]')?.addEventListener('click', () => this.action());
  }

  private burstConfetti() {
    this.confetti.visible = true;
    this.confettiLife = 3;
    const top = this.origin.clone().setY(HEIGHT + 1.2);
    for (const d of this.confettiData) {
      d.p.copy(top);
      d.v.set((Math.random() - 0.5) * 9, 4 + Math.random() * 7, (Math.random() - 0.5) * 9);
      d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
  }

  private updateConfetti(dt: number) {
    if (!this.confetti.visible) return;
    this.confettiLife -= dt;
    if (this.confettiLife <= 0) {
      this.confetti.visible = false;
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    this.confettiData.forEach((d, i) => {
      d.v.y -= 9 * dt;
      d.v.multiplyScalar(1 - dt * 1.5);
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < 0.05) {
        d.p.y = 0.05;
        d.v.set(0, 0, 0);
      }
      d.r.x += dt * 5;
      d.r.y += dt * 3;
      q.setFromEuler(d.r);
      this.confetti.setMatrixAt(i, m.compose(d.p, q, s));
    });
    this.confetti.instanceMatrix.needsUpdate = true;
  }
}
