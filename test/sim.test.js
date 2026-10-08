// Spuštění: npm test (node --test). Soubor projde, když skončí s kódem 0.
const assert = require('node:assert');
const Sim = require('../sim');
const { C } = Sim;
const out = [];
const t = (name, fn) => { try { fn(); out.push('OK   ' + name); } catch (e) { out.push('FAIL ' + name + ': ' + e.stack.split('\n').slice(0, 3).join(' | ')); } };
function tapNearest(w, pid, plotId) {
    const plot = w.plots[plotId];
    const cx = plot.x + C.PLOT_WIDTH / 2;
    const pk = w.oilPockets.filter(p => !p.tappedBy.length).sort((a, b) => Math.abs(a.x + a.width / 2 - cx) - Math.abs(b.x + b.width / 2 - cx))[0];
    return Sim.act(w, pid, { type: 'pipe', plotId, x: pk.x + pk.width / 2, y: pk.y + pk.height / 2 });
}

t('same seed = same world', () => {
    const a = Sim.createWorld({ seed: 42 }), b = Sim.createWorld({ seed: 42 });
    assert.deepStrictEqual(a.plots.map(p => p.price), b.plots.map(p => p.price));
    assert.strictEqual(Sim.serialize(a), Sim.serialize(b));
});

t('solo flow: buy, derrick, pipe, trucks sell oil', () => {
    const w = Sim.createWorld({ seed: 7 });
    w.players.player.money = 100000;
    assert.ok(Sim.act(w, 'player', { type: 'buyPlot', plotId: 3 }).ok);
    assert.ok(!Sim.act(w, 'player', { type: 'buyPlot', plotId: 3 }).ok, 'cannot rebuy');
    assert.ok(Sim.act(w, 'player', { type: 'buildDerrick', plotId: 3 }).ok);
    const r = tapNearest(w, 'player', 3);
    assert.ok(r.ok && r.struck, 'struck');
    Sim.act(w, 'player', { type: 'buyTruck' });
    Sim.act(w, 'player', { type: 'buyTruck' });
    w.time.started = true;
    for (let i = 0; i < 5000; i++) Sim.step(w, 16);
    const p = w.players.player;
    assert.ok(p.sold > 0, 'sold ' + p.sold);
    assert.ok(w.events.some(e => e.type === 'sale'));
    assert.ok(w.time.day > 5);
});

t('pressure builds and blows out without trucks', () => {
    const w = Sim.createWorld({ seed: 9 });
    w.players.player.money = 100000;
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 2 });
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: 2 });
    tapNearest(w, 'player', 2);
    w.time.started = true;
    for (let i = 0; i < 2000; i++) Sim.step(w, 16);
    assert.ok(w.events.some(e => e.type === 'warn'));
    assert.ok(w.events.some(e => e.type === 'blowout'));
    assert.ok(w.plots[2].spill > 0.1, 'spill ' + w.plots[2].spill);
});

t('vent resets pressure', () => {
    const w = Sim.createWorld({ seed: 9 });
    w.players.player.money = 100000;
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 2 });
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: 2 });
    tapNearest(w, 'player', 2);
    w.time.started = true;
    for (let i = 0; i < 1000; i++) Sim.step(w, 16);
    const n = Sim.getNetworkForPlot(w, 2);
    assert.ok(n.pressure >= C.VENT_MIN, 'pressure ' + n.pressure);
    assert.ok(Sim.act(w, 'player', { type: 'vent', plotId: 2 }).ok);
    assert.strictEqual(n.pressure, 0);
});

t('bankruptcy ends solo game', () => {
    const w = Sim.createWorld({ seed: 1 });
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 0 });
    w.players.player.money = 5;
    w.time.started = true;
    for (let i = 0; i < 700; i++) Sim.step(w, 16);
    assert.strictEqual(w.players.player.reason, 'bankrupt');
    assert.ok(w.over);
});

t('race length ends the race', () => {
    const w = Sim.createWorld({ seed: 1, race: { months: 1, mode: 'richest', target: 0 } });
    assert.strictEqual(w.players.player.money, 2000);
    w.time.started = true;
    for (let i = 0; i < 20000 && !w.over; i++) Sim.step(w, 16);
    assert.strictEqual(w.players.player.reason, 'race_end');
    assert.strictEqual(w.time.month, 1);
});

