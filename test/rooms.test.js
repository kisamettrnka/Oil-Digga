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

t('race_start carries mode, target and months', () => {
    const { ws } = setup(2, { mode: 'target', target: 10000, months: 6 });
    const m = last(ws[1], 'race_start');
    assert.strictEqual(m.mode, 'target'); assert.strictEqual(m.target, 10000); assert.strictEqual(m.months, 6);
});

t('target: first to reach wins, everyone gets race_end', () => {
    const { room, ws } = setup(3, { mode: 'target', target: 10000 });
    const rid = room.raceId;
    room.handle('p1', { type: 'progress', raceId: rid, money: 9000 });
    assert.strictEqual(room.winnerId, null);
    room.handle('p2', { type: 'progress', raceId: rid, money: 10500 });
    assert.strictEqual(room.winnerId, 'p2');
    ws.forEach(w => assert.strictEqual(last(w, 'race_end')?.reason, 'target'));
    room.handle('p1', { type: 'progress', raceId: rid, money: 20000 }); // pozdě
    assert.strictEqual(room.winnerId, 'p2');
    ['p0', 'p1', 'p2'].forEach(id => room.handle(id, { type: 'finish', raceId: rid, money: 5000, reason: 'race_end' }));
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.snapshot().winnerId, 'p2');
});

t('last standing: 2 players, one bankrupt -> other gets race_end', () => {
    const { room, ws } = setup(2);
    const rid = room.raceId;
    room.handle('p0', { type: 'finish', raceId: rid, money: -10, reason: 'bankrupt' });
    assert.strictEqual(room.phase, 'playing');
    assert.strictEqual(last(ws[1], 'race_end')?.reason, 'last_standing');
    room.handle('p1', { type: 'finish', raceId: rid, money: 2500, reason: 'race_end' });
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p1');
});

t('survival: last standing is winner even with less money', () => {
    const { room } = setup(3, { mode: 'survival' });
    const rid = room.raceId;
    room.handle('p0', { type: 'finish', raceId: rid, money: -5, reason: 'bankrupt' });
    room.handle('p1', { type: 'finish', raceId: rid, money: -50, reason: 'bankrupt' });
    assert.strictEqual(room.winnerId, 'p2');
    room.handle('p2', { type: 'finish', raceId: rid, money: 100, reason: 'race_end' });
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p2');
});

t('richest: winner is most money among non-bankrupt', () => {
    const { room } = setup(3, { mode: 'richest' });
    const rid = room.raceId;
    room.handle('p0', { type: 'finish', raceId: rid, money: 9000, reason: 'race_end' });
    room.handle('p1', { type: 'finish', raceId: rid, money: 12000, reason: 'race_end' });
    room.handle('p2', { type: 'finish', raceId: rid, money: 4000, reason: 'race_end' });
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p1');
});

t('solo race (1 player) does not end on its own', () => {
    const { room, ws } = setup(1);
    assert.strictEqual(room.phase, 'playing');
    assert.strictEqual(last(ws[0], 'race_end'), undefined);
});

t('disconnect leaves one racer -> last standing', () => {
    const { room, ws } = setup(2);
    room.leave('p0', ws[0]);
    assert.strictEqual(last(ws[1], 'race_end')?.reason, 'last_standing');
});

t('forceEnd finishes stuck race', () => {
    const { room } = setup(2);
    room.forceEnd(room.raceId);
    assert.strictEqual(room.phase, 'finished');
});

t('reset clears winner and timers', () => {
    const { room } = setup(2, { mode: 'target', target: 10000 });
    room.handle('p1', { type: 'progress', raceId: room.raceId, money: 99999 });
    room.handle('p0', { type: 'reset' });
    assert.strictEqual(room.phase, 'lobby'); assert.strictEqual(room.winnerId, null); assert.strictEqual(room.raceTimer, null);
});

t('survival: finishing on time is not being out (no false last standing)', () => {
    const { room, ws } = setup(2, { mode: 'survival' });
    const rid = room.raceId;
    room.handle('p0', { type: 'finish', raceId: rid, money: 9000, reason: 'race_end' });
    assert.strictEqual(last(ws[1], 'race_end'), undefined);
    room.handle('p1', { type: 'finish', raceId: rid, money: 3000, reason: 'race_end' });
    assert.strictEqual(room.phase, 'finished');
    assert.strictEqual(room.winnerId, 'p0');
});

console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
