// Spuštění: npm test (node --test). Soubor projde, když skončí s kódem 0.
const assert = require('node:assert');
const { Room } = require('../server/rooms');

function fakeWs(name) {
    return { name, readyState: 1, inbox: [], send(d) { this.inbox.push(JSON.parse(d)); }, close() { this.readyState = 3; } };
}
function setup(n, settings) {
    const room = new Room('t');
    const ws = [];
    for (let i = 0; i < n; i++) { ws.push(fakeWs('p' + i)); room.join({ id: 'p' + i, name: 'P' + i, avatar: null }, ws[i]); }
    if (settings) room.handle('p0', { type: 'settings', ...settings });
    room.handle('p0', { type: 'start' });
    return { room, ws };
}
const last = (w, type) => [...w.inbox].reverse().find(m => m.type === type);
const results = [];
const t = (name, fn) => { try { fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message); } };

t('non-host cannot change settings', () => {
    const room = new Room('t'); const a = fakeWs('a'), b = fakeWs('b');
    room.join({ id: 'a', name: 'A' }, a); room.join({ id: 'b', name: 'B' }, b);
    room.handle('b', { type: 'settings', mode: 'survival', months: 12 });
    assert.deepStrictEqual(room.settings, { kind: 'race', months: 3, mode: 'richest', target: 20000 });
    room.handle('a', { type: 'settings', mode: 'bogus', target: 123, months: 2 });
    assert.deepStrictEqual(room.settings, { kind: 'race', months: 3, mode: 'richest', target: 20000 });
});

// Závod počítá server: svět na hráče ze stejného seedu; testy hýbou světy přímo
const Sim = require('../sim');
const game = room => room.shared;
const world = (room, id) => room.shared.worldOf(id);
const tick = (room, n = 1) => { room.shared.startNow(); for (let i = 0; i < n; i++) room.shared.tick(); };

t('start sends every racer its own world from the same seed', () => {
    const { room, ws } = setup(2, { mode: 'target', target: 10000, months: 6 });
    const m = last(ws[1], 'shared_start');
    assert.strictEqual(m.mode, 'target'); assert.strictEqual(m.target, 10000); assert.strictEqual(m.months, 6);
    assert.strictEqual(m.separate, true);
    assert.deepStrictEqual(Object.keys(m.world.players), ['p1'], 'own world only');
    assert.notStrictEqual(world(room, 'p0'), world(room, 'p1'));
    assert.deepStrictEqual(world(room, 'p0').plots.map(p => p.price), world(room, 'p1').plots.map(p => p.price), 'same map');
    assert.strictEqual(world(room, 'p0').shared, false, 'no auctions in a race');
    room.backToLobby?.();
});

t('target: first to reach wins, all worlds end', () => {
    const { room } = setup(3, { mode: 'target', target: 10000 });
    world(room, 'p1').players.p1.money = 9000;
    tick(room);
    assert.strictEqual(room.winnerId, null);
    world(room, 'p2').players.p2.money = 10500;
    tick(room);
    assert.strictEqual(room.winnerId, 'p2');
    assert.ok(['p0', 'p1', 'p2'].every(id => world(room, id).over), 'everyone is over');
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.snapshot().winnerId, 'p2');
});

t('last standing: 2 players, one bankrupt -> race ends', () => {
    const { room } = setup(2);
    Sim.endPlayer(world(room, 'p0'), world(room, 'p0').players.p0, 'bankrupt');
    tick(room);
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p1');
});

t('survival: last standing is winner even with less money', () => {
    const { room } = setup(3, { mode: 'survival' });
    world(room, 'p2').players.p2.money = 100;
    world(room, 'p0').players.p0.money = 9000;
    Sim.endPlayer(world(room, 'p0'), world(room, 'p0').players.p0, 'bankrupt');
    Sim.endPlayer(world(room, 'p1'), world(room, 'p1').players.p1, 'bankrupt');
    tick(room);
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p2');
});

t('richest: winner is most money among non-bankrupt at the end', () => {
    const { room } = setup(3, { mode: 'richest' });
    world(room, 'p0').players.p0.money = 9000;
    world(room, 'p1').players.p1.money = 12000;
    world(room, 'p2').players.p2.money = 4000;
    game(room).endNow();
    tick(room);
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p1');
});

t('solo race (1 player) does not end on its own', () => {
    const { room } = setup(1);
    tick(room, 5);
    assert.strictEqual(room.phase, 'playing');
});

t('disconnect leaves one racer -> last standing', () => {
    const { room, ws } = setup(2);
    room.leave('p0', ws[0]);
    tick(room);
    assert.strictEqual(room.phase, 'finished');
});

t('forceEnd finishes stuck race', () => {
    const { room } = setup(2);
    room.forceEnd(room.raceId);
    tick(room);
    assert.strictEqual(room.phase, 'finished');
});

t('reset clears winner and timers', () => {
    const { room } = setup(2, { mode: 'target', target: 10000 });
    world(room, 'p1').players.p1.money = 99999;
    tick(room);
    room.handle('p0', { type: 'reset' });
    assert.strictEqual(room.phase, 'lobby'); assert.strictEqual(room.winnerId, null); assert.strictEqual(room.raceTimer, null);
});

t('survival: finishing on time is not being out (no false last standing)', () => {
    const { room } = setup(2, { mode: 'survival' });
    Sim.endPlayer(world(room, 'p0'), world(room, 'p0').players.p0, 'race_end');
    tick(room);
    assert.strictEqual(room.phase, 'playing', 'p1 still races');
    assert.strictEqual(room.winnerId, null);
    world(room, 'p0').players.p0.money = 9000;
    world(room, 'p1').players.p1.money = 3000;
    Sim.endPlayer(world(room, 'p1'), world(room, 'p1').players.p1, 'race_end');
    tick(room);
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p0');
});

t('clients cannot report money: progress and finish messages are ignored', () => {
    const { room } = setup(2, { mode: 'target', target: 10000 });
    room.handle('p1', { type: 'progress', raceId: room.raceId, money: 99999 });
    room.handle('p1', { type: 'finish', raceId: room.raceId, money: 99999, reason: 'race_end' });
    tick(room);
    assert.strictEqual(room.winnerId, null);
    assert.ok(room.players.get('p1').progress.money < 10000);
});

console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
