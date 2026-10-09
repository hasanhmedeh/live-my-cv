import * as THREE from 'three';
import type { Ctx } from './context';
import { FALCON_TRACK, nearTrack } from './rides';
import { withFogSun } from './fog';
import { WHEEL_LAWN } from './layout';
import { mulberry } from './random';
import { hdr, PALETTE, signMaterial, signTexture } from './textures';

// Terrain window (outside the park, north-east): x, z bounds and grid spacing in metres.
const X0 = -110;
const X1 = 340;
const Z0 = -950;
const Z1 = -96;
const STEP = 2.5;
const NX = Math.round((X1 - X0) / STEP);
const NZ = Math.round((Z1 - Z0) / STEP);

/** The lawn around the road to the giant wheel (with a margin): kept exactly level with the park. */
const lawnZone = (x: number, z: number) => Math.abs(x) < WHEEL_LAWN.half + 3 && z > WHEEL_LAWN.z0 - 3;

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
 * sandstone wall right behind the drop, and a ramp-like spur carrying the launch up the cliff. The
 * heightfield is derived from the track, so the climb and plateau rest on the rock, the drop
 * plunges out in front of the cliff face, and all other track is guaranteed to clear it.
 */
export class Mountain {
  private heights: Float32Array;
  /** Where the track enters the tunnel, and the direction of the drop (for the portal facade). */
  portal!: { index: number; along: THREE.Vector2 };

