// Místnosti lobby a závodu. Jedna místnost = jedna instance aktivity v Discordu (instanceId),
// lokálně ?room=... Server hru nesimuluje: rozdá všem stejný seed (stejná mapa i ceny),
// sbírá průběžné výsledky a rozesílá žebříček.
const ROOM_IDLE_MS = 60_000;          // prázdná místnost se po minutě zahodí
const STATE_THROTTLE_MS = 500;        // průběžné výsledky se rozesílají nejvýš 2× za sekundu
const RACE_COUNTDOWN_MS = 4000;
const MAX_PLAYERS = 12;

function clampNumber(value, min, max, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function sanitizeProgress(msg) {
    return {
        money: Math.round(clampNumber(msg.money, -1e9, 1e9)),
        revenue: Math.round(clampNumber(msg.revenue, 0, 1e9)),
        sold: Math.round(clampNumber(msg.sold, 0, 1e9)),
        day: Math.round(clampNumber(msg.day, 1, 31, 1)),
        month: Math.round(clampNumber(msg.month, 1, 12, 1)),
        over: msg.over === true,
        reason: msg.reason === 'bankrupt' ? 'bankrupt' : (msg.reason === 'year_end' ? 'year_end' : null)
    };
}

function send(ws, payload) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

class Room {
    constructor(id) {
        this.id = id;
        this.players = new Map(); // id -> hráč, pořadí vložení = pořadí příchodu
        this.hostId = null;
        this.phase = 'lobby';     // lobby | playing | finished
        this.seed = null;
        this.raceId = 0;
        this.raceStartedAt = null;
        this.emptySince = null;
        this.stateTimer = null;
    }

    connectedPlayers() {
        return [...this.players.values()].filter(p => p.connected);
    }

    join(user, ws) {
        let player = this.players.get(user.id);
        if (!player && this.players.size >= MAX_PLAYERS) return null;
        if (player) {
            // Stejný hráč z jiné karty nebo po výpadku spojení: staré spojení se zavře
            if (player.ws && player.ws !== ws) player.ws.close(4000, 'replaced');
            Object.assign(player, { ws, connected: true, name: user.name, avatar: user.avatar });
        } else {
            player = {
                id: user.id, name: user.name, avatar: user.avatar, ws, connected: true,
                ready: false, status: this.phase === 'lobby' ? 'lobby' : 'spectating', progress: null
            };
            this.players.set(user.id, player);
        }
        this.emptySince = null;
        if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = user.id;
        this.broadcastState();
        return player;
    }

    leave(playerId, ws) {
        const player = this.players.get(playerId);
        if (!player || player.ws !== ws) return; // spojení už nahradilo novější
        player.connected = false;
        player.ws = null;
        // V lobby odpojený hráč mizí, během závodu zůstává v žebříčku
        if (this.phase === 'lobby') this.players.delete(playerId);
        if (this.hostId === playerId) this.hostId = this.connectedPlayers()[0]?.id || null;
        if (!this.connectedPlayers().length) this.emptySince = Date.now();
        this.checkRaceEnd();
        this.broadcastState();
    }

    handle(playerId, msg) {
        const player = this.players.get(playerId);
        if (!player) return;
        const isHost = playerId === this.hostId;
        switch (msg.type) {
            case 'ready':
                if (this.phase === 'lobby') player.ready = msg.ready === true;
                break;
            case 'solo':
                if (player.status === 'lobby' || player.status === 'spectating') player.status = 'solo';
                player.ready = false;
                break;
            case 'lobby':
                if (player.status === 'solo' || player.status === 'spectating') {
                    player.status = this.phase === 'lobby' ? 'lobby' : 'spectating';
                }
                break;
            case 'start':
                if (isHost && this.phase === 'lobby') this.startRace();
                return;
            case 'progress':
                if (player.status !== 'racing' || msg.raceId !== this.raceId) return;
                player.progress = sanitizeProgress(msg);
                this.scheduleState();
                return;
            case 'finish':
                if (player.status !== 'racing' || msg.raceId !== this.raceId) return;
                player.progress = sanitizeProgress({ ...msg, over: true });
                player.status = 'finished';
                this.checkRaceEnd();
                break;
            case 'reset':
                if (isHost && this.phase !== 'lobby') this.backToLobby();
                break;
            default:
                return;
        }
        this.broadcastState();
    }

    startRace() {
        const racers = this.connectedPlayers().filter(p => p.status === 'lobby');
        if (!racers.length) return;
        this.phase = 'playing';
        this.raceId++;
        this.seed = Math.floor(Math.random() * 2 ** 31);
        this.raceStartedAt = Date.now() + RACE_COUNTDOWN_MS;
        racers.forEach(p => {
            p.status = 'racing';
            p.ready = false;
            p.progress = sanitizeProgress({ money: 3000 });
            send(p.ws, { type: 'race_start', raceId: this.raceId, seed: this.seed, startIn: RACE_COUNTDOWN_MS });
        });
        this.broadcastState();
    }

    // Závod končí, když už nikdo připojený nejede (odpojení hráči závod neblokují)
    checkRaceEnd() {
        if (this.phase !== 'playing') return;
        if (!this.connectedPlayers().some(p => p.status === 'racing')) this.phase = 'finished';
    }

    backToLobby() {
        this.phase = 'lobby';
        this.seed = null;
        this.raceStartedAt = null;
        for (const [id, p] of this.players) {
            if (!p.connected) {
                this.players.delete(id);
                continue;
            }
            p.status = 'lobby';
            p.ready = false;
            p.progress = null;
        }
    }

    snapshot() {
        return {
            id: this.id,
            phase: this.phase,
            hostId: this.hostId,
            raceId: this.raceId,
            raceStartedAt: this.raceStartedAt,
            players: [...this.players.values()].map(p => ({
                id: p.id, name: p.name, avatar: p.avatar, ready: p.ready,
                status: p.status, connected: p.connected, progress: p.progress
            }))
        };
    }

    scheduleState() {
        if (this.stateTimer) return;
        this.stateTimer = setTimeout(() => {
            this.stateTimer = null;
            this.broadcastState();
        }, STATE_THROTTLE_MS);
    }

    broadcastState() {
        const room = this.snapshot();
        const serverTime = Date.now();
        for (const p of this.players.values()) {
            if (p.connected) send(p.ws, { type: 'state', you: p.id, serverTime, room });
        }
    }
}

class RoomRegistry {
    constructor() {
        this.rooms = new Map();
        this.sweeper = setInterval(() => this.sweep(), ROOM_IDLE_MS / 2);
        this.sweeper.unref?.();
    }

    join(roomId, user, ws) {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = new Room(roomId);
            this.rooms.set(roomId, room);
        }
        const player = room.join(user, ws);
        return player ? { room, playerId: player.id } : null;
    }

    sweep() {
        const now = Date.now();
        for (const [id, room] of this.rooms) {
            if (room.emptySince && now - room.emptySince > ROOM_IDLE_MS) this.rooms.delete(id);
        }
    }
}

module.exports = { RoomRegistry, Room, sanitizeProgress, send, RACE_COUNTDOWN_MS };
