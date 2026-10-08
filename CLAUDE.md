# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keep this file current

Update CLAUDE.md in the same commit as any change that makes it wrong or incomplete: new or renamed commands, architecture, file responsibilities, network messages, game rules, deployment. Remove statements that are no longer true instead of adding caveats.

## What this is

"Oil digga" (package name `turmoil-activity`): an oil tycoon that runs as a Discord Activity (solo, a race where everyone plays a copy of the same map, or one shared real-time map). The game is plain browser code with no bundler: `index.html`, `style.css` and classic scripts sharing one global scope (no modules): `sim.js` (game rules, also `require`d by the server), `net.js` (Discord login, lobby, race/shared flow) and one big `script.js` (rendering, input, HUD, sound). A Node server (`server/`, Express + `ws`) serves the game, exchanges the Discord OAuth code and runs the lobby rooms. Only the Discord SDK is bundled (esbuild: `client/discord-sdk.js` -> `dist/discord-sdk.js`, global `OilDiscordSDK`). UI text and code comments are in Czech; keep that. Discord Developer Portal setup (URL mappings, secrets) and Render deployment are in `README.md`.

## Commands

```bash
npm install
cp .env.example .env      # DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / PORT; .env is gitignored
npm run dev               # build the SDK bundle, run server/index.js on :3000 with --watch
npm start                 # same without watch (what the host runs)
npm run static            # plain http-server without the backend: no lobby, net.js falls back to solo
npm test                  # node --test test/*.test.js
node test/sim.test.js     # one suite (each test file is a standalone script that exits non-zero on failure)
node --check script.js    # syntax check (also sim.js, net.js, server/*.js); there is no lint
```

Tests cover `sim.js`, the lobby rooms and the server-side shared game, not rendering; check visual changes in a browser. Lobby without Discord: open `/?user=Alice&room=test` and `/?user=Bob&room=test` in two tabs (guest ids live in `sessionStorage`). Top-level `let`/`const` in `script.js` are reachable from the devtools console; change state through `world`/`doAction`, the other globals are only a mirror:

```js
world.players[myId].money = 9000; doAction({ type: 'buyPlot', plotId: 1 }); isPaused = true;  // freeze the real loop
update(16);        // then step the world yourself (OilSim.step + events + syncFromWorld)
```

Deployment: `render.yaml` (Render blueprint; `DISCORD_CLIENT_SECRET` is set in the Render dashboard). Vercel cannot host the WebSocket server.

## Design direction

Visual and UI work must look hand-crafted and specific to this game, not like a generic AI-generated template. Build on the established art direction instead of introducing a new style:
- Night oil boomtown in the desert: cool moonlight rim light (`MOON_X`) against warm lamps, flares and glowing oil; a 2.5D cut-away diorama; everything on the canvas is custom vector drawing with additive glow (`drawGlow`), no stock images.
- "Print shop and telegraph": anything that is a message or a document is paper under lamplight (`--paper`, `--ink`, `--stamp-*` in `style.css`): notifications are telegrams (`notify` -> `.telegram`, text ends with STOP), goals and the race board are a ledger, the event log is telegraph tape, world news and race results are the "Pouštní kurýr" newspaper, the lobby is the land office notice board with a claims register, a form with pen-crossed checkboxes and rubber-stamp buttons. Instruments (clock, resource bar, toolbar, buyer cards on the canvas) stay dark translucent panels.
- Typography: Rye for headlines, signs and stamps; Courier Prime for typed text (telegrams, ledger, newspaper); Barlow Condensed for HUD labels and numbers (also on the canvas). All three are self-hosted with Czech glyphs (`latin-ext` subsets via `unicode-range`).
- Icons: the `ICONS` set in `script.js` (`iconSvg(name)`, inline SVG with `currentColor`); never emoji as UI icons.
- Avoid templated defaults: purple/blue gradient backgrounds, identical rounded cards everywhere, centered "hero" layouts, generic glassmorphism, placeholder copy. Motion should mean something (a strike, a blowout, breaking news), not decorate.
- Every new element gets the same care: lighting consistent with the scene, depth (shadows, parallax, occlusion), readable at the compact HUD size, and checked in a browser screenshot.