t('survival tax grows', () => {
    const w = Sim.createWorld({ seed: 1, race: { months: 6, mode: 'survival', target: 0 } });
    w.time.month = 3;
    assert.strictEqual(Sim.getLandTax(w), 25 + 30);
});

t('tools: seismic echoes, radar reveals per player, drone flies away', () => {
    const w = Sim.createWorld({ seed: 3, players: [{ id: 'a' }, { id: 'b' }], shared: true, race: { months: 3, mode: 'richest' } });
    w.players.a.money = 10000;
    Sim.act(w, 'a', { type: 'buyPlot', plotId: 4 });
    assert.ok(Sim.act(w, 'a', { type: 'seismic', plotId: 4, x: 0 }).ok);
    assert.ok(!Sim.act(w, 'b', { type: 'seismic', plotId: 4, x: 0 }).ok, 'not your plot');
    for (let i = 0; i < 120; i++) Sim.step(w, 16);
    assert.ok(w.oilPockets.some(p => p.echo.a > w.tools.clock), 'echo for a');
    assert.ok(!w.oilPockets.some(p => p.echo.b), 'no echo for b');
    const pk = w.oilPockets[0];
    Sim.act(w, 'a', { type: 'radar', x: pk.x + pk.width / 2, y: pk.y + pk.height / 2 });
    assert.ok(pk.revealedBy.includes('a') && !pk.revealedBy.includes('b'));
    assert.ok(Sim.act(w, 'a', { type: 'drone' }).ok);
    assert.ok(!Sim.act(w, 'a', { type: 'drone' }).ok, 'one drone at a time');
    for (let i = 0; i < 600; i++) Sim.step(w, 16);
    assert.strictEqual(w.tools.drones.length, 0);
});

t('shared: two players tap same pocket and both pump', () => {
    const w = Sim.createWorld({ seed: 5, players: [{ id: 'a' }, { id: 'b' }], shared: true, race: { months: 3, mode: 'richest' } });
    w.players.a.money = w.players.b.money = 100000;
    Sim.act(w, 'a', { type: 'buyPlot', plotId: 3 });
    assert.ok(!Sim.act(w, 'b', { type: 'buyPlot', plotId: 3 }).ok, 'b cannot buy a plot');
    Sim.act(w, 'b', { type: 'buyPlot', plotId: 4 });
    Sim.act(w, 'a', { type: 'buildDerrick', plotId: 3 });
    Sim.act(w, 'b', { type: 'buildDerrick', plotId: 4 });
    const pk = w.oilPockets[0];
    const target = { x: pk.x + pk.width / 2, y: pk.y + pk.height / 2 };
    assert.ok(Sim.act(w, 'a', { type: 'pipe', plotId: 3, ...target }).struck);
    assert.ok(Sim.act(w, 'b', { type: 'pipe', plotId: 4, ...target }).struck);
    assert.deepStrictEqual(pk.tappedBy, ['a', 'b']);
    Sim.act(w, 'a', { type: 'buyTruck' });
    Sim.act(w, 'b', { type: 'buyTruck' });
    assert.ok(!Sim.act(w, 'b', { type: 'pipe', plotId: 3, x: 500, y: 600 }).ok, 'b cannot pipe a rig');
    w.time.started = true;
    const priceBefore = w.market.left.price + w.market.right.price;
    for (let i = 0; i < 4000; i++) Sim.step(w, 16);
    assert.ok(w.players.a.sold > 0 && w.players.b.sold > 0, `sold a=${w.players.a.sold} b=${w.players.b.sold}`);
    assert.ok(w.trucks.every(tr => tr.homeNetworkId === null || Sim.getNetworkForPlot(w, tr.owner === 'a' ? 3 : 4).id === tr.homeNetworkId), 'trucks serve own rigs');
});

