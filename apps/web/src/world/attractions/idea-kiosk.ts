import * as THREE from 'three';
import { shadowed, staticBox, std, type Attraction, type Ctx } from '../context';
import { LAYOUT } from '../layout';
import { hdr, PALETTE, signMaterial, signTexture, stripeTexture } from '../textures';

/** The kiosk is built facing +z, then turned so its slot faces east, across the entrance plaza. */
const YAW = Math.PI / 2;
/** Where the letter slot is, in the kiosk's own frame. */
const SLOT = new THREE.Vector3(0, 1.6, 0.34);
/** Where a posted envelope starts: in the visitor's hand, in front of the slot. */
const HAND = new THREE.Vector3(0.12, 1.4, 1.15);
const POST_S = 0.85;

/** (x, z) in the kiosk's own frame, out in the fair. */
export function ideaKioskPoint(lx: number, lz: number) {
  const c = Math.cos(YAW);
  const s = Math.sin(YAW);
  return { x: LAYOUT.ideas.x + lx * c + lz * s, z: LAYOUT.ideas.z - lx * s + lz * c };
}

/**
 * The Idea Box: a post box on a little cabinet, a corkboard of other visitors' notes behind it, a
 * marquee sign and a giant light bulb on top that glows. A suggestion sent from it (world/ideas.ts)
 * flies into the slot as an envelope, and the bulb lights up.
 */
export class IdeaKiosk implements Attraction {
  readonly root = new THREE.Group();
  private bulb: THREE.Group;
  private glass: THREE.MeshStandardMaterial;
  private envelope: THREE.Mesh;
  private posting = -1;
  private flash = 0;

  constructor(ctx: Ctx) {
    const root = this.root;
    root.position.set(LAYOUT.ideas.x, 0, LAYOUT.ideas.z);
    root.rotation.y = YAW;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      root.add(b);
      return b;
    };
    const violet = std(PALETTE.violet, { roughness: 0.6 });
    const trim = std(PALETTE.mustard, { roughness: 0.35, metalness: 0.4 });
    const red = std('#d8263f', { roughness: 0.35, metalness: 0.15 });
    const iron = std('#2c2433', { metalness: 0.75, roughness: 0.35 });

