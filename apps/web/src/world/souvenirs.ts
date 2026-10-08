// Souvenirs from the booth's shop, worn in the fair: a cap or a top hat, star shades, a balloon on a
// string, a foam finger. They aren't parented to the skeleton (its bones carry the model's own
// scale and axes); each frame they're placed from the bones' world positions instead.
//
// Head pieces are fitted to the wearer's actual head: once, while they stand upright, the posed
// meshes are measured (the eyes, the top of the skull and of the hair, the head's width and its
// front and back) in the wearer's own frame, and each piece is sized and placed from that.
import * as THREE from 'three';
import { std } from './context';
import type { PersonRig } from './crowd/people';
import { PALETTE } from './textures';

type Holder = 'head' | 'leftHand' | 'rightHand';

/** The wearer's head, measured in their own frame from the head bone: x right, y up, -z forward. */
interface Head {
  /** Top of the skull (under the hair) and of the hair. */
  skull: number;
  hair: number;
  /** Half the head's width above the eyes, and where its front and back are at the forehead. */
  half: number;
  front: number;
  back: number;
  /** The same, taking the hair in (what a cap has to cover). */
  hairHalf: number;
  hairFront: number;
  hairBack: number;
  /** The eyes: their height, the front of the eyeballs, and the distance between them. */
  eyeY: number;
  eyeFront: number;
  eyeGap: number;
}

interface Piece {
  id: string;
  holder: Holder;
  object: THREE.Object3D;
  /** Head pieces: sizes the piece to the head and says where it goes (in the wearer's frame). */
  fit?: (head: Head) => THREE.Vector3;
  offset?: THREE.Vector3;
  dispose: () => void;
}

const UP = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const yaw = new THREE.Quaternion();
const basis = new THREE.Matrix4();

/** Everything one person wears from the shop. */
export class Wardrobe {
  private pieces = new Map<string, Piece>();
  private head: Head | null = null;
  private shown = true;
  private balloon: { pos: THREE.Vector3; vel: THREE.Vector3 } | null = null;

  constructor(
    private rig: PersonRig,
    private scene: THREE.Scene,
  ) {}

  /** Wear exactly these (catalog ids); anything else comes off. */
  set(items: readonly string[]) {
    for (const [id, p] of this.pieces)
      if (!items.includes(id)) {
        this.scene.remove(p.object);
        p.dispose();
        this.pieces.delete(id);
      }
    for (const id of items) {
      if (this.pieces.has(id)) continue;
      const piece = build(id);
      if (!piece) continue;
      if (this.head && piece.fit) piece.offset = piece.fit(this.head);
      piece.object.visible = this.shown && (!piece.fit || !!piece.offset);
      this.scene.add(piece.object);
      this.pieces.set(id, piece);
      if (id === 'balloon') this.balloon = null;
    }
  }

  /** Show or hide everything (e.g. while the wearer is out of sight on a ride). */
  setVisible(on: boolean) {
    this.shown = on;
    for (const p of this.pieces.values()) p.object.visible = on && (!p.fit || !!p.offset);
  }

  update(dt: number) {
    if (!this.pieces.size) return;
    const root = this.rig.root;
    root.updateWorldMatrix(true, false);
    const headBone = this.rig.bone('Head');
    headBone.updateWorldMatrix(true, false);
    const headPos = headBone.getWorldPosition(new THREE.Vector3());
    root.getWorldQuaternion(yaw);

    // measure the head once, standing upright (not mid-roll); head pieces wait out of sight till then
    if (!this.head) {
      const feet = root.getWorldPosition(new THREE.Vector3());
      if (headPos.y - feet.y > this.rig.height * 0.8) {
        this.head = this.measure(headPos);
        if (this.head)
          for (const p of this.pieces.values())
            if (p.fit) {
              p.offset = p.fit(this.head);
              p.object.visible = this.shown;
            }
      }
    }

    for (const p of this.pieces.values()) {
      if (p.fit) {
        if (!p.offset) continue;
        p.object.position.copy(p.offset).applyQuaternion(yaw).add(headPos);
        p.object.quaternion.copy(yaw);
      } else if (p.id === 'balloon') this.updateBalloon(p, dt);
      else this.wearOnHand(p, 'r');
    }
  }

