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
| 🏎️ Turbo Speedway | Kart racing: three laps against three rivals on a circuit outside the south-west fence, with cones, hay bales, tyre stacks, oil slicks and boost pads laid out fresh every race |
| 🌀 Sky Flip | A giant swing that goes right over the top, head over heels 125 m up |
| 🛸 Nebula 360 | A looping pendulum ship, after the 360° rides at travelling fairs |
| 🚁 Drone Flights | Rent a camera drone and fly over the whole fair |
| 🎟️ Ticket Booth | Park guide |

Stack: **Vite + TypeScript + Three.js + cannon-es + postprocessing + N8AO** for the game, **NestJS + Prisma + PostgreSQL** for accounts, in a **pnpm + Turborepo** monorepo. The world is built procedurally and all sound is synthesized with WebAudio; the one model file is the visitor, "Casual Character" by [Quaternius](https://quaternius.com) (CC0, from [Poly Pizza](https://poly.pizza/m/kZ3DmIoGip)).

## Accounts, tickets & rides

Anyone can walk in as a guest and explore the park, knock over the letters and visit the Ticket Booth. **Every attraction needs tickets, and tickets need a free account.**

- **Ticket counter:** the 🎟️ Ticket Booth sells packs of **20 tickets**, free for now. A pack is added to whatever you have left. You can buy **once every 5 hours**, counted from your last purchase (skipped windows don't stack up). The counter shows your balance, a countdown to the next pack, prices and your purchase history.
- **Prices:** every ride and game costs **1 ticket**; the **Giant Wheel** and **Sky Falcon** cost **5**.
- **One round per ticket:** boarding spends the tickets, the attraction runs one round and ends on its own (leaving early still uses the ticket), and a results screen shows that round's statistics with personal bests. Riding again costs another ticket.
- **Saved per user:** every purchase and every round, with its statistics. Players can download all their data or delete their account from the account menu in the HUD.
- **Terms & privacy:** signing up requires accepting the [Terms of Service](apps/web/terms.html) and [Privacy Policy](apps/web/privacy.html) (served at `/terms` and `/privacy`). Fill in the highlighted placeholders before launch.

The rules are enforced on the server, not just in the page: the balance, the 5-hour cooldown and ticket spending are atomic database updates, so double clicks or parallel requests can't buy twice or overspend. Round statistics are reported by the browser, so they're for fun, not for anything valuable. The session is an httpOnly cookie, so the page never sees the token. If the API is down, the fair still opens for guests.

## Run it

### Prerequisites

- **Node.js 24+**
- **pnpm 12** (the exact version is pinned in the root `package.json`)
- **PostgreSQL 16** running locally (or anywhere you can reach)

### One command

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs Turborepo, which in order:

1. creates `apps/api/.env` from `apps/api/.env.example` on the first run, with a freshly generated `JWT_SECRET` (an existing `.env` is never touched),
2. generates the Prisma client,
3. applies the database migrations (creating the database if it doesn't exist yet),
4. starts the API on **http://localhost:3000** (`nest start --watch`) and the game on **http://localhost:5173** (Vite), and opens the browser. Set `BROWSER=none` to skip that.

The Vite dev server proxies `/api` to the API, so the browser stays on one origin and the session cookie just works.

### Settings

The API reads `apps/api/.env` (variables set in the real environment win). The defaults expect PostgreSQL at `postgresql://postgres:postgres@localhost:5432/funfair`. If yours is different, edit `DATABASE_URL` and run `pnpm dev` again. To set it up by hand instead:

```bash
cp apps/api/.env.example apps/api/.env
# then set DATABASE_URL to your Postgres, and JWT_SECRET to a long random string:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs the session cookie: at least 32 characters. Changing it signs everyone out |
| `PORT` | API port (default 3000; the Vite proxy expects 3000) |
| `WEB_ORIGIN` | Comma-separated origins allowed to call the API cross-site with cookies (default `http://localhost:5173`) |
| `NODE_ENV` | `development`, `production` or `test`. In production the cookie is marked `Secure` |
| `TRUST_PROXY` | Optional Express "trust proxy" value (default `loopback`), so rate limits see the visitor's real IP behind a proxy |

If something is missing or wrong, the API lists every problem at startup and exits.

### Other scripts

Run from the repo root:

```bash
pnpm build                                  # type-check + production builds (apps/web/dist, apps/api/dist), cached by Turborepo
pnpm typecheck                              # type-check both apps
pnpm --filter @funfair/api db:migrate       # after editing prisma/schema.prisma: write and apply a migration (add --name <change>)
pnpm --filter @funfair/api db:generate      # regenerate the Prisma client (pnpm dev/build/typecheck do this for you)
pnpm --filter @funfair/api db:studio        # browse the database in Prisma Studio
pnpm --filter @funfair/web preview          # serve the web production build
```

## Repository layout

```
apps/web/        the game: Vite + TypeScript + Three.js (package @funfair/web)
apps/api/        accounts and ride tickets: NestJS + Prisma + PostgreSQL (package @funfair/api)
turbo.json       the task pipeline: env:init → db:generate / db:deploy → dev, build, typecheck
package.json     root scripts: pnpm dev | build | typecheck
```

```
apps/api/
  prisma/schema.prisma      users, ticket_purchases, ride_rounds and the attraction enum; migrations/ next to it
  prisma.config.ts          Prisma CLI config: loads apps/api/.env
  scripts/init-env.mjs      creates .env on the first `pnpm dev`
  src/main.ts               /api prefix, cookies, validation, CORS
  src/config/env.ts         validates the environment at startup
  src/auth/                 signup (terms), login, logout, me, data export, account deletion; scrypt passwords, JWT session cookie, rate limits
  src/tickets/              ticket balance, 20-ticket packs, 5-hour cooldown, purchase history
  src/rides/                attractions + costs, boarding (spends tickets), rounds and their stats
  src/health/               GET /api/health
  src/generated/prisma/     the generated client (not committed)
```

## API

Every route is under `/api`. The session is an httpOnly, `SameSite=Lax` cookie named `funfair_session` holding a 30-day JWT. Errors use Nest's usual body, `{ statusCode, message, error }`, where `message` is a string or, for validation errors, a list of strings.

| Method | Path | Auth | Answers |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | | Body `{ email, username, password, acceptTerms: true }` → **201** `{ user }` and sets the cookie. Username: 3–20 letters, digits or `_`, unique ignoring case. Password: 8–72 characters. **409** if the email or username is taken, **400** if invalid or the terms aren't accepted |
| `POST` | `/api/auth/login` | | Body `{ email, password }` → **200** `{ user }` and sets the cookie. **401** `Wrong email or password` |
| `POST` | `/api/auth/logout` | | **204**, clears the cookie |
| `GET` | `/api/auth/me` | ✔ | **200** `{ user }`, or **401** |
| `GET` | `/api/auth/me/export` | ✔ | **200** JSON download of everything stored about the user (profile, tickets, purchases, rounds) |
| `DELETE` | `/api/auth/me` | ✔ | Body `{ password }` → **204**, deletes the account and all its data. **401** `Wrong password` |
| `GET` | `/api/tickets` | ✔ | **200** `{ balance, packSize, cooldownHours, lastPurchaseAt, nextPurchaseAt, canBuy, costs }` |
| `POST` | `/api/tickets/purchase` | ✔ | **201** `{ balance, purchase, nextPurchaseAt, canBuy }`. **409** with `nextPurchaseAt` during the cooldown |
| `GET` | `/api/tickets/purchases` | ✔ | **200** `{ purchases }`, newest first (`?limit=`, default 50) |
| `POST` | `/api/rides/:ride/board` | ✔ | Spends the tickets and opens a round: **201** `{ round: { id, ride, ticketsSpent, startedAt }, balance }`. **402** `{ needed, balance }` when short, **401** for guests, **400** for an unknown attraction |
| `POST` | `/api/rides/rounds/:id/finish` | ✔ | Body `{ completed, stats }` (up to 16 numeric stats) → **200** `{ round, history: { rounds, best } }`, where `best` is the min/max of each stat over earlier completed rounds. **409** if already finished, **404** if not yours |
| `GET` | `/api/rides/stats` | ✔ | **200** `{ totalRounds, ticketsSpent, byRide }`, with every attraction listed |
| `GET` | `/api/rides/history` | ✔ | **200** `{ rounds }`, newest first (`?limit=`, default 20) |
| `GET` | `/api/health` | | **200** `{ ok: true, db: 'up' }`, or **503** if the database is unreachable |

`user` is `{ id, email, username, createdAt }`. Attraction ids are `coaster`, `falcon`, `rocket`, `ferris`, `flip`, `ship`, `speedway`, `drone`, `crates` and `striker`; costs, pack size and cooldown live in `apps/api/src/rides/attractions.ts`. Signup, login and account deletion are each limited to 10 requests a minute per IP (**429**, with `Retry-After`).

## The coaster

The track is built like in real coaster-design tools (`apps/web/src/world/attractions/track.ts`). It's a list of elements (straights, clothoid-eased banked turns, hills, a teardrop loop, a heartline roll, a helix) that a turtle integrates into a heartline. The rails hang below it, so inversions rotate around the riders. A Hermite connector closes the circuit.

- **Physics** (`stepRide`): gravity along the track, driver motors (`W`), brakes (`S`), turbo (`Shift`), an automatic launch, station tyres, trim brakes, drag and rolling resistance. Coasting does a lap in ~35 s at up to 83 km/h, with −1 to 5.5 G and under 1.5 G sideways. Full throttle laps in ~15 s.
- **Cameras** (`C`, or the E button on touch): Driver (the horizon rolls with the track), Chase, and Trackside.
- **HUD**: speed, live G-meter (grey-out/red-out vignette at extreme G), lap timer and best lap (kept in the browser).
- A ghost train runs laps when nobody is riding.
- To change the layout, edit `LAYOUT_ELEMENTS`. Keep the end of the element list close to the station, because the closing connector fills the gap. Re-check self-intersections and ground clearance after changes.

## Sky Falcon (the mega-coaster)

A tribute to Falcon's Flight, the record-breaking cliff coaster at Six Flags Qiddiya near Riyadh. Board it from the 🦅 station at the east gate.

- **4,247 m of track** (`apps/web/src/world/attractions/falcon-track.ts`), laid out from the real ride's published stats and checked against a front-row POV video (4,250 m, 250 km/h, 158 m drop at 90°, 163 m hill, no inversions). Dispatch turns right onto a 39 km/h LSM lift, then a twisted drop, airtime hills and an overbanked turn near the giant hill. A **160 km/h LSM launch** fires the train up the cliff; a slow, twisting clifftop section leads to the edge. The train then drops **158 m at 90° down a channel cut into the cliff**, straight into a **keyhole tunnel portal** with a sunburst frame. An LSM launch out of the tunnel fires it at the park at **250 km/h**, over the **163 m hill on its lattice tower**, back up into a high overbanked turn, through a dive, a wave turn and airtime hills, under the overbanked turn, and along the park's edge to the brakes. Turn radii and hill shapes are fitted to the park; the exact plan isn't public.
- **Trackside scenery** (`apps/web/src/world/trackside.ts`): trees, shrubs, rocks and red-banded marker posts line the Falcon wherever it runs close to the ground, so you can feel the speed.
- **The mountain** (`apps/web/src/world/mountain.ts`) is generated from the track: a sandstone table mountain with strata, a sheer wall behind the drop, a ridge carrying the launch up the cliff, a narrow channel the drop falls down, the keyhole portal and the rock that buries the tunnel, and an earth embankment that brings the track down to the desert. Every other part of the track is guaranteed to clear the rock. The strata are painted in the shader from world height.
- Same driving controls, cameras and HUD as Thunder Loop. Both coasters share one physics model (`stepRide`) with per-ride tuning (`FALCON_PHYS`). Its trees, fence posts and support columns keep clear of both tracks (`apps/web/src/world/rides.ts`).
- A coasting lap takes ~170 s, peaking at 250 km/h with −1.6 to 4.7 G and up to 2.1 G sideways. Trains have four cars and a single-row lead car, for 14 riders.

## Turbo Speedway (kart racing)

Walk down the path south-west of the entrance to the kart garage and press `E`. You start at the back of a four-kart grid; three red lights, then green.

- **The circuit** (`apps/web/src/world/attractions/speedway-track.ts`): a 472 m clockwise loop on the lawn outside the fence: a long main straight past the grandstand, a sweeping right-hander, a dip into the infield, an S and a long right-hander home. It's a Catmull-Rom spline through control points laid out in a frame facing the park, sampled every metre with its curvature. Red-and-white kerbs mark every corner, gravel traps sit on their outsides, and tyre walls line both sides 10 m from the centre line. Trees and the horizon hills keep clear of it.
- **Obstacles** (laid out again for every race, never on the grid or the run to turn one): 🟧 cones (lane closures, slaloms and gates) that go flying when you hit them; hay bales and tyre stacks that stop you dead; oil slicks that spin you round; and ⚡ boost pads. Bales, tyre stacks and oil only go on the gentler stretches, never on a corner's apex.
- **Driving** (`Speedway.step`): arcade physics. Engine and brakes act along the nose, steering yaw falls off with speed, and grip bleeds off sideways speed: less of it on grass, under the handbrake (`Space`, for drifting) or on oil. `W`/`S` drive and brake (and reverse), `A`/`D` steer, `Shift` fires the nitro (it refills slowly, and boost pads top it up), `R` puts you back on track, `C` cycles Chase / Driver / High cameras.
- **The rivals** drive the same karts. They follow a speed profile worked out from the curvature (with braking zones), steer by pure pursuit, and pick a lane round the next block of obstacles (the wider gap, and one that also clears whatever comes next). They skip boost pads that would fire them into a bend, and they're rubber-banded a little toward you. While nobody's racing, all four karts lap the circuit as a ghost race you can watch from the park.
- **HUD**: position, lap, nitro, race time, best lap, speed and live standings. Your best race, best lap and wins are kept in the browser.

## Graphics

- **Physically based sunset sky** (Preetham scattering with drifting clouds). The same sky is baked into an environment map, so every glossy surface reflects it: clearcoat paint on the rocket and letters, chrome, gilded lettering and metallic coaster rails.
- **HDR pipeline**: scene → N8AO ambient occlusion (half-res) → bloom + ACES filmic tone mapping + vignette (one merged pass) → SMAA. Marquee bulbs, lamps, string lights and engine flames render above 1.0, so they glow through the bloom.
- **Time of day**: the full day/night cycle is built in (`apps/web/src/world/environment.ts`, `apps/web/src/world/time-control.ts`), but for now the park is held at a sunny 16:00 and the clock panel is switched off (`TIME_CONTROLS` in `Game.ts`). Clouds drift across the sky and the sun is a small disc with a soft glow. In development, `?hour=13` jumps to a time.
- **Atmosphere**: fog that blends to orange toward the sun and violet away from it, layered horizon hills, stars that fade in as the rocket reaches space, and fireflies.
- **Living ground**: tens of thousands of instanced grass blades that sway in the wind and part around the visitor. A tiling detail normal map makes the sand and soil catch the low sun. Trees sway too, with soft volumetric foliage shading.
- **Real lights where they matter**: an engine light under the rocket, plus soft light pools under every lamp.

### Performance

- **Quality tiers** (`apps/web/src/world/quality.ts`) are picked from the GPU and device type: high (dedicated GPU), medium (integrated GPU / high-end phone) and low (phones, software rendering). Tiers change AO, SMAA, shadow-map size, grass density/distance, clouds and extra lights. Force one with `?quality=low|medium|high`.
- **Adaptive resolution**: if the frame rate drops below ~48 fps, render resolution scales down (to 55% minimum) and recovers when there's headroom.
- Grass is chunked with distance LOD and frustum culling. Trees, lamps, bulbs and fences are instanced. The light count is fixed at startup, so shaders never recompile mid-ride. AO switches off in space.

## Controls

`WASD`/arrows walk · `Shift` run · `Space` dodge-roll · `F` kick · `E`/`Enter` interact · `H` wave · `R` back to entrance · `M` park map · `Esc` exit a ride. Touch devices get a joystick + action button. Mouse wheel zooms.

Park map: click the minimap (or press `M`) to open a full-screen map. Drag to pan, scroll or pinch to zoom, pick a place on the map or in the legend, then pick it again (or press `Enter`) to fast travel there.

## Deploy (Vercel + Neon)

Everything runs as **one Vercel project**: the game is the static site, and the API runs as a Vercel Function on the same domain (`apps/web/api/index.js` wraps `apps/api/src/serverless.ts`; `apps/web/vercel.json` rewrites `/api/*` to it). One origin means the `SameSite=Lax` session cookie and per-visitor rate limits work exactly as in development.

On each deployment, `apps/web/vercel.json`'s build command runs from the repo root: it applies pending Prisma migrations (`db:deploy`), then builds the API (`nest build`) and the site. Functions run in Frankfurt (`fra1`), next to the database.

### Set up

1. **Project:** in Vercel, import the GitHub repo (or open the existing project for it) and set **Settings → Build and Deployment → Root Directory** to `apps/web`. Leave "Include files outside the root directory" on. Framework, build command and output directory come from `apps/web/vercel.json`.
2. **Database:** **Storage → Create Database → Neon**, region **AWS Frankfurt (eu-central-1)**, and connect it to the project. This sets `DATABASE_URL` (pooled, used by the app) and `DATABASE_URL_UNPOOLED` (direct, used for migrations). Turn on Neon's preview branches if you want preview deployments to get their own database; otherwise previews migrate and use the production database.
3. **Environment variables** (Settings → Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `JWT_SECRET` | a long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `NODE_ENV` | `production` (makes the session cookie `Secure`) |
   | `WEB_ORIGIN` | your site's origin, e.g. `https://hasanhmedeh.vercel.app` |
   | `TRUST_PROXY` | `true` (Vercel sets the visitor's IP in `X-Forwarded-For`) |
   | `SITE_URL` | your final domain, for canonical URLs, Open Graph tags, `sitemap.xml` and `robots.txt` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel uses the pnpm version pinned in the root `package.json` |

4. **Deploy** (push to the production branch, or Redeploy), then check `https://<your-domain>/api/health` answers `{"ok":true,"db":"up"}`.
5. Submit `https://<your-domain>/sitemap.xml` in Google Search Console.

### Notes

- **Rate limits** (signup, login, account deletion) are counted in each function instance's memory, so on serverless they're per instance and looser than locally. Move the counters in `apps/api/src/auth/auth-throttler.guard.ts` to a shared store (e.g. Upstash Redis) if you need them strict.
- **Elsewhere:** the API also runs as a normal Node server (`pnpm build --filter=@funfair/api`, `pnpm --filter @funfair/api db:deploy`, `pnpm --filter @funfair/api start`). Put it behind the site's origin with a rewrite of `/api/*`; a separate origin would need cross-site (`SameSite=None`) cookies.
- **Before launch**, fill in the highlighted placeholders in `apps/web/terms.html` and `apps/web/privacy.html`.

## Content and settings

- Rocket stages and High Striker tiers: `apps/web/src/data/fair.ts`
- Park layout / zone positions: `apps/web/src/world/layout.ts` (attraction zone ids must match the `Attraction` enum in `apps/api/prisma/schema.prisma`, `ATTRACTIONS` in `apps/api/src/rides/attractions.ts` and `ATTRACTION_IDS` in `apps/web/src/account/api.ts`)
- Colors: `PALETTE` in `apps/web/src/world/textures.ts` and CSS variables in `apps/web/src/styles.css`
- 3D font: `node apps/web/scripts/build-font.mjs` regenerates `apps/web/src/assets/lilita.typeface.json` (add characters to `CHARS` if you need more glyphs in 3D text)
- The page has Open Graph / Twitter cards (`apps/web/public/og-image.jpg`), a web manifest and icons; `sitemap.xml` and `robots.txt` are generated during the build. The 3D world is code-split and loads after the intro card has rendered.

## Game structure

All paths are under `apps/web/`:

```
index.html              page shell + intro card + HUD markup + sign-up dialog
vite.config.ts          site URL, sitemap and robots.txt, /api proxy for dev
src/main.ts             intro card (continue as guest, or sign up / log in), lazy-loads the 3D world
src/account/            api.ts (typed API client), session.ts (who's visiting), auth-dialog.ts, account-menu.ts (HUD chip)
src/data/fair.ts        rocket stages and striker tiers
src/world/Game.ts       renderer, physics, loop, camera modes, interactions, the ride gate
src/world/minimap.ts    corner minimap + the shared top-down painter of the fair
src/world/world-map.ts  full-screen park map: pan, zoom, legend and fast travel
src/world/player.ts     the visitor: walk/run/roll/kick/wave controls and physics on a crowd rig
src/world/crowd/        the park's guests: people.ts (rig, outfits, animation), pets.ts (dogs, leashes),
                        crowd.ts (parties, queues, coaster boarding, benches, kids' play), nav.ts + obstacles.ts (walking)
public/models/guests.glb       "Universal Base Characters" by Quaternius (CC0): bodies + hairstyles
public/models/guest-anims.glb  "Universal Animation Library" by Quaternius (CC0): a curated set of clips
public/models/dog-*.glb        Shiba Inu and Husky by Quaternius (CC0, via Poly Pizza)
src/world/subdivide.ts  rounds off faceted models at load: welds, one Loop subdivision, smooth normals, blended skin weights
src/world/environment.ts sky, lights, ground, trees, lamps, tents, balloons
src/world/attractions/  coaster, rocket, crates, striker, ferris/carousel/booth/arch, speedway (+ speedway-track),
                        sky-flip, ship (Nebula 360), drone
```

In development, `?cam=x,y,z,lookX,lookY,lookZ` pins the camera (handy for screenshots) and `window.__game` is exposed for debugging; both are stripped from production builds.
