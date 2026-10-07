# The Funfair — a 3D theme park in the browser

Walk around a low-poly funfair at dusk as a fully animated visitor:

| Attraction | What it is |
| --- | --- |
| 🎪 Entrance + physical letters | Knock over the giant **FUNFAIR** letters (Bruno Simon style) |
| 🎢 Thunder Loop | A launched steel coaster **you drive**: throttle, brakes and turbo, real physics (roll back if you're too slow), loop, zero-g roll, airtime hill, helix and tunnel |
| 🦅 Sky Falcon | A 4.25 km cliff coaster modelled on Falcons Flight: 158 m drop at 90°, 250 km/h |
| 🚀 Rocket Ride | Countdown, lift-off, stage separation: fire six stages up to orbit |
| 🥫 Crate Smash | 22 physics crates worth 10, 25 or 50 points; ram them for a high score |
| 🔔 High Striker | Timing mini-game: swing the hammer and ring the bell |
| 🎡 Giant Wheel | A full-size tribute to Ain Dubai, the tallest observation wheel on Earth: 250 m tall, 48 capsules, 192 cable spokes, four 126 m legs. Ride it from inside a capsule (time-lapse of the real 38-minute turn) |
| 🎟️ Ticket Booth | Park guide |

Stack: **Vite + TypeScript + Three.js + cannon-es + postprocessing + N8AO**. The world is built procedurally and all sound is synthesized with WebAudio; the one model file is the visitor, "Casual Character" by [Quaternius](https://quaternius.com) (CC0, from [Poly Pizza](https://poly.pizza/m/kZ3DmIoGip)).

## The coaster

The track is built like in real coaster-design tools (`src/world/attractions/track.ts`). It's a list of elements (straights, clothoid-eased banked turns, hills, a teardrop loop, a heartline roll, a helix) that a turtle integrates into a heartline. The rails hang below it, so inversions rotate around the riders. A Hermite connector closes the circuit.

- **Physics** (`stepRide`): gravity along the track, driver motors (`W`), brakes (`S`), turbo (`Shift`), an automatic launch, station tyres, trim brakes, drag and rolling resistance. Coasting does a lap in ~35 s at up to 83 km/h, with −1 to 5.5 G and under 1.5 G sideways. Full throttle laps in ~15 s.
- **Cameras** (`C`, or the E button on touch): Driver (the horizon rolls with the track), Chase, and Trackside.
- **HUD**: speed, live G-meter (grey-out/red-out vignette at extreme G), lap timer and best lap (kept in the browser).
- A ghost train runs laps when nobody is riding.
- To change the layout, edit `LAYOUT_ELEMENTS`. Keep the end of the element list close to the station, because the closing connector fills the gap. Re-check self-intersections and ground clearance after changes.

## Sky Falcon (the mega-coaster)

A tribute to Falcon's Flight, the record-breaking cliff coaster at Six Flags Qiddiya near Riyadh. Board it from the 🦅 station at the east gate.

- **4,247 m of track** (`src/world/attractions/falcon-track.ts`), laid out from the real ride's published stats and checked against a front-row POV video (4,250 m, 250 km/h, 158 m drop at 90°, 163 m hill, no inversions). Dispatch turns right onto a 39 km/h LSM lift, then a twisted drop, airtime hills and an overbanked turn near the giant hill. A **160 km/h LSM launch** fires the train up the cliff; a slow, twisting clifftop section leads to the edge. The train then drops **158 m at 90° down a channel cut into the cliff**, straight into a **keyhole tunnel portal** with a sunburst frame. An LSM launch out of the tunnel fires it at the park at **250 km/h**, over the **163 m hill on its lattice tower**, back up into a high overbanked turn, through a dive, a wave turn and airtime hills, under the overbanked turn, and along the park's edge to the brakes. Turn radii and hill shapes are fitted to the park; the exact plan isn't public.
- **Trackside scenery** (`src/world/trackside.ts`): trees, shrubs, rocks and red-banded marker posts line the Falcon wherever it runs close to the ground, so you can feel the speed.
- **The mountain** (`src/world/mountain.ts`) is generated from the track: a sandstone table mountain with strata, a sheer wall behind the drop, a ridge carrying the launch up the cliff, a narrow channel the drop falls down, the keyhole portal and the rock that buries the tunnel, and an earth embankment that brings the track down to the desert. Every other part of the track is guaranteed to clear the rock. The strata are painted in the shader from world height.
- Same driving controls, cameras and HUD as Thunder Loop. Both coasters share one physics model (`stepRide`) with per-ride tuning (`FALCON_PHYS`). Its trees, fence posts and support columns keep clear of both tracks (`src/world/rides.ts`).
- A coasting lap takes ~170 s, peaking at 250 km/h with −1.6 to 4.7 G and up to 2.1 G sideways. Trains have four cars and a single-row lead car, for 14 riders.

## Graphics

- **Physically based sunset sky** (Preetham scattering with drifting clouds). The same sky is baked into an environment map, so every glossy surface reflects it: clearcoat paint on the rocket and letters, chrome, gilded lettering and metallic coaster rails.
- **HDR pipeline**: scene → N8AO ambient occlusion (half-res) → bloom + ACES filmic tone mapping + vignette (one merged pass) → SMAA. Marquee bulbs, lamps, string lights and engine flames render above 1.0, so they glow through the bloom.
- **Time of day**: the full day/night cycle is built in (`src/world/environment.ts`, `src/world/time-control.ts`), but for now the park is held at a sunny 16:00 and the clock panel is switched off (`TIME_CONTROLS` in `Game.ts`). Clouds drift across the sky and the sun is a small disc with a soft glow. In development, `?hour=13` jumps to a time.
- **Atmosphere**: fog that blends to orange toward the sun and violet away from it, layered horizon hills, stars that fade in as the rocket reaches space, and fireflies.
- **Living ground**: tens of thousands of instanced grass blades that sway in the wind and part around the visitor. A tiling detail normal map makes the sand and soil catch the low sun. Trees sway too, with soft volumetric foliage shading.
- **Real lights where they matter**: an engine light under the rocket, plus soft light pools under every lamp.

### Performance

- **Quality tiers** (`src/world/quality.ts`) are picked from the GPU and device type: high (dedicated GPU), medium (integrated GPU / high-end phone) and low (phones, software rendering). Tiers change AO, SMAA, shadow-map size, grass density/distance, clouds and extra lights. Force one with `?quality=low|medium|high`.
- **Adaptive resolution**: if the frame rate drops below ~48 fps, render resolution scales down (to 55% minimum) and recovers when there's headroom.
- Grass is chunked with distance LOD and frustum culling. Trees, lamps, bulbs and fences are instanced. The light count is fixed at startup, so shaders never recompile mid-ride. AO switches off in space.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Controls: `WASD`/arrows walk · `Shift` run · `Space` dodge-roll · `F` kick · `E`/`Enter` interact · `H` wave · `R` back to entrance · `Esc` exit a ride. Touch devices get a joystick + action button. Mouse wheel zooms.

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel — the framework (Vite), build command and output dir are already set in `vercel.json`.
   Or from this folder: `npx vercel` then `npx vercel --prod`.
2. **Set `SITE_URL`** (Project → Settings → Environment Variables) to your final domain.
   It is used for the canonical URL, Open Graph tags, `sitemap.xml` and `robots.txt`. Without it the build falls back to Vercel's production URL.
3. Submit `https://<your-domain>/sitemap.xml` in Google Search Console.

## Content and settings

- Rocket stages and High Striker tiers: `src/data/fair.ts`
- Park layout / zone positions: `src/world/layout.ts`
- Colors: `PALETTE` in `src/world/textures.ts` and CSS variables in `src/styles.css`
- 3D font: `node scripts/build-font.mjs` regenerates `src/assets/lilita.typeface.json` (add characters to `CHARS` if you need more glyphs in 3D text)
- The page has Open Graph / Twitter cards (`public/og-image.jpg`), a web manifest and icons; `sitemap.xml` and `robots.txt` are generated during the build. The 3D world is code-split and loads after the intro card has rendered.

## Project structure

```
index.html              page shell + intro card + HUD markup
vite.config.ts          site URL, sitemap and robots.txt
src/main.ts             intro card, lazy-loads the 3D world
src/data/fair.ts        rocket stages and striker tiers
src/world/Game.ts       renderer, physics, loop, camera modes, interactions
src/world/player.ts     the visitor: walk/run/roll/kick/wave controls and physics on a crowd rig
src/world/crowd/        the park's guests: people.ts (rig, outfits, animation), pets.ts (dogs, leashes),
                        crowd.ts (parties, queues, coaster boarding, benches, kids' play), nav.ts + obstacles.ts (walking)
public/models/guests.glb       "Universal Base Characters" by Quaternius (CC0): bodies + hairstyles
public/models/guest-anims.glb  "Universal Animation Library" by Quaternius (CC0): a curated set of clips
public/models/dog-*.glb        Shiba Inu and Husky by Quaternius (CC0, via Poly Pizza)
src/world/subdivide.ts  rounds off faceted models at load: welds, one Loop subdivision, smooth normals, blended skin weights
src/world/environment.ts sky, lights, ground, trees, lamps, tents, balloons
src/world/attractions/  coaster, rocket, crates, striker, ferris/carousel/booth/arch
```

In development, `?cam=x,y,z,lookX,lookY,lookZ` pins the camera (handy for screenshots) and `window.__game` is exposed for debugging; both are stripped from production builds.
