import * as THREE from 'three';
import { shadowed, staticBox, staticCylinder, std, type Attraction, type Ctx } from '../context';
import { LAYOUT } from '../layout';
import { textMesh } from '../letters';
import { hdr, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';

/** Decorative merry-go-round in the central plaza. */
export class Carousel implements Attraction {
  private spin = new THREE.Group();
  private horses: THREE.Group[] = [];

  constructor(ctx: Ctx) {
    const root = new THREE.Group();
    root.position.set(LAYOUT.carousel.x, 0, LAYOUT.carousel.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.3, 0.7, 40), std(PALETTE.cream));
    base.position.y = 0.35;
    root.add(base);

    const deck = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 0.15, 40), std('#b98a5a'));
    deck.position.y = 0.78;
    this.spin.add(deck);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 6, 20), std('#ffffff', { map: stripeTexture(PALETTE.candy, PALETTE.cream, 10, true) }));
    pole.position.y = 3.8;
    this.spin.add(pole);
    const canopyTex = stripeTexture(PALETTE.candy, PALETTE.cream, 16);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(7.6, 3, 32), std('#ffffff', { map: canopyTex }));
    canopy.position.y = 8.2;
    this.spin.add(canopy);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 0.9, 32, 1, true), std(PALETTE.mustard, { side: THREE.DoubleSide }));
    skirt.position.y = 6.3;
    this.spin.add(skirt);
    // a ring of warm bulbs around the skirt: the classic carousel glow
    const ringN = 48;
    const ring = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), ringN);
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      ring.setMatrixAt(i, new THREE.Matrix4().makeTranslation(Math.cos(a) * 7.68, 6.3, Math.sin(a) * 7.68));
      ring.setColorAt(i, hdr(i % 3 ? '#ffe2a0' : '#ff7a90', 6));
    }
    this.spin.add(ring);
    const topper = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), std('#ffcf5a', { metalness: 1, roughness: 0.2 }));
    topper.position.y = 10;
    this.spin.add(topper);

    const horseColors = [PALETTE.cream, PALETTE.teal, PALETTE.violet, PALETTE.mustard];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 5;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.2), std('#d9d4e6', { metalness: 0.9, roughness: 0.2 }));
      rod.position.set(Math.cos(a) * r, 3.4, Math.sin(a) * r);
      this.spin.add(rod);
      const horse = new THREE.Group();
      const mat = std(horseColors[i % horseColors.length], { roughness: 0.4 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.1, 4, 10), mat);
      body.rotation.z = Math.PI / 2;
      const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 4, 8), mat);
      neck.position.set(0.7, 0.45, 0);
      neck.rotation.z = -0.6;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.3), mat);
      head.position.set(1.05, 0.8, 0);
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.6), std(PALETTE.candy));
      saddle.position.y = 0.38;
      horse.add(body, neck, head, saddle);
      for (const lx of [-0.45, 0.45])
        for (const lz of [-0.18, 0.18]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.7), mat);
          leg.position.set(lx, -0.5, lz);
          leg.rotation.z = lx > 0 ? -0.5 : 0.5;
          horse.add(leg);
        }
      horse.position.set(Math.cos(a) * r, 2.2, Math.sin(a) * r);
      horse.rotation.y = -a + Math.PI; // face along the direction of travel
      this.spin.add(horse);
      this.horses.push(horse);
    }
    root.add(this.spin);
    shadowed(root, true);
    ctx.scene.add(root);
    staticCylinder(ctx, LAYOUT.carousel.x, LAYOUT.carousel.z, 7.3, 2);
  }

  update(_dt: number, t: number) {
    this.spin.rotation.y = t * 0.35;
    this.horses.forEach((h, i) => (h.position.y = 2.2 + Math.sin(t * 2.2 + i * 1.3) * 0.45));
  }
}

/** Ticket booth — the park guide. */
export class Booth implements Attraction {
  private ticket: THREE.Mesh;