    // the cabinet on its plinth, with a gold band round the top
    box(1.9, 0.12, 1.3, 0, 0.06, 0.1, std('#b98a5a', { roughness: 0.8 }));
    box(1.5, 1.15, 0.8, 0, 0.695, 0, violet);
    box(1.54, 0.1, 0.84, 0, 1.22, 0, trim);
    // a cream panel on the front with a big question mark
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), std('#ffffff', { map: questionTexture(), roughness: 0.7 }));
    panel.position.set(0, 0.68, 0.402);
    root.add(panel);

    // the post box: a red body, a rounded lid, and a brass plate round the slot
    box(0.9, 0.5, 0.55, 0, 1.52, 0.05, red);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.9, 24, 1, false, 0, Math.PI), red);
    lid.rotation.z = Math.PI / 2;
    lid.position.set(0, 1.77, 0.05);
    root.add(lid);
    box(0.62, 0.16, 0.02, SLOT.x, SLOT.y, SLOT.z - 0.008, trim);
    box(0.5, 0.045, 0.02, SLOT.x, SLOT.y, SLOT.z + 0.004, std('#120a1c', { roughness: 1 }));

    // behind it: two posts holding a corkboard of notes and the sign
    for (const x of [-0.85, 0.85]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.5, 10), iron);
      post.position.set(x, 1.75, -0.45);
      root.add(post);
    }
    box(1.6, 0.95, 0.05, 0, 2.3, -0.45, std('#c89b6d', { roughness: 1 }));
    this.pinNotes(root);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 0.75),
      signMaterial(signTexture('IDEA BOX', { sub: 'Tell the Ringmaster', border: PALETTE.violet })),
    );
    sign.position.set(0, 3.2, -0.41);
    root.add(sign);
    box(2.2, 0.08, 0.55, 0, 3.62, -0.3, std('#ffffff', { map: stripeTexture(PALETTE.violet, PALETTE.cream, 10) }));

    // the bright idea: a giant light bulb on top
    this.bulb = new THREE.Group();
    this.glass = new THREE.MeshStandardMaterial({ color: '#fff4c9', emissive: hdr('#ffd36b', 1), emissiveIntensity: 1.4, roughness: 0.15 });
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 18), this.glass);
    glass.scale.set(1, 1.08, 1);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.26, 18), this.glass);
    neck.position.y = -0.4;
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.24, 18), std('#bfc3cc', { metalness: 0.9, roughness: 0.3 }));
    screw.position.y = -0.62;
    for (let i = 0; i < 3; i++) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 18), std('#9aa0ab', { metalness: 0.9, roughness: 0.3 }));
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = -0.54 - i * 0.07;
      this.bulb.add(ridge);
    }
    this.bulb.add(glass, neck, screw);
    this.bulb.position.set(0, 4.55, -0.3);
    root.add(this.bulb);

    // the envelope a visitor posts (hidden until then)
    this.envelope = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.012), std('#fffaf0', { map: envelopeTexture(), roughness: 0.8 }));
    this.envelope.visible = false;
    root.add(this.envelope);

    shadowed(root, true);
    glass.castShadow = false;
    ctx.scene.add(root);
    staticBox(ctx, LAYOUT.ideas.x, 1, LAYOUT.ideas.z, 0.95, 1, 0.68, YAW);
  }

  /** A suggestion was sent: an envelope flies from the visitor's hand into the slot, and the bulb lights up. */
  post() {
    this.posting = 0;
    this.envelope.visible = true;
  }

  update(dt: number, t: number) {
    this.bulb.position.y = 4.55 + Math.sin(t * 1.6) * 0.08;
    this.bulb.rotation.y = Math.sin(t * 0.7) * 0.4;
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.glass.emissiveIntensity = 1.3 + Math.sin(t * 3.1) * 0.25 + this.flash * 6;
    if (this.posting < 0) return;
    this.posting += dt / POST_S;
    const k = Math.min(1, this.posting);
    const e = this.envelope;
    // an arc from the hand into the slot, turning flat to slide in
    e.position.lerpVectors(HAND, SLOT, k);
    e.position.y += Math.sin(k * Math.PI) * 0.35;
    e.rotation.set(0, 0, (1 - k) * 0.5);
    e.scale.setScalar(k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1);
    if (k >= 1) {
      e.visible = false;
      this.posting = -1;
      this.flash = 1;
    }
  }

  private pinNotes(root: THREE.Group) {
    const colors = ['#fff3a8', '#ffd1dc', '#c8f0e0', '#cfe0ff', '#ffe0b8', '#e6dcff', '#fff3a8'];
    const spots: [number, number][] = [[-0.55, 2.55], [-0.15, 2.6], [0.3, 2.52], [0.6, 2.25], [-0.4, 2.1], [0.05, 2.15], [0.42, 1.98]];
    const pin = std('#d8263f', { roughness: 0.3 });
    spots.forEach(([x, y], i) => {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.24), std(colors[i % colors.length], { map: scribbleTexture(i), roughness: 0.95 }));
      note.position.set(x, y, -0.422);
      note.rotation.z = Math.sin(i * 2.3) * 0.18;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), pin);
      head.position.set(x, y + 0.08, -0.405);
      root.add(note, head);
    });
  }
}

/** The cabinet's front: a big friendly question mark on cream. */
function questionTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = PALETTE.cream;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = PALETTE.mustard;
  g.lineWidth = 8;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = PALETTE.violet;
  g.font = '700 118px "Lilita One", "Arial Rounded MT Bold", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A few lines of "handwriting" on a note, different for each. */
function scribbleTexture(seed: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(40, 30, 80, 0.55)';
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  for (let line = 0; line < 4; line++) {
    const y = 16 + line * 11;
    const end = 50 - ((seed * 7 + line * 13) % 22);
    g.beginPath();
    g.moveTo(10, y);
    for (let x = 10; x < end; x += 4) g.lineTo(x, y + Math.sin(x * 0.7 + seed + line) * 1.6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An envelope's flap, drawn on its face. */
function envelopeTexture() {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, 96, 64);
  g.strokeStyle = 'rgba(123, 92, 214, 0.7)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(3, 3);
  g.lineTo(48, 36);
  g.lineTo(93, 3);
  g.stroke();
  g.fillStyle = PALETTE.candy;
  g.beginPath();
  g.arc(48, 36, 6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
