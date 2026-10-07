# The Funfair — a 3D theme park in the browser

Drive a car around a low-poly funfair at dusk:

| Attraction | What it is |
| --- | --- |
| 🎪 Entrance + physical letters | Knock over the giant **FUNFAIR** letters (Bruno Simon style) |
| 🎢 Thunder Loop | A launched steel coaster **you drive**: throttle, brakes and turbo, real physics (roll back if you're too slow), loop, zero-g roll, airtime hill, helix and tunnel |
| 🦅 Sky Falcon | A 4.25 km cliff coaster modelled on Falcons Flight: 158 m drop at 90°, 250 km/h |
| 🚀 Rocket Ride | Countdown, lift-off, stage separation: fire six stages up to orbit |
| 🥫 Crate Smash | 22 physics crates worth 10, 25 or 50 points; ram them for a high score |
| 🔔 High Striker | Timing mini-game: swing the hammer and ring the bell |
| 🎡 Ferris Wheel | The best view in the park |
| 🎟️ Ticket Booth | Park guide |

Stack: **Vite + TypeScript + Three.js + cannon-es + postprocessing + N8AO**. No 3D model files — everything is built procedurally, and all sound is synthesized with WebAudio.

## The coaster

The track is built like in real coaster-design tools (`src/world/attractions/track.ts`). It's a list of elements (straights, clothoid-eased banked turns, hills, a teardrop loop, a heartline roll, a helix) that a turtle integrates into a heartline. The rails hang below it, so inversions rotate around the riders. A Hermite connector closes the circuit.

- **Physics** (`stepRide`): gravity along the track, driver motors (`W`), brakes (`S`), turbo (`Shift`), an automatic launch, station tyres, trim brakes, drag and rolling resistance. Coasting does a lap in ~35 s at up to 83 km/h, with −1 to 5.5 G and under 1.5 G sideways. Full throttle laps in ~15 s.
- **Cameras** (`C`, or the E button on touch): Driver (the horizon rolls with the track), Chase, and Trackside.
- **HUD**: speed, live G-meter (grey-out/red-out vignette at extreme G), lap timer and best lap (kept in the browser).
- A ghost train runs laps when nobody is riding.
- To change the layout, edit `LAYOUT_ELEMENTS`. Keep the end of the element list close to the station, because the closing connector fills the gap. Re-check self-intersections and ground clearance after changes.

## Sky Falcon (the mega-coaster)

A tribute to Falcon's Flight, the record-breaking cliff coaster at Six Flags Qiddiya near Riyadh. Board it from the 🦅 station at the east gate.

- **4,247 m of track** (`src/world/attractions/falcon-track.ts`), following the real ride's published sequence and stats (4,250 m, 250 km/h, 158 m drop at 90°, 163 m arch, no inversions). Dispatch turns right onto a 39 km/h LSM lift, then a 55 m twisted drop, airtime hills, a wave turn and an extreme overbanked turn. A **160 km/h LSM launch** fires the train up the cliff face, and it climbs the rest on momentum. On top is a slow clifftop section with an overbanked turn. Brakes hold the train at the edge, then it drops **158 m at 90° into a tunnel**. An LSM launch out of the tunnel takes it downhill to **250 km/h**. Heavy trims slow it on the way up the **163 m arch**, then speed turns run around the park boundary and over the main entrance. The final brake run ends with a right turn into the station. The real track plan isn't public, so turn radii, hill shapes and the route are fitted to the park.
- **The mountain** (`src/world/mountain.ts`) is generated from the track: a sandstone table mountain with strata, a sheer wall behind the drop, and a ridge carrying the launch up the cliff. Every other part of the track is guaranteed to clear the rock. The strata are painted in the shader from world height.
- Same driving controls, cameras and HUD as Thunder Loop. Both coasters share one physics model (`stepRide`) with per-ride tuning (`FALCON_PHYS`). Its trees, fence posts and support columns keep clear of both tracks (`src/world/rides.ts`).
- A coasting lap takes ~170 s, peaking at 250 km/h with −1.6 to 4.7 G and up to 2.1 G sideways. Trains have four cars and a single-row lead car, for 14 riders.

## Graphics

- **Physically based sunset sky** (Preetham scattering with drifting clouds). The same sky is baked into an environment map, so every glossy surface reflects it: clearcoat paint on the car, rocket and letters, chrome, gilded lettering and metallic coaster rails.
- **HDR pipeline**: scene → N8AO ambient occlusion (half-res) → bloom + ACES filmic tone mapping + vignette (one merged pass) → SMAA. Marquee bulbs, lamps, string lights and engine flames render above 1.0, so they glow through the bloom.
- **Atmosphere**: fog that blends to orange toward the sun and violet away from it, layered horizon hills, stars that fade in as the rocket reaches space, and fireflies.
- **Living ground**: tens of thousands of instanced grass blades that sway in the wind and part around the car. A tiling detail normal map makes the sand and soil catch the low sun. Trees sway too, with soft volumetric foliage shading.
- **Real lights where they matter**: headlight spotlight on the car, an engine light under the rocket, plus soft light pools under every lamp.

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

Controls: `WASD`/arrows drive · `Shift` boost · `E`/`Enter`/`Space` interact · `R` back to entrance · `H` honk · `Esc` exit a ride. Touch devices get a joystick + action button. Mouse wheel zooms.

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
src/world/car.ts        sports car (arcade physics, spinning/steering wheels, suspension)
src/world/environment.ts sky, lights, ground, trees, lamps, tents, balloons
src/world/attractions/  coaster, rocket, crates, striker, ferris/carousel/booth/arch
```

In development, `?cam=x,y,z,lookX,lookY,lookZ` pins the camera (handy for screenshots) and `window.__game` is exposed for debugging; both are stripped from production builds.
