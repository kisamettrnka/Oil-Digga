// Místnosti lobby a závodu. Jedna místnost = jedna instance aktivity v Discordu (instanceId),
// lokálně ?room=... Server hru nesimuluje: rozdá všem stejný seed (stejná mapa i ceny),
// sbírá průběžné výsledky a rozesílá žebříček.
const ROOM_IDLE_MS = 60_000;          // prázdná místnost se po minutě zahodí
const STATE_THROTTLE_MS = 500;        // průběžné výsledky se rozesílají nejvýš 2× za sekundu
const { SharedGame } = require('./shared');
const { C: SIM } = require('../sim');

const RACE_COUNTDOWN_MS = 4000;
const MAX_PLAYERS = 12;
const RACE_DAY_MS = 10000;            // = MS_PER_DAY ve script.js (závod běží na 1×)
const RACE_GRACE_MS = 60_000;         // rezerva na zpoždění klientů, pak server závod ukončí sám
const RACE_MONTH_OPTIONS = [1, 3, 6, 12];
// Režimy: richest = nejvíc peněz na konci, target = kdo první nasbírá cíl, survival = kdo jediný nezkrachuje
const RACE_MODES = ['richest', 'target', 'survival'];
const TARGET_OPTIONS = [10000, 20000, 50000];
const RACE_END_WAIT_MS = 10_000;      // po race_end čeká server na finish klientů, pak uzavře sám
// Druh hry: race = každý svou kopii mapy (počítá klient), shared = jedna mapa pro všechny (počítá server)
const GAME_KINDS = ['race', 'shared'];
const DEFAULT_SETTINGS = { kind: 'race', months: 3, mode: 'richest', target: 20000 };
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

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
        reason: ['bankrupt', 'year_end', 'race_end'].includes(msg.reason) ? msg.reason : null
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
        this.raceSize = 0;            // kolik hráčů závod začalo
        this.lastStandingSent = false;
        this.raceTimer = null;
        this.settings = { ...DEFAULT_SETTINGS };
        this.winnerId = null;
        this.ending = false;
        this.shared = null;           // SharedGame během sdílené hry
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
        if (this.shared) this.shared.resume(player);
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
            case 'settings':
                if (!isHost || this.phase !== 'lobby') return;
                if (RACE_MONTH_OPTIONS.includes(msg.months)) this.settings.months = msg.months;
                if (RACE_MODES.includes(msg.mode)) this.settings.mode = msg.mode;
                if (TARGET_OPTIONS.includes(msg.target)) this.settings.target = msg.target;
                if (GAME_KINDS.includes(msg.kind)) this.settings.kind = msg.kind;
                break;
            case 'action':
                if (this.shared && player.status === 'racing' && msg.raceId === this.raceId) this.shared.act(playerId, msg.action);
                return;
            case 'start':
                if (isHost && this.phase === 'lobby') this.startRace();
                return;
            case 'progress':
                if (player.status !== 'racing' || msg.raceId !== this.raceId) return;
                player.progress = sanitizeProgress(msg);
                // Režim cíl: kdo první nahlásí peníze nad cílem, vyhrává
                if (this.settings.mode === 'target' && !this.winnerId && player.progress.money >= this.settings.target) {
                    this.winnerId = player.id;
                    this.endRaceForAll('target');
                    this.broadcastState();
                    return;
                }
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
        let racers = this.connectedPlayers().filter(p => p.status === 'lobby');
        if (!racers.length) return;
        const shared = this.settings.kind === 'shared';
        // Sdílená mapa má 8 pozemků: hraje nejvýš MAX_SHARED_PLAYERS, ostatní počkají na další kolo
        if (shared) racers = racers.slice(0, SIM.MAX_SHARED_PLAYERS);
        this.phase = 'playing';
        this.raceId++;
        this.seed = Math.floor(Math.random() * 2 ** 31);
        this.raceStartedAt = Date.now() + RACE_COUNTDOWN_MS;
        this.raceSize = racers.length;
        this.lastStandingSent = false;
        this.winnerId = null;
        this.ending = false;
        const { months, mode, target } = this.settings;
        racers.forEach(p => {
            p.status = 'racing';
            p.ready = false;
            p.progress = null;
            if (!shared) send(p.ws, { type: 'race_start', raceId: this.raceId, seed: this.seed, months, mode, target, startIn: RACE_COUNTDOWN_MS });
        });
        if (shared) this.shared = new SharedGame(this, racers, RACE_COUNTDOWN_MS);
        // Pojistka: po uplynutí herní délky závodu ho server ukončí, i když se klient zasekne
        const raceDays = DAYS_IN_MONTH.slice(1, months + 1).reduce((a, b) => a + b, 0);
        const raceId = this.raceId;
        clearTimeout(this.raceTimer);
        this.raceTimer = setTimeout(() => this.forceEnd(raceId), RACE_COUNTDOWN_MS + raceDays * RACE_DAY_MS + RACE_GRACE_MS);
        this.raceTimer.unref?.();
        this.broadcastState();
    }

    racing() {
        return this.connectedPlayers().filter(p => p.status === 'racing');
    }

    // Závod končí, když už nikdo připojený nejede (odpojení hráči závod neblokují).
    // Ve hře o víc hráčích vyhrává poslední přeživší: zbyde-li jediný, dostane race_end.
    checkRaceEnd() {
        if (this.phase !== 'playing' || this.shared) return; // sdílenou hru hlídá SharedGame
        const active = this.racing();
        if (!active.length) {
            this.finishRace();
        } else if (this.raceSize >= 2 && active.length === 1 && !this.lastStandingSent && !this.ending
            && this.othersAreOut(active[0])) {
            this.lastStandingSent = true;
            if (this.settings.mode === 'survival') this.winnerId = active[0].id;
            send(active[0].ws, { type: 'race_end', raceId: this.raceId, reason: 'last_standing', winnerId: this.winnerId });
        }
    }

    // Ostatní závodníci zkrachovali nebo odpadli (kdo dojel na čas, z boje nevypadl)
    othersAreOut(survivor) {
        return [...this.players.values()]
            .filter(p => p !== survivor && (p.status === 'racing' || p.status === 'finished'))
            .every(p => !p.connected || p.progress?.reason === 'bankrupt');
    }

    // Konec pro všechny najednou (dosažený cíl): klienti pošlou finish se svými penězi
    endRaceForAll(reason) {
        if (this.ending) return;
        this.ending = true;
        for (const p of this.racing()) send(p.ws, { type: 'race_end', raceId: this.raceId, reason, winnerId: this.winnerId });
        const raceId = this.raceId;
        clearTimeout(this.raceTimer);
        this.raceTimer = setTimeout(() => this.forceEnd(raceId), RACE_END_WAIT_MS);
        this.raceTimer.unref?.();
    }

    forceEnd(raceId) {
        if (this.phase !== 'playing' || this.raceId !== raceId) return;
        if (this.shared) {
            this.shared.endNow();
            return;
        }
        for (const p of this.players.values()) {
            if (p.status !== 'racing') continue;
            send(p.ws, { type: 'race_end', raceId, reason: 'timeout' });
            p.status = 'finished';
        }
        this.finishRace();
        this.broadcastState();
    }

    // Vítěz, pokud ho neurčil cíl nebo přežití: nejvíc peněz z těch, kdo nezkrachovali
    // Sdílený svět skončil (všichni mimo hru): stavy hráčů už srovnal SharedGame
    onSharedOver() {
        if (this.phase !== 'playing') return;
        for (const p of this.players.values()) if (p.status === 'racing') p.status = 'finished';
        this.finishRace();
        this.broadcastState();
    }

    finishRace() {
        this.phase = 'finished';
        clearTimeout(this.raceTimer);
        this.raceTimer = null;
        if (!this.winnerId) {
            const survivors = [...this.players.values()].filter(p => p.progress && p.progress.reason !== 'bankrupt');
            survivors.sort((a, b) => b.progress.money - a.progress.money);
            this.winnerId = survivors[0]?.id || null;
        }
    }

    backToLobby() {
        if (this.shared) {
            this.shared.stop();
            this.shared = null;
        }
        clearTimeout(this.raceTimer);
        this.raceTimer = null;
        this.phase = 'lobby';
        this.seed = null;
        this.winnerId = null;
        this.ending = false;
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
            raceSize: this.raceSize,
            settings: this.settings,
            winnerId: this.winnerId,
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
            if (room.emptySince && now - room.emptySince > ROOM_IDLE_MS) {
                if (room.shared) room.shared.stop();
                clearTimeout(room.raceTimer);
                this.rooms.delete(id);
            }
        }
    }
}

module.exports = { RoomRegistry, Room, sanitizeProgress, send, RACE_COUNTDOWN_MS, RACE_MONTH_OPTIONS, RACE_MODES, TARGET_OPTIONS, GAME_KINDS };
