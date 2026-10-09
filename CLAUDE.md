# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keep this file current

Update CLAUDE.md in the same commit as any change that makes it wrong or incomplete: new or renamed commands, architecture, file responsibilities, network messages, game rules, deployment. Remove statements that are no longer true instead of adding caveats.

## Every change ships with its checks and its record

Do these in the same commit as the change, not afterwards:
1. **Bots play it.** Any change to game functionality (rules, numbers in `sim.js`, buyers, eras, drilling, contracts, truck logic, race or shared-map rules) runs `npm run balance` before the commit. Compare with the previous run: no bankruptcies in the solo scenarios, every buyer keeps a share of revenue, the eras spread over the year, failed contracts stay rare, money grows from the start sum. Fix the balance or state the known deviation in the commit message; never commit a number you have not seen the bots play. UI-only changes skip this.
2. **CLAUDE.md** is updated as described above.
3. **CHANGELOG.md** gets an entry under "Nevydáno" for every player-visible novelty or change (new mechanic, buyer, tool, UI panel, rule, balance change the player will feel), written in Czech from the player's point of view, one or two lines each. Refactors and fixes nobody would notice do not go in. When a feature from `docs/navrh-v2.md` is finished, mark it done there too.

## Working style (token budget)

Follows `docs/claude-code-prirucka.md`; this section is the part Claude applies.
- Terse replies: no preamble, no recap, one line on what changed and where. Show only changed code. At most one clarifying question.
- Grep/Glob first, then Read only the needed range; the `js/` files are big, never read one whole. Do not re-read files you already read or just edited. Never read `node_modules/`, `dist/`, `package-lock.json`.
- Trim command output (`| tail -40`, `-q`). Run one suite (`node test/sim.test.js`), not `npm test`, unless the change spans suites. Start the dev server only for visual checks.
- Smallest change that solves the task, no drive-by refactors. Subagents: the ones listed under "Sub-agents" below, otherwise only when a task spans many files. Big task: short plan first.
- Skills: when a workflow repeats (same kind of task twice, rediscovered steps or quirks), propose a skill and write it after a yes with superpowers `writing-skills` (or `skill-creator`). Oil Digga skills go to `.claude/skills/<name>/SKILL.md` and get committed; cross-project ones to `~/.claude/skills/`. Keep them short: `description` says when to use it, body has exact steps, commands, pitfalls. Check existing skills before a task; fix a wrong skill in the same session.

## What this is

"Oil digga" (package name `turmoil-activity`): an oil tycoon that runs as a Discord Activity (solo, a race where everyone plays a copy of the same map, or one shared real-time map). The game is plain browser code with no bundler: `index.html`, `style.css` and classic scripts sharing one global scope (no modules): `ads.js` (ad configuration, global `OIL_ADS`), `sim.js` (game rules, also `require`d by the server), `net.js` (Discord login, lobby, race/shared flow) and the client in `js/` (`core.js` world bridge, events and prefs; `scene.js` ambient life, camera, loop/draw and the diorama; `world-draw.js` game objects, buyers, vehicles, particles and sound; `hud.js` HTML panels, survey map and guide; `input.js` previews, listeners and tool drawing), all one global scope loaded in that order by `index.html`; a top-level statement may only call functions from its own or an earlier file. A Node server (`server/`, Express + `ws`) serves the game, exchanges the Discord OAuth code and runs the lobby rooms. Only the Discord SDK is bundled (esbuild: `client/discord-sdk.js` -> `dist/discord-sdk.js`, global `OilDiscordSDK`). UI text and code comments are in Czech; keep that. Discord Developer Portal setup (URL mappings, secrets) and Render deployment are in `README.md`.

## Commands

```bash
npm install
cp .env.example .env      # DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / PORT; .env is gitignored
npm run dev               # build the SDK bundle, run server/index.js on :3000 with --watch
npm start                 # same without watch (what the host runs)
npm run static            # plain http-server without the backend: no lobby, net.js falls back to solo
npm test                  # node --test test/*.test.js
node test/sim.test.js     # one suite (each test file is a standalone script that exits non-zero on failure)
npm run balance [solo|race3|shared2|...|all]   # bots play whole games over 16 seeds; prints money, $/bbl, buyer shares, era days, contracts
for f in js/*.js sim.js net.js server/*.js; do node --check $f; done   # syntax check; there is no lint
```

Tests cover `sim.js`, the lobby rooms and the server-side shared game, not rendering; check visual changes in a browser. After touching any number in `sim.js` (`C`, `RULES`, `BUYERS`, `ERAS`, `ROCKS`) run `npm run balance` (criteria above). Lobby without Discord: open `/?user=Alice&room=test` and `/?user=Bob&room=test` in two tabs (guest ids live in `sessionStorage`). Top-level `let`/`const` in `js/*.js` are reachable from the devtools console; change state through `world`/`doAction`, the other globals are only a mirror:

