# Hasan's Funfair — an interactive 3D CV

Drive a bumper car around a low-poly funfair at dusk and explore Hasan Hmedeh's CV:

| Attraction | What it shows |
| --- | --- |
| 🎪 Entrance + physical name letters | Knock over **HASAN HMEDEH** (Bruno Simon style) |
| 🎢 The Stack (Projects Coaster) | A launched steel coaster **you drive**: throttle, brakes and turbo, real physics (roll back if you're too slow), loop, zero-g roll, airtime hill, helix and tunnel. Billboards along the track are projects |
| 🚀 Career Rocket | Countdown, lift-off, stage separation — each ring in the sky is a career milestone (2019 → today) |
| 🥫 Skill Smash | 22 physics crates, one per skill — ram them to light them up |
| 🔔 High Striker | Timing mini-game; each tier unlocks an achievement |
| 🎡 Ferris Wheel | About me, languages, education |
| 🎟️ Ticket Booth | Email, GitHub, LinkedIn, PDF download |

Stack: **Vite + TypeScript + Three.js + cannon-es + postprocessing + N8AO**. No 3D model files — everything is built procedurally, and all sound is synthesized with WebAudio.

## The coaster

The track is built like in real coaster-design tools (`src/world/attractions/track.ts`). It's a list of elements (straights, clothoid-eased banked turns, hills, a teardrop loop, a heartline roll, a helix) that a turtle integrates into a heartline. The rails hang below it, so inversions rotate around the riders. A Hermite connector closes the circuit.

- **Physics** (`stepRide`): gravity along the track, driver motors (`W`), brakes (`S`), turbo (`Shift`), an automatic launch, station tyres, trim brakes, drag and rolling resistance. Coasting does a lap in ~35 s at up to 83 km/h, with −1 to 5.5 G and under 1.5 G sideways. Full throttle laps in ~15 s.
- **Cameras** (`C`, or the E button on touch): Driver (the horizon rolls with the track), Chase, and Trackside.
- **HUD**: speed, live G-meter (grey-out/red-out vignette at extreme G), lap timer and best lap (kept in the browser).
- A ghost train runs laps when nobody is riding.
- To change the layout, edit `LAYOUT_ELEMENTS`. Keep the end of the element list close to the station, because the closing connector fills the gap. Re-check self-intersections and ground clearance after changes.

## Graphics

- **Physically based sunset sky** (Preetham scattering with drifting clouds). The same sky is baked into an environment map, so every glossy surface reflects it: clearcoat paint on the bumper car, rocket and letters, chrome, gilded lettering and metallic coaster rails.
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
2. **Set `SITE_URL`** (Project → Settings → Environment Variables) to your final domain, e.g. `https://hasanhmedeh.com`.
   It is used for the canonical URL, Open Graph tags, JSON-LD, `sitemap.xml` and `robots.txt`. Without it the build falls back to Vercel's production URL.
3. Submit `https://<your-domain>/sitemap.xml` in Google Search Console.

## SEO — how it works

The 3D world is a progressive enhancement on top of a fully static, crawlable page:

- `src/data/cv.ts` is the single source of truth. At build time `seo/render.ts` turns it into semantic HTML (`<h1>`, sections, `<time>`, lists) inside `index.html`, so crawlers and no-JS visitors get the full CV instantly. It also powers the "Classic CV" drawer and the print stylesheet.
- JSON-LD `ProfilePage` + `Person` + `WebSite` structured data, canonical URL, Open Graph / Twitter cards (`public/og-image.jpg`), web manifest and icons.
- `sitemap.xml` and `robots.txt` are generated during the build.
- Fast first paint: the initial HTML + CSS + JS is ≈11 KB gzipped. The 3D world (~375 KB gzipped) is code-split and loaded only after the page has rendered.
- Graceful fallbacks: no WebGL 2 → the button opens the classic CV; no JS → the CV is shown as a normal page.

## Updating the CV

Edit `src/data/cv.ts` — experience, skills, languages, the coaster's `projects`, the rocket's `timeline` and the striker's `achievements` all live there. Replace `public/hasan-hmedeh-cv.pdf` with the latest PDF.

Other knobs:
- Park layout / zone positions: `src/world/layout.ts`
- Colors: `PALETTE` in `src/world/textures.ts` and CSS variables in `src/styles.css`
- 3D font: `node scripts/build-font.mjs` regenerates `src/assets/lilita.typeface.json` (add characters to `CHARS` if you need more glyphs in 3D text)

## Project structure

```
index.html              page shell + SEO meta (CV HTML is injected at build time)
vite.config.ts          SEO plugin: renders CV HTML, JSON-LD, sitemap, robots
seo/render.ts           CV → HTML / JSON-LD
src/main.ts             intro, classic CV drawer, lazy-loads the 3D world
src/data/cv.ts          the CV content
src/world/Game.ts       renderer, physics, loop, camera modes, interactions
src/world/car.ts        bumper car (arcade physics)
src/world/environment.ts sky, lights, ground, trees, lamps, tents, balloons
src/world/attractions/  coaster, rocket, crates, striker, ferris/carousel/booth/arch
```

In development, `?cam=x,y,z,lookX,lookY,lookZ` pins the camera (handy for screenshots) and `window.__game` is exposed for debugging; both are stripped from production builds.
