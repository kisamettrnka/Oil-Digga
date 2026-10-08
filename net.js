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
            if (isDiscord && typeof notify === 'function') notify('Lobby nedostupné', 'Přihlášení přes Discord selhalo, hraješ sám', 'bad', '📡');
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
            else if (msg.type === 'race_start') onRaceStart(msg);
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

    function onState(msg) {
        const firstState = !room;
        room = msg.room;
        youId = msg.you;
        const player = me();
        if (!player) return;

        // Zpět do lobby: hostitel ukončil závod
        if (room.phase === 'lobby' && (mode === 'race' || mode === 'results' || mode === 'countdown')) {
            leaveRace();
            setMode('lobby');
        } else if (firstState || mode === 'offline') {
            // Po (znovu)připojení: rozjetý závod po výpadku pokračuje, jinak lobby
            if (player.status === 'racing' && raceId === room.raceId) setMode('race');
            else if (player.status === 'solo') setMode('solo');
            else setMode('lobby');
        }
        render();
        updatePresence();
    }

    function onRaceStart(msg) {
        raceId = msg.raceId;
        finishSent = false;
        raceStartedAt = Date.now() + msg.startIn;
        if (typeof restartGame === 'function') restartGame(msg.seed);
        raceMode = { raceId: msg.raceId };
        gameSpeed = 1;
        isPaused = false;
        setMode('countdown');
        runCountdown(msg.startIn);
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

    function leaveRace() {
        raceMode = null;
        raceId = null;
        finishSent = false;
        if (typeof restartGame === 'function') restartGame(null);
    }

    // Každou sekundu průběžný výsledek; po konci roku nebo bankrotu konečný
    function sendProgress() {
        if (mode !== 'race' && mode !== 'results') return;
        if (!raceMode || finishSent) return;
        const progress = {
            raceId,
            money: Math.floor(money),
            revenue: Math.floor(totalRevenue),
            sold: Math.floor(totalOilSold),
            day,
            month,
            reason: gameOverReason || null
        };
        if (isGameOver) {
            finishSent = true;
            sendMsg({ type: 'finish', ...progress });
            setMode('results');
        } else {
            sendMsg({ type: 'progress', ...progress });
        }
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
        $('race-results').classList.toggle('hidden', mode !== 'results');
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
        $('results-wait').classList.toggle('hidden', isHost);
        $('results-title').textContent = room.phase === 'finished' ? 'Konečné pořadí' : 'Průběžné pořadí';
    }

    function renderLobby() {
        const player = me();
        const isHost = youId === room.hostId;
        const list = $('lobby-players');
        list.innerHTML = room.players.filter(p => p.connected).map(p => `
            <div class="lobby-player${p.id === youId ? ' you' : ''}${p.ready ? ' ready' : ''}">
                ${avatarHtml(p)}
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
                money: live ? Math.floor(money) : (p.progress?.money ?? 0),
                month: live ? month : (p.progress?.month ?? 1),
                day: live ? day : (p.progress?.day ?? 1)
            };
        }).sort((a, b) => b.money - a.money);
        const title = detailed ? '' : '<div class="race-title">Závod o ropu</div>';
        el.innerHTML = title + rows.map((r, i) => {
            const state = !r.p.connected ? 'odpojen'
                : r.p.status === 'finished' ? (r.p.progress?.reason === 'bankrupt' ? 'bankrot' : 'v cíli')
                    : `${r.day}. ${monthNames[r.month]}`;
            return `<div class="race-row${r.p.id === youId ? ' you' : ''}">
                <span class="rank">${i + 1}.</span>${avatarHtml(r.p)}
                <span class="race-name">${escapeHtml(r.p.name)}</span>
                <span class="race-money">${formatMoney(r.money)}</span>
                ${detailed ? `<span class="race-state">${state}</span>` : ''}
            </div>`;
        }).join('');
        bindAvatarFallbacks(el);
    }

    // Vlastní řádek žebříčku se obnovuje i mezi zprávami serveru
    setInterval(() => {
        if (room && (mode === 'race' || mode === 'results')) render();
    }, 1000);

    document.addEventListener('DOMContentLoaded', start);

    return {
        isRacing: () => !!raceMode,
        mode: () => mode
    };
})();