  constructor(ctx: Ctx) {
    const d = FALCON_TRACK;
    const n = d.pos.length;
    const firstLift = d.zone.indexOf('launch'); // the cliff launch: where the rock begins
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
    // the drop pulls out ~35 m up, inside a tunnel: bury the tunnel in a rocky buttress at the
    // foot of the cliff, then carry the track down to the desert floor on an earth embankment
    const tunnelStart = d.zone.indexOf('tunnel');
    const tunnelEnd = d.zone.lastIndexOf('tunnel');
    let fillEnd = tunnelEnd;
    // …down to the bottom of the run-out (the track climbs away on its own supports after that)
    while (fillEnd < n - 1 && rail(fillEnd + 1) > 1.2 && rail(fillEnd + 1) <= rail(fillEnd) + 0.02) fillEnd++;
    const mound: { x: number; z: number; h: number }[] = [];
    for (let i = tunnelStart; i <= tunnelEnd; i += 4) mound.push({ x: d.pos[i].x, z: d.pos[i].z, h: rail(i) + 6.5 });
    const fill: { x: number; z: number; h: number }[] = [];
    for (let i = tunnelEnd + 1; i <= fillEnd; i += 4) fill.push({ x: d.pos[i].x, z: d.pos[i].z, h: rail(i) - 1.3 });
    const ridges = climb.concat(fill);
    // the drop: the train tips over the lip and falls clear of a sheer wall (nothing but air in
    // front of the riders), then pulls out along the crest of a rock buttress standing at the
    // foot of the cliff, straight into the portal
    const along = (x: number, z: number) => (x - edgeP.x) * dropDir.x + (z - edgeP.z) * dropDir.y;
    const across = (x: number, z: number) => (x - edgeP.x) * -dropDir.y + (z - edgeP.z) * dropDir.x;
    const portal = d.pos[tunnelStart];
    const portalA = along(portal.x, portal.z);
    const railAt = (i: number) => ({ x: d.pos[i].x - d.up[i].x, z: d.pos[i].z - d.up[i].z, h: rail(i) });
    // the lip: where the rails have dipped a little below the plateau
    let lip = edgeIdx;
    while (lip < tunnelStart && rail(lip) > top - 2.5) lip++;
    const lipA = along(railAt(lip).x, railAt(lip).z);
    // the foot of the vertical, where the pull-out (and the buttress under it) begins
    let foot = tunnelStart;
    while (foot > edgeIdx && d.tan[foot].y > -0.999) foot--;
    // (along the steep pull-out only a hair's width is cut, or the lower rails ahead would
    // trench the rock out from under the higher ones)
    const channel: { x: number; z: number; h: number; r: number }[] = [];
    for (let i = edgeIdx + 1; i <= tunnelStart; i += 2) {
      const r = railAt(i);
      channel.push({ x: r.x, z: r.z, h: r.h - 2.2, r: i < foot ? 3.4 : 0.5 });
    }
    const spine: { x: number; z: number; h: number; a: number }[] = [];
    for (let i = foot; i <= tunnelStart; i += 2) {
      const r = railAt(i);
      spine.push({ x: r.x, z: r.z, h: r.h - 1.5, a: along(r.x, r.z) });
    }
    this.portal = { index: tunnelStart, along: dropDir.clone() };
    // everything after the edge (and before the climb) must clear the rock
    const clear: { x: number; z: number; h: number }[] = [];
    for (let i = 0; i < n; i += 3) {
      if (i >= firstLift && i <= edgeIdx) continue;
      if (i >= edgeIdx && i <= fillEnd) continue; // the drop, tunnel and embankment shape their own rock
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
        // under the park's ground / under the lawn by the road to the giant wheel / desert floor
        const base = Math.abs(x) < 131 && z > -131 ? -2 : lawnZone(x, z) ? 0 : 0.08;
        // ---- mesa: flat top, steep flanks, a sheer wall along the edge plane ----
        const wob = (noise(x * 0.012, z * 0.012) - 0.5) * 70;
        const dc = Math.hypot(x - mesaC.x, z - mesaC.y) + wob;
        // around the drop the wall is sheer and starts right at the lip, so the vertical hangs
        // clear of it
        const sheer = 1 - THREE.MathUtils.smoothstep(Math.abs(across(x, z)), 45, 80);
        const jut = lipA * sheer;
        const planeDist = along(x, z) - jut + (noise2(x * 0.03, z * 0.03) - 0.5) * (10 - 9 * sheer);
        let mesa = top - 1.3 - 2.4 * Math.max(0, dc - jut - 150);
        mesa = Math.min(mesa, top - 1.3 - (4.5 + 17.5 * sheer) * Math.max(0, planeDist));
        // talus apron at the foot of the walls
        const apron = top * 0.22 * (1 - THREE.MathUtils.smoothstep(Math.max(dc - 150, planeDist), 0, 90));
        let h = Math.max(base, mesa, apron);
        // ---- the spur under the launch climb, and the embankment after the tunnel ----
        // (the spur and plateau stop dead at the wall above the drop, rather than bulging past it)
        const pastWall = 17.5 * sheer * Math.max(0, planeDist);
        for (let k = 0; k < ridges.length; k++) {
          const c = ridges[k];
          const dd = Math.hypot(x - c.x, z - c.z);
          // a knife-edge ridge whose flanks wobble, so it reads as rock rather than a ramp
          const flank = 1.7 + (noise(c.x * 0.05 + x * 0.02, c.z * 0.05 + z * 0.02) - 0.5) * 1.2;
          if (dd < 120) h = Math.max(h, c.h - flank * Math.max(0, dd - 5) - (k < climb.length ? pastWall : 0));
        }
        // ---- erosion: gullies and ledges, strongest on high ground ----
        if (h > 3) {
          const ridge = Math.abs(noise2(x * 0.04, z * 0.04) * 2 - 1);
          h -= ridge * Math.min(14, h * 0.1);
          h += (noise(x * 0.15, z * 0.15) - 0.5) * 1.6;
        }
        // ---- the buttress around the tunnel (after erosion, so its roof stays whole) ----
        const a = along(x, z);
        if (a > portalA - 0.5)
          for (const c of mound) {
            const dd = Math.hypot(x - c.x, z - c.z);
            if (dd < 60) h = Math.max(h, c.h - Math.max(0, dd - 7) * 1.3);
          }
        // ---- the buttress under the pull-out, running back to the foot of the wall ----
        // (it falls away gently to the sides and behind, but steeply ahead, where the rails dive)
        const ac = across(x, z);
        const spineFlank = 1.4 + (noise(x * 0.08, z * 0.08) - 0.5) * 0.8;
        for (const c of spine) {
          const ahead = a - c.a;
          const side = Math.hypot(ac, Math.min(0, ahead));
          if (side < 70) h = Math.max(h, c.h - Math.max(0, side - 3) * spineFlank - Math.max(0, ahead) * 20);
        }
        // ---- a notch through the lip and a clear path down to the portal ----
        if (a < portalA + 0.5)
          for (const c of channel) {
            const dd = Math.hypot(x - c.x, z - c.z);
            if (dd < 20) h = Math.min(h, c.h + Math.max(0, dd - c.r) * 14);
          }
        // ---- a solid track bed along the embankment ----
        for (const c of fill) {
          const dd = Math.hypot(x - c.x, z - c.z);
          if (dd < 8) h = Math.max(h, c.h - Math.max(0, dd - 3) * 1.1);
        }
        // ---- the ride always wins: climb/plateau sit in a shallow cutting, the rest clears ----
        for (const c of ridges) {
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
      withFogSun(shader);
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
    this.buildPortal(ctx);

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
      signMaterial(signTexture('SKY FALCON', { sub: '4.25 km · 158 m drop at 90° · 250 km/h · ride it from the east gate', border: PALETTE.mustard, width: 1536, height: 384 }), {
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

  /**
   * The tunnel portal in the buttress at the foot of the drop, after the real ride's: a sandstone
   * facade with a keyhole-shaped opening, framed by a bronze arch and a sunburst of rods.
   * The opening is sized to the tunnel bore where the steeply diving track crosses the
   * (vertical) facade: everything is in metres relative to the riders' heartline.
   */
  private buildPortal(ctx: Ctx) {
    const d = FALCON_TRACK;
    const P = d.pos[this.portal.index];
    const f = new THREE.Vector3(this.portal.along.x, 0, this.portal.along.y).normalize();
    const zAxis = f.clone().negate(); // the facade faces back up the drop
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(xAxis, yAxis, zAxis).setPosition(P);

    // keyhole: an arch of radius R over a narrower slot reaching below the rails
    const R = 3.1;
    const cy = 2.2;
    const slot = 1.9;
    const bottom = -3.6;
    const joinY = cy - Math.sqrt(R * R - slot * slot);
    const a0 = Math.atan2(joinY - cy, slot);
    const hole = new THREE.Path();
    hole.moveTo(-slot, bottom);
    hole.lineTo(slot, bottom);
    hole.lineTo(slot, joinY);
    hole.absarc(0, cy, R, a0, Math.PI - a0, false);
    hole.lineTo(-slot, bottom);
    const face = new THREE.Shape();
    face.moveTo(-13, -18);
    face.lineTo(13, -18);
    face.lineTo(13, 15);
    face.lineTo(-13, 15);
    face.closePath();
    face.holes.push(hole);
    const depth = 2.4;
    const facadeGeo = new THREE.ExtrudeGeometry(face, { depth, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 2, curveSegments: 40 });
    facadeGeo.translate(0, 0, -depth);
    const facade = new THREE.Mesh(facadeGeo, new THREE.MeshStandardMaterial({ color: '#c9a37a', roughness: 0.92 }));
    g.add(facade);

    // bronze frame: the arch and the slot's edges
    const bronze = new THREE.MeshStandardMaterial({ color: '#7a5f42', metalness: 0.65, roughness: 0.45 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R + 0.2, 0.2, 8, 48, Math.PI - 2 * a0), bronze);
    arch.rotation.z = a0;
    arch.position.set(0, cy, 0.3);
    g.add(arch);
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, joinY - bottom, 0.4), bronze);
      edge.position.set(sx * (slot + 0.2), (joinY + bottom) / 2, 0.3);
      g.add(edge);
    }
    // sunburst: rods radiating from the arch, alternating long and short, with an outer ring
    const rodGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
    const rods = new THREE.InstancedMesh(rodGeo, bronze, 32);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    for (let ang = a0 - 0.05; ang <= Math.PI - a0 + 0.06 && k < 32; ang += (Math.PI - 2 * a0 + 0.1) / 21) {
      const len = k % 2 ? 1.8 : 2.9;
      const r0 = R + 0.5;
      const mid = r0 + len / 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang - Math.PI / 2);
      m.compose(new THREE.Vector3(Math.cos(ang) * mid, cy + Math.sin(ang) * mid, 0.35), q, new THREE.Vector3(1, len, 1));
      rods.setMatrixAt(k++, m);
    }
    rods.count = k;
    g.add(rods);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(R + 3.5, 0.09, 6, 64, Math.PI - 2 * a0 + 0.1), bronze);
    outer.rotation.z = a0 - 0.05;
    outer.position.set(0, cy, 0.35);
    g.add(outer);

    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    g.updateMatrixWorld(true);
    ctx.scene.add(g);
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
