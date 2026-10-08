// Shoes for the park's people. The base bodies come barefoot (the shoe colour was only painted on,
// toes and all), so each body gets a pair of trainers built around its own feet: the foot is cut
// into slices from heel to toe, each slice is wrapped in a rounded section a little wider and
// taller than the foot, and the toe and heel are rounded off. Every shoe vertex borrows the skin
// weights of the nearest foot vertex, so the shoe bends with the foot exactly.
import * as THREE from 'three';

/** Sections along the foot, and points around each section. */
const SLICES = 26;
const AROUND = 24;
/** How far the shoe stands off the foot: the foot never shows through. */
const MARGIN = 0.009;
/** The sole: this thick, pale, and a touch wider than the upper. */
const SOLE = 0.028;
/** Rounded-box sections (2 = ellipse, higher = squarer). */
const SQUARE = 3.2;

interface Section {
  z: number;
  cx: number;
  half: number;
  lo: number;
  hi: number;
}

/**
 * A pair of trainers for one body, as a skinned geometry over that body's skeleton (vertex colours:
 * white upper, which the material tints, and a pale sole). `isFoot(i)` tells the shoe's vertices.
 */
export function buildShoes(body: THREE.SkinnedMesh, isFoot: (i: number) => boolean): THREE.BufferGeometry {
  const g = body.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const feet: [number[], number[]] = [[], []];
  for (let i = 0; i < pos.count; i++) if (isFoot(i)) feet[pos.getX(i) > 0 ? 0 : 1].push(i);

  const P: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  const SI: number[] = [];
  const SW: number[] = [];
  const SOLES: number[] = [];
  for (const verts of feet) if (verts.length > 20) buildOne(verts);

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  out.setAttribute('aSole', new THREE.Float32BufferAttribute(SOLES, 1));
  out.setIndex(I);
  out.computeVertexNormals();
  return out;

  function buildOne(verts: number[]) {
    let zMin = Infinity;
    let zMax = -Infinity;
    let ground = Infinity;
    for (const i of verts) {
      zMin = Math.min(zMin, pos.getZ(i));
      zMax = Math.max(zMax, pos.getZ(i));
      ground = Math.min(ground, pos.getY(i));
    }
    // the foot's outline, slice by slice
    const step = (zMax - zMin) / SLICES;
    const raw: Section[] = [];
    for (let s = 0; s <= SLICES; s++) {
      const z = zMin + s * step;
      let x0 = Infinity;
      let x1 = -Infinity;
      let hi = -Infinity;
      for (const i of verts) {
        if (Math.abs(pos.getZ(i) - z) > step * 1.2) continue;
        x0 = Math.min(x0, pos.getX(i));
        x1 = Math.max(x1, pos.getX(i));
        hi = Math.max(hi, pos.getY(i));
      }
      if (x0 === Infinity) continue;
      raw.push({ z, cx: (x0 + x1) / 2, half: (x1 - x0) / 2, lo: ground, hi });
    }
    // smooth the outline right out (no toe-by-toe bumps), but never inside the foot: each slice
    // first takes the largest of its neighbours, then the result is blurred
    const soft = (get: (r: Section) => number, grow: boolean) => {
      let v = raw.map(get);
      if (grow) v = v.map((_, k) => Math.max(...v.slice(Math.max(0, k - 2), k + 3)));
      for (let pass = 0; pass < 2; pass++)
        v = v.map((_, k) => {
          let sum = 0;
          let n = 0;
          for (let d = -1; d <= 1; d++) {
            sum += v[Math.min(v.length - 1, Math.max(0, k + d))];
            n++;
          }
          return sum / n;
        });
      return v;
    };
    const cxs = soft((r) => r.cx, false);
    const halves = soft((r) => r.half, true);
    const his = soft((r) => r.hi, true);
    const len = zMax - zMin;
    // a trainer's top line: the heel collar, down over the laces to a low, rounded toe box
    const collar = ground + Math.min(0.105, Math.max(...raw.map((r) => r.hi)) - ground + 0.01);
    const toeBox = ground + Math.max(0.05, len * 0.21);
    const sections = raw.map((r, k) => {
      const t = raw.length > 1 ? k / (raw.length - 1) : 0;
      const profile = collar + (toeBox - collar) * THREE.MathUtils.smoothstep(t, 0.28, 0.82);
      return { z: r.z, cx: cxs[k], half: Math.max(halves[k], len * 0.16) + MARGIN, lo: ground - 0.004, hi: Math.max(profile, his[k] + MARGIN) };
    });
    // round off the toe and the heel with shrinking sections beyond the ends
    const cap = (end: Section, dir: number) =>
      [0.35, 0.65, 0.85, 0.97].map((s) => {
        const k = Math.sqrt(1 - s * s);
        return { z: end.z + dir * (MARGIN * 1.4 + s * 0.035), cx: end.cx, half: end.half * (0.35 + 0.65 * k), lo: end.lo, hi: end.lo + (end.hi - end.lo) * (0.45 + 0.55 * k) };
      });
    const all = [...cap(sections[0], -1).reverse(), ...sections, ...cap(sections[sections.length - 1], 1)];

    const base = P.length / 3;
    for (const sec of all) {
      const cy = (sec.lo + sec.hi) / 2;
      const b = (sec.hi - sec.lo) / 2;
      for (let a = 0; a < AROUND; a++) {
        const th = (a / AROUND) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const sx = Math.sign(c) * Math.abs(c) ** (2 / SQUARE);
        const sy = Math.sign(s) * Math.abs(s) ** (2 / SQUARE);
        let y = cy + b * sy;
        let x = sec.cx + sec.half * sx;
        // a flat sole, slightly wider than the upper
        const sole = y < sec.lo + SOLE;
        if (y < sec.lo) y = sec.lo;
        if (sole) x = sec.cx + (sec.half + 0.003) * sx;
        P.push(x, y, sec.z);
        // where along the shoe (0 heel … 1 toe; the caps beyond) and how high round its section
        const t = (sec.z - zMin) / (zMax - zMin);
        let shade = 1;
        if (sole) shade = -1;
        else if (y < sec.lo + SOLE + 0.006) shade = 0.62; // the line where the upper meets the sole
        else if (sy > 0.72 && t > 0.3 && t < 0.72) shade = 0.8; // the lace panel
        else if (t < 0.1 && sy > 0.35) shade = 0.72; // the heel tab
        else if (t > 0.88 && sy > 0.1) shade = 0.9; // the toe cap
        C.push(...(shade < 0 ? [1, 1, 1] : [shade, shade, shade]));
        SOLES.push(shade < 0 ? 1 : 0);
        // the nearest bit of foot moves this bit of shoe
        let best = verts[0];
        let bd = Infinity;
        for (const i of verts) {
          const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - sec.z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        SI.push(si.getX(best), si.getY(best), si.getZ(best), si.getW(best));
        SW.push(sw.getX(best), sw.getY(best), sw.getZ(best), sw.getW(best));
      }
    }
    // stitch the sections into a tube, and close both ends
    for (let r = 0; r < all.length - 1; r++)
      for (let a = 0; a < AROUND; a++) {
        const i0 = base + r * AROUND + a;
        const i1 = base + r * AROUND + ((a + 1) % AROUND);
        const j0 = i0 + AROUND;
        const j1 = i1 + AROUND;
        // counter-clockwise seen from outside: around (θ) then along (z) faces out
        I.push(i0, i1, j0, i1, j1, j0);
      }
    for (const [r, flip] of [
      [0, true],
      [all.length - 1, false],
    ] as const) {
      const ring = base + r * AROUND;
      for (let a = 1; a < AROUND - 1; a++) I.push(...(flip ? [ring, ring + a + 1, ring + a] : [ring, ring + a, ring + a + 1]));
    }
  }
}

/** A trainer in `color`; whatever the colour, its sole stays pale rubber. */
export function shoeMaterial(color: THREE.Color) {
  const mat = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.62 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSole;
        varying float vSole;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSole = aSole;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSole;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.88, 0.84), vSole);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, vSole);`);
  };
  mat.customProgramCacheKey = () => 'guest-shoe';
  return mat;
}