t('shared: bankrupt player stops pumping, others keep going', () => {
    const w = Sim.createWorld({ seed: 5, players: [{ id: 'a' }, { id: 'b' }], shared: true, race: { months: 3, mode: 'richest' } });
    w.players.a.money = 100000;
    Sim.act(w, 'a', { type: 'buyPlot', plotId: 3 });
    Sim.act(w, 'a', { type: 'buildDerrick', plotId: 3 });
    tapNearest(w, 'a', 3);
    Sim.act(w, 'a', { type: 'buyTruck' });
    Sim.act(w, 'a', { type: 'buyPlot', plotId: 1 });
    w.players.a.money = 1;
    w.time.started = true;
    for (let i = 0; i < 700; i++) Sim.step(w, 16);
    assert.strictEqual(w.players.a.reason, 'bankrupt');
    assert.ok(!w.over, 'b still plays');
    assert.ok(!Sim.getNetworkForPlot(w, 3).isPumping);
    assert.strictEqual(w.trucks.length, 0);
});

t('serialize drops functions and events, roundtrips', () => {
    const w = Sim.createWorld({ seed: 11 });
    w.events.push({ type: 'x' });
    const copy = JSON.parse(Sim.serialize(w));
    assert.strictEqual(copy.events, undefined);
    assert.strictEqual(copy._market, undefined);
    copy.events = [];
    copy.time.started = true;
    for (let i = 0; i < 100; i++) Sim.step(copy, 16); // klient počítá i bez náhody trhu
});

t('news: same seed -> same headlines on the same days', () => {
    const a = Sim.createWorld({ seed: 77, race: { months: 3, mode: 'richest' } });
    const b = Sim.createWorld({ seed: 77, race: { months: 3, mode: 'richest' } });
    // jiná délka snímků nesmí změnit, kdy a jaká zpráva přijde
    a.time.started = b.time.started = true;
    const newsA = [], newsB = [];
    for (let i = 0; i < 40 * C.MS_PER_DAY / 16; i++) { Sim.step(a, 16); newsA.push(...a.events.splice(0).filter(e => e.type === 'news').map(e => `${a.time.dayIndex}:${e.key}`)); }
    for (let i = 0; i < 40 * C.MS_PER_DAY / 50; i++) { Sim.step(b, 50); newsB.push(...b.events.splice(0).filter(e => e.type === 'news').map(e => `${b.time.dayIndex}:${e.key}`)); }
    assert.ok(newsA.length >= 3, 'some news in 40 days: ' + newsA.length);
    assert.deepStrictEqual(newsA, newsB);
});

t('news: price multiplier, closed buyer and tax break apply', () => {
    const w = Sim.createWorld({ seed: 3 });
    const add = key => {
        const n = Sim.NEWS.find(x => x.key === key);
        w.news.active.push({ ...n, daysLeft: n.days });
    };
    add('hormuz');
    w.time.started = true;
    w.time.dayTimer = C.MS_PER_DAY - 1;
    Sim.step(w, 2); // přechod dne přepočítá ceny
    assert.ok(Math.abs(w.market.left.quote - w.market.left.price * 1.6) < 0.01, 'hormuz +60 %');
    w.news.active = [];
    add('rail_strike');
    add('tax_break');
    w.time.dayTimer = C.MS_PER_DAY - 1;
    Sim.step(w, 2);
    assert.strictEqual(w.market.right.closed, true);
    assert.strictEqual(Sim.getLandTax(w), 0);
});

t('news: trucks avoid a closed buyer and turn around', () => {
    const w = Sim.createWorld({ seed: 7 });
    w.players.player.money = 100000;
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 3 });
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: 3 });
    tapNearest(w, 'player', 3);
    Sim.act(w, 'player', { type: 'buyTruck' });
    Sim.act(w, 'player', { type: 'assignTruck', company: 'right', delta: 1 });
    const strike = Sim.NEWS.find(x => x.key === 'rail_strike');
    w.news.active.push({ ...strike, daysLeft: 99 });
    w.news.nextInDays = 999;
    w.time.started = true;
    for (let i = 0; i < 3000; i++) Sim.step(w, 16);
    const sales = w.events.filter(e => e.type === 'sale');
    assert.ok(sales.length > 0, 'sold something');
    assert.ok(sales.every(e => e.company === 'left'), 'only the open refinery buys');
});

console.log(out.join('\n'));
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
