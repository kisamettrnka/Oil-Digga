// Spuštění: npm test (node --test). Soubor projde, když skončí s kódem 0.
const assert = require('node:assert');
const { Room } = require('../server/rooms');
const Sim = require('../sim');
const C = Sim.C;
const fakeWs = name => ({ name, readyState: 1, inbox: [], send(d) { this.inbox.push(JSON.parse(d)); }, close() { this.readyState = 3; } });
const wait = ms => new Promise(r => setTimeout(r, ms));
const last = (w, type) => [...w.inbox].reverse().find(m => m.type === type);

(async () => {
    const out = [];
    const t = async (name, fn) => { try { await fn(); out.push('OK   ' + name); } catch (e) { out.push('FAIL ' + name + ': ' + e.stack.split('\n').slice(0, 2).join(' | ')); } };

    await t('shared game: start, actions, snapshots, both players act on one world', async () => {
        const room = new Room('s');
        const a = fakeWs('a'), b = fakeWs('b');
        room.join({ id: 'a', name: 'Alice' }, a);
        room.join({ id: 'b', name: 'Bob' }, b);
        room.handle('a', { type: 'settings', kind: 'shared', months: 1 });
        room.handle('a', { type: 'start' });
        const start = last(b, 'shared_start');
        assert.ok(start && start.world.shared, 'shared_start with world');
        assert.deepStrictEqual(Object.keys(start.world.players), ['a', 'b']);
        const rid = room.raceId;
        const w = room.shared.world;
        w.players.a.money = w.players.b.money = 50000;
        // Koupě na sdílené mapě je dražba: první příhoz od a, b musí přihodit víc, pak se čeká na konec
        const settleAuctions = () => { w.time.started = true; for (let i = 0; i < 50 && w.auctions.length; i++) Sim.step(w, 500); };
        room.handle('a', { type: 'action', raceId: rid, action: { type: 'buyPlot', plotId: 2 } });
        room.handle('b', { type: 'action', raceId: rid, action: { type: 'buyPlot', plotId: 2 } });
        assert.ok(w.auctions.some(x => x.plotId === 2 && x.bidder === 'a'), 'a leads the auction');
        settleAuctions();
        assert.strictEqual(w.plots[2].owner, 'a', 'first buyer gets the plot');
        room.handle('b', { type: 'action', raceId: rid, action: { type: 'buyPlot', plotId: 5 } });
        settleAuctions();
        room.handle('a', { type: 'action', raceId: rid, action: { type: 'buildDerrick', plotId: 2 } });
        room.handle('b', { type: 'action', raceId: rid, action: { type: 'buildDerrick', plotId: 2 } });
        assert.ok(w.plots[2].hasVrt);
        await wait(300);
        const snap = last(b, 'snapshot');
        assert.ok(snap, 'snapshot arrives');
        assert.strictEqual(snap.world.plots[2].owner, 'a');
        assert.strictEqual(snap.world.plots[5].owner, 'b');
        assert.ok(snap.world.players.a.money < 50000);
        // klientská kopie jde krokovat (predikce)
        snap.world.events = [];
        Sim.step(snap.world, 16);
        room.backToLobby();
    });

    await t('shared game: countdown then time runs on server', async () => {
        const room = new Room('s2');
        const a = fakeWs('a'), b = fakeWs('b');
        room.join({ id: 'a', name: 'A' }, a);
        room.join({ id: 'b', name: 'B' }, b);
        room.handle('a', { type: 'settings', kind: 'shared' });
        room.handle('a', { type: 'start' });
        assert.strictEqual(room.shared.world.time.started, false);
        await wait(4200);
        assert.strictEqual(room.shared.world.time.started, true);
        room.backToLobby();
        assert.strictEqual(room.shared, null);
    });

    await t('shared game: bankrupt opponent -> last standing ends, survival winner', async () => {
        const room = new Room('s3');
        const a = fakeWs('a'), b = fakeWs('b');
        room.join({ id: 'a', name: 'A' }, a);
        room.join({ id: 'b', name: 'B' }, b);
        room.handle('a', { type: 'settings', kind: 'shared', mode: 'survival' });
        room.handle('a', { type: 'start' });
        const w = room.shared.world;
        w.time.started = true;
        Sim.endPlayer(w, w.players.b, 'bankrupt');
        await wait(200);
        assert.strictEqual(room.phase, 'finished');
        assert.strictEqual(room.winnerId, 'a');
        assert.ok(last(a, 'snapshot').world.over, 'final snapshot says over');
    });

    await t('shared game: target reached ends for everyone', async () => {
        const room = new Room('s4');
        const a = fakeWs('a'), b = fakeWs('b');
        room.join({ id: 'a', name: 'A' }, a);
        room.join({ id: 'b', name: 'B' }, b);
        room.handle('a', { type: 'settings', kind: 'shared', mode: 'target', target: 10000 });
        room.handle('a', { type: 'start' });
        const w = room.shared.world;
        w.time.started = true;
        w.players.b.money = 12000;
        await wait(200);
        assert.strictEqual(room.winnerId, 'b');
        assert.strictEqual(room.phase, 'finished');
    });

    await t('shared game: action spam is rate limited', async () => {
        const room = new Room('s5');
        const a = fakeWs('a');
        room.join({ id: 'a', name: 'A' }, a);
        room.handle('a', { type: 'settings', kind: 'shared' });
        room.handle('a', { type: 'start' });
        const w = room.shared.world;
        w.players.a.money = 1e6;
        for (let i = 0; i < 100; i++) room.handle('a', { type: 'action', raceId: room.raceId, action: { type: 'buyTruck' } });
        assert.ok(w.players.a.trucksOwned <= C.MAX_TRUCKS);
        room.backToLobby();
    });

    await t('shared game: reconnect resumes with current world', async () => {
        const room = new Room('s6');
        const a = fakeWs('a'), b = fakeWs('b');
        room.join({ id: 'a', name: 'A' }, a);
        room.join({ id: 'b', name: 'B' }, b);
        room.handle('a', { type: 'settings', kind: 'shared' });
        room.handle('a', { type: 'start' });
        room.shared.world.players.b.money = 777;
        room.leave('b', b);
        const b2 = fakeWs('b2');
        room.join({ id: 'b', name: 'B' }, b2);
        const resumed = last(b2, 'shared_start');
        assert.ok(resumed && resumed.world.players.b.money === 777);
        room.backToLobby();
    });

    await t('shared game: world news reach every player via snapshot events', async () => {
        const room = new Room('s7');
        const a = fakeWs('a'), b = fakeWs('b');
        room.join({ id: 'a', name: 'A' }, a);
        room.join({ id: 'b', name: 'B' }, b);
        room.handle('a', { type: 'settings', kind: 'shared' });
        room.handle('a', { type: 'start' });
        const w = room.shared.world;
        w.time.started = true;
        w.news.nextInDays = 1;
        w.time.dayTimer = C.MS_PER_DAY - 10;
        await wait(300);
        [a, b].forEach(ws => {
            const news = ws.inbox.filter(m => m.type === 'snapshot').flatMap(m => m.events).filter(e => e.type === 'news');
            assert.strictEqual(news.length, 1, 'one news event per player');
        });
        assert.strictEqual(last(b, 'snapshot').world.news.active.length, 1);
        room.backToLobby();
    });

    console.log(out.join('\n'));
    process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
