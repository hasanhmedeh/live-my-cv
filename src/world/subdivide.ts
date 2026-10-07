import * as THREE from 'three';

/**
 * Smooths a skinned, flat-shaded (low-poly) mesh: welds the corners each triangle carries on
 * its own, runs one level of Loop subdivision (so silhouettes round off) and recomputes smooth
 * normals. Skin influences of new vertices are blended from their parents, so the result
 * still deforms with the skeleton. Open borders (where clothing meets skin, which live in
 * separate primitives) use the boundary rule, so neighbouring pieces stay crack-free.
 */
export function smoothSkinned(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = src.getAttribute('position');
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const col = src.getAttribute('color');
  const uv = src.getAttribute('uv');
  const index = src.getIndex();
  if (!pos || !si || !sw) return src;

  // ---- weld corners that share a position ----
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const q = 1e5 / Math.max(1e-9, box.getSize(new THREE.Vector3()).length());
  const keyOf = new Map<string, number>();
  const remap = new Int32Array(pos.count);
  const P: number[] = [];
  const SKIN: Map<number, number>[] = [];
  const C: number[] = [];
  const UV: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let v = keyOf.get(key);
    if (v === undefined) {
      v = P.length / 3;
      keyOf.set(key, v);
      P.push(x, y, z);
      const m = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > 0) m.set(si.getComponent(i, k), w);
      }
      SKIN.push(m);
      C.push(0, 0, 0, 0);
      UV.push(0, 0);
      counts.push(0);
    }
    remap[i] = v;
    if (col) for (let k = 0; k < col.itemSize; k++) C[v * 4 + k] += col.getComponent(i, k);
    if (uv) {
      UV[v * 2] += uv.getX(i);
      UV[v * 2 + 1] += uv.getY(i);
    }
    counts[v]++;
  }
  for (let v = 0; v < counts.length; v++) {
    for (let k = 0; k < 4; k++) C[v * 4 + k] /= counts[v];
    UV[v * 2] /= counts[v];
    UV[v * 2 + 1] /= counts[v];
  }
  const tris: number[] = [];
  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = remap[index ? index.getX(t * 3) : t * 3];
    const b = remap[index ? index.getX(t * 3 + 1) : t * 3 + 1];
    const c = remap[index ? index.getX(t * 3 + 2) : t * 3 + 2];
    if (a !== b && b !== c && c !== a) tris.push(a, b, c);
  }

  // ---- topology: edges with their opposite vertices, and vertex neighbours ----
  const nV = P.length / 3;
  const edgeKey = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  const edges = new Map<number, { a: number; b: number; opp: number[]; mid: number }>();
  const neighbours: Set<number>[] = Array.from({ length: nV }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e];
      const b = tris[t + ((e + 1) % 3)];
      const o = tris[t + ((e + 2) % 3)];
      const k = edgeKey(a, b);
      let ed = edges.get(k);
      if (!ed) edges.set(k, (ed = { a, b, opp: [], mid: -1 }));
      ed.opp.push(o);
      neighbours[a].add(b);
      neighbours[b].add(a);
    }
  }
  const boundaryNbrs: number[][] = Array.from({ length: nV }, () => []);
  for (const ed of edges.values())
    if (ed.opp.length === 1) {
      boundaryNbrs[ed.a].push(ed.b);
      boundaryNbrs[ed.b].push(ed.a);
    }

  // ---- output buffers ----
  const outP: number[] = [];
  const outSkin: Map<number, number>[] = [];
  const outC: number[] = [];
  const outUV: number[] = [];
  const blendSkin = (a: Map<number, number>, b: Map<number, number>) => {
    const m = new Map<number, number>();
    for (const [j, w] of a) m.set(j, (m.get(j) ?? 0) + w * 0.5);
    for (const [j, w] of b) m.set(j, (m.get(j) ?? 0) + w * 0.5);
    return m;
  };

  // repositioned original vertices
  for (let v = 0; v < nV; v++) {
    const px = P[v * 3];
    const py = P[v * 3 + 1];
    const pz = P[v * 3 + 2];
    let x = px;
    let y = py;
    let z = pz;
    const bn = boundaryNbrs[v];
    if (bn.length > 0) {
      if (bn.length === 2) {
        x = 0.75 * px + 0.125 * (P[bn[0] * 3] + P[bn[1] * 3]);
        y = 0.75 * py + 0.125 * (P[bn[0] * 3 + 1] + P[bn[1] * 3 + 1]);
        z = 0.75 * pz + 0.125 * (P[bn[0] * 3 + 2] + P[bn[1] * 3 + 2]);
      }
    } else {
      const n = neighbours[v].size;
      if (n >= 3) {
        const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const u of neighbours[v]) {
          sx += P[u * 3];
          sy += P[u * 3 + 1];
          sz += P[u * 3 + 2];
        }
        x = (1 - n * beta) * px + beta * sx;
        y = (1 - n * beta) * py + beta * sy;
        z = (1 - n * beta) * pz + beta * sz;
      }
    }
    outP.push(x, y, z);
    outSkin.push(SKIN[v]);
    outC.push(C[v * 4], C[v * 4 + 1], C[v * 4 + 2], C[v * 4 + 3]);
    outUV.push(UV[v * 2], UV[v * 2 + 1]);
  }
  // one new vertex per edge
  for (const ed of edges.values()) {
    const { a, b, opp } = ed;
    let x: number;
    let y: number;
    let z: number;
    if (opp.length >= 2) {
      const [c, d] = opp;
      x = 0.375 * (P[a * 3] + P[b * 3]) + 0.125 * (P[c * 3] + P[d * 3]);
      y = 0.375 * (P[a * 3 + 1] + P[b * 3 + 1]) + 0.125 * (P[c * 3 + 1] + P[d * 3 + 1]);
      z = 0.375 * (P[a * 3 + 2] + P[b * 3 + 2]) + 0.125 * (P[c * 3 + 2] + P[d * 3 + 2]);
    } else {
      x = 0.5 * (P[a * 3] + P[b * 3]);
      y = 0.5 * (P[a * 3 + 1] + P[b * 3 + 1]);
      z = 0.5 * (P[a * 3 + 2] + P[b * 3 + 2]);
    }
    ed.mid = outP.length / 3;
    outP.push(x, y, z);
    outSkin.push(blendSkin(SKIN[a], SKIN[b]));
    for (let k = 0; k < 4; k++) outC.push(0.5 * (C[a * 4 + k] + C[b * 4 + k]));
    outUV.push(0.5 * (UV[a * 2] + UV[b * 2]), 0.5 * (UV[a * 2 + 1] + UV[b * 2 + 1]));
  }
  // each triangle becomes four
  const outIndex: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const ab = edges.get(edgeKey(a, b))!.mid;
    const bc = edges.get(edgeKey(b, c))!.mid;
    const ca = edges.get(edgeKey(c, a))!.mid;
    outIndex.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }

  // ---- pack: keep the four strongest influences per vertex ----
  const n = outP.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const top = [...outSkin[v].entries()].sort((p, q2) => q2[1] - p[1]).slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0) || 1;
    top.forEach(([j, w], k) => {
      skinIndex[v * 4 + k] = j;
      skinWeight[v * 4 + k] = w / total;
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  if (col) {
    const size = col.itemSize;
    const c = size === 4 ? outC : outC.filter((_, i) => i % 4 < 3);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, size));
  }
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(outUV, 2));
  g.setIndex(outIndex);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
