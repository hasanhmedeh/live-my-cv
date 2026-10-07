import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Sfx } from './audio';
import { Car } from './car';
import type { Ctx } from './context';
import { Environment } from './environment';
import { Input } from './input';
import { LAYOUT, ZONES, type ZoneId } from './layout';
import { NAME_COLORS, physicsWord } from './letters';
import { PALETTE } from './textures';
import { UI } from './ui';
import { Zones } from './zones';
import { Minimap } from './minimap';
import { Post } from './post';
import { AdaptiveResolution, detectQuality, type Quality } from './quality';
import { wind } from './wind';
import { Coaster } from './attractions/coaster';
import { Mountain } from './mountain';
import { FALCON_TRACK, nearTrack, STACK_TRACK, TRACK_DS } from './rides';
import { PHYS } from './attractions/track';
import { FALCON_PHYS } from './attractions/falcon-track';
import { Rocket } from './attractions/rocket';
import { Crates } from './attractions/crates';
import { Striker } from './attractions/striker';
import { Arch, Booth, Carousel, FerrisWheel } from './attractions/landmarks';

type Mode = 'drive' | 'coaster' | 'rocket' | 'striker';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class Game {
  private ctx!: Ctx;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2400);
  private world = new CANNON.World();
  private timer = new THREE.Timer();
  private debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private input!: Input;
  private ui!: UI;
  private sfx = new Sfx();
  private env!: Environment;
  private car!: Car;
  private zones!: Zones;
  private minimap!: Minimap;
  private stack!: Coaster;
  private falcon!: Coaster;
  /** The coaster currently being ridden (valid while mode === 'coaster'). */
  private ride!: Coaster;
  private mountain!: Mountain;
  private rocket!: Rocket;
  private crates!: Crates;
  private striker!: Striker;
  private ferris!: FerrisWheel;
  private booth!: Booth;
  private updatables: { update(dt: number, t: number): void }[] = [];
  private mode: Mode = 'drive';
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private zoom = 1;
  private panelZone: ZoneId | null = null;
  /** The crates card auto-opens in its ring; once closed it stays closed until you leave. */
  private cratesDismissed = false;
  private running = false;
  private mobile = matchMedia('(pointer: coarse)').matches;
  private fadeEl!: HTMLDivElement;
  private time = { t: 0 };
  private quality!: Quality;
  private post!: Post;
  private adaptive = new AdaptiveResolution();
  private focus = new THREE.Vector3();

  constructor(private container: HTMLElement) {}

  /** Builds the whole fair in small steps so the progress bar can update. */
  async build(onProgress: (p: number) => void) {
    const steps: [number, () => void][] = [];
    const step = (w: number, fn: () => void) => steps.push([w, fn]);

    step(1, () => this.setupRenderer());
    step(1, () => this.setupPhysics());
    step(3, () => {
      this.env = new Environment(this.ctx, this.quality);
    });
    step(1, () => {
      // Bruno-style physical letters in front of the spawn point.
      physicsWord(this.ctx, 'FUNFAIR', new THREE.Vector3(LAYOUT.letters.x, 0, LAYOUT.letters.z), 2.4, NAME_COLORS);
      this.updatables.push(new Arch(this.ctx));
    });
    step(1, () => {
      this.updatables.push(new Carousel(this.ctx));
      this.ferris = new FerrisWheel(this.ctx);
      this.booth = new Booth(this.ctx);
      this.updatables.push(this.ferris, this.booth);
    });
    step(3, () => {
      this.stack = new Coaster(this.ctx, {
        id: 'stack',
        name: 'Thunder Loop',
        track: STACK_TRACK,
        phys: PHYS,
        station: { title: 'THUNDER LOOP', sub: 'Drive it yourself · launch · loop · roll', side: -1 },
        colors: { rail: PALETTE.candy, spine: PALETTE.mustard, cars: [PALETTE.mustard, PALETTE.candy, PALETTE.teal] },
        cars: 3,
        trackside: [
          new THREE.Vector3(-50, 3, 38), // loop
          new THREE.Vector3(-66, 4, 6), // banked turn + camelback
          new THREE.Vector3(-66, 6, -40), // high turn + roll
          new THREE.Vector3(-14, 9, -34), // helix
          new THREE.Vector3(-16, 4, 12), // station
        ],
        intro: (touch) =>
          `<p class="eyebrow">Thunder Loop · You're the driver</p><h2>Hold on tight!</h2><p>${
            touch
              ? 'Push the joystick <strong>up</strong> for power, <strong>down</strong> to brake. Tap <kbd>E</kbd> to switch camera.'
              : 'Hold <kbd>W</kbd> for power, <kbd>S</kbd> to brake, <kbd>Shift</kbd> for turbo, <kbd>C</kbd> to switch camera.'
          } The launch fires automatically — brake too hard before the loop and you'll roll back!</p>`,
      });
      this.ride = this.stack;
      this.updatables.push(this.stack);
    });
    step(4, () => {
      this.mountain = new Mountain(this.ctx);
      const ground = (x: number, z: number) => this.mountain.sample(x, z);
      // landmarks a support column must never land on
      const keep: [number, number, number][] = [
        [0, 5, 14], [0, -8, 10], [0, -30, 9], [0, -68, 8], [34, -14, 9], [42, -52, 9], [20, 12, 4], [-20, -40, 4], [-26, 3, 6],
      ];
      const keepOut = (x: number, z: number) => keep.some(([kx, kz, r]) => Math.hypot(x - kx, z - kz) < r) || nearTrack(x, z, 3.5, Infinity, 'stack');
      const f = FALCON_TRACK;
      const at = (zone: string, offset: [number, number, number]) => {
        const p = f.pos[Math.max(0, f.zone.indexOf(zone as never))];
        const x = p.x + offset[0];
        const z = p.z + offset[2];
        return new THREE.Vector3(x, Math.max(p.y * 0.4, ground(x, z)) + offset[1], z);
      };
      // a camera beside the track at arc length s (metres from the station)
      const atS = (s: number, offset: [number, number, number], y?: number) => {
        const p = f.pos[Math.round(s / TRACK_DS) % f.pos.length];
        const x = p.x + offset[0];
        const z = p.z + offset[2];
        return new THREE.Vector3(x, y ?? Math.max(p.y * 0.4, ground(x, z)) + offset[1], z);
      };
      this.falcon = new Coaster(this.ctx, {
        id: 'falcon',
        name: 'Sky Falcon',
        track: FALCON_TRACK,
        phys: FALCON_PHYS,
        station: { title: 'SKY FALCON', sub: '4.25 km · 158 m drop at 90° · 250 km/h', side: 1 },
        colors: { rail: PALETTE.teal, spine: '#e6c08a', cars: ['#e6c08a', PALETTE.teal, '#e6c08a', PALETTE.teal] },
        cars: 4,
        leadRows: 1, // 2 + 4 + 4 + 4 = 14 riders, like the real Exa trains
        trackside: [
          new THREE.Vector3(54, 6, 34), // station
          atS(110, [0, 8, 45]), // the LSM lift hill
          atS(250, [-45, 6, 0]), // twisted drop + airtime hills
          at('launch', [-38, 8, -60]), // the launch up the cliff
          at('brake', [-60, 30, 40]), // the plateau rim
          (() => {
            // hovering over the run-out (always open air: the track sits in a cutting), looking back
            // up the cliff as the train comes off the drop at full speed
            const i = f.zone.lastIndexOf('boost') + 320;
            const p = f.pos[i];
            return new THREE.Vector3(p.x, Math.max(p.y + 14, ground(p.x, p.z) + 6), p.z);
          })(),
          atS(2160, [0, 0, 95], 70), // beside the 163 m arch
          atS(3200, [40, 6, -30]), // speed turns around the park boundary
          atS(3650, [0, 6, 45]), // the hill over the main entrance
        ],
        ground,
        keepOut,
        beats: {
          lift: ['LSM lift hill · 39 km/h ⚙️', 'The clifftop… 190 m up ⛰️'],
          launch: 'LAUNCH → 160 km/h up the cliff 🚀',
          brake: ['The edge. Look down. 😱', 'Final brake run'],
          tunnel: 'Into the tunnel… 🕳️',
          boost: 'LSM LAUNCH → 250 km/h 🦅',
          trim: ['The 163 m arch — trims bite 😮‍💨', 'Speed turns around the park 🏁'],
          station: 'Welcome back to the fair!',
        },
        intro: (touch) =>
          `<p class="eyebrow">Sky Falcon · tribute to Falcons Flight, Six Flags Qiddiya City</p><h2>The world's tallest, fastest, longest</h2><p>An LSM lift and a twisted drop, airtime hills and an overbanked turn, then a <strong>160 km/h launch</strong> up the cliff. Crawl to the edge… drop <strong>158 m at 90°</strong> into a tunnel, launch out of it to <strong>250 km/h</strong>, crest the <strong>163 m arch</strong> and race around the park back home: 4.25 km, no inversions.</p><p>${
            touch ? 'Joystick <strong>up</strong> = power, <strong>down</strong> = brake, <kbd>E</kbd> = camera.' : '<kbd>W</kbd> power · <kbd>S</kbd> brake · <kbd>Shift</kbd> turbo · <kbd>C</kbd> camera.'
          } Or just hold on — the lift and launches do the work.</p>`,
      });
      this.updatables.push(this.falcon);
    });
    step(2, () => {
      this.rocket = new Rocket(this.ctx, this.env);
      this.updatables.push(this.rocket);
    });
    step(1, () => {
      this.crates = new Crates(this.ctx);
      this.striker = new Striker(this.ctx);
      this.updatables.push(this.crates, this.striker);
    });
    step(1, () => {
      this.zones = new Zones(this.ctx);
      this.car = new Car(this.ctx);
      this.wire();
    });
    step(2, () => {
      // warm up: upload textures/compile shaders before the user enters
      this.post = new Post(this.renderer, this.scene, this.camera, this.quality);
      this.resize();
      this.updateDriveCamera(1, true);
      this.renderer.compile(this.scene, this.camera);
      this.post.render(0);
    });

    const total = steps.reduce((a, [w]) => a + w, 0);
    let done = 0;
    for (const [w, fn] of steps) {
      fn();
      done += w;
      onProgress(done / total);
      await nextFrame();
    }
    this.timer.connect(document);
    this.timer.reset();
    this.setupDebug();
    this.running = true;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private setupRenderer() {
    // AA, tone mapping and colour output all happen in the post pipeline (see post.ts).
    this.renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.quality = detectQuality(this.renderer, this.mobile);
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.container.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'drive') return;
        this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.001, 0.55, 1.7);
      },
      { passive: true },
    );
    this.resize();
  }

  private setupPhysics() {
    const w = this.world;
    w.gravity.set(0, -20, 0);
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    (w.solver as CANNON.GSSolver).iterations = 8;
    const ground = new CANNON.Material('ground');
    const car = new CANNON.Material('car');
    const prop = new CANNON.Material('prop');
    w.addContactMaterial(new CANNON.ContactMaterial(ground, car, { friction: 0, restitution: 0 }));
    w.addContactMaterial(new CANNON.ContactMaterial(ground, prop, { friction: 0.45, restitution: 0.15 }));
    w.addContactMaterial(new CANNON.ContactMaterial(car, prop, { friction: 0.05, restitution: 0.35 }));
    w.addContactMaterial(new CANNON.ContactMaterial(prop, prop, { friction: 0.4, restitution: 0.1 }));

    this.ui = new UI(this.mobile);
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'fade';
    document.body.appendChild(this.fadeEl);

    this.ctx = {
      scene: this.scene,
      world: w,
      renderer: this.renderer,
      camera: this.camera,
      sfx: this.sfx,
      ui: this.ui,
      mobile: this.mobile,
      mats: { ground, car, prop },
      quality: this.quality,
      dynamics: [],
      time: this.time,
    };
  }

  private wire() {
    this.input = new Input({
      stick: document.getElementById('stick')!,
      knob: document.getElementById('stick-knob')!,
      action: document.getElementById('touch-action')!,
    });
    this.input.on('action', () => this.onAction());
    this.input.on('escape', () => this.onEscape());
    this.input.on('reset', () => this.mode === 'drive' && this.teleport('entrance'));
    this.input.on('honk', () => this.sfx.honk());
    this.input.on('camera', () => this.mode === 'coaster' && this.ride.cycleCamera());
    this.stack.input = this.input;
    this.falcon.input = this.input;
    this.ui.onPromptClick = () => this.onAction();
    this.ui.onRideExit = () => this.onEscape();
    this.ui.onPanelClose = () => {
      if (this.zones.active === 'crates') this.cratesDismissed = true;
      this.panelZone = null;
    };
    this.minimap = new Minimap(document.getElementById('minimap')!);
    this.minimap.onGoto = (id) => this.teleport(id);

    this.stack.onFinish = () => this.endRide();
    this.falcon.onFinish = () => this.endRide();
    this.rocket.onFinish = () => this.endRide();
    this.striker.onFinish = () => this.endRide();
    this.crates.onScore = (n, total, points, score) => {
      this.ui.score(`🥫 +${points}! · ${score} points · ${n} / ${total} crates`);
      if (this.panelZone === 'crates') this.ui.panel(`crates-${n}`, this.crates.panelHtml(), { accent: PALETTE.teal });
      if (n === total) this.sfx.ding();
      else this.sfx.pop();
    };

    document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) =>
      b.addEventListener('click', () => {
        b.blur();
        this.teleport(b.dataset.goto as ZoneId);
      }),
    );
    const sound = document.getElementById('sound-toggle')!;
    const syncSound = () => {
      sound.textContent = this.sfx.muted ? '🔇' : '🔊';
      sound.setAttribute('aria-pressed', String(!this.sfx.muted));
      sound.setAttribute('aria-label', this.sfx.muted ? 'Unmute sound' : 'Mute sound');
    };
    sound.addEventListener('click', () => {
      this.sfx.setMuted(!this.sfx.muted);
      syncSound();
    });
    syncSound();
    if (this.mobile) document.getElementById('touch')!.hidden = false;
  }

  /** Called when the visitor presses "Enter the fair". */
  enter() {
    this.sfx.unlock();
    this.ui.hud.hidden = false;
    this.ui.panel(
      'welcome',
      `<p class="eyebrow">Welcome to the fair</p><h2>Step right up! 🎪</h2><p>Hop in the car and drive around the park. Every ride is free:</p><ul>
        <li>🎢 <strong>Thunder Loop</strong> — drive the coaster yourself: launch, loop and roll</li>
        <li>🦅 <strong>Sky Falcon</strong> — a 4.25 km cliff coaster: 158 m drop at 90°, 250 km/h</li>
        <li>🚀 <strong>Rocket Ride</strong> — fire six stages all the way to orbit</li>
        <li>🥫 <strong>Crate Smash</strong> — ram the crates and rack up points</li>
        <li>🔔 <strong>High Striker</strong> — swing the hammer and ring the bell</li>
        <li>🎡 <strong>Ferris Wheel</strong> — the best view · 🎟️ <strong>Tickets</strong> — park guide</li>
      </ul><p>${this.mobile ? 'Use the joystick to drive and the <kbd>E</kbd> button to play.' : 'Drive with <kbd>WASD</kbd> or arrows, <kbd>E</kbd> to play. Try knocking over the big letters!'}</p>`,
      { accent: PALETTE.candy },
    );
  }

  private onAction() {
    if (!this.running || this.ui.hud.hidden) return;
    if (this.mode === 'rocket') return this.rocket.action();
    if (this.mode === 'striker') return this.striker.action();
    if (this.mode === 'coaster') return this.ride.cycleCamera();
    if (this.mode !== 'drive') return;
    const z = this.zones.active;
    if (!z) return;
    switch (z) {
      case 'coaster':
      case 'falcon': {
        const c = z === 'falcon' ? this.falcon : this.stack;
        this.startRide('coaster', () => {
          this.ride = c;
          c.start();
        });
        break;
      }
      case 'rocket':
        this.startRide('rocket', () => this.rocket.start());
        break;
      case 'striker':
        this.mode = 'striker';
        this.car.enabled = false;
        this.ui.rideExit(true);
        this.ui.prompt('', '', '');
        this.striker.start();
        this.panelZone = 'striker';
        break;
      case 'crates':
        this.crates.restack();
        this.ui.score(null);
        this.showZonePanel('crates');
        break;
      case 'ferris':
      case 'booth':
        this.showZonePanel(z);
        this.sfx.chime();
        break;
    }
  }

  private showZonePanel(z: ZoneId) {
    this.panelZone = z;
    const html = z === 'crates' ? this.crates.panelHtml() : z === 'ferris' ? this.ferris.panelHtml() : this.booth.panelHtml();
    const accent = z === 'crates' ? PALETTE.teal : z === 'ferris' ? PALETTE.violet : PALETTE.candy;
    this.ui.panel(`${z}-${Date.now()}`, html, { accent });
  }

  private startRide(mode: Mode, start: () => void) {
    this.ui.prompt('', '', '');
    this.car.enabled = false;
    this.fade(() => {
      this.mode = mode;
      this.ui.cinematic(true);
      this.ui.rideExit(true);
      start();
    });
  }

  private onEscape() {
    if (this.mode === 'coaster') this.fade(() => this.ride.exit());
    else if (this.mode === 'rocket') this.fade(() => this.rocket.exit());
    else if (this.mode === 'striker') this.striker.exit();
    else {
      if (this.zones.active === 'crates') this.cratesDismissed = true;
      this.ui.hidePanel();
      this.panelZone = null;
    }
  }

  private endRide() {
    this.camera.up.set(0, 1, 0);
    const wasRide = this.mode === 'coaster' || this.mode === 'rocket';
    const from = this.mode;
    this.mode = 'drive';
    this.car.enabled = true;
    this.ui.cinematic(false);
    this.ui.rideExit(false);
    this.ui.countdown(null);
    this.panelZone = from === 'striker' ? 'striker' : from === 'coaster' ? (this.ride === this.falcon ? 'falcon' : 'coaster') : 'rocket';
    if (wasRide) this.updateDriveCamera(1, true);
  }

  private fade(mid: () => void) {
    this.fadeEl.classList.add('on');
    setTimeout(() => {
      mid();
      requestAnimationFrame(() => this.fadeEl.classList.remove('on'));
    }, 320);
  }

  teleport(id: ZoneId) {
    if (this.mode === 'striker') this.striker.exit();
    if (this.mode !== 'drive') return;
    const z = ZONES[id];
    this.fade(() => {
      // park just in front of the trigger ring so the prompt shows up immediately
      this.car.reset(z.x, z.z, z.heading);
      this.updateDriveCamera(1, true);
    });
  }

  private resize() {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.camera.aspect = w / h;
    // portrait screens need a wider view
    this.camera.fov = w / h < 0.8 ? 58 : 42;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(w, h);
    this.post?.setSize(w, h);
  }

  private updateDriveCamera(dt: number, snap = false) {
    const p = this.car.position;
    const vel = this.car.body.velocity;
    const portrait = this.camera.aspect < 0.8;
    const offset = new THREE.Vector3(0, 17, 21).multiplyScalar(this.zoom * (portrait ? 1.25 : 1));
    const target = new THREE.Vector3(p.x + vel.x * 0.25, 1.2, p.z + vel.z * 0.25);
    const k = snap ? 1 : 1 - Math.exp(-dt * 4);
    this.camTarget.lerp(target, k);
    this.camPos.lerp(target.clone().add(offset), k);
    if (snap) {
      this.camTarget.copy(target);
      this.camPos.copy(target).add(offset);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.time.t += dt;
    const t = this.time.t;

    this.input.update();
    this.car.update(dt, this.input); // car.enabled is false during rides

    this.world.step(1 / 60, dt, 4);
    for (const d of this.ctx.dynamics) {
      d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
      d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
    }
    this.car.sync();

    for (const u of this.updatables) u.update(dt, t);
    this.updateCoasterAudio();
    if (this.mode === 'drive') this.updateMinimap(dt);
    wind.uTime.value = t;
    wind.uCar.value.copy(this.car.position);

    // camera + shadow focus per mode
    if (this.mode === 'coaster') {
      this.zones.setVisible(false);
      this.ride.updateCamera(this.camera, dt);
      this.env.follow(this.ride.trainPosition.clone().setY(0));
    } else if (this.mode === 'rocket') {
      this.camera.up.set(0, 1, 0);
      this.zones.setVisible(false);
      this.rocket.updateCamera(this.camera, dt);
      this.env.follow(new THREE.Vector3(LAYOUT.rocket.x, 0, LAYOUT.rocket.z));
    } else if (this.mode === 'striker') {
      this.camera.up.set(0, 1, 0);
      this.zones.setVisible(false);
      const s = new THREE.Vector3(LAYOUT.striker.x, 0, LAYOUT.striker.z);
      this.camPos.lerp(s.clone().add(new THREE.Vector3(6, 7, 15)), 1 - Math.exp(-dt * 3));
      this.camTarget.lerp(s.clone().setY(5), 1 - Math.exp(-dt * 3));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
      this.env.follow(s);
    } else {
      this.camera.up.set(0, 1, 0); // the coaster cam may have rolled it
      this.updateDriveCamera(dt);
      this.env.follow(this.car.position);
      this.zones.setVisible(true);
      this.updateZones(t);
    }

    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.lookAt(this.debugCam.look);
    }

    // grass/LOD focus: what the camera is looking at while driving, the camera itself on rides
    if (this.mode === 'drive' && !this.debugCam) this.focus.copy(this.camTarget);
    else this.focus.copy(this.camera.position);
    this.env.update(t, this.focus);

    if (this.adaptive.update(dt)) {
      this.renderer.setPixelRatio(this.quality.dpr * this.adaptive.scale);
      this.resize();
    }
    this.post.render(dt);
  }

  private updateMinimap(dt: number) {
    const q = this.car.group.quaternion;
    // yaw from the quaternion (the car only ever rotates about y)
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    const p = this.car.position;
    this.minimap.update(dt, { x: p.x, z: p.z, heading }, [
      { x: this.stack.trainPosition.x, z: this.stack.trainPosition.z, color: PALETTE.mustard },
      { x: this.falcon.trainPosition.x, z: this.falcon.trainPosition.z, color: PALETTE.teal },
    ]);
  }

  /** One shared set of coaster sounds: the ride you're on, otherwise the nearest ghost train. */
  private updateCoasterAudio() {
    if (this.mode === 'coaster') {
      const c = this.ride;
      this.sfx.setCoaster(Math.min(1, c.speed / (c === this.falcon ? 60 : 30)), c.launching, true);
      return;
    }
    let best = 0;
    let launching = false;
    for (const c of [this.stack, this.falcon]) {
      const near = Math.max(0, 1 - c.trainPosition.distanceTo(this.camera.position) / 90);
      const level = Math.min(1, c.speed / 30) * near;
      if (level > best) {
        best = level;
        launching = c.launching && near > 0.4;
      }
    }
    this.sfx.setCoaster(best, launching, false);
  }

  /** Dev-only helpers: ?cam=x,y,z,lx,ly,lz pins the camera; window.__game for scripting. */
  private setupDebug() {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __game: Game }).__game = this;
    const cam = new URLSearchParams(location.search).get('cam');
    if (cam) {
      const n = cam.split(',').map(Number);
      this.debugCam = { pos: new THREE.Vector3(n[0], n[1], n[2]), look: new THREE.Vector3(n[3], n[4], n[5]) };
    }
  }

  /** Dev helper used by screenshot scripts. */
  debugAction(zone: ZoneId) {
    const z = ZONES[zone];
    this.car.reset(z.x, z.z, z.heading);
    this.zones.update(this.car.position, this.time.t);
    this.onAction();
  }

  private updateZones(t: number) {
    const zone = this.zones.update(this.car.position, t);
    this.ui.highlightNav(zone);
    if (zone) {
      const z = ZONES[zone];
      this.ui.prompt(zone, z.title, z.action);
      if (zone === 'crates' && this.panelZone !== 'crates' && !this.cratesDismissed) this.showZonePanel('crates');
    } else {
      this.ui.prompt('', '', '');
    }
    if (zone !== 'crates') this.cratesDismissed = false;

    // close a zone's panel once you drive well away from it
    if (this.panelZone) {
      const z = ZONES[this.panelZone];
      if (Math.hypot(this.car.position.x - z.x, this.car.position.z - z.z) > 28) {
        this.ui.hidePanel();
        this.panelZone = null;
      }
    }
    // crate score badge only near the stall
    const dCrates = Math.hypot(this.car.position.x - LAYOUT.crates.x, this.car.position.z - LAYOUT.crates.z);
    if (dCrates > 30 || this.crates.knockedCount === 0) this.ui.score(null);
  }
}
