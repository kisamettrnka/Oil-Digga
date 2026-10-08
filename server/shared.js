// Sdílená mapa: server počítá jeden svět (sim.js) pro všechny hráče místnosti.
// Klienti posílají jen akce (koupě, stavby, potrubí...), server 20× za sekundu krokuje svět
// a 5× za sekundu rozešle stav s událostmi. Klient mezi zprávami svět dopočítává sám,
// takže kamiony jezdí plynule, a další zpráva ho opraví.
const Sim = require('../sim');

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

class SharedGame {
    constructor(room, racers, startInMs) {
        this.room = room;
        this.raceId = room.raceId;
        const { months, mode, target } = room.settings;
        this.world = Sim.createWorld({
            seed: room.seed,
            race: { months, mode, target },
            shared: true,
            players: racers.map(p => ({ id: p.id, name: p.name }))
        });
        this.startAt = Date.now() + startInMs;
        this.pendingEvents = [];
        this.tickCount = 0;
        this.actionCounts = new Map();
        this.finished = false;
        racers.forEach(p => this.sendStart(p));
        this.startTimer = setTimeout(() => { this.world.time.started = true; }, startInMs);
        this.interval = setInterval(() => this.tick(), TICK_MS);
        this.startTimer.unref?.();
        this.interval.unref?.();
    }

    sendStart(player) {
        if (!player.ws || player.ws.readyState !== 1) return;
        const { months, mode, target } = this.room.settings;
        const head = JSON.stringify({
            type: 'shared_start', raceId: this.raceId, months, mode, target,
            startIn: Math.max(0, this.startAt - Date.now())
        });
        player.ws.send(`${head.slice(0, -1)},"world":${serializeRounded(this.world)}}`);
    }

    hasPlayer(id) {
        return !!this.world.players[id];
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
        Sim.act(this.world, playerId, action);
    }

    tick() {
        if (this.finished) return;
        Sim.step(this.world, TICK_MS);
        this.applyRaceRules();
        this.pendingEvents.push(...this.world.events.splice(0));
        this.syncRoomPlayers();
        this.tickCount++;
        if (this.world.over || this.tickCount % BROADCAST_EVERY === 0) this.broadcast();
        if (this.world.over) {
            this.finished = true;
            this.stop();
            this.room.onSharedOver();
        }
    }

    // Režimy závodu na sdílené mapě: cíl, poslední přeživší (bankrot nebo odpojení soupeřů)
    applyRaceRules() {
        const world = this.world;
        if (world.over || !world.time.started) return;
        const settings = this.room.settings;
        const ids = world.playerOrder;
        if (settings.mode === 'target' && !this.room.winnerId) {
            const hit = ids.find(id => !world.players[id].over && world.players[id].money >= settings.target);
            if (hit) {
                this.room.winnerId = hit;
                Sim.endAll(world, 'race_end');
                return;
            }
        }
        const isIn = id => !world.players[id].over && this.room.players.get(id)?.connected;
        const alive = ids.filter(isIn);
        if (!alive.length) {
            Sim.endAll(world, 'race_end');
        } else if (ids.length >= 2 && alive.length === 1) {
            if (settings.mode === 'survival') this.room.winnerId = alive[0];
            Sim.endAll(world, 'race_end');
        }
    }

    // Průběžné výsledky do místnosti (žebříček a výsledky používají stejná data jako závod)
    syncRoomPlayers() {
        const world = this.world;
        world.playerOrder.forEach(id => {
            const roomPlayer = this.room.players.get(id);
            const p = world.players[id];
            if (!roomPlayer) return;
            roomPlayer.progress = {
                money: Math.round(p.money), revenue: Math.round(p.revenue), sold: Math.round(p.sold),
                day: world.time.day, month: world.time.month, over: p.over, reason: p.reason
            };
            if (p.over && roomPlayer.status === 'racing') roomPlayer.status = 'finished';
        });
        this.room.scheduleState();
    }

    broadcast() {
        const events = JSON.stringify(this.pendingEvents);
        this.pendingEvents = [];
        const message = `{"type":"snapshot","raceId":${this.raceId},"events":${events},"world":${serializeRounded(this.world)}}`;
        for (const p of this.room.players.values()) {
            if (p.connected && p.ws && p.ws.readyState === 1 && this.hasPlayer(p.id)) p.ws.send(message);
        }
    }

    // Pojistka serveru (vypršel čas závodu): ukončí všechny, poslední krok rozešle konec
    endNow() {
        if (!this.world.over) Sim.endAll(this.world, 'race_end');
    }

    stop() {
        clearInterval(this.interval);
        clearTimeout(this.startTimer);
    }
}

module.exports = { SharedGame, serializeRounded, TICK_MS };