  /**
   * The head, measured from the posed meshes (skinning applied) in the wearer's frame around the
   * head bone. Null if the meshes don't give a sensible answer.
   */
  private measure(headPos: THREE.Vector3): Head | null {
    const inv = yaw.clone().invert();
    const body: THREE.Vector3[] = [];
    const hair: THREE.Vector3[] = [];
    const eyes: THREE.Vector3[] = [];
    for (const mesh of this.rig.skinnedMeshes) {
      const name = (mesh.material as THREE.Material).name;
      const kind = name.includes('Superhero') ? body : name === 'MI_Eyes' ? eyes : name.startsWith('MI_Hair') ? hair : null;
      if (!kind || !mesh.visible) continue;
      mesh.updateWorldMatrix(true, false);
      const n = mesh.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i++) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).sub(headPos).applyQuaternion(inv);
        // only around the head
        if (v.y < -0.12 || v.y > 0.4 || Math.abs(v.x) > 0.2 || Math.abs(v.z) > 0.2) continue;
        kind.push(v.clone());
      }
    }
    if (body.length < 50 || eyes.length < 10) return null;
    const eyeY = avg(eyes, 'y');
    const left = eyes.filter((e) => e.x < 0);
    const right = eyes.filter((e) => e.x >= 0);
    const eyeGap = left.length && right.length ? Math.abs(avg(right, 'x') - avg(left, 'x')) : 0.064;
    const eyeFront = Math.min(...eyes.map((e) => e.z));
    const skull = Math.max(...body.map((b) => b.y));
    const brow = body.filter((b) => b.y > eyeY + 0.02 && b.y < eyeY + 0.07);
    const band = brow.length ? brow : body;
    const front = Math.min(...band.map((b) => b.z));
    const back = Math.max(...band.map((b) => b.z));
    const half = Math.max(...band.map((b) => Math.abs(b.x)));
    const hairTop = hair.length ? Math.max(...hair.map((h) => h.y)) : skull;
    // the hair above the brow: how far it stands out round the head
    const crop = hair.filter((p) => p.y > eyeY + 0.03);
    const hairHalf = Math.max(half, ...crop.map((p) => Math.abs(p.x)));
    const hairFront = Math.min(front, ...crop.filter((p) => p.y > eyeY + 0.06).map((p) => p.z));
    const hairBack = Math.max(back, ...crop.map((p) => p.z));
    return { skull, hair: Math.max(skull, hairTop), half, front, back, hairHalf, hairFront, hairBack, eyeY, eyeFront, eyeGap };
  }

  /** Worn on the right hand like a glove: along the forearm, palm out of the fist. */
  private wearOnHand(p: Piece, side: 'l' | 'r') {
    const hand = this.rig.bone(side === 'r' ? 'hand_r' : 'hand_l').getWorldPosition(new THREE.Vector3());
    const elbow = this.rig.bone(side === 'r' ? 'lowerarm_r' : 'lowerarm_l').getWorldPosition(new THREE.Vector3());
    const along = hand.clone().sub(elbow).normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yaw);
    const face = forward.clone().addScaledVector(along, -forward.dot(along));
    if (face.lengthSq() < 1e-4) face.set(1, 0, 0).applyQuaternion(yaw);
    face.normalize();
    const across = new THREE.Vector3().crossVectors(along, face).normalize();
    basis.makeBasis(across, along, face);
    p.object.quaternion.setFromRotationMatrix(basis);
    p.object.position.copy(hand).addScaledVector(along, 0.02);
  }

  /** The balloon floats a string's length above the left hand, lagging behind and bobbing. */
  private updateBalloon(p: Piece, dt: number) {
    const handBone = this.rig.bone('hand_l').getWorldPosition(new THREE.Vector3());
    const elbow = this.rig.bone('lowerarm_l').getWorldPosition(new THREE.Vector3());
    // the string comes out of the fist
    const hand = handBone.clone().addScaledVector(handBone.clone().sub(elbow).normalize(), 0.07);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(yaw);
    const rest = hand.clone().addScaledVector(UP, 1.05).addScaledVector(back, 0.18);
    if (!this.balloon) this.balloon = { pos: rest.clone(), vel: new THREE.Vector3() };
    const b = this.balloon;
    const k = Math.min(dt, 1 / 20);
    // a soft spring towards its spot, with drag: it trails when you run
    b.vel.addScaledVector(rest.clone().sub(b.pos).multiplyScalar(12), k).multiplyScalar(Math.exp(-k * 3.2));
    b.pos.addScaledVector(b.vel, k);
    // never further than the string allows
    const d = b.pos.distanceTo(hand);
    if (d > 1.12) b.pos.sub(hand).multiplyScalar(1.12 / d).add(hand);
    const group = p.object as THREE.Group;
    const ball = group.getObjectByName('ball')!;
    const line = group.getObjectByName('string') as THREE.Line;
    ball.position.copy(b.pos);
    // it leans the way it's pulled
    ball.quaternion.setFromUnitVectors(UP, b.pos.clone().sub(hand).normalize());
    const pts = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const knot = b.pos.clone().addScaledVector(b.pos.clone().sub(hand).normalize(), -0.2);
    pts.setXYZ(0, hand.x, hand.y, hand.z);
    pts.setXYZ(1, knot.x, knot.y, knot.z);
    pts.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  dispose() {
    this.set([]);
  }
}