## Architecture

**Game rules (`sim.js`, `OilSim`).** One `world` object holds everything for all players: `createWorld({ seed, players, race, shared })`, `act(world, playerId, action)` (the only way to change state; validates everything, because on the shared map actions arrive over the network), `step(world, dt)` (calendar and land tax, market, news, pumping, pressure, trucks, exploration tools; before `world.time.started` only tools run) and `world.events` (sale, strike, blowout, news, ... drained by the caller for sounds and toasts). Per-player state is in `world.players[id]`; plots, rigs (`pipeNetworks`) and trucks have an `owner`. With a `seed` the map is identical for everyone; the market uses `world._market` (seeded, not serialized) and news use `dayRandom` (seed + `time.dayIndex`), so race players get the same headlines on the same day regardless of frame timing. Key mechanics:
- Pockets: polygon `vertices` (pipe hits use `isSegmentIntersectingPolygon`, not the bounding box), `tappedBy` (solo/race: one rig per pocket; shared: several players can drain it), `revealedBy` (georadar) and `echo[playerId]` (seismics, drone), so exploration results are private.
- Trucks: state machine `idle -> to_rig -> waiting_at_rig | to_company -> to_rig ...`; rig (`findNetworkForTruck`, own rigs only) and buyer (`chooseCompanyFor`: assigned slots `player.assigned` first, then the better `quote`) are re-picked every trip. `moveTruckToward` never overshoots, `trafficLimitedStep` keeps gaps on the shared road.
- Buyers are `market.left` (drawn as the Refinery) and `market.right` (Railway depot): `price` is a random walk, `quote = price * mult` is what gets paid, `closed` buyers are skipped (trucks on the way turn around).
- News (`NEWS`, `stepNews` on each day change): for some days multiply buyer prices, close a buyer or change rules (`taxMult`, `fineMult`, `truckSpeed` via `newsEffect`).
- Overpressure (`stepPressure`): a pumping rig with full storage builds `pressure` (rules `pressureBuildMs`), vent action from `VENT_MIN`, at 1 a blowout (fine via `getBlowoutFine`, oil wasted, `plot.spill` grows). With enough trucks/silos it never blows out.
- Rules: `RULES.solo` vs harsher `RULES.race` (also used by the shared map), land tax per owned plot per day (`getLandTax`, grows monthly in survival mode), bankruptcy when money < 0, end after the race length or Dec 31 (`endPlayer`/`endAll`).

**Client bridge (`script.js`).** `world` is either local (solo/race: `restartGame(seed)` creates it; `raceMode` must be set first because it picks the rules) or a copy from the server (`startSharedWorld`/`applySharedSnapshot`). `syncFromWorld()` mirrors it into the old globals (`plots`, `money`, `trucks`, `leftIncPrice` = quote, `day`, ...) and computes the local player's view (`pocket.revealed`, `pocket.echoUntil`, `network.connectedPocket`). Input goes through `doAction(action)`: locally `OilSim.act` plus `handleWorldEvents`, on the shared map `Net.sendAction`. `myId` is `'player'` locally and the network id on the shared map; `isMine()` and `playerColor()` drive ownership-dependent drawing. `gameLoop` calls `update(frameMs * gameSpeed)` every frame unless paused; the frame delta is capped by `MAX_FRAME_MS` (an uncapped delta makes trucks overshoot and breaks the calendar). Purely visual effects (smoke, steam, gusher drops, fireworks, ambient life) are client-side and never touch the world.

