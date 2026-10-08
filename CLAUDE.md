# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Oil digga" (package name `turmoil-activity`): a Turmoil-style oil tycoon, meant to run as a Discord Activity. The game itself is plain browser code with no bundler: `index.html` + `style.css` + one big `script.js` + `net.js` (classic scripts sharing global scope, no modules). A small Node server (`server/`, Express + `ws`) serves it, exchanges the Discord OAuth code and runs the lobby/race rooms. Only the Discord SDK is bundled (esbuild, `client/discord-sdk.js` -> `dist/discord-sdk.js`, global `OilDiscordSDK`). UI text and code comments are in Czech; keep that. Discord Developer Portal setup is in `README.md`.

## Commands

```bash
npm install
cp .env.example .env      # DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / PORT; .env is gitignored
npm run dev               # build the SDK bundle, run server/index.js on :3000 with --watch
npm start                 # same without watch (what a host runs)
npm run static            # old static http-server, no lobby (net.js falls back to solo)
node --check script.js    # the only static check (also net.js, server/*.js); no lint or test suite
```

There are no automated tests. Verify by running the game in a browser. Top-level `let`/`const` in `script.js` are reachable from the devtools console, so the game can be driven directly:

```js
plots[1].owner = 'player'; plots[1].hasVrt = true; startGameLoop(); isPaused = true;  // freeze the real loop
update(16);        // then step the simulation yourself
```

Stepping `update(16)` in a loop (e.g. 5000 times) is a cheap way to test truck logic; prices and pocket layout use `marketRandom`/a seeded `rand` only when `worldSeed` is set (race), otherwise `Math.random`.

Lobby without Discord: open `/?user=Alice&room=test` and `/?user=Bob&room=test` in two tabs (guest ids live in `sessionStorage`, so each tab is a separate player). A raw `ws` client from Node can also join a room to inspect its state.

## Architecture

**Rendering and loop.** A fixed 1600x900 `<canvas>` fills a 16:9 `#stage` (CSS); `getCanvasViewport()`/`getCanvasPosition()` map client coordinates back to canvas space. `getGroundLevel()` (`canvas.height * GROUND_RATIO`) is the y of the surface; everything above is sky/plots/buildings, below is underground (pipes, oil pockets). Pockets are generated above `POCKET_BOTTOM_MARGIN`, the strip covered by the bottom toolbar. `gameLoop` (requestAnimationFrame) starts at page load and always calls `draw()`, but `update(dt)` only runs once `isGameStarted` (first plot purchase) and not while `isPaused`. `dt` is capped by `MAX_FRAME_MS` before being multiplied by `gameSpeed`; never feed `update` an uncapped delta (trucks overshoot and the day counter breaks). Frame-based timers (`plotBlinkTimers`, `lastBoughtHighlightTimer`) tick in `draw()`, so they work before the game starts. The HTML HUD is driven by `updateUI()`, which `draw()` calls every frame (use `setText`, it only writes on change).