function avg(list: THREE.Vector3[], axis: 'x' | 'y' | 'z') {
  return list.reduce((s, p) => s + p[axis], 0) / list.length;
}

// ---------- The pieces ----------

function build(id: string): Piece | null {
  const parts: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    parts.push(g);
    if (!mats.includes(m)) mats.push(m);
    const x = new THREE.Mesh(g, m);
    x.castShadow = true;
    return x;
  };
  const dispose = () => {
    parts.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  };
  const g = new THREE.Group();

  switch (id) {
    case 'cap': {
      // a baseball cap: six-panel crown, a curved brim out over the face, a button on top
      const red = std('#c8302a', { roughness: 0.82 });
      const cream = std(PALETTE.cream, { roughness: 0.8 });
      const crown = mesh(crownGeometry(), red);
      const band = mesh(new THREE.CylinderGeometry(1, 1, 0.12, 32, 1, true), red);
      band.position.y = -0.06;
      const brim = mesh(brimGeometry(), cream);
      const button = mesh(new THREE.SphereGeometry(0.09, 12, 8), red);
      g.add(crown, band, brim, button);
      return {
        id,
        holder: 'head',
        object: g,
        dispose,
        fit: (h) => {
          // sits over the hair (flattening it a little), round the widest part, down to the brow
          const rx = Math.max(h.half + 0.014, h.hairHalf + 0.004);
          const front = Math.min(h.front - 0.012, h.hairFront - 0.004);
          const back = Math.max(h.back + 0.012, h.hairBack + 0.004);
          const rz = (back - front) / 2;
          const rim = h.eyeY + 0.052;
          const ry = Math.max(0.06, h.hair + 0.008 - rim);
          crown.scale.set(rx, ry, rz);
          // the sweatband: from the crown's edge down to the brow
          band.scale.set(rx, ry, rz);
          band.position.y = -0.06 * ry;
          // the brim: thin, out over the face, tipped down a touch
          brim.scale.set(rx, rx, rz);
          brim.position.set(0, -ry * 0.06, -rz * 0.55);
          brim.rotation.x = 0.16;
          button.position.set(0, ry, 0);
          button.scale.setScalar(Math.max(rx, rz) * 0.9);
          return new THREE.Vector3(0, rim + ry * 0.1, (front + back) / 2);
        },
      };
    }
    case 'top-hat': {
      const silk = std('#141018', { roughness: 0.32, metalness: 0.08 });
      const ribbon = std('#b3122a', { roughness: 0.55 });
      const brim = mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.09, 40), silk);
      const crown = mesh(new THREE.CylinderGeometry(0.98, 1, 1.75, 40), silk);
      crown.position.y = 0.9;
      const top = mesh(new THREE.CircleGeometry(0.98, 40).rotateX(-Math.PI / 2), silk);
      top.position.y = 1.775;
      const band = mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.3, 40, 1, true), ribbon);
      band.position.y = 0.2;
      g.add(brim, crown, top, band);
      return {
        id,
        holder: 'head',
        object: g,
        dispose,
        fit: (h) => {
          // the crown's opening fits round the head; it sits down on the hair, level
          const r = Math.max(h.hairHalf, (h.hairBack - h.hairFront) / 2) * 0.97 + 0.004;
          g.scale.set(r, r * 0.98, r * ((h.back - h.front) / 2 + 0.008) / r);
          return new THREE.Vector3(0, h.hair - 0.045, (h.front + h.back) / 2);
        },
      };
    }
    case 'shades': {
      const gold = std(PALETTE.mustard, { roughness: 0.28, metalness: 0.75 });
      const glass = new THREE.MeshPhysicalMaterial({ color: '#2a1a40', roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 });
      const lenses: THREE.Object3D[] = [];
      for (const side of [-1, 1]) {
        const lens = new THREE.Group();
        const frame = mesh(new THREE.ExtrudeGeometry(star(1, 0.48), { depth: 0.12, bevelEnabled: false }), gold);
        frame.position.z = -0.06;
        const pane = mesh(new THREE.ShapeGeometry(star(0.8, 0.38)), glass);
        pane.position.z = 0.07;
        lens.add(frame, pane);
        lens.userData.side = side;
        lenses.push(lens);
        g.add(lens);
      }
      const bridge = mesh(new THREE.BoxGeometry(1, 0.12, 0.12), gold);
      const arms = [-1, 1].map((side) => {
        const arm = mesh(new THREE.BoxGeometry(0.1, 0.1, 1), gold);
        arm.userData.side = side;
        g.add(arm);
        return arm;
      });
      g.add(bridge);
      return {
        id,
        holder: 'head',
        object: g,
        dispose,
        fit: (h) => {
          // one star over each eye, just in front of them, with arms back to the ears
          const r = h.eyeGap * 0.62;
          for (const lens of lenses) {
            lens.scale.setScalar(r);
            lens.position.set((lens.userData.side * h.eyeGap) / 2, 0, 0);
            // the stars face out of the face: the wearer's -z
            lens.rotation.y = Math.PI;
          }
          bridge.scale.set(h.eyeGap * 0.3, r * 0.9, r * 0.9);
          const depth = h.back - h.eyeFront - 0.04;
          for (const arm of arms) {
            arm.scale.set(r * 0.9, r * 0.9, depth);
            arm.position.set(arm.userData.side * (h.half + 0.004), r * 0.15, depth / 2);
          }
          return new THREE.Vector3(0, h.eyeY + 0.002, h.eyeFront - 0.016);
        },
      };
    }
    case 'balloon': {
      const latex = new THREE.MeshPhysicalMaterial({ color: '#d81e34', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color('#ff8a9a') });
      // a real balloon: rounder at the top, narrowing to the knot
      const ball = mesh(balloonGeometry(0.15), latex);
      ball.name = 'ball';
      const stringGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const stringMat = new THREE.LineBasicMaterial({ color: '#efe9de' });
      parts.push(stringGeo);
      mats.push(stringMat);
      const string = new THREE.Line(stringGeo, stringMat);
      string.name = 'string';
      string.frustumCulled = false;
      g.add(ball, string);
      return { id, holder: 'leftHand', object: g, dispose };
    }
    case 'foam-finger': {
      // a foam hand worn over the fist: the cuff round the wrist, the finger pointing on along the arm
      const foam = std('#f2b51f', { roughness: 0.92 });
      const cuffMat = std('#c9302c', { roughness: 0.85 });
      const cuff = mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.07, 20), cuffMat);
      cuff.position.y = -0.005;
      const palm = mesh(new THREE.CapsuleGeometry(0.055, 0.07, 6, 16), foam);
      palm.scale.set(1.15, 1, 0.62);
      palm.position.y = 0.09;
      const finger = mesh(new THREE.CapsuleGeometry(0.026, 0.15, 6, 12), foam);
      finger.position.set(0.025, 0.24, 0);
      const knuckles = mesh(new THREE.CapsuleGeometry(0.03, 0.06, 6, 12), foam);
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(-0.012, 0.155, 0.006);
      const thumb = mesh(new THREE.CapsuleGeometry(0.022, 0.05, 6, 10), foam);
      thumb.position.set(-0.07, 0.11, 0);
      thumb.rotation.z = 0.7;
      g.add(cuff, palm, finger, knuckles, thumb);
      return { id, holder: 'rightHand', object: g, dispose };
    }
  }
  return null;
}

