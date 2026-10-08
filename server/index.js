// Server Oil digga: servíruje hru, vyměňuje OAuth kód za token (Client Secret zná jen server)
// a přes WebSocket drží lobby a závod. Konfigurace z .env (viz .env.example).
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomRegistry, send } = require('./rooms');

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Hosté bez Discordu (?user=...&room=...) jen pro lokální vývoj, v produkci vypnuto
const ALLOW_GUESTS = process.env.ALLOW_GUESTS
    ? process.env.ALLOW_GUESTS === '1'
    : process.env.NODE_ENV !== 'production';
const ROOT = path.join(__dirname, '..');
const DISCORD_API = 'https://discord.com/api';
const TOKEN_CACHE_MS = 10 * 60 * 1000;

const app = express();
app.disable('x-powered-by');

// Discord proxy posílá požadavky aktivity přes /.proxy/...; server je přijme s i bez prefixu
app.use((req, res, next) => {
    if (req.url.startsWith('/.proxy/')) req.url = req.url.slice('/.proxy'.length);
    next();
});
app.use(express.json({ limit: '4kb' }));

// Discord cachuje agresivně: nic se necachuje (soubory mají navíc ?v= z index.html)
function noStore(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
}
const sendRootFile = file => (req, res) => {
    noStore(res);
    res.sendFile(path.join(ROOT, file));
};
const staticDir = dir => express.static(dir, { index: false, setHeaders: noStore });

// Jen vyjmenované soubory hry: server/, .env ani node_modules se ven nedostanou
app.get('/', sendRootFile('index.html'));
['script.js', 'net.js', 'sim.js', 'style.css'].forEach(file => app.get('/' + file, sendRootFile(file)));
app.use('/img', staticDir(path.join(ROOT, 'img')));
app.use('/dist', staticDir(path.join(ROOT, 'dist')));
app.use('/fonts', staticDir(path.join(ROOT, 'node_modules/@fontsource/rye/files')));

app.get('/api/config', (req, res) => {
    noStore(res);
    res.json({ clientId: CLIENT_ID, guests: ALLOW_GUESTS });
});

// Výměna kódu z discordSdk.commands.authorize za access token
app.post('/api/token', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!code || !CLIENT_ID || !CLIENT_SECRET) {
        res.status(400).json({ error: 'missing_code_or_server_config' });
        return;
    }
    try {
        const response = await fetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code
            })
        });
        const data = await response.json();
        if (!response.ok || !data.access_token) {
            console.warn('Výměna tokenu selhala:', response.status, data.error);
            res.status(502).json({ error: 'token_exchange_failed' });
            return;
        }
        res.json({ access_token: data.access_token });
    } catch (e) {
        console.warn('Výměna tokenu selhala:', e.message);
        res.status(502).json({ error: 'token_exchange_failed' });
    }
});

// Identitu hráče server ověří u Discordu podle tokenu, klient si jméno nemůže vymyslet
const tokenCache = new Map();

async function fetchDiscordUser(accessToken) {
    const cached = tokenCache.get(accessToken);
    if (cached && cached.expires > Date.now()) return cached.user;
    const response = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const u = await response.json();
    const user = {
        id: String(u.id),
        name: String(u.global_name || u.username || 'Hráč').slice(0, 32),
        // Cesta na cdn.discordapp.com, klient si doplní adresu (v Discordu přes URL mapping)
        avatar: u.avatar ? `avatars/${u.id}/${u.avatar}.png?size=64` : null
    };
    tokenCache.set(accessToken, { user, expires: Date.now() + TOKEN_CACHE_MS });
    return user;
}

setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of tokenCache) if (entry.expires < now) tokenCache.delete(token);
}, TOKEN_CACHE_MS).unref();

function cleanText(value, max) {
    return String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

async function resolveUser(msg) {
    if (typeof msg.accessToken === 'string' && msg.accessToken) {
        try {
            return await fetchDiscordUser(msg.accessToken);
        } catch (e) {
            return null;
        }
    }
    if (!ALLOW_GUESTS) return null;
    const guestId = cleanText(msg.guestId, 40).replace(/[^\w-]/g, '');
    if (!guestId) return null;
    return { id: `guest-${guestId}`, name: cleanText(msg.name, 24) || 'Host', avatar: null };
}

function cleanRoomId(value) {
    const id = String(value || '').replace(/[^\w:.-]/g, '').slice(0, 100);
    return id || null;
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const rooms = new RoomRegistry();

server.on('upgrade', (req, socket, head) => {
    const url = req.url.replace(/^\/\.proxy/, '');
    if (!url.startsWith('/api/ws')) {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
    let session = null;      // { room, playerId } po úspěšném hello
    let authenticating = false;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async raw => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!msg || typeof msg.type !== 'string') return;

        if (!session) {
            if (msg.type !== 'hello' || authenticating) return;
            authenticating = true;
            const user = await resolveUser(msg);
            const roomId = cleanRoomId(msg.instanceId);
            if (!user || !roomId) {
                send(ws, { type: 'error', code: user ? 'bad_room' : 'auth_failed' });
                ws.close(4001, 'auth');
                return;
            }
            if (ws.readyState !== 1) return; // klient se mezitím odpojil
            session = rooms.join(roomId, user, ws);
            if (!session) {
                send(ws, { type: 'error', code: 'room_full' });
                ws.close(4002, 'full');
            }
            return;
        }
        session.room.handle(session.playerId, msg);
    });

    ws.on('close', () => {
        if (session) session.room.leave(session.playerId, ws);
    });
});

// Mrtvá spojení (zavřené víko notebooku apod.) se poznají podle chybějícího pongu
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30_000).unref();

server.listen(PORT, () => {
    console.log(`Oil digga běží na http://localhost:${PORT}`);
    if (!CLIENT_ID || !CLIENT_SECRET) console.log('Chybí DISCORD_CLIENT_ID nebo DISCORD_CLIENT_SECRET (.env nebo proměnné hostingu): přihlášení přes Discord nepůjde.');
    if (ALLOW_GUESTS) console.log(`Lokální lobby: http://localhost:${PORT}/?user=Alice&room=test`);
});
