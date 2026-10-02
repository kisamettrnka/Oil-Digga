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

**Rendering and loop.** A fixed 1600x900 `<canvas>` is scaled by CSS; `getCanvasViewport()`/`getCanvasPosition()` map client coordinates back to canvas space. `groundLevel = canvas.height / 3` is the y of the surface; everything above is sky/plots/buildings, below is underground (pipes, oil pockets). `gameLoop` (requestAnimationFrame) starts at page load and always calls `draw()`, but `update(dt)` only runs once `isGameStarted` (first plot purchase) and not while `isPaused`. `dt` is capped by `MAX_FRAME_MS` before being multiplied by `gameSpeed`; never feed `update` an uncapped delta (trucks overshoot and the day counter breaks). Frame-based timers (`plotBlinkTimers`, `lastBoughtHighlightTimer`) tick in `draw()`, so they work before the game starts. HTML buttons in the top bar are driven by `updateUI()`, which `draw()` calls every frame.

**Game model** (all module-level state, reset together in `restartGame()`; add new state there too):
- `plots` (8 purchasable columns; owner, `hasVrt`, `siloCount`) and `oilPockets` (random polygons underground; `tapped` = connected to a derrick, `revealed` = shown by the mole tool but still drillable).
- `pipeNetworks`: one per derrick (`derrickId` = plot id) with a `path` of clicked points, `oilStored`/`oilCapacity`, `connectedPocket`, `isPumping`. A pipe segment that intersects a pocket **polygon** (`isSegmentIntersectingPolygon`, not its bounding box) taps it and starts pumping. Mole tunnels are networks with `derrickId: -1`, never pump.
- `trucks`: state machine `idle -> to_rig -> waiting_at_rig | to_company -> to_rig ...`. Both the **rig** (`findNetworkForTruck`) and the **company** (`chooseCompanyFor`) are re-picked on every trip, so new wells get served and the company arrows (`trucksAssignedLeft/Right`, set by clicking arrows or the mouse wheel over a company) take effect on running trucks. Assigned slots are filled first, the rest go to the better price. Movement uses `moveTruckToward` (lands on the target, never overshoots) and `trafficLimitedStep` (keeps a gap in the same lane; a waiting truck only blocks trucks heading to the same rig).
- Economy: land tax per owned plot per game day, bankruptcy when money < 0, the year ends after Dec 31 (`isGameOver` with `gameOverReason`, restart button drawn on the canvas).

**Canvas input.** One `click` handler (`handleCanvasClick`) dispatches by priority: sound button, game-over restart, company arrows, plot purchase, then build-mode / pipe placement / derrick selection. Hit rectangles for canvas controls (`companyControls`, sign hitboxes) are recomputed during drawing, so they only exist after at least one `draw()`.

**Drawing.** Trucks, silos and the road are vector-drawn (`drawTankerTruck`, `drawSilo`, `drawRoad`); `derrick` still uses `img/oil-tower.png` through `drawSprite`, which crops the icon's transparent margin and keeps its aspect ratio (the icons are 512x512 squares, never stretch them). Canvas text state leaks between draw functions (e.g. `drawPlots` leaves `textBaseline = 'middle'`), so set font/align/baseline explicitly before `fillText`.

## Cache busting (Discord caches aggressively)

`index.html` sets `window.ASSET_VERSION = Date.now()` and loads `style.css`, `script.js` and the favicon through `document.write` with `?v=<version>`; button icons use `data-src` and are filled in the same way; images loaded from JS go through `assetUrl()`. Do not add plain `src`/`href` references to local assets, or they will be cached. `npm start` serves with `-c-1`. `index.html` itself can only be kept fresh by server headers, and there is no hosting config in the repo.

## Known gaps

- **Discord SDK does not work.** `https://discord.com/assets/embedded-app-sdk.js` returns 404 and `Discord.EmbeddedAppSDK` does not exist (the real package is `@discord/embedded-app-sdk`, `new DiscordSDK(clientId)`, needs a bundler). It only "works" because the `catch` falls back to `loadImages()`. The local/Discord switch is `hostname === 'localhost' || '127.0.0.1'`. External resources (Google Fonts "Rye", `transparenttextures.com` wood texture, which also 404s) need Discord URL mappings.
- The top bar overflows below roughly 1150 px width.
- `Analýza.docx` and `README.md` describe an older truck system (`collecting`/`returning` states) and are out of date; trust the code.
- `node_modules` is committed and there is no `.gitignore`.

## Git workflow used here

Work on a short-lived branch, commit with an English message, fast-forward merge into `main`, push `origin/main`, delete the branch (only when asked). Repo-local git identity is configured; do not change global git config.
