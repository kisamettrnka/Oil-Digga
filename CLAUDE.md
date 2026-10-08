# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Oil digga" (package name `turmoil-activity`): a Turmoil-style oil tycoon, meant to run as a Discord Activity. It is a static, dependency-free browser game: `index.html` + `style.css` + one big `script.js` (global scope, no modules, no bundler). The only npm dependency is `http-server` (dev). UI text and code comments are in Czech; keep that.

## Commands

```bash
npm install
npm start                 # http-server on :3000 with caching disabled (-c-1), opens the browser
node --check script.js    # the only static check; there is no lint, build or test suite
```

There are no automated tests. Verify by running the game in a browser. Top-level `let`/`const` in `script.js` are reachable from the devtools console, so the game can be driven directly:

```js
plots[1].owner = 'player'; plots[1].hasVrt = true; startGameLoop(); isPaused = true;  // freeze the real loop
update(16);        // then step the simulation yourself
```

Stepping `update(16)` in a loop (e.g. 5000 times) is a cheap way to test truck logic; only prices, pocket layout and some tie-breaks use `Math.random`.

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

**Camera.** The world uses canvas coordinates at zoom 1; `camera` (`x`, `y`, `zoom` easing toward `tx`, `ty`, `tzoom`) is applied by `applyCameraTransform()` in `draw()`; the vignette, pause and game-over overlays are drawn in screen space after `setTransform(1,0,0,1,0,0)`. `getCanvasPosition()` returns world `x/y` plus raw canvas `px/py`, so hit tests keep working while zoomed. Wheel zooms (except over a buyer, where it assigns trucks), dragging pans when zoomed (`suppressNextClick` swallows the click that ends a drag), keys: arrows/WASD, `+`/`-`, `0`. Game over resets the camera instantly.

**Canvas input.** One `click` handler (`handleCanvasClick`) dispatches by priority: game-over restart, buyer −/+ buttons, plot purchase, then build-mode (vrt, silo, seismic, radar) / pipe placement / derrick selection. Hit rectangles for canvas controls (`companyControls`, sign hitboxes) are recomputed during drawing, so they only exist after at least one `draw()`.

**Drawing (2.5D diorama).** Game logic stays 2D; only rendering fakes depth. `groundLevel` is the front edge of a tilted surface slab (`SLAB_DEPTH` px tall, perspective toward `VANISH_Y` via `slabXAt`/`traceSlabQuad`) with a night town in its back `TOWN_DEPTH` band, the road on its front strip, and derricks/silos/signs at `groundLevel - STRUCTURE_BASE_OFFSET`. Static layers are painted once via `paintLayer`, which temporarily swaps the global `ctx`, so draw helpers work for both: `farCache` (sky, moon, mountains; wider than the canvas, drawn with parallax from the camera and the mouse) and `sceneCache` (slab, town, road, rocks, cliff; transparent above the slab). Everything on the canvas is vector-drawn, no images are loaded (`loadImages()` just starts the game); `drawGlow` adds additive light. Light comes from `MOON_X` (cool rim) plus warm lamps. Ambient life (`updateAmbient`, `ambientClock` in real seconds, stops while paused): walkers keep to the main-street sidewalks and the promenade with stop-and-go (`getTownLayout`, `drawTownLife`, `drawTownFront`); town buildings in front of the street are painted into `townFrontCache` (each item has its own seed) and drawn after the walkers, and `fitTownItemInFront` keeps their roofs below the sidewalk (otherwise walkers behind them look like they stand on roofs); rig workers, blimp, biplane, bats, shooting stars (`drawSkyLife`, positions are functions of time) and fireworks (the only stateful part; `launchFirework` also fires on an oil strike). Pocket outlines are drawn from `getPocketShape` (cached on `pocket.shape`), collisions still use `pocket.vertices`.

**HUD.** `index.html` overlays panels on the canvas inside `#stage`, sized in `em` from `font-size: clamp(..., cqw, ...)`, with a compact `@container` mode under 1200 px. Info panels (`#hud-goals`, `#hud-toasts`, `#hud-log`) have `pointer-events: none` so clicks reach the canvas; only the top-left clock, the top-right camera/sound buttons and the bottom toolbar take clicks. Toolbar icons are inline SVG. `notify()` shows a toast and calls `logEvent()`; `getYearGoals()` is display-only. Canvas text state leaks between draw functions (e.g. `drawPlots` leaves `textBaseline = 'middle'`), so set font/align/baseline explicitly before `fillText`.

## Cache busting (Discord caches aggressively)

`index.html` sets `window.ASSET_VERSION = Date.now()` and loads `style.css`, `script.js` and the favicon through `document.write` with `?v=<version>`; any image loaded from JS must go through `assetUrl()`. Do not add plain `src`/`href` references to local assets, or they will be cached. `npm start` serves with `-c-1`. `index.html` itself can only be kept fresh by server headers, and there is no hosting config in the repo.

## Known gaps

- **Discord SDK does not work.** `https://discord.com/assets/embedded-app-sdk.js` returns 404 and `Discord.EmbeddedAppSDK` does not exist (the real package is `@discord/embedded-app-sdk`, `new DiscordSDK(clientId)`, needs a bundler). It only "works" because the `catch` falls back to `loadImages()`. The local/Discord switch is `hostname === 'localhost' || '127.0.0.1'`. External resources (Google Fonts "Rye", `transparenttextures.com` wood texture, which also 404s) need Discord URL mappings.
- `Analýza.docx` and `README.md` describe an older truck system (`collecting`/`returning` states) and are out of date; trust the code.
- `node_modules` is committed and there is no `.gitignore`.

## Git workflow used here

Work on a short-lived branch, commit with an English message, fast-forward merge into `main`, push `origin/main`, delete the branch (only when asked). Repo-local git identity is configured; do not change global git config.