**Network (`net.js`, `server/`).** `Net` boots on `DOMContentLoaded`: `GET /api/config`; in Discord (`frame_id` in the URL) `DiscordSDK.ready()` -> `authorize` -> `POST /api/token` (the server exchanges the code with the client secret) -> `authenticate`; elsewhere a guest identity, allowed only when not `NODE_ENV=production`. Then WebSocket `/api/ws` with `hello`; the server verifies Discord users via `/users/@me`. In Discord all API paths use the `/.proxy` prefix and the server strips it. If `/api/config` fails the game silently runs solo. The server serves only an allowlist (`/`, `script.js`, `net.js`, `sim.js`, `style.css`, `img/`, `dist/`, `/fonts/<rye|courier-prime|barlow-condensed>/`), never the repo root.
- Rooms (`server/rooms.js`): one room per Discord `instanceId`, phases `lobby -> playing -> finished -> lobby`, the first connected player is host and only the host changes `settings` (`kind` race/shared, `mode` richest/target/survival, `target`, `months`) and can `start`/`reset`. Last standing ends a race when everyone else went bankrupt or disconnected (finishing on time does not count as out); `forceEnd` is the server-side timeout. Room logic is plain JS and is tested with fake `ws` objects (`{ readyState: 1, send() {} }`).
- Race (`kind: 'race'`): every client simulates its own world from the shared `seed`, sends `progress` every second and `finish` at the end; clients report their own money, so it is not cheat-proof.
- Shared map (`kind: 'shared'`, `server/shared.js`, max `MAX_SHARED_PLAYERS`): the server steps one world every 50 ms, applies rate-limited `action` messages, enforces target/last-standing and sends `snapshot` (rounded JSON + events) 5× per second, `shared_start` on start and on reconnect. Clients keep stepping their copy between snapshots for smooth movement (events of those local steps are ignored). Snapshots contain the whole map, so hidden pockets are visible in devtools.

**Rendering (2.5D diorama).** Fixed 1600×900 world drawn on a canvas that fills the 16:9 `#stage`. Logic stays 2D; only drawing fakes depth: `getGroundLevel()` is the front edge of a tilted surface slab (`slabXAt`/`traceSlabQuad`) with a town in the back, the road on the front strip, structures at `groundLevel - STRUCTURE_BASE_OFFSET`, and the underground cross-section below. Static layers are painted once through `paintLayer` (temporarily swaps the global `ctx`): `farCache` (sky and mountains with parallax), `sceneCache` (slab, town, road, rocks) and `townFrontCache` (houses in front of the main street, drawn after the walkers; `fitTownItemInFront` keeps their roofs below the sidewalk). The `camera` transform applies to the world; vignette, pause and game-over overlays are drawn in screen space. `getCanvasPosition()` returns world `x/y` plus raw canvas `px/py`, so hit tests work while zoomed. Hit rectangles for canvas controls (buyer −/+ buttons, plot signs) are recomputed during drawing, so they exist only after a `draw()`. Pocket outlines are cached per `pocket.id` (`pocketShapes`) because shared worlds are replaced by every snapshot. Canvas text state leaks between draw functions, so set font/align/baseline before `fillText`. Sounds are synthesized (`SOUNDS`, no audio files).

**HUD.** HTML panels inside `#stage`, sized in `em` from `font-size: clamp(..., cqw, ...)` with a compact `@container` mode under 1200 px. Info panels (`#hud-goals`, `#hud-race`, `#hud-toasts`, `#hud-news`, `#hud-log`, `#news-flash`) have `pointer-events: none` so clicks reach the canvas. Overlays (lobby, results) only darken the scene, no blur, so the town stays visible. `updateUI()` runs every frame from `draw()`; use `setText`, which writes only on change.

## Cache busting (Discord caches aggressively)

`index.html` sets `window.ASSET_VERSION = Date.now()` and loads `style.css`, the favicon, `dist/discord-sdk.js`, `sim.js`, `net.js` and `script.js` through `document.write` with `?v=<version>`; images loaded from JS go through `assetUrl()`. Do not add plain `src`/`href` references to local assets. The server sends `Cache-Control: no-store` for everything. Fonts come from `@fontsource/*` packages (server routes `/fonts/<name>/`) because Discord's CSP blocks Google Fonts; canvas text needs `document.fonts.load` to trigger them (done in `initializeGame`).

## Git workflow used here

Work on a short-lived branch, commit with an English message, fast-forward merge into `main`, push `origin/main`, delete the branch (only when asked). Render deploys `main` automatically. Repo-local git identity is configured; do not change global git config. `Analýza.docx` describes an older truck system and is out of date; trust the code.
