// Hra na serveru: server počítá svět (sim.js), klienti posílají jen akce (koupě, stavby,
// vrtání...). 20× za sekundu krokuje svět a 5× za sekundu rozešle každému hráči stav s událostmi.
// Klient mezi zprávami svět dopočítává sám, takže vozy jezdí plynule, a další zpráva ho opraví.
// Sdílená mapa = jeden svět pro všechny, závod = svět na hráče ze stejného seedu.
const Sim = require('../sim');
const playerSpec = p => ({ id: p.id, name: p.name, color: Sim.PLAYER_COLORS[p.colorIndex] });

const TICK_MS = 50;
const BROADCAST_EVERY = 4;         // každý 4. krok = 5× za sekundu
const ACTIONS_PER_SECOND = 30;     // ochrana proti zahlcení (kolečko myši apod.)

// Čísla zaokrouhlená na setiny: zpráva je o dost kratší a na kreslení to stačí
function serializeRounded(world) {
    return JSON.stringify(world, (key, value) => {
        if (key === 'events' || key === '_market') return undefined;
        return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value;
    });
}

// Pohled jednoho hráče: ložiska a rizika, která nezná, jdou jen jako { id, hidden } bez tvaru
// a obsahu, aby je nešlo vyčíst z devtools. Zbytek světa je společný.
function serializeFor(world, playerId) {
    const clock = world.tools.clock;
    const view = {
        ...world,
        oilPockets: world.oilPockets.map(p => {
            const known = p.tappedBy.length > 0 || p.revealedBy.includes(playerId) || (p.echo[playerId] || 0) > clock;
            return known ? p : { id: p.id, hidden: true, oil: 0, maxOil: 0, tappedBy: [], revealedBy: [], echo: {} };
        }),
        hazards: world.hazards.map(h => (h.hit || h.revealedBy.includes(playerId)
            ? h : { id: h.id, kind: h.kind, hidden: true, hit: false, spent: !!h.spent, revealedBy: [] }))
    };
    return serializeRounded(view);
}

// Jedna hra místnosti. Sdílená mapa: jeden svět pro všechny. Závod „každý svou mapu“: svět na hráče
// ze stejného seedu (separate), takže i závod počítá server a klient nemůže hlásit vymyšlené peníze.
class SharedGame {
    constructor(room, racers, startInMs, { separate = false } = {}) {
        this.room = room;
        this.raceId = room.raceId;
        this.separate = separate;
        const { months, mode, target } = room.settings;
        const race = { months, mode, target };
        this.ids = racers.map(p => p.id);
        this.worlds = new Map();
        if (separate) {
            racers.forEach(p => this.worlds.set(p.id, Sim.createWorld({ seed: room.seed, race, shared: false, players: [playerSpec(p)] })));
        } else {
            const world = Sim.createWorld({ seed: room.seed, race, shared: true, players: racers.map(playerSpec) });
            racers.forEach(p => this.worlds.set(p.id, world));
        }
        this.startAt = Date.now() + startInMs;
        this.pendingEvents = new Map(this.ids.map(id => [id, []]));
        this.tickCount = 0;
        this.actionCounts = new Map();
        this.finished = false;
        racers.forEach(p => this.sendStart(p));
        this.startTimer = setTimeout(() => this.startNow(), startInMs);
        this.interval = setInterval(() => this.tick(), TICK_MS);
        this.startTimer.unref?.();
        this.interval.unref?.();
    }

    // Sdílený svět (nebo první svět závodu): testy a kontrola času
    get world() {
        return this.worlds.get(this.ids[0]);
    }

    worldOf(id) {
        return this.worlds.get(id);
    }

    uniqueWorlds() {
        return [...new Set(this.worlds.values())];
    }

    startNow() {
        this.uniqueWorlds().forEach(w => { w.time.started = true; });
    }

    sendStart(player) {
        if (!player.ws || player.ws.readyState !== 1) return;
        const { months, mode, target } = this.room.settings;
        const head = JSON.stringify({
            type: 'shared_start', raceId: this.raceId, months, mode, target, separate: this.separate,
            startIn: Math.max(0, this.startAt - Date.now())
        });
        player.ws.send(`${head.slice(0, -1)},"world":${serializeFor(this.worldOf(player.id), player.id)}}`);
    }

    hasPlayer(id) {
        return this.worlds.has(id);
    }