```js
world.players[myId].money = 9000; doAction({ type: 'buyPlot', plotId: 1 }); isPaused = true;  // freeze the real loop
update(16);        // then step the world yourself (OilSim.step + events + syncFromWorld)
```

Deployment: `render.yaml` (Render blueprint; `DISCORD_CLIENT_SECRET` is set in the Render dashboard). Vercel cannot host the WebSocket server.

## Design direction

Visual and UI work must look hand-crafted and specific to this game, not like a generic AI-generated template: night oil boomtown in the desert, 2.5D cut-away diorama with custom vector drawing, "print shop and telegraph" paper UI (`--paper`, `--ink`, `--stamp-*`), Rye / Courier Prime / Barlow Condensed, inline SVG icons from `ICONS` (never emoji). **Before any visual or UI work read `docs/design.md`** (full art direction and what to avoid), and check the result in a browser screenshot.

## Architecture

Details are in `docs/architektura.md`: **read the relevant part before changing that area** (sim rules, client bridge, network/server, rendering, HUD). Invariants that hold everywhere:
- `sim.js` (`OilSim`) keeps all game state in one `world`; `act(world, playerId, action)` is the only way to change it and must validate everything, because on the shared map actions arrive over the network. `step(world, dt)` advances it; `world.events` are drained by the caller. Randomness stays seeded and deterministic (`world._market`, `dayRandom`), so race players see the same game.
- The client changes state only through `doAction(action)`; `syncFromWorld()` mirrors `world` into the old globals. Purely visual effects are client-side and never touch the world. The frame delta is capped by `MAX_FRAME_MS`.
- On the shared map and in races the server is authoritative: snapshots are per player (`serializeFor`), hidden pockets/hazards arrive as `{ id, hidden: true }`, so `sim.js` must guard on `vertices`/`hidden`; nothing secret may reach the client.
- Rendering uses a fixed 1600×900 logical world (`VIEW_W`/`VIEW_H`; never read `canvas.width` for layout) with the `viewScale` transform; static layers are painted once through `paintLayer`. Canvas text state leaks between draw functions: set font/align/baseline before `fillText`.
- HUD is HTML inside `#stage`; `updateUI()` runs every frame, so write through `setText` (writes only on change). Info panels keep `pointer-events: none`.

## Sub-agents

Use them proactively (read-only helpers that return a few lines, so big files and long output stay out of the main context):
- `balance-runner`: after any gameplay/rules/number change (runs `npm run balance`, judges it by the criteria above).
- `commit-checklist`: right before every commit.
- `code-scout`: locating things in `sim.js`, `js/*.js`, `server/` instead of reading them whole.
- `run-digest`: tests and the `node --check` loop, when output would be long.
- `state-integrity-checker`: after adding world state or an action (validation in `act()`, serialization per player, hidden info).
- `frame-time-auditor`: after changing `update()`/draw/animation code in `js/`.
- `czech-text-checker`: after adding or changing player-facing text or CHANGELOG entries.

## Cache busting (Discord caches aggressively)

`index.html` sets `window.ASSET_VERSION = Date.now()` and loads `style.css`, the favicon, `dist/discord-sdk.js`, `ads.js`, `sim.js`, `net.js` and the `js/*.js` files through `document.write` with `?v=<version>`; images loaded from JS go through `assetUrl()`. Do not add plain `src`/`href` references to local assets. The server sends `Cache-Control: no-store` for everything. Fonts come from `@fontsource/*` packages (server routes `/fonts/<name>/`) because Discord's CSP blocks Google Fonts; canvas text needs `document.fonts.load` to trigger them (done in `initializeGame`).

## Git workflow used here

Work on a short-lived branch, commit with an English message, fast-forward merge into `main`, push `origin/main`, delete the branch (only when asked). Render deploys `main` automatically. Repo-local git identity is configured; do not change global git config. Never credit Claude or AI anywhere in git or on GitHub: no `Co-Authored-By` trailer, no "Generated with Claude Code" line, no Claude/AI mention as author or contributor in commit messages, PR titles or bodies, branch names or tags (`.claude/settings.json` turns off the automatic attribution too). `Analýza.docx` describes an older truck system and is out of date; trust the code. `CHANGELOG.md` is the player-facing history (see above). `docs/claude-code-prirucka.md` is a Czech guide to setting up Claude Code (plugins, token saving, self-made skills) for people working with Claude; it is not about the game.
