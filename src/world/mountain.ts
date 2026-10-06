import * as THREE from 'three';
import type { Ctx } from './context';
import { FALCON_TRACK, nearTrack } from './rides';
import { mulberry } from './random';
import { hdr, PALETTE, signMaterial, signTexture } from './textures';

// Terrain window (outside the park, north-east): x, z bounds and grid spacing in metres.
const X0 = -110;
const X1 = 340;
const Z0 = -680;
const Z1 = -96;
const STEP = 2.5;
const NX = Math.round((X1 - X0) / STEP);
const NZ = Math.round((Z1 - Z0) / STEP);

/** Smooth value noise (deterministic). */
function makeNoise(seed: number) {
  const rnd = mulberry(seed);
  const N = 256;
  const g = Float32Array.from({ length: N * N }, rnd);
  const at = (i: number, j: number) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/**
 * The escarpment the Sky Falcon climbs and dives off: a table mountain (mesa) with a sheer
 * sandstone wall right behind the drop, and a ramp-like spur carrying the LSM climb. The
 * heightfield is derived from the track, so the climb and plateau rest on the rock, the drop
 * plunges out in front of the cliff face, and all other track is guaranteed to clear it.
 */
export class Mountain {
  private heights: Float32Array;

  constructor(ctx: Ctx) {
    const d = FALCON_TRACK;
    const n = d.pos.length;
    const firstLift = d.zone.indexOf('lift');
    const edgeIdx = d.zone.lastIndexOf('brake', d.zone.indexOf('boost')); // end of the plateau trim brakes
    const lastMountain = d.zone.indexOf('boost');
    const rail = (i: number) => d.pos[i].y - d.up[i].y;

    // the cliff edge: a plane through the edge point, facing the direction of the drop
    const edgeP = d.pos[edgeIdx].clone();
    const dropDir = new THREE.Vector2(d.tan[edgeIdx].x, d.tan[edgeIdx].z).normalize();
    const top = rail(edgeIdx);

    // plateau samples define the mesa's centre; climb samples form the spur
    const plateau: THREE.Vector2[] = [];
    const climb: { x: number; z: number; h: number }[] = [];
    for (let i = firstLift; i <= edgeIdx; i += 6) {
      const r = rail(i);
      if (r > top - 3) plateau.push(new THREE.Vector2(d.pos[i].x, d.pos[i].z));
      climb.push({ x: d.pos[i].x, z: d.pos[i].z, h: r - 1.3 });
    }
    const mesaC = plateau.reduce((a, b) => a.add(b), new THREE.Vector2()).divideScalar(plateau.length);
    // everything after the edge (and before the climb) must clear the rock
    const clear: { x: number; z: number; h: number }[] = [];
    for (let i = 0; i < n; i += 3) {
      if (i >= firstLift && i <= edgeIdx) continue;
      const p = d.pos[i];
      if (p.x < X0 - 10 || p.x > X1 + 10 || p.z < Z0 - 10 || p.z > Z1 + 10) continue;
      clear.push({ x: p.x, z: p.z, h: rail(i) - (i < lastMountain && i > edgeIdx ? 2.5 : 3) });
    }

    const noise = makeNoise(17);
    const noise2 = makeNoise(29);
    this.heights = new Float32Array((NX + 1) * (NZ + 1));
    for (let j = 0; j <= NZ; j++)
      for (let i = 0; i <= NX; i++) {
        const x = X0 + i * STEP;
        const z = Z0 + j * STEP;
        const base = Math.abs(x) < 131 && z > -131 ? -2 : 0.08; // under the park's ground / desert floor
        // ---- mesa: flat top, steep flanks, a sheer wall along the edge plane ----
        const wob = (noise(x * 0.012, z * 0.012) - 0.5) * 70;
        const dc = Math.hypot(x - mesaC.x, z - mesaC.y) + wob;
        const planeDist = (x - edgeP.x) * dropDir.x + (z - edgeP.z) * dropDir.y + (noise2(x * 0.03, z * 0.03) - 0.5) * 10;
        let mesa = top - 1.3 - 2.4 * Math.max(0, dc - 150);
        mesa = Math.min(mesa, top - 1.3 - 4.5 * Math.max(0, planeDist));
        // talus apron at the foot of the walls
        const apron = top * 0.22 * (1 - THREE.MathUtils.smoothstep(Math.max(dc - 150, planeDist), 0, 90));
        let h = Math.max(base, mesa, apron);
        // ---- the spur under the LSM climb ----
        for (const c of climb) {
          const dd = Math.hypot(x - c.x, z - c.z);
          // a knife-edge ridge whose flanks wobble, so it reads as rock rather than a ramp
          const flank = 1.7 + (noise(c.x * 0.05 + x * 0.02, c.z * 0.05 + z * 0.02) - 0.5) * 1.2;
          if (dd < 120) h = Math.max(h, c.h - flank * Math.max(0, dd - 5));
        }
        // ---- erosion: gullies and ledges, strongest on high ground ----
        if (h > 3) {
          const ridge = Math.abs(noise2(x * 0.04, z * 0.04) * 2 - 1);
          h -= ridge * Math.min(14, h * 0.1);
          h += (noise(x * 0.15, z * 0.15) - 0.5) * 1.6;
        }
        // ---- the ride always wins: climb/plateau sit in a shallow cutting, the rest clears ----
        for (const c of climb) {
          const dd = Math.hypot(x - c.x, z - c.z);
          if (dd < 30) h = Math.min(h, c.h + Math.max(0, dd - 2.6) * 1.6);
        }
        for (const c of clear) {
          const dd = Math.hypot(x - c.x, z - c.z);
          if (dd < 26) h = Math.min(h, c.h + Math.max(0, dd - 3.5) * 1.5);
        }
        // fade into the desert floor at the window's edges
        const edge = Math.min(x - X0, X1 - x, z - Z0, Z1 - z);
        h = base + (h - base) * THREE.MathUtils.smoothstep(edge, 0, 30);
        this.heights[j * (NX + 1) + i] = Math.max(-2, h);
      }

    // ---- mesh: strata are painted in the shader from world height (crisp on sheer walls) ----
    const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, NX, NZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // after rotateX(-90°) the plane's rows run from z = Z0 to Z1, matching the heightfield layout
    for (let v = 0; v < pos.count; v++) pos.setY(v, this.heights[v]);
    geo.computeVertexNormals();
    // per-vertex blend weights: r = desert sand, g = green (park side), b = speckle
    const w: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const dcM = Math.hypot(x - mesaC.x, z - mesaC.y);
      const edge = Math.min(x - X0, X1 - x, z - Z0, Z1 - z);
      // desert around the mesa, fading back to grassland toward the park and the window edges
      const green = Math.max(THREE.MathUtils.smoothstep(dcM, 200, 290), 1 - THREE.MathUtils.smoothstep(edge, 0, 40));
      w.push(1, green, noise2(x * 0.35, z * 0.35));
    }
    geo.setAttribute('aW', new THREE.Float32BufferAttribute(w, 3));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, color: '#ffffff' });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aW;\nvarying vec3 vW;\nvarying vec3 vWorld;\nvarying vec3 vWN;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvW = aW;\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW;\nvarying vec3 vWorld;\nvarying vec3 vWN;')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          {
            vec3 bands[6];
            bands[0] = vec3(0.79, 0.53, 0.31);
            bands[1] = vec3(0.85, 0.64, 0.42);
            bands[2] = vec3(0.72, 0.44, 0.25);
            bands[3] = vec3(0.89, 0.71, 0.49);
            bands[4] = vec3(0.66, 0.38, 0.23);
            bands[5] = vec3(0.82, 0.58, 0.35);
            float y = vWorld.y + sin(vWorld.x * 0.045) * 2.2 + sin(vWorld.z * 0.038 + 1.3) * 2.2;
            float layer = y / 6.5;
            float f = fract(layer);
            int i0 = int(mod(floor(layer), 6.0));
            int i1 = int(mod(floor(layer) + 1.0, 6.0));
            vec3 strata = mix(bands[i0], bands[i1], smoothstep(0.82, 1.0, f));
            strata *= 1.0 - 0.18 * smoothstep(0.93, 1.0, f); // thin dark bedding lines
            float flat_ = smoothstep(0.82, 0.96, vWN.y);
            vec3 sand = vec3(0.89, 0.75, 0.55);
            vec3 col = mix(strata, sand, flat_ * 0.8);
            col = mix(col, vec3(0.36, 0.48, 0.27), vW.g * 0.85);
            col *= 0.9 + vW.b * 0.2;
            diffuseColor.rgb = col;
          }`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    ctx.scene.add(mesh);

    // giant sign on the plateau, beside the edge, facing the park
    // on the plateau, set back from the rim, somewhere no track passes within 55 m
    let sx = edgeP.x - dropDir.x * 70;
    let sz = edgeP.z - dropDir.y * 70;
    search: for (let r = 55; r <= 200; r += 10)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const cx = edgeP.x + Math.cos(a) * r;
        const cz = edgeP.z + Math.sin(a) * r;
        if (!nearTrack(cx, cz, 55, Infinity, 'falcon') && this.sample(cx, cz) > top - 12) {
          sx = cx;
          sz = cz;
          break search;
        }
      }
    const sign = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 16),
      signMaterial(signTexture('SKY FALCON', { sub: '3.2 km · 188 m cliff drop · 500 km/h · ride it from the east gate', border: PALETTE.mustard, width: 1536, height: 384 }), {
        emissiveIntensity: 2.4,
      }),
    );
    const back = new THREE.Mesh(new THREE.BoxGeometry(65, 17, 0.8), new THREE.MeshStandardMaterial({ color: '#3a2f4a', roughness: 0.6 }));
    back.position.z = -0.45;
    sign.add(board, back);
    for (const lx of [-24, 0, 24]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 22, 1.2), new THREE.MeshStandardMaterial({ color: '#3a2f4a', metalness: 0.5, roughness: 0.5 }));
      leg.position.set(lx, -14, -1);
      sign.add(leg);
    }
    sign.position.set(sx, this.sample(sx, sz) + 22, sz);
    sign.lookAt(sx + dropDir.x * 100, sign.position.y, sz + dropDir.y * 100);
    ctx.scene.add(sign);
    // aircraft warning beacon on the rim
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 10), new THREE.MeshBasicMaterial({ color: hdr('#ff3b3b', 10) }));
    beacon.position.set(edgeP.x + 18, top + 16, edgeP.z - 12);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 16), new THREE.MeshStandardMaterial({ color: '#3a2f4a' }));
    mast.position.set(edgeP.x + 18, top + 8, edgeP.z - 12);
    ctx.scene.add(beacon, mast);
  }

  /** Terrain height at (x, z); 0 outside the mountain window. */
  sample(x: number, z: number) {
    const fx = (x - X0) / STEP;
    const fz = (z - Z0) / STEP;
    if (fx < 0 || fz < 0 || fx > NX || fz > NZ) return 0;
    const i = Math.min(NX - 1, Math.floor(fx));
    const j = Math.min(NZ - 1, Math.floor(fz));
    const u = fx - i;
    const v = fz - j;
    const W = NX + 1;
    const h = this.heights;
    const a = h[j * W + i] + (h[j * W + i + 1] - h[j * W + i]) * u;
    const b = h[(j + 1) * W + i] + (h[(j + 1) * W + i + 1] - h[(j + 1) * W + i]) * u;
    return Math.max(0, a + (b - a) * v);
  }
}