    // Hráč se po výpadku spojení vrátil: dostane aktuální svět a hraje dál
    resume(player) {
        if (this.hasPlayer(player.id) && !this.finished) this.sendStart(player);
    }

    act(playerId, action) {
        if (this.finished || !this.hasPlayer(playerId) || !action || typeof action !== 'object') return;
        const second = Math.floor(Date.now() / 1000);
        const count = this.actionCounts.get(playerId);
        if (count && count.second === second) {
            if (++count.n > ACTIONS_PER_SECOND) return;
        } else {
            this.actionCounts.set(playerId, { second, n: 1 });
        }
        Sim.act(this.worldOf(playerId), playerId, action);
    }

    playerState(id) {
        return this.worldOf(id).players[id];
    }

    allOver() {
        return this.uniqueWorlds().every(w => w.over);
    }

    tick() {
        if (this.finished) return;
        this.uniqueWorlds().forEach(w => Sim.step(w, TICK_MS));
        this.applyRaceRules();
        // Události světa dostanou jeho hráči (sdílený svět všichni, oddělený jen jeho majitel)
        this.uniqueWorlds().forEach(w => {
            const events = w.events.splice(0);
            if (!events.length) return;
            this.ids.forEach(id => {
                if (this.worlds.get(id) !== w) return;
                const queue = this.pendingEvents.get(id);
                queue.push(...events);
                if (queue.length > 200) queue.splice(0, queue.length - 200);
            });
        });
        this.syncRoomPlayers();
        this.tickCount++;
        const over = this.allOver();
        if (over || this.tickCount % BROADCAST_EVERY === 0) this.broadcast();
        if (over) {
            this.finished = true;
            this.stop();
            this.room.onSharedOver();
        }
    }

    // Režimy závodu: cíl (první s částkou), poslední přeživší (bankrot nebo odpojení soupeřů)
    applyRaceRules() {
        if (this.allOver() || !this.world.time.started) return;
        const settings = this.room.settings;
        const ids = this.ids;
        if (settings.mode === 'target' && !this.room.winnerId) {
            const hit = ids.find(id => !this.playerState(id).over && this.playerState(id).money >= settings.target);
            if (hit) {
                this.room.winnerId = hit;
                this.endAll();
                return;
            }
        }
        // Venku je, kdo zkrachoval nebo odpadl; kdo dojel na čas, z boje nevypadl
        const over = id => this.playerState(id).over;
        const connected = id => !!this.room.players.get(id)?.connected;
        const out = id => (over(id) && this.playerState(id).reason === 'bankrupt') || !connected(id);
        const racing = ids.filter(id => !over(id) && connected(id));
        if (!racing.length) {
            this.endAll();
        } else if (ids.length >= 2 && racing.length === 1 && ids.filter(id => id !== racing[0]).every(out)) {
            if (settings.mode === 'survival') this.room.winnerId = racing[0];
            this.endAll();
        }
    }

    endAll() {
        this.uniqueWorlds().forEach(w => Sim.endAll(w, 'race_end'));
    }

    // Průběžné výsledky do místnosti (žebříček a výsledky používají stejná data)
    syncRoomPlayers() {
        this.ids.forEach(id => {
            const roomPlayer = this.room.players.get(id);
            const p = this.playerState(id);
            const time = this.worldOf(id).time;
            if (!roomPlayer) return;
            roomPlayer.progress = {
                money: Math.round(p.money), revenue: Math.round(p.revenue), sold: Math.round(p.sold),
                day: time.day, month: time.month, over: p.over, reason: p.reason
            };
            if (p.over && roomPlayer.status === 'racing') roomPlayer.status = 'finished';
        });
        this.room.scheduleState();
    }

    broadcast() {
        for (const p of this.room.players.values()) {
            if (!(p.connected && p.ws && p.ws.readyState === 1 && this.hasPlayer(p.id))) continue;
            const events = JSON.stringify(this.pendingEvents.get(p.id));
            this.pendingEvents.set(p.id, []);
            p.ws.send(`{"type":"snapshot","raceId":${this.raceId},"events":${events},"world":${serializeFor(this.worldOf(p.id), p.id)}}`);
        }
    }

    // Pojistka serveru (vypršel čas závodu): ukončí všechny, poslední krok rozešle konec
    endNow() {
        if (!this.allOver()) this.endAll();
    }

    stop() {
        clearInterval(this.interval);
        clearTimeout(this.startTimer);
    }
}

module.exports = { SharedGame, serializeRounded, serializeFor, TICK_MS };
