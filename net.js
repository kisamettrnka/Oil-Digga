// --- Síť: Discord, lobby a závod ---
// Načítá se před script.js. Herní stav (money, day, restartGame...) čte až za běhu.
// Bez serveru (např. npm run static) se WebSocket nepřipojí a hra jede sólo jako dřív.
// V Discordu: SDK -> authorize -> /api/token -> authenticate -> WebSocket s access tokenem.
// Mimo Discord (vývoj): http://localhost:3000/?user=Alice&room=test, víc záložek = víc hráčů.
const Net = (() => {
    const params = new URLSearchParams(location.search);
    const isDiscord = params.has('frame_id');
    const API_BASE = isDiscord ? '/.proxy' : '';
    const RECONNECT_MAX_MS = 10000;
    const PROGRESS_INTERVAL_MS = 1000;
    const PRESENCE_INTERVAL_MS = 20000;

    let sdk = null;
    let identity = null;      // { accessToken } nebo { guestId, name }, plus instanceId
    let ws = null;
    let reconnectDelay = 1000;
    let authFailed = false;
    let room = null;          // poslední stav místnosti ze serveru
    let youId = null;
    let mode = 'offline';     // offline | lobby | solo | countdown | race | results
    let raceId = null;
    let raceStartedAt = null;
    let finishSent = false;
    let progressTimer = null;
    let lastPresenceAt = 0;

    const $ = id => document.getElementById(id);

    // --- Start ---
    async function start() {
        bindUi();
        try {
            const config = await getJson(`${API_BASE}/api/config`);
            identity = isDiscord ? await discordLogin(config.clientId) : guestIdentity(config);
            connect();
        } catch (e) {
            console.warn('Síť nedostupná, hra běží sólo:', e.message);
            setMode('offline');
            // V Discordu má lobby fungovat, tak to hráči řekneme (lokálně bez serveru je sólo normální)
            if (isDiscord && typeof notify === 'function') notify('Lobby nedostupné', 'Přihlášení přes Discord selhalo, hraješ sám', 'bad', 'wire');
        }
    }

    async function getJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return response.json();
    }

    async function discordLogin(clientId) {
        if (!clientId) throw new Error('server nemá DISCORD_CLIENT_ID');
        const { DiscordSDK } = window.OilDiscordSDK;
        sdk = new DiscordSDK(clientId);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({
            client_id: clientId,
            response_type: 'code',
            state: '',
            prompt: 'none',
            scope: ['identify', 'rpc.activities.write']
        });
        const { access_token: accessToken } = await getJson(`${API_BASE}/api/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        await sdk.commands.authenticate({ access_token: accessToken });
        return { accessToken, instanceId: sdk.instanceId };
    }

    function guestIdentity(config) {
        if (!config.guests) throw new Error('server nepouští hosty mimo Discord');
        let guestId = null;
        try {
            guestId = sessionStorage.getItem('oilDiggaGuestId');
            if (!guestId) {
                guestId = Math.random().toString(36).slice(2, 10);
                sessionStorage.setItem('oilDiggaGuestId', guestId);
            }
        } catch (e) {
            guestId = Math.random().toString(36).slice(2, 10);
        }
        return {
            guestId,
            name: params.get('user') || `Hráč ${guestId.slice(0, 3).toUpperCase()}`,
            instanceId: `local-${params.get('room') || 'test'}`
        };
    }

    // --- WebSocket ---
    function connect() {
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${protocol}://${location.host}${API_BASE}/api/ws`);
        setStatus('Připojuji…');
        ws.onopen = () => {
            reconnectDelay = 1000;
            ws.send(JSON.stringify({ type: 'hello', instanceId: identity.instanceId, ...identity }));
        };
        ws.onmessage = event => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                return;
            }
            if (msg.type === 'state') onState(msg);
            else if (msg.type === 'race_end') onRaceEnd(msg);
            else if (msg.type === 'shared_start') onSharedStart(msg);
            else if (msg.type === 'snapshot') onSnapshot(msg);
            else if (msg.type === 'error') onError(msg);
        };
        ws.onclose = () => {
            ws = null;
            if (authFailed) return;
            setStatus('Spojení ztraceno, zkouším znovu…');
            setTimeout(connect, reconnectDelay);
            reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
        };
    }

    function sendMsg(payload) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }

    function onError(msg) {
        const texts = {
            auth_failed: 'Přihlášení selhalo. Zkus aktivitu spustit znovu.',
            room_full: 'Místnost je plná.',
            bad_room: 'Neplatná místnost.'
        };
        authFailed = true;
        setStatus(texts[msg.code] || 'Chyba připojení.');
        setMode('offline');
    }

    // --- Stav místnosti ---
    function me() {
        return room?.players.find(p => p.id === youId) || null;
    }

    let wantSolo = false; // hráč zvolil sólo v menu dřív, než přišel stav místnosti

    function onState(msg) {
        const firstState = !room;
        room = msg.room;
        youId = msg.you;
        const player = me();
        if (!player) return;
        if (wantSolo && room.phase === 'lobby' && player.status !== 'solo') {
            wantSolo = false;
            sendMsg({ type: 'solo' });
            player.status = 'solo';
        }

        // Divák: hra skončila, výsledky se vrátí
        if (spectating && room.phase === 'finished') {
            spectating = false;
            setMode('results');
        }
        // Zpět do lobby: hostitel ukončil závod
        if (room.phase === 'lobby' && (mode === 'race' || mode === 'results' || mode === 'countdown')) {
            leaveRace();
            setMode('lobby');
        } else if (firstState || mode === 'offline') {
            // Po (znovu)připojení: rozjetý závod po výpadku pokračuje, jinak lobby
            if (player.status === 'racing' && raceId === room.raceId) setMode('race');
            else if (player.status === 'solo' || wantSolo) setMode('solo');
            else setMode('lobby');
        }
        render();
        updatePresence();
        // Otevřené hlavní menu: po příchodu stavu místnosti se odemkne Multiplayer
        if (typeof menuOpen !== 'undefined' && menuOpen && typeof openMenu === 'function') openMenu();
    }

    // Server ukončil závod: zbyl jsi poslední (ostatní zkrachovali/odpadli), nebo vypršel čas
    function onRaceEnd(msg) {
        if (!raceMode || msg.raceId !== raceId || isGameOver) return;
        endLocalGame('race_end');
        if (typeof notify === 'function') {
            const winner = room?.players.find(p => p.id === msg.winnerId);
            if (msg.reason === 'target') {
                notify(msg.winnerId === youId ? 'Vyhrál jsi!' : 'Konec závodu',
                    `${msg.winnerId === youId ? 'Jako první máš' : `${winner ? winner.name : 'Soupeř'} má jako první`} ${formatMoney(raceMode.target)}`,
                    msg.winnerId === youId ? 'good' : 'bad', 'trophy');
            } else if (msg.reason === 'last_standing') {
                notify('Poslední na trhu!', 'Ostatní zkrachovali nebo odpadli, závod končí', 'good', 'trophy');
            }
        }
        sendProgress();
    }

    // Sdílená mapa: svět počítá server, klient posílá akce a kreslí stav ze snapshotů
    function onSharedStart(msg) {
        const resumed = raceId === msg.raceId && mode !== 'lobby';
        raceId = msg.raceId;
        finishSent = false;
        raceStartedAt = Date.now() + msg.startIn;
        raceMode = { raceId: msg.raceId, months: msg.months, mode: msg.mode, target: msg.target, shared: true };
        if (typeof startSharedWorld === 'function') startSharedWorld(msg.world, youId);
        if (msg.startIn > 0) {
            setMode('countdown');
            runCountdown(msg.startIn);
        } else {
            setMode(isGameOver ? 'results' : 'race');
            if (resumed && typeof notify === 'function') notify('Zpátky ve hře', 'Spojení obnoveno', 'cool', 'wire');
        }
    }

    function onSnapshot(msg) {
        if (!raceMode || !raceMode.shared || msg.raceId !== raceId) return;
        if (typeof applySharedSnapshot === 'function') applySharedSnapshot(msg.world, msg.events);
        if (isGameOver && mode === 'race') setMode('results');
    }

    function sendAction(action) {
        if (!raceMode || !raceMode.shared) return;
        sendMsg({ type: 'action', raceId, action });
    }

    function runCountdown(ms) {
        const box = $('race-countdown');
        const tick = () => {
            if (mode !== 'countdown') return;
            const left = raceStartedAt - Date.now();
            if (left <= 0) {
                box.textContent = 'VRTEJTE!';
                box.classList.add('go');
                setTimeout(() => {
                    box.classList.remove('go');
                    if (mode === 'countdown') setMode('race');
                }, 700);
                if (typeof startGameLoop === 'function') startGameLoop();
                return;
            }
            box.textContent = String(Math.ceil(left / 1000));
            setTimeout(tick, Math.min(250, left));
        };
        tick();
    }

    let spectating = false;

    function leaveRace() {
        spectating = false;
        if (raceMode?.shared && typeof leaveSharedWorld === 'function') leaveSharedWorld();
        raceMode = null;
        raceId = null;
        finishSent = false;
        if (typeof restartGame === 'function') restartGame(null);
    }

    // Hru počítá server: klient jen přepne na výsledky, až jeho svět skončí, a obnoví presence
    function sendProgress() {
        if (mode !== 'race' && mode !== 'results') return;
        if (!raceMode || finishSent) return;
        if (isGameOver && mode === 'race') setMode('results');
        updatePresence();
    }

    // --- Rich presence v Discordu ---
    function updatePresence(force = false) {
        if (!sdk) return;
        const now = Date.now();
        if (!force && now - lastPresenceAt < PRESENCE_INTERVAL_MS) return;
        lastPresenceAt = now;
        const racers = room ? room.players.filter(p => p.connected).length : 1;
        const activity = { type: 0, details: 'V lobby', state: `${racers} v místnosti` };
        if (mode === 'race' || mode === 'results') {
            activity.details = 'Závod o ropu';
            activity.state = `${monthNames[month]} · ${formatMoney(Math.floor(money))}`;
            if (raceStartedAt) activity.timestamps = { start: raceStartedAt };
        } else if (mode === 'solo') {
            activity.details = 'Těží sám';
            activity.state = `${monthNames[month]} · ${formatMoney(Math.floor(money))}`;
        }
        sdk.commands.setActivity({ activity }).catch(() => { });
    }

    // --- UI ---
    function setMode(next) {
        mode = next;
        // Tlačítko s fokusem by po znovuzobrazení lobby šlo omylem stisknout Enterem/mezerníkem
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        const stage = $('stage');
        $('lobby').classList.toggle('hidden', mode !== 'lobby');
        $('race-countdown').classList.toggle('hidden', mode !== 'countdown');
        $('race-results').classList.toggle('hidden', mode !== 'results' || spectating);
        stage.classList.toggle('racing', mode === 'race' || mode === 'results' || mode === 'countdown');
        $('lobby-btn').classList.toggle('hidden', mode !== 'solo');
        clearInterval(progressTimer);
        progressTimer = (mode === 'race' || mode === 'results')
            ? setInterval(sendProgress, PROGRESS_INTERVAL_MS) : null;
        if (typeof updateUI === 'function' && typeof canvas !== 'undefined' && canvas) updateUI();
        render();
        updatePresence(true);
    }

    function setStatus(text) {
        const el = $('lobby-status');
        if (el) el.textContent = text;
    }

    function bindUi() {
        $('lobby-ready').addEventListener('click', () => sendMsg({ type: 'ready', ready: !me()?.ready }));
        $('lobby-start').addEventListener('click', () => sendMsg({ type: 'start' }));
        $('lobby-solo').addEventListener('click', () => {
            sendMsg({ type: 'solo' });
            if (typeof restartGame === 'function') restartGame(null);
            setMode('solo');
        });
        $('lobby-btn').addEventListener('click', () => {
            sendMsg({ type: 'lobby' });
            setMode('lobby');
        });
        $('lobby-invite').addEventListener('click', () => {
            if (sdk) sdk.commands.openInviteDialog().catch(() => setStatus('Pozvánku tady poslat nejde (DM nebo chybí oprávnění).'));
        });
        $('results-reset').addEventListener('click', () => sendMsg({ type: 'reset' }));
        // Odveta: zpět do lobby a hned start na stejné mapě
        $('results-rematch').addEventListener('click', () => {
            sendMsg({ type: 'reset' });
            sendMsg({ type: 'start', sameMap: true });
        });
        // Divák: zkrachovalý hráč na sdílené mapě kouká dál, výsledky se vrátí na konci
        $('results-watch').addEventListener('click', () => {
            spectating = true;
            $('race-results').classList.add('hidden');
            if (typeof notify === 'function') notify('Sleduješ', 'Hra běží dál, výsledky přijdou na konci', 'cool', 'people');
        });
        $('lobby-players').addEventListener('click', event => {
            const dot = event.target.closest('[data-color]');
            if (dot) sendMsg({ type: 'color', index: Number(dot.dataset.color) });
        });
        // Volby hostitele: délka, režim, cíl (server přijme jen od hostitele v lobby)
        ['lobby-kind', 'lobby-length', 'lobby-mode', 'lobby-target'].forEach(id => $(id).addEventListener('click', event => {
            const btn = event.target.closest('.length-btn');
            if (!btn || btn.disabled) return;
            if (btn.dataset.kind) sendMsg({ type: 'settings', kind: btn.dataset.kind });
            if (btn.dataset.months) sendMsg({ type: 'settings', months: Number(btn.dataset.months) });
            if (btn.dataset.mode) sendMsg({ type: 'settings', mode: btn.dataset.mode });
            if (btn.dataset.target) sendMsg({ type: 'settings', target: Number(btn.dataset.target) });
        }));
        $('lobby-rules').innerHTML = `Závodní pravidla: start <b>$${RACE_RULES.startMoney.toLocaleString('cs-CZ')}</b>,
            daň <b>$${RACE_RULES.landTax}</b>/pozemek/den (v přežití +$${SURVIVAL_TAX_STEP} každý měsíc), rychlejší přetlak,
            pokuta za erupci <b>$${RACE_RULES.blowoutFine}</b>. Kdo zkrachuje, končí. Zbyde-li jediný, závod hned skončí.`;
        $('lobby-invite').classList.toggle('hidden', !isDiscord);
    }

    // Avatar z Discordu, jinak kroužek s iniciálou (barva podle id hráče)
    function avatarHtml(player) {
        const initial = escapeHtml(player.name.trim().slice(0, 1).toUpperCase() || '?');
        const hue = [...player.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
        const fallback = `<span class="avatar avatar-initial" style="--hue:${hue}">${initial}</span>`;
        if (!player.avatar) return fallback;
        // V Discordu jde CDN přes URL mapping /discord-cdn -> cdn.discordapp.com
        const base = isDiscord ? `${API_BASE}/discord-cdn/` : 'https://cdn.discordapp.com/';
        return `<img class="avatar" src="${base}${escapeHtml(player.avatar)}" alt="" data-hue="${hue}" data-initial="${initial}">`;
    }

    // Nenačtený avatar (chybí URL mapping, offline) nahradí iniciála
    function bindAvatarFallbacks(container) {
        container.querySelectorAll('img.avatar').forEach(img => {
            img.addEventListener('error', () => {
                const span = document.createElement('span');
                span.className = 'avatar avatar-initial';
                span.style.setProperty('--hue', img.dataset.hue);
                span.textContent = img.dataset.initial;
                img.replaceWith(span);
            }, { once: true });
        });
    }

    function formatMoney(value) {
        return `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('cs-CZ')}`;
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const RACE_LENGTHS = [1, 3, 6, 12];
    const GAME_KINDS = {
        race: { name: 'Každý svou mapu', desc: 'Stejná mapa i ceny, hrajete vedle sebe' },
        shared: { name: 'Sdílená mapa', desc: `Jedna mapa pro všechny (max ${OilSim.C.MAX_SHARED_PLAYERS}), pozemky a ropa se přetahují` }
    };
    const RACE_TARGETS = [10000, 20000, 50000];
    const RACE_MODES = {
        richest: { name: 'Nejbohatší', desc: 'Na konci vyhrává nejvíc peněz' },
        target: { name: 'Cíl', desc: 'Kdo první nasbírá cílovou částku' },
        survival: { name: 'Přežití', desc: 'Daň každý měsíc roste, vyhrává kdo jediný nezkrachuje' }
    };

    function modeTitle(settings) {
        if (settings.mode === 'target') return `Cíl ${formatMoney(settings.target)}`;
        return RACE_MODES[settings.mode]?.name || 'Závod';
    }

    function raceDays(months) {
        return daysInMonth.slice(1, months + 1).reduce((a, b) => a + b, 0);
    }

    const STATUS_TEXT = {
        lobby: 'v lobby', solo: 'hraje sám', racing: 'závodí', finished: 'v cíli', spectating: 'sleduje'
    };

    function render() {
        if (!room) return;
        renderLobby();
        renderLeaderboard($('hud-race'), false);
        renderLeaderboard($('results-list'), true);
        const isHost = youId === room.hostId;
        $('results-reset').classList.toggle('hidden', !isHost);
        $('results-rematch').classList.toggle('hidden', !isHost || room.phase !== 'finished');
        $('results-wait').classList.toggle('hidden', isHost);
        const canWatch = room.phase === 'playing' && raceMode?.shared && typeof world !== 'undefined' && world?.shared;
        $('results-watch').classList.toggle('hidden', !canWatch);
        const winner = room.players.find(p => p.id === room.winnerId);
        $('results-date').textContent = typeof day !== 'undefined' ? `${day}. ${MONTH_FULL_NAMES[month]}` : '';
        $('results-title').textContent = room.phase === 'finished'
            ? (winner ? (winner.id === youId ? 'Jsi králem ropy!' : `${winner.name} králem ropy!`) : 'Konečné pořadí')
            : 'Průběžné pořadí';
    }

    function renderLobby() {
        const player = me();
        const isHost = youId === room.hostId;
        const list = $('lobby-players');
        list.innerHTML = room.players.filter(p => p.connected).map(p => `
            <div class="lobby-player${p.id === youId ? ' you' : ''}${p.ready ? ' ready' : ''}">
                ${avatarHtml(p)}
                ${p.id === youId && room.phase === 'lobby'
                    ? `<button class="lobby-dot own" data-color="${(p.colorIndex + 1) % OilSim.PLAYER_COLORS.length}" style="background:${playerColorFor(p.id) || '#777'}" title="Změnit barvu"></button>`
                    : `<span class="lobby-dot" style="background:${playerColorFor(p.id) || '#777'}"></span>`}
                <div class="lobby-name">${escapeHtml(p.name)}${p.id === room.hostId ? ' <span class="badge">hostitel</span>' : ''}</div>
                <div class="lobby-state">${p.ready && p.status === 'lobby' ? 'připraven' : STATUS_TEXT[p.status] || ''}</div>
            </div>`).join('');
        bindAvatarFallbacks(list);

        const ready = $('lobby-ready');
        ready.textContent = player?.ready ? 'Nepřipraven' : 'Připraven';
        ready.classList.toggle('active', !!player?.ready);
        ready.disabled = room.phase !== 'lobby';
        const startBtn = $('lobby-start');
        startBtn.classList.toggle('hidden', !isHost);
        startBtn.disabled = room.phase !== 'lobby';

        // Druh hry, režim, cíl a délka: hostitel volí, ostatní vidí
        const settings = room.settings || { kind: 'race', months: 3, mode: 'richest', target: 20000 };
        const canEdit = isHost && room.phase === 'lobby';
        $('lobby-kind').innerHTML = Object.entries(GAME_KINDS).map(([key, k]) => `
            <button class="length-btn mode-btn${key === settings.kind ? ' active' : ''}" data-kind="${key}" ${canEdit ? '' : 'disabled'}>
                ${k.name}<small>${k.desc}</small>
            </button>`).join('');
        $('lobby-mode').innerHTML = Object.entries(RACE_MODES).map(([key, m]) => `
            <button class="length-btn mode-btn${key === settings.mode ? ' active' : ''}" data-mode="${key}" ${canEdit ? '' : 'disabled'}>
                ${m.name}<small>${m.desc}</small>
            </button>`).join('');
        $('lobby-target').classList.toggle('hidden', settings.mode !== 'target');
        $('lobby-target-field').classList.toggle('hidden', settings.mode !== 'target');
        $('lobby-target').innerHTML = RACE_TARGETS.map(t => `
            <button class="length-btn${t === settings.target ? ' active' : ''}" data-target="${t}" ${canEdit ? '' : 'disabled'}>${formatMoney(t)}</button>`).join('');
        const months = settings.months;
        $('lobby-length').innerHTML = RACE_LENGTHS.map(m => `
            <button class="length-btn${m === months ? ' active' : ''}" data-months="${m}" ${canEdit ? '' : 'disabled'}>
                ${m} ${m === 1 ? 'měsíc' : (m < 5 ? 'měsíce' : 'měsíců')}<small>~${Math.round(raceDays(m) * MS_PER_DAY / 60000)} min</small>
            </button>`).join('');

        if (room.phase !== 'lobby') setStatus('Probíhá závod. Počkej na další kolo, nebo hraj sám.');
        else if (isHost) {
            const readyCount = room.players.filter(p => p.connected && p.ready).length;
            const lobbyCount = room.players.filter(p => p.connected && p.status === 'lobby').length;
            setStatus(`Připraveno ${readyCount} z ${lobbyCount}. Spusť závod, až budou všichni.`);
        } else {
            setStatus('Hostitel spustí závod. Všichni dostanete stejnou mapu.');
        }
    }

    // Žebříček podle peněz; vlastní peníze se berou živě z hry, ostatní ze serveru
    function renderLeaderboard(el, detailed) {
        if (!el) return;
        const racers = room.players.filter(p => ['racing', 'finished'].includes(p.status) || (p.progress && !p.connected));
        const rows = racers.map(p => {
            const live = p.id === youId && raceMode && !finishSent;
            return {
                p,
                money: live ? Math.floor(money) : (p.progress?.money ?? RACE_RULES.startMoney),
                month: live ? month : (p.progress?.month ?? 1),
                day: live ? day : (p.progress?.day ?? 1)
            };
        }).sort((a, b) => {
            const outA = a.p.progress?.reason === 'bankrupt', outB = b.p.progress?.reason === 'bankrupt';
            return outA !== outB ? (outA ? 1 : -1) : b.money - a.money;
        });
        const settings = room.settings || {};
        const goal = settings.mode === 'target' ? settings.target : 0;
        const subtitle = settings.mode === 'survival' && raceMode ? ` · daň $${getLandTax()}` : '';
        const title = detailed ? '' : `<div class="race-title">${escapeHtml(modeTitle(settings))}${subtitle}</div>`;
        el.innerHTML = title + rows.map((r, i) => {
            const bankrupt = r.p.progress?.reason === 'bankrupt';
            const state = bankrupt ? 'bankrot'
                : !r.p.connected ? 'odpojen'
                    : r.p.status === 'finished' ? 'v cíli'
                        : `${r.day}. ${monthNames[r.month]}`;
            const winner = room.phase === 'finished' && r.p.id === room.winnerId;
            // Sdílená mapa: barva hráče (stejná jako jeho kamiony a praporky) u jména a avataru
            const color = playerColorFor(r.p.id);
            const colorAttr = color ? ` style="--player-color:${color}"` : '';
            return `<div class="race-row${r.p.id === youId ? ' you' : ''}${bankrupt ? ' out' : ''}${color ? ' colored' : ''}"${colorAttr}>
                <span class="rank">${winner ? iconSvg('trophy', 'rank-trophy') : `${i + 1}.`}</span>${avatarHtml(r.p)}
                <span class="race-name">${escapeHtml(r.p.name)}</span>
                <span class="race-money">${formatMoney(r.money)}</span>
                ${detailed ? `<span class="race-state">${state}</span>` : ''}
                ${goal ? `<span class="goal-bar"><span style="width:${Math.max(0, Math.min(100, r.money / goal * 100)).toFixed(1)}%"></span></span>` : ''}
            </div>`;
        }).join('');
        bindAvatarFallbacks(el);
    }

    // Barva hráče: ze světa (hraje se), jinak z místnosti (lobby)
    function playerColorFor(id) {
        const color = (raceMode?.shared && typeof world !== 'undefined' && world) ? world.players[id]?.color : null;
        if (/^#[0-9a-f]{6}$/i.test(color || '')) return color;
        const p = room?.players.find(x => x.id === id);
        return p && Number.isInteger(p.colorIndex) ? OilSim.PLAYER_COLORS[p.colorIndex] : null;
    }

    // Vlastní řádek žebříčku se obnovuje i mezi zprávami serveru
    setInterval(() => {
        if (room && (mode === 'race' || mode === 'results')) render();
    }, 1000);

    document.addEventListener('DOMContentLoaded', start);

    // Odkaz ven: Discord iframe nepustí window.open, musí přes SDK
    function openLink(url) {
        if (sdk) sdk.commands.openExternalLink({ url }).catch(() => { });
        else window.open(url, '_blank', 'noopener');
    }

    // Hlavní menu (js/core.js): je kam jít do lobby? sólo z menu, lobby z menu
    function canLobby() {
        return !!room && !authFailed;
    }

    function playSolo() {
        if (!room) { wantSolo = true; return; }
        sendMsg({ type: 'solo' });
        if (typeof restartGame === 'function' && !(typeof isGameOver !== 'undefined' && !isGameOver && typeof isGameStarted !== 'undefined' && isGameStarted)) restartGame(null);
        setMode('solo');
    }

    function openLobby() {
        if (!room) return;
        if (mode === 'solo' || mode === 'offline') sendMsg({ type: 'lobby' });
        if (room.phase !== 'lobby' && me()?.status === 'racing') setMode('race');
        else setMode('lobby');
    }

    return {
        isRacing: () => !!raceMode,
        mode: () => mode,
        canLobby, playSolo, openLobby,
        sendAction,
        openLink
    };
})();