**Game model** (all module-level state, reset together in `restartGame()`; add new state there too):
- `plots` (8 purchasable columns; owner, `hasVrt`, `siloCount`) and `oilPockets` (random polygons underground; `tapped` = connected to a derrick, `revealed` = shown permanently by the georadar but still drillable, `echoUntil` = temporary outline from seismics/drone).
- `pipeNetworks`: one per derrick (`derrickId` = plot id) with a `path` of clicked points, `oilStored`/`oilCapacity`, `connectedPocket`, `isPumping`. A pipe segment that intersects a pocket **polygon** (`isSegmentIntersectingPolygon`, not its bounding box) taps it and starts pumping. Mole tunnels are networks with `derrickId: -1`, never pump.
- `trucks`: state machine `idle -> to_rig -> waiting_at_rig | to_company -> to_rig ...`. Both the **rig** (`findNetworkForTruck`) and the **company** (`chooseCompanyFor`) are re-picked on every trip, so new wells get served and the buyer cards (`trucksAssignedLeft/Right`, set by the −/+ buttons or the mouse wheel over a buyer) take effect on running trucks. Assigned slots are filled first, the rest go to the better price. Movement uses `moveTruckToward` (lands on the target, never overshoots) and `trafficLimitedStep` (keeps a gap in the same lane; a waiting truck only blocks trucks heading to the same rig).
- Buyers: internally still companies `'left'`/`'right'`, drawn as the Refinery (left) and the Railway depot (right) with a price card each (`BUYERS`, `drawBuyerCard`).
- Exploration tools (`updateToolEffects`, runs on `toolClock` at game speed, also before the first purchase): seismic charge on an owned plot (wave echoes pockets within `SEISMIC_RADIUS`), drone sweep (echoes pockets under its beam), georadar click underground (sets `revealed` within `RADAR_RADIUS`).
- Overpressure (`updateRigPressure`): a pumping rig with a full storage builds `network.pressure` (0 to 1 over `PRESSURE_BUILD_MS`), it decays once storage has room. From `VENT_MIN` a click on the rig vents it (`ventRig`); at 1 it blows out (`startBlowout`): fine, oil wasted from the pocket, gusher particles (`type: 'oil'`, with gravity) that land into `plot.spill`. With enough trucks/silos it never blows out (checked by stepping `update(16)`).
- Sound: synthesized in `SOUNDS` (FM bell `playBell`, filtered noise `playNoise`, pitch-drop `playThump`), sale sounds are throttled by `SALE_SOUND_GAP_MS`.
- Economy: land tax per owned plot per game day, bankruptcy when money < 0, the year ends after Dec 31 (`isGameOver` with `gameOverReason`, restart button drawn on the canvas).

**Network (`net.js`, `server/`).** `Net` boots on `DOMContentLoaded`: `GET /api/config`; in Discord (`frame_id` in the URL) `DiscordSDK.ready()` -> `authorize` -> `POST /api/token` (server exchanges the code with the client secret) -> `authenticate`; elsewhere a guest identity (only if the server allows guests, i.e. not `NODE_ENV=production`). Then a WebSocket `/api/ws` with `hello`; the server verifies Discord users via `/users/@me`. In Discord all API paths use the `/.proxy` prefix; the server strips it. Room = `instanceId` (`server/rooms.js`): phases `lobby -> playing -> finished -> lobby`, the first connected player is host, only the host can `start`/`reset`. A race sends everyone the same `seed`; `restartGame(seed)` makes the same map and the same price sequence, `raceMode` locks speed to 1× and disables pause, the countdown calls `startGameLoop()`. Clients send `progress` every second and `finish` on game over; the server re-broadcasts state at most twice per second.
Race settings (host only, in lobby): length 1/3/6/12 months (`raceMode.months`, the client ends with `gameOverReason = 'race_end'`) and mode: `richest` (most money at the end), `target` (first `progress` at or above `settings.target` wins, server sends `race_end` to all), `survival` (land tax grows by `SURVIVAL_TAX_STEP` each month, see `getLandTax()`). In every mode, when 2+ racers started and only one is left while all others went bankrupt or disconnected (`othersAreOut`), that one gets `race_end` (`last_standing`). `finishRace` picks the winner (richest non-bankrupt unless target/survival already set `winnerId`); `forceEnd` is the server-side timeout. Races use harsher `RACE_RULES` (start money, land tax, pressure build-up, blowout fine) via `getRules()`; `raceMode` must be set before `restartGame(seed)`. Room logic is plain JS and can be tested directly with fake `ws` objects (`{ readyState: 1, send() {} }`). If `/api/config` fails, the game silently runs solo. The server only serves an allowlist (`/`, `script.js`, `net.js`, `style.css`, `img/`, `dist/`, `/fonts` from `@fontsource/rye`), never the repo root.

**Camera.** The world uses canvas coordinates at zoom 1; `camera` (`x`, `y`, `zoom` easing toward `tx`, `ty`, `tzoom`) is applied by `applyCameraTransform()` in `draw()`; the vignette, pause and game-over overlays are drawn in screen space after `setTransform(1,0,0,1,0,0)`. `getCanvasPosition()` returns world `x/y` plus raw canvas `px/py`, so hit tests keep working while zoomed. Wheel zooms (except over a buyer, where it assigns trucks), dragging pans when zoomed (`suppressNextClick` swallows the click that ends a drag), keys: arrows/WASD, `+`/`-`, `0`. Game over resets the camera instantly.