/** A cap's crown, unit size: full at the sides and gently domed on top (not a hemisphere), so it covers hair. */
function crownGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const y = i / 16;
    // a superellipse profile: (x^3 + y^3 = 1)
    pts.push(new THREE.Vector2(Math.max(0.0001, Math.cbrt(1 - y ** 3)), y));
  }
  return new THREE.LatheGeometry(pts, 32);
}

/** A cap's brim: a flat, slightly curved half-disc reaching out over the face (-z), unit radius. */
function brimGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, 0.45);
  shape.quadraticCurveTo(-0.98, -0.55, 0, -1.05);
  shape.quadraticCurveTo(0.98, -0.55, 0.95, 0.45);
  shape.quadraticCurveTo(0, -0.1, -0.95, 0.45);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16 });
  // lie it flat (the shape was drawn in x/y), then curve it down at the sides
  geo.rotateX(Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - 0.18 * pos.getX(i) ** 2);
  geo.computeVertexNormals();
  return geo;
}

/** A balloon of radius `r`: a sphere pulled into a teardrop at the bottom, with a little knot. */
function balloonGeometry(r: number) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI;
    // wider and rounder at the top, tapering smoothly towards the neck (no crease at the middle)
    const taper = ((1 + Math.cos(a)) / 2) ** 2;
    const w = Math.sin(a) * (1 - 0.2 * taper);
    pts.push(new THREE.Vector2(Math.max(0.0001, w * r), -Math.cos(a) * r * 1.18));
  }
  pts.push(new THREE.Vector2(r * 0.12, -r * 1.3), new THREE.Vector2(r * 0.16, -r * 1.36), new THREE.Vector2(0.0001, -r * 1.38));
  return new THREE.LatheGeometry(pts, 28);
}

/** A five-pointed star, flat in x/y, with outer radius `outer`. */
function star(outer: number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}
