import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { std, staticCylinder, type Ctx } from './context';
import { Grass } from './grass';
import { flipLocal, LAYOUT, onPath, PATHS, PLAZAS, WHEEL_LAWN, WHEEL_ROAD } from './layout';
import type { Quality } from './quality';
import { mulberry } from './random';
import { detailNormalTexture, glowTexture, groundTexture, hdr, PALETTE, lawnPatchTexture, poolTexture, stripeTexture } from './textures';
import { addWind } from './wind';
import { FALCON_TRACK, nearTrack } from './rides';
import { fogSun, installSunFog } from './fog';

export { mulberry };

const WORLD = 260;
const FOG_DENSITY = 0.0026;
/** A full 24-hour day lasts this many real seconds (10 minutes). */
export const DAY_SECONDS = 600;
/** For now the park is held at a sunny 4 pm (see TIME_CONTROLS in Game.ts). */
export const START_HOUR = 16;

/** How the park clock moves: the 10-minute day cycle, frozen at a chosen hour, or the visitor's own local time. */
export type TimeMode = 'cycle' | 'paused' | 'local';

const col = (c: string) => new THREE.Color(c);
// palette keyframes: [night, sunrise/sunset glow, full day]
const HEMI_SKY = [col('#2c3866'), col('#9a8ee0'), col('#c9cfd6')];
const HEMI_GROUND = [col('#18131f'), col('#4a3b30'), col('#5e5240')];
const FOG = [col('#0d1426'), col('#584a70'), col('#7f9fc2')];
const FOG_SUN = [col('#1c2850'), col('#f0a06a'), col('#c9c3b4')];
const SUN_WARM = col('#ffbe86');
const SUN_NOON = col('#fff3e2');
const MOON = col('#9eb6ff');
const ENV_GROUND = [col('#0c1410'), col('#24402f'), col('#3d6a48')];

/** night → glow → day blend of three colours. */
function tri(out: THREE.Color, c: THREE.Color[], day: number, glow: number) {
  return out.copy(c[0]).lerp(c[2], day).lerp(c[1], glow);
}


export class Environment {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  grass: Grass;
  private sky: Sky;
  private skyUniforms = { uSpace: { value: 0 }, uSkyExposure: { value: 0.8 }, uNight: { value: 0 } };
  private stars: THREE.Points;
  private fireflies: THREE.Points;
  private fireflySeeds: Float32Array;
  private balloons: THREE.Group[] = [];
  private bulbs: THREE.InstancedMesh[] = [];
  /** In-game clock, 0–24. */
  hours = START_HOUR;
  timeMode: TimeMode = 'paused';
  private lastT: number | null = null;
  private bakedHours = -99;
  /** 0 in daylight, 1 in full night. */
  night = 0;
  private space = 0;
  private haze = 1;
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3(-0.92, 0.36, -0.2).normalize();
  private moon: THREE.Group;
  private lampMat!: THREE.MeshBasicMaterial;
  private poolMat!: THREE.MeshBasicMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envGround: THREE.MeshBasicMaterial;
  private cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  private cubeCam: THREE.CubeCamera;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private tmp = new THREE.Color();