**Canvas input.** One `click` handler (`handleCanvasClick`) dispatches by priority: game-over restart, buyer −/+ buttons, plot purchase, then build-mode (vrt, silo, seismic, radar) / pipe placement / derrick selection. Hit rectangles for canvas controls (`companyControls`, sign hitboxes) are recomputed during drawing, so they only exist after at least one `draw()`.

**Drawing (2.5D diorama).** Game logic stays 2D; only rendering fakes depth. `groundLevel` is the front edge of a tilted surface slab (`SLAB_DEPTH` px tall, perspective toward `VANISH_Y` via `slabXAt`/`traceSlabQuad`) with a night town in its back `TOWN_DEPTH` band, the road on its front strip, and derricks/silos/signs at `groundLevel - STRUCTURE_BASE_OFFSET`. Static layers are painted once via `paintLayer`, which temporarily swaps the global `ctx`, so draw helpers work for both: `farCache` (sky, moon, mountains; wider than the canvas, drawn with parallax from the camera and the mouse) and `sceneCache` (slab, town, road, rocks, cliff; transparent above the slab). Everything on the canvas is vector-drawn, no images are loaded (`loadImages()` just starts the game); `drawGlow` adds additive light. Light comes from `MOON_X` (cool rim) plus warm lamps. Ambient life (`updateAmbient`, `ambientClock` in real seconds, stops while paused): walkers keep to the main-street sidewalks and the promenade with stop-and-go (`getTownLayout`, `drawTownLife`, `drawTownFront`); town buildings in front of the street are painted into `townFrontCache` (each item has its own seed) and drawn after the walkers, and `fitTownItemInFront` keeps their roofs below the sidewalk (otherwise walkers behind them look like they stand on roofs); rig workers, blimp, biplane, bats, shooting stars (`drawSkyLife`, positions are functions of time) and fireworks (the only stateful part; `launchFirework` also fires on an oil strike). Pocket outlines are drawn from `getPocketShape` (cached on `pocket.shape`), collisions still use `pocket.vertices`.

**HUD.** `index.html` overlays panels on the canvas inside `#stage`, sized in `em` from `font-size: clamp(..., cqw, ...)`, with a compact `@container` mode under 1200 px. Info panels (`#hud-goals`, `#hud-toasts`, `#hud-log`) have `pointer-events: none` so clicks reach the canvas; only the top-left clock, the top-right camera/sound buttons and the bottom toolbar take clicks. Toolbar icons are inline SVG. `notify()` shows a toast and calls `logEvent()`; `getYearGoals()` is display-only. Canvas text state leaks between draw functions (e.g. `drawPlots` leaves `textBaseline = 'middle'`), so set font/align/baseline explicitly before `fillText`.

## Cache busting (Discord caches aggressively)

`index.html` sets `window.ASSET_VERSION = Date.now()` and loads `style.css`, `script.js` and the favicon through `document.write` with `?v=<version>`; any image loaded from JS must go through `assetUrl()`. Do not add plain `src`/`href` references to local assets, or they will be cached. The server sends `Cache-Control: no-store` for everything it serves. The Rye font is self-hosted (`@font-face` in `style.css`), because Discord's CSP blocks Google Fonts; canvas text needs `document.fonts.load` to trigger it.

## Known gaps

- The Discord path (SDK auth, `/.proxy`, avatar URL mapping `/discord-cdn`) has not been tested inside Discord yet, only the guest lobby locally.
- The race is not cheat-proof: clients report their own money.
- `Analýza.docx` describes an older truck system (`collecting`/`returning` states) and is out of date; trust the code.

## Git workflow used here

Work on a short-lived branch, commit with an English message, fast-forward merge into `main`, push `origin/main`, delete the branch (only when asked). Repo-local git identity is configured; do not change global git config.