  constructor(ctx: Ctx) {
    const root = new THREE.Group();
    root.position.set(LAYOUT.booth.x, 0, LAYOUT.booth.z);
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), std(PALETTE.teal));
    kiosk.position.y = 1.5;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.2, 0.9), std(PALETTE.cream));
    counter.position.set(0, 1.3, 1.8);
    const window_ = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), std('#2a2050', { emissive: '#ffcf7a', emissiveIntensity: 1.6, roughness: 0.1 }));
    window_.position.set(0, 2.1, 1.51);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2, 4), std('#ffffff', { map: stripeTexture(PALETTE.candy, PALETTE.cream, 8) }));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 4;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.5),
      signMaterial(signTexture('TICKETS', { sub: 'Park guide · Ride info', border: PALETTE.candy })),
    );
    sign.position.set(0, 3.55, 1.75);
    sign.rotation.x = -0.2;
    // giant spinning ticket
    this.ticket = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 0.08),
      signMaterial(signTexture('ADMIT ONE', { border: PALETTE.mustard, width: 768, height: 384, bulbs: false }), { emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.3 }),
    );
    this.ticket.position.y = 6.2;
    root.add(kiosk, counter, window_, roof, sign, this.ticket);
    shadowed(root, true);
    ctx.scene.add(root);
    staticBox(ctx, LAYOUT.booth.x, 1.5, LAYOUT.booth.z, 2.2, 1.5, 1.8);
  }

  panelHtml() {
    return `<p class="eyebrow">Ticket Booth · Park guide</p><h2>Welcome to the fair</h2><p>Every ride is free today. Walk up to a glowing ring and press <kbd>E</kbd> to play.</p><ul>
      <li>🎢 <strong>Thunder Loop</strong> — drive the coaster yourself: launch, loop and roll</li>
      <li>🦅 <strong>Sky Falcon</strong> — 4.25 km cliff coaster, 158 m drop at 90°, 250 km/h</li>
      <li>🚀 <strong>Rocket Ride</strong> — fire six stages all the way to orbit</li>
      <li>🥫 <strong>Crate Smash</strong> — ram the crates and rack up points</li>
      <li>🔔 <strong>High Striker</strong> — swing the hammer and ring the bell</li>
      <li>🎡 <strong>Giant Wheel</strong> — 250 m, the tallest observation wheel on Earth</li>
      <li>🚁 <strong>Drone Flights</strong> — rent a camera drone and fly over the whole park</li>
      <li>🌀 <strong>Sky Flip</strong> — swing 125 m up, right over the top, flipping head over heels</li>
      <li>🛸 <strong>Nebula 360</strong> — pendulum ship: loops forward, hangs upside down, loops back</li>
    </ul>`;
  }

  update(_dt: number, t: number) {
    this.ticket.rotation.y = t * 1.2;
    this.ticket.position.y = 6.2 + Math.sin(t * 2) * 0.2;
  }
}

/** Entrance arch with the fair's name in 3D letters. */
export class Arch implements Attraction {
  private bulbs: THREE.InstancedMesh;

  constructor(ctx: Ctx) {
    const root = new THREE.Group();
    root.position.set(LAYOUT.arch.x, 0, LAYOUT.arch.z);
    const towerMat = std('#ffffff', { map: stripeTexture(PALETTE.candy, PALETTE.cream, 6, true) });
    for (const x of [-8, 8]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 9, 16), towerMat);
      tower.position.set(x, 4.5, 0);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.2, 16), std(PALETTE.mustard));
      cap.position.set(x, 10.1, 0);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), std(PALETTE.candy));
      ball.position.set(x, 11.4, 0);
      root.add(tower, cap, ball);
      staticCylinder(ctx, LAYOUT.arch.x + x, LAYOUT.arch.z, 1.1, 9);
    }
    // arched beam
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-8, 8, 0), new THREE.Vector3(0, 11.5, 0), new THREE.Vector3(8, 8, 0));
    const beam = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.45, 10, false), std(PALETTE.violet));
    root.add(beam);
    const pts = curve.getSpacedPoints(30);
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), pts.length);
    pts.forEach((p, i) => {
      this.bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y - 0.55, p.z + 0.3));
      this.bulbs.setColorAt(i, hdr(i % 2 ? '#ffd23d' : '#ff5d7a', 6));
    });
    root.add(this.bulbs);

    const title = textMesh('THE FUNFAIR', 1.15, 0.35, std('#ffcf5a', { roughness: 0.22, metalness: 1 })); // gilded marquee lettering
    title.position.set(0, 7.6, 0.2);
    root.add(title);
    const sub = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.3),
      signMaterial(signTexture('RIDES · GAMES · THRILLS · PRIZES', { border: PALETTE.violet, height: 160, width: 1100, bulbs: false })),
    );
    sub.position.set(0, 6.1, 0.3);
    root.add(sub);

    shadowed(root);
    this.bulbs.castShadow = false;
    ctx.scene.add(root);
  }

  update(_dt: number, t: number) {
    const on = Math.floor(t * 4) % 2;
    (this.bulbs.material as THREE.MeshBasicMaterial).color.setScalar(on ? 1 : 0.75);
  }
}