  constructor(private ctx: Ctx, q: Quality) {
    const { scene } = ctx;

    // ---------- Physically based sky (Preetham scattering + drifting clouds) ----------
    this.sky = new Sky();
    this.sky.scale.setScalar(1800);
    const u = this.sky.material.uniforms;
    // high turbidity + strong Rayleigh + a sun just above the horizon = deep orange/pink sunset
    u.turbidity.value = 9;
    u.rayleigh.value = 3.2;
    u.mieCoefficient.value = 0.0016;
    u.mieDirectionalG.value = 0.72;
    u.cloudCoverage.value = q.clouds ? 0.3 : 0;
    u.cloudDensity.value = 0.5;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00016;
    u.cloudSpeed.value = 0.00007; // a gentle breeze: clouds visibly drift across the sky
    this.sky.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.skyUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uSpace;\nuniform float uSkyExposure;\nuniform float uNight;\nvoid main() {')
        .replace(
          'gl_FragColor = vec4( texColor, 1.0 );',
          `vec3 spaceCol = mix( vec3( 0.004, 0.002, 0.012 ), vec3( 0.02, 0.01, 0.05 ), smoothstep( -0.3, 0.6, direction.y ) );
          vec3 skyCol = texColor * uSkyExposure;
          // the sun disc is brighter than half-float buffers can hold: clamp it (and scrub NaNs)
          // so the bloom blur can never smear Inf/NaN across the screen
          // only the sun disc itself may go past the bloom threshold: a small glow, no glare
          skyCol = any( isnan( skyCol ) ) ? vec3( 0.0 ) : clamp( skyCol, 0.0, mix( 0.9, 3.0, sundisc ) );
          // night: a deep blue dome, a touch lighter toward the zenith
          vec3 nightCol = mix( vec3( 0.006, 0.008, 0.02 ), vec3( 0.016, 0.026, 0.065 ), smoothstep( -0.1, 0.6, direction.y ) );
          skyCol = mix( skyCol, nightCol, uNight );
          gl_FragColor = vec4( mix( skyCol, spaceCol, uSpace ), 1.0 );`,
        );
    };
    scene.add(this.sky);
    if (import.meta.env.DEV && location.search.includes('hidesky')) this.sky.visible = false;

    // Image-based lighting from the same sky, re-baked as the day goes by (see bakeEnvironment)
    this.pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const envSky = new Sky();
    envSky.material = this.sky.material;
    envSky.scale.setScalar(1800);
    this.envScene.add(envSky);
    // a dark ground hemisphere so reflections don't show sky below the horizon
    this.envGround = new THREE.MeshBasicMaterial({ color: '#24402f', side: THREE.BackSide });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.envGround));
    this.cubeCam = new THREE.CubeCamera(1, 4000, this.cubeRT);

    // the moon: a pale disc with a soft halo, opposite the sun
    this.moon = new THREE.Group();
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: hdr('#eef2ff', 2.4), fog: false }));
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('#c8d6ff'), color: hdr('#9fb4ff', 0.6), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
    );
    halo.scale.setScalar(150);
    this.moon.add(halo, moonDisc);
    scene.add(this.moon);

    // stars: invisible at dusk, take over in space
    const starGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    const sr = mulberry(3);
    for (let i = 0; i < 2200; i++) {
      const v = new THREE.Vector3(sr() * 2 - 1, sr() * 2 - 1, sr() * 2 - 1).normalize();
      if (v.y < 0.03) v.y = Math.abs(v.y) + 0.03;
      v.normalize().multiplyScalar(820);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: hdr('#ffffff', 2), size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    scene.add(this.stars);

    scene.fog = new THREE.FogExp2('#584a70', FOG_DENSITY);
    installSunFog();

    // ---------- Lights ----------
    this.hemi = new THREE.HemisphereLight('#9a8ee0', '#4a3b30', 0.55);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffbe86', 4.2);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -46;
    cam.right = cam.top = 46;
    cam.near = 1;
    cam.far = 320;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);

    // ---------- Ground ----------
    const ground = groundTexture(ctx.mobile || q.tier === 'lowest' ? 2048 : 4096, WORLD, PATHS, PLAZAS);
    const detail = detailNormalTexture(512);
    detail.repeat.set(90, 90);
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      std('#ffffff', { map: ground.texture, normalMap: detail, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.96 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    // the road to the giant wheel runs on past the edge of the park's ground texture, through a
    // lawn that carries on from the park's and fades out into the open country
    const L = WHEEL_LAWN;
    const lawnRect = { x0: -L.half, x1: L.half, z0: L.z0, z1: L.z1 };
    const lawnW = lawnRect.x1 - lawnRect.x0;
    const lawnH = lawnRect.z1 - lawnRect.z0;
    const lawnDetail = detail.clone();
    lawnDetail.repeat.set((90 * lawnW) / WORLD, (90 * lawnH) / WORLD);
    const lawnFadeNear = L.z1 + WORLD / 2; // the overlap with the park ground
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(lawnW, lawnH).rotateX(-Math.PI / 2),
      std('#ffffff', {
        map: lawnPatchTexture(lawnRect, ctx.mobile || q.tier === 'lowest' ? 8 : 12, WORLD, { side: L.fade, near: lawnFadeNear }, PATHS, PLAZAS),
        normalMap: lawnDetail,
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.96,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    lawn.position.set((lawnRect.x0 + lawnRect.x1) / 2, 0.03, (lawnRect.z0 + lawnRect.z1) / 2);
    lawn.receiveShadow = true;
    scene.add(lawn);
    const far = new THREE.Mesh(new THREE.CircleGeometry(900, 64), std('#2b5c40', { roughness: 1 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.05;
    scene.add(far);
    this.buildHills();

    const groundBody = new CANNON.Body({ mass: 0, material: ctx.mats.ground });
    groundBody.addShape(new CANNON.Plane());
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ctx.world.addBody(groundBody);

    // grass grows on the park's lawn and on the lawn along the wheel road (thinning out where it fades)
    const R = LAYOUT.boundary + 1;
    const growth = (x: number, z: number) => {
      if (Math.hypot(x, z) < R) return ground.isSand(x, z) ? 0 : 1;
      if (Math.abs(x) > L.half || z < L.z0 || z > 0 || onPath(x, z, 1.2)) return 0;
      const edge = Math.min(L.half - Math.abs(x), z - L.z0);
      return THREE.MathUtils.smoothstep(edge, L.fade * 0.25, L.fade);
    };
    const grassBounds = { x0: -R, x1: R, z0: L.z0, z1: R };
    this.grass = new Grass(scene, growth, grassBounds, q.grass, q.grassDistance, q.tier !== 'low' && q.tier !== 'lowest');

    this.buildTrees();
    this.buildFence();
    this.buildLamps();
    this.buildStringLights();
    this.buildTents();
    this.buildBalloons();

    // fireflies drifting over the meadow
    const n = q.tier === 'lowest' ? 0 : q.tier === 'low' ? 60 : 160;
    this.fireflySeeds = new Float32Array(n * 4);
    const fr = mulberry(77);
    for (let i = 0; i < n; i++) {
      const a = fr() * Math.PI * 2;
      const r = 14 + fr() * 70;
      this.fireflySeeds.set([Math.cos(a) * r, Math.sin(a) * r, 0.6 + fr() * 2.4, fr() * 100], i * 4);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.fireflies = new THREE.Points(
      fg,
      new THREE.PointsMaterial({
        size: 0.35,
        map: glowTexture('#fff2a8'),
        color: hdr('#ffe98a', 4),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);
  }

  /** Rolling hills on the horizon give the scene depth (fog does the rest). */
  private buildHills() {
    const seg = 180;
    const radii = [190, 280, 420, 600, 850];
    const amps = [0, 3, 9, 18, 30];
    const colors = ['#2b5c40', '#2a5038', '#2e4836', '#3a4250', '#4c4562'].map((c) => new THREE.Color(c));
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const h = (a: number, k: number) =>
      (Math.sin(a * 3 + k) * 0.5 + Math.sin(a * 7.3 + k * 2.1) * 0.3 + Math.sin(a * 13.7 + k) * 0.2) * 0.5 + 0.5;
    // flatten the hills into a plain wherever the Sky Falcon runs out into the desert
    const reach = new Float32Array(seg);
    for (let k = 0; k < FALCON_TRACK.pos.length; k += 4) {
      const p = FALCON_TRACK.pos[k];
      const r = Math.hypot(p.x, p.z);
      if (r < 150) continue;
      const a = Math.atan2(p.z, p.x);
      const si = Math.round((((a / (Math.PI * 2)) % 1) + 1) % 1 * seg);
      for (let d = -6; d <= 6; d++) {
        const j = (((si + d) % seg) + seg) % seg;
        reach[j] = Math.max(reach[j], r);
      }
    }
    radii.forEach((r, row) => {
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const flat = row === 0 || r < reach[i % seg] + 140;
        pos.push(Math.cos(a) * r, flat ? -0.1 : h(a, row) * amps[row] + amps[row] * 0.15, Math.sin(a) * r);
        col.push(colors[row].r, colors[row].g, colors[row].b);
      }
    });
    for (let row = 0; row < radii.length - 1; row++)
      for (let i = 0; i < seg; i++) {
        const a = row * (seg + 1) + i;
        const b = a + seg + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.ctx.scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  private buildTrees() {
    const rnd = mulberry(42);
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 130; i++) {
      const a = rnd() * Math.PI * 2;
      const r = LAYOUT.boundary + 4 + rnd() * 34;
      spots.push([Math.cos(a) * r, Math.sin(a) * r, 0.85 + rnd() * 0.8]);
    }
    const clusters: [number, number][] = [[-30, 46], [48, 42], [60, -14], [-70, -64], [20, -84], [-34, -76], [70, -70], [-8, 40], [30, 40]];
    for (const [cx, cz] of clusters)
      for (let i = 0; i < 5; i++) spots.push([cx + (rnd() - 0.5) * 12, cz + (rnd() - 0.5) * 12, 0.75 + rnd() * 0.6]);

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 2.6, 7);
    trunkGeo.translate(0, 1.3, 0);
    const broad = broadleafGeometry();
    const pine = pineGeometry();

    const trunkMat = std('#5b4033', { roughness: 0.95 });
    const leafMat = std('#ffffff', { vertexColors: true, roughness: 0.82 });
    const pineMat = std('#ffffff', { vertexColors: true, roughness: 0.85 });
    addWind(leafMat, 0.05);
    addWind(pineMat, 0.035);

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const leaves = new THREE.InstancedMesh(broad, leafMat, spots.length);
    const pines = new THREE.InstancedMesh(pine, pineMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    let nl = 0;
    let np = 0;
    // nothing may grow through a coaster, on the road out to the giant wheel, or where the Sky Flip swings low
    const underFlip = (x: number, z: number) => {
      const [lx, lz] = flipLocal(x, z);
      return Math.abs(lx) < 34 && lz > -3 && lz < 21;
    };
    for (let i = spots.length - 1; i >= 0; i--)
      if (nearTrack(spots[i][0], spots[i][1], 5, 9) || (spots[i][1] < 0 && Math.abs(spots[i][0]) < WHEEL_ROAD.half + 5) || underFlip(spots[i][0], spots[i][1]))
        spots.splice(i, 1);
    spots.forEach(([x, z, sc], i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.25), sc));
      trunks.setMatrixAt(i, m);
      color.setHSL(0.22 + rnd() * 0.12, 0.3 + rnd() * 0.25, 0.75 + rnd() * 0.2);
      if (rnd() > 0.42) {
        leaves.setMatrixAt(nl, m);
        leaves.setColorAt(nl++, color);
      } else {
        pines.setMatrixAt(np, m);
        pines.setColorAt(np++, color);
      }
      if (Math.hypot(x, z) < LAYOUT.boundary + 2) staticCylinder(this.ctx, x, z, 0.4 * sc, 3);
    });
    leaves.count = nl;
    pines.count = np;
    for (const im of [trunks, leaves, pines]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.ctx.scene.add(im);
    }
  }

  private buildFence() {
    const n = 220;
    const geo = new THREE.BoxGeometry(0.16, 1.2, 0.1);
    geo.translate(0, 0.6, 0);
    const posts = new THREE.InstancedMesh(geo, std(PALETTE.cream, { roughness: 0.7 }), n);
    const m = new THREE.Matrix4();
    const r = LAYOUT.boundary + 2.5;
    // the north gate, where the road leaves for the giant wheel (centred on angle -π/2)
    const gate = Math.asin((WHEEL_ROAD.half + 0.6) / r);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // leave a gap where a coaster runs through the fence, and at the gate
      const g = Math.abs(((a + Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (nearTrack(Math.cos(a) * r, Math.sin(a) * r, 3, 4) || g < gate) m.makeScale(0, 0, 0);
      else m.makeRotationY(-a).setPosition(Math.cos(a) * r, 0, Math.sin(a) * r);
      posts.setMatrixAt(i, m);
    }
    posts.castShadow = true;
    this.ctx.scene.add(posts);
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.06, 4, 160, Math.PI * 2 - gate * 2).rotateZ(-Math.PI / 2 + gate),
      std(PALETTE.candy, { roughness: 0.5 }),
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.95;
    this.ctx.scene.add(rail);
  }

  private buildLamps() {
    const spots: [number, number][] = [];
    for (let z = -14; z > -56; z -= 10) spots.push([-5.2, z], [5.2, z]);
    // …and on along the road out to the giant wheel
    for (let z = -66; z > WHEEL_ROAD.end + 4; z -= 12) spots.push([-5.2, z], [5.2, z]);
    spots.push([-13.5, 15], [13.5, 15], [-14.5, 4], [14.5, 4], [28, -6], [38, -24], [-12, -36], [24, -40], [-8, -26], [8, -26]);

    const iron = std('#2c2433', { metalness: 0.75, roughness: 0.35 });
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.11, 4.2, 10).translate(0, 2.1, 0),
      new THREE.CylinderGeometry(0.22, 0.28, 0.35, 10).translate(0, 0.17, 0),
      new THREE.ConeGeometry(0.42, 0.35, 10).translate(0, 4.75, 0),
    ])!;
    const poles = new THREE.InstancedMesh(poleGeo, iron, spots.length);
    this.lampMat = new THREE.MeshBasicMaterial({ color: hdr('#ffd59a', 7) });
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 16, 12), this.lampMat, spots.length);
    const pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2),
      (this.poolMat = new THREE.MeshBasicMaterial({
        map: poolTexture(),
        color: hdr('#ffb26b', 0.3),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })),
      spots.length,
    );
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      poles.setMatrixAt(i, m.makeTranslation(x, 0, z));
      lamps.setMatrixAt(i, m.makeTranslation(x, 4.38, z));
      pools.setMatrixAt(i, m.makeTranslation(x, 0.03, z));
      staticCylinder(this.ctx, x, z, 0.2, 4);
    });
    poles.castShadow = true;
    pools.renderOrder = 1;
    this.ctx.scene.add(poles, lamps, pools);
  }

  /** Strings of coloured bulbs along the boulevard and around the entrance plaza. */
  private buildStringLights() {
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    for (let z = -14; z > -54; z -= 10) {
      lines.push([new THREE.Vector3(-5.2, 4.1, z), new THREE.Vector3(-5.2, 4.1, z - 10)]);
      lines.push([new THREE.Vector3(5.2, 4.1, z), new THREE.Vector3(5.2, 4.1, z - 10)]);
    }
    const ring: [number, number][] = [[-13.5, 15], [-14.5, 4], [-8, -7.5], [8, -7.5], [14.5, 4], [13.5, 15]];
    for (let i = 0; i < ring.length - 1; i++)
      lines.push([new THREE.Vector3(ring[i][0], 4.1, ring[i][1]), new THREE.Vector3(ring[i + 1][0], 4.1, ring[i + 1][1])]);

    const colors = ['#ff5d7a', '#ffd23d', '#5ce1d6', '#a98bff', '#fff3d6'];
    const perLine = 16;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lines.length * perLine);
    const wirePts: number[] = [];
    const m = new THREE.Matrix4();
    let i = 0;
    for (const [a, b] of lines) {
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= perLine; k++) {
        const t = k / perLine;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * 0.7;
        if (prev) wirePts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
        if (k < perLine) {
          bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y - 0.12, p.z));
          bulbs.setColorAt(i, hdr(colors[i % colors.length], 5));
          i++;
        }
      }
    }
    const wire = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3)),
      new THREE.LineBasicMaterial({ color: '#1e1628' }),
    );
    this.ctx.scene.add(bulbs, wire);
    this.bulbs.push(bulbs);
  }

  private buildTents() {
    const spots: [number, number, string][] = [
      [-14, 18, PALETTE.candy],
      [-10, -48, PALETTE.violet],
      [16, -22, PALETTE.teal],
      [-16, -56, PALETTE.candy],
      [22, -60, PALETTE.mustard],
      [56, -28, PALETTE.candy],
      [-44, -50, PALETTE.teal],
      [12, 30, PALETTE.violet],
    ];
    const rnd = mulberry(8);
    for (const [x, z, col] of spots) {
      const g = new THREE.Group();
      const stripes = stripeTexture(col, PALETTE.cream, 12);
      const canvas = { map: stripes, roughness: 0.88, side: THREE.DoubleSide } as const;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.6, 24, 1, true), std('#ffffff', canvas));
      wall.position.y = 1.3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.8, 24, 1, true), std('#ffffff', canvas));
      roof.position.y = 4;
      const scallop = new THREE.Mesh(new THREE.CylinderGeometry(3.62, 3.62, 0.35, 24, 1, true), std(col, { roughness: 0.85, side: THREE.DoubleSide }));
      scallop.position.y = 2.6;
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4), std('#3a2f4a', { metalness: 0.6, roughness: 0.4 }));
      flagPole.position.y = 6;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 3), std(PALETTE.mustard));
      flag.rotation.z = -Math.PI / 2;
      flag.position.set(0.4, 6.4, 0);
      // a warm glow spilling out of the doorway
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2), new THREE.MeshBasicMaterial({ color: hdr('#ffb46b', 1.6) }));
      door.position.set(0, 1, 3.02);
      g.add(wall, roof, scallop, flagPole, flag, door);
      g.position.set(x, 0, z);
      g.rotation.y = rnd() * Math.PI * 2;
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      door.castShadow = false;
      this.ctx.scene.add(g);
      staticCylinder(this.ctx, x, z, 3, 3);
    }
  }

  private buildBalloons() {
    const colors = [PALETTE.candy, PALETTE.mustard, PALETTE.teal, PALETTE.violet, PALETTE.orange];
    const clusters: [number, number][] = [[-11, 23], [11, 23], [27, 6], [-10, -20]];
    const rnd = mulberry(12);
    clusters.forEach(([x, z], ci) => {
      const g = new THREE.Group();
      const linePts: number[] = [];
      for (let i = 0; i < 5; i++) {
        // glossy latex: the clearcoat picks up the sunset reflections
        const mat = new THREE.MeshPhysicalMaterial({ color: colors[(i + ci) % colors.length], roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), mat);
        b.scale.y = 1.2;
        const bx = (rnd() - 0.5) * 1.4;
        const bz = (rnd() - 0.5) * 1.4;
        const by = 4 + rnd() * 1.2;
        b.position.set(bx, by, bz);
        b.castShadow = true;
        g.add(b);
        linePts.push(0, 1.2, 0, bx, by - 0.6, bz);
      }
      g.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3)),
          new THREE.LineBasicMaterial({ color: '#f6eadb' }),
        ),
      );
      const weight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), std('#3a2f4a', { metalness: 0.5, roughness: 0.4 }));
      weight.position.y = 0.6;
      weight.castShadow = true;
      g.add(weight);
      g.position.set(x, 0, z);
      this.ctx.scene.add(g);
      this.balloons.push(g);
      staticCylinder(this.ctx, x, z, 0.35, 1.2);
    });
  }

  /** 0 = on the ground, 1 = outer space (the rocket ride). */
  setSpace(k: number) {
    this.space = k;
  }

  /** Thins the haze (1 = normal), e.g. high up on the giant wheel where you see over it. */
  setHaze(k: number) {
    this.haze = k;
  }

  /** Keep the shadow camera centred on what matters. */
  follow(target: THREE.Vector3) {
    this.sun.position.copy(target).addScaledVector(this.lightDir, 150);
    this.sun.target.position.copy(target);
  }

  /** Jump the clock to a given hour (0–24). */
  setHour(hour: number) {
    this.hours = ((hour % 24) + 24) % 24;
  }

  /** Clock as "HH:MM". */
  get clock() {
    const m = Math.floor(this.hours * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /**
   * The day cycle: the sun rises in the east at 06:00, crosses high in the sky and sets in the
   * west at 18:00; the moon takes over at night. Sky, sunlight, ambient light, fog, stars,
   * reflections and the park's lights all follow it.
   */
  private applyTime(t: number) {
    const smooth = THREE.MathUtils.smoothstep;
    const lerp = THREE.MathUtils.lerp;
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    if (this.timeMode === 'cycle') this.setHour(this.hours + (dt / DAY_SECONDS) * 24);
    else if (this.timeMode === 'local') {
      const now = new Date();
      this.hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    }
    const a = ((this.hours - 6) / 24) * Math.PI * 2;
    const sun = this.sunDir.set(Math.cos(a), Math.sin(a) * 0.9, -0.22).normalize();
    const moon = this.moonDir.copy(sun).negate();
    const day = smooth(sun.y, -0.1, 0.22);
    const glow = smooth(sun.y, -0.2, 0) * (1 - smooth(sun.y, 0.06, 0.4)); // sunrise / sunset
    this.night = 1 - smooth(sun.y, -0.24, -0.02);
    const space = this.space;

    // sky
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(sun);
    // clear, deep-blue daytime sky; hazy and red only around sunrise / sunset
    u.turbidity.value = lerp(1.8, 9, glow);
    u.rayleigh.value = lerp(1.7, 3.2, glow);
    this.skyUniforms.uSkyExposure.value = lerp(0.28, 0.8, glow);
    this.skyUniforms.uNight.value = this.night;
    this.skyUniforms.uSpace.value = space;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(this.night * 0.85, smooth(space, 0.15, 0.8));
    this.stars.rotation.y = (this.hours / 24) * Math.PI * 2 * 0.25;
    this.moon.position.copy(moon).multiplyScalar(780);
    this.moon.lookAt(0, 0, 0);
    this.moon.visible = moon.y > -0.05;

    // direct light: the sun by day, the moon by night (one shadow-casting light)
    const sunW = smooth(sun.y, -0.03, 0.1);
    if (sunW > 0.001) {
      this.lightDir.copy(sun).setY(Math.max(sun.y, 0.08)).normalize();
      this.sun.color.copy(SUN_WARM).lerp(SUN_NOON, smooth(sun.y, 0.1, 0.5));
      // a low sun grazes the ground; a high one hits it square on, so it needs far less intensity
      this.sun.intensity = sunW * lerp(4.2, 1.45, smooth(sun.y, 0.08, 0.5));
    } else {
      this.lightDir.copy(moon).setY(Math.max(moon.y, 0.3)).normalize();
      this.sun.color.copy(MOON);
      // moonlight, already partly up during twilight so dusk never goes pitch black
      this.sun.intensity = 1.05 * Math.max(this.night, 0.55);
    }

    // ambient + reflections
    tri(this.hemi.color, HEMI_SKY, day, glow);
    tri(this.hemi.groundColor, HEMI_GROUND, day, glow);
    this.hemi.intensity = lerp(0.85, 0.45, day) * (1 - space * 0.7);
    this.ctx.scene.environmentIntensity = (lerp(0.42, 0.4, day) + 0.35 * glow) * (1 - space * 0.8);
    tri(this.envGround.color, ENV_GROUND, day, glow);

    // fog: colour, sun-side tint and density
    const fog = this.ctx.scene.fog as THREE.FogExp2;
    tri(fog.color, FOG, day, glow);
    tri(fogSun.uFogSunColor.value, FOG_SUN, day, glow);
    fogSun.uFogSunDir.value.copy(sun.y > -0.05 ? sun : moon);
    fog.density = FOG_DENSITY * lerp(1, 0.3, day) * this.haze * (1 - space);

    // the park's own lights: dimmer by day, full glow at night
    const lights = 1 - 0.6 * day;
    this.lampMat.color.copy(this.tmp.set('#ffd59a')).multiplyScalar(7 * lights);
    this.poolMat.opacity = lerp(0.15, 1, this.night);
    (this.fireflies.material as THREE.PointsMaterial).opacity = this.night;
    this.fireflies.visible = this.night > 0.02;
  }

  /** Re-renders the sky into the reflection map whenever the clock has moved ~6 game minutes. */
  private bakeEnvironment() {
    const d = Math.abs(this.hours - this.bakedHours) % 24; // circular: 23:59 is next to 00:00
    if (Math.min(d, 24 - d) < 0.1) return;
    this.bakedHours = this.hours;
    this.cubeCam.update(this.ctx.renderer, this.envScene);
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    this.ctx.scene.environment = this.envRT.texture;
  }

  update(t: number, focus: THREE.Vector3) {
    this.sky.material.uniforms.time.value = t;
    this.applyTime(t);
    this.bakeEnvironment();
    this.grass.update(focus);    this.grass.update(focus);

    for (let i = 0; i < this.balloons.length; i++) {
      const b = this.balloons[i];
      b.rotation.y = Math.sin(t * 0.3 + i) * 0.3;
      b.rotation.z = Math.sin(t * 0.7 + i * 2) * 0.03;
    }
    const lights = 1 - 0.55 * (1 - this.night);
    for (const im of this.bulbs) (im.material as THREE.MeshBasicMaterial).color.setScalar((0.85 + Math.sin(t * 3) * 0.15) * lights);

    // fireflies: lazy figure-of-eight drift + blinking (an "off" firefly hides below ground)
    const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
    const s = this.fireflySeeds;
    for (let i = 0; i < pos.count; i++) {
      const x = s[i * 4];
      const z = s[i * 4 + 1];
      const y = s[i * 4 + 2];
      const ph = s[i * 4 + 3];
      const tt = t * 0.35 + ph;
      const on = Math.sin(t * 1.3 + ph * 7) > -0.2;
      pos.setXYZ(i, x + Math.sin(tt) * 2.2, on ? y + Math.sin(tt * 2.1) * 0.5 : -5, z + Math.sin(tt * 0.8) * Math.cos(tt) * 2.2);
    }
    pos.needsUpdate = true;
  }
}

/** A lumpy, softly shaded broadleaf crown made of a few merged blobs. */
export function broadleafGeometry() {
  const rnd = mulberry(21);
  const center = new THREE.Vector3(0, 3.7, 0);
  const blobs: [number, number, number, number][] = [
    [0, 3.7, 0, 1.75],
    [0.95, 3.25, 0.4, 1.2],
    [-0.85, 3.35, -0.35, 1.25],
    [0.15, 4.6, 0.2, 1.15],
    [-0.35, 3.05, 0.95, 1.0],
    [0.4, 3.1, -0.95, 1.0],
  ];
  const parts = blobs.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    const seed = rnd() * 10;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i);
      const vy = p.getY(i);
      const vz = p.getZ(i);
      const n = 1 + Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 + seed) * Math.sin(vy * 2.3) * 0.14;
      p.setXYZ(i, vx * n, vy * n, vz * n);
    }
    g.translate(x, y, z);
    return g;
  });
  const g = mergeGeometries(parts)!;
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const col: number[] = [];
  const sway: number[] = [];
  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  const n = new THREE.Vector3();
  const dark = new THREE.Color('#1f4a2a');
  const light = new THREE.Color('#7fae4e');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // spherical normals = soft, volumetric foliage lighting instead of faceted blobs
    out.copy(v).sub(center).normalize();
    n.fromBufferAttribute(nrm, i).lerp(out, 0.75);
    // opposite normals can cancel to zero, which would turn into NaN in the lighting
    if (n.lengthSq() < 1e-4) n.copy(out);
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
    // self-shadowed underside, sunlit crown
    c.lerpColors(dark, light, THREE.MathUtils.smoothstep(v.y, 2.0, 5.6) * 0.85);
    col.push(c.r, c.g, c.b);
    sway.push(THREE.MathUtils.clamp((v.y - 2) / 3, 0, 1));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  return g;
}

export function pineGeometry() {
  const layers: [number, number, number][] = [
    [1.9, 2.4, 2.5],
    [1.45, 2.1, 3.8],
    [1.0, 1.9, 5.0],
    [0.55, 1.3, 6.0],
  ];
  const g = mergeGeometries(layers.map(([r, h, y]) => new THREE.ConeGeometry(r, h, 12, 2).translate(0, y, 0)))!;
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const col: number[] = [];
  const sway: number[] = [];
  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  const n = new THREE.Vector3();
  const dark = new THREE.Color('#12331f');
  const light = new THREE.Color('#4f8a4a');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    out.set(v.x, 0.35, v.z).normalize();
    n.fromBufferAttribute(nrm, i).lerp(out, 0.5);
    if (n.lengthSq() < 1e-4) n.copy(out);
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
    const layerT = (v.y % 1.25) / 1.25;
    c.lerpColors(dark, light, THREE.MathUtils.clamp(v.y / 7 + layerT * 0.25, 0, 1));
    col.push(c.r, c.g, c.b);
    sway.push(THREE.MathUtils.clamp((v.y - 1.5) / 5, 0, 1));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  return g;
}
