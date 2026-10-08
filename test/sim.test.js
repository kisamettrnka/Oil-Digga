// Spuštění: npm test (node --test). Soubor projde, když skončí s kódem 0.
const assert = require('node:assert');
const Sim = require('../sim');
const { C } = Sim;
const out = [];
const t = (name, fn) => { try { fn(); out.push('OK   ' + name); } catch (e) { out.push('FAIL ' + name + ': ' + e.stack.split('\n').slice(0, 3).join(' | ')); } };
// Vrtá k bodu, dokud vrták nedojede (preventer a korunku obslouží sám). Čas běží jen po dobu vrtání.
function drillTo(w, pid, plotId, target) {
    const r = Sim.act(w, pid, { type: 'drill', plotId, x: target.x, y: target.y });
    if (!r.ok) return r;
    const started = w.time.started;
    w.time.started = true;
    const n = Sim.getNetworkForPlot(w, plotId);
    for (let i = 0; i < 40000 && n.drillState !== 'done' && n.drillState !== 'idle'; i++) {
        serviceRigs(w);
        Sim.step(w, 16);
    }
    w.time.started = started;
    return { ok: true, struck: n.drillState === 'done' };
}
// Obsluha vrtných souprav jako hráč: zavře preventer, vymění korunku
function serviceRigs(w) {
    w.pipeNetworks.forEach(n => {
        if (n.drillState === 'kick') Sim.act(w, n.owner, { type: 'bop', plotId: n.derrickId });
        if (n.drillState === 'worn' && !(n.blowout > 0)) Sim.act(w, n.owner, { type: 'bit', plotId: n.derrickId });
    });
}
function pocketCenter(pk) {
    return { x: pk.x + pk.width / 2, y: pk.y + pk.height / 2 };
}
function tapNearest(w, pid, plotId) {
    const plot = w.plots[plotId];
    const cx = plot.x + plot.width / 2;
    const pk = w.oilPockets.filter(p => !p.tappedBy.length).sort((a, b) => Math.abs(a.x + a.width / 2 - cx) - Math.abs(b.x + b.width / 2 - cx))[0];
    return drillTo(w, pid, plotId, pocketCenter(pk));
}
// Svět bez náhodných rizik a s jednou horninou: pro testy, které měří vrtání
function plainWorld(seed, rock = 'sand') {
    const w = Sim.createWorld({ seed });
    w.hazards = [];
    w.links = [];
    w.strata = { bounds: [], layers: [rock] };
    w.plots.forEach(p => { p.terrain = 'flat'; p.rockDepth = 0; });
    w.players.player.money = 100000;
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 3 });
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: 3 });
    w.time.started = true;
    w.news.nextInDays = 9999;
    return w;
}
const rigX = w => w.plots[3].x + w.plots[3].width / 2;

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
    w.hazards = [];
    w.links = [];
    w.oilPockets = [pk]; // ať vrták cestou nenarazí na jiné ložisko
    Sim.act(w, 'a', { type: 'drill', plotId: 3, ...target });
    Sim.act(w, 'b', { type: 'drill', plotId: 4, ...target });
    w.time.started = true;
    for (let i = 0; i < 40000 && pk.tappedBy.length < 2; i++) { serviceRigs(w); Sim.step(w, 16); }
    assert.deepStrictEqual(pk.tappedBy.slice().sort(), ['a', 'b']);
    Sim.act(w, 'a', { type: 'buyTruck' });
    Sim.act(w, 'b', { type: 'buyTruck' });
    assert.ok(!Sim.act(w, 'b', { type: 'drill', plotId: 3, x: 500, y: 600 }).ok, 'b cannot drill a rig');
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
    assert.ok(Math.abs(w.market.left.quote - w.market.left.price * 1.2) < 0.01, 'hormuz +20 % in town');
    w.news.active = [];
    add('rail_strike');
    add('tax_break');
    w.time.dayTimer = C.MS_PER_DAY - 1;
    Sim.step(w, 2);
    assert.strictEqual(w.market.right.closed, true);
    assert.strictEqual(Sim.getLandTax(w), 0);
});

t('news: trucks avoid a closed buyer', () => {
    const w = Sim.createWorld({ seed: 7 });
    w.players.player.money = 100000;
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 3 });
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: 3 });
    tapNearest(w, 'player', 3);
    Sim.act(w, 'player', { type: 'buyTruck' });
    const fire = Sim.NEWS.find(x => x.key === 'refinery_fire');
    w.news.active.push({ ...fire, daysLeft: 99 });
    w.news.nextInDays = 999;
    w.time.started = true;
    for (let i = 0; i < 3000; i++) Sim.step(w, 16);
    const sales = w.events.filter(e => e.type === 'sale');
    assert.ok(sales.length > 0, 'sold something');
    assert.ok(sales.every(e => e.company !== 'left'), 'the burning refinery does not buy');
});

t('market: full stock lowers the price, the town consumes it', () => {
    const w = Sim.createWorld({ seed: 40 });
    w.time.started = true;
    const b = w.market.lamps;
    const fresh = b.quote;
    b.stock = b.demand * 3;
    Sim.step(w, 16);
    assert.ok(b.quote < fresh * 0.6, `flooded ${b.quote} vs ${fresh}`);
    const stock = b.stock;
    Sim.step(w, C.MS_PER_DAY / 2);
    assert.ok(Math.abs(stock - b.stock - b.demand / 2) < 1, 'half a day of demand consumed');
    assert.ok(!w.market.right.open && w.market.right.closed, 'rail depot comes later');
});

t('market: trucks spread loads to the buyer that pays more', () => {
    const w = Sim.createWorld({ seed: 41 });
    w.time.started = true;
    // prázdná petrolejka platí víc než přeplněná rafinerie
    w.market.lamps.stock = 0;
    w.market.left.stock = w.market.left.demand * 4;
    const truck = { id: 99, owner: 'player', x: 400, state: 'to_company', oil: 100, targetCompany: null, facing: 1 };
    w.trucks.push(truck);
    Sim.step(w, 16);
    assert.strictEqual(truck.targetCompany, 'lamps');
});

t('town: deliveries move the era, open the rail depot and switch to trucks', () => {
    const w = plainWorld(42);
    assert.strictEqual(w.town.era, 0);
    const wagon = Sim.truckSpeed(w);
    w.trucks.push({ id: 5, owner: 'player', x: 60, state: 'to_company', oil: 100, targetCompany: 'left', facing: -1 });
    w.town.delivered = Sim.ERAS[2].delivered - 50;
    w.trucks[0].x = 50;
    Sim.step(w, 16);
    assert.strictEqual(w.town.era, 2);
    assert.ok(w.events.filter(e => e.type === 'era').length === 2, 'boomtown and rail announced');
    assert.ok(w.market.right.open && !w.market.right.closed, 'rail depot buys');
    assert.ok(Sim.truckSpeed(w) > wagon, 'trucks replace wagons');
});

t('contracts: offer, accept, deliver at the contract price', () => {
    const w = plainWorld(43);
    w.contracts.nextInDays = 1;
    w.time.dayTimer = C.MS_PER_DAY - 1;
    Sim.step(w, 2);
    const offer = w.contracts.offers[0];
    assert.ok(offer, 'an offer arrived');
    assert.ok(w.events.some(e => e.type === 'contract_offer'));
    assert.ok(Sim.act(w, 'player', { type: 'acceptContract', id: offer.id }).ok);
    assert.ok(!Sim.act(w, 'player', { type: 'acceptContract', id: offer.id }).ok, 'taken');
    const buyer = w.market[offer.buyer];
    const truck = { id: 7, owner: 'player', x: buyer.x + 1, state: 'to_company', oil: offer.amount, targetCompany: offer.buyer, facing: -1 };
    w.trucks.push(truck);
    const money = w.players.player.money;
    Sim.step(w, 16);
    assert.ok(w.events.some(e => e.type === 'contract_done'));
    assert.ok(Math.abs(w.players.player.money - money - offer.amount * offer.price) < 1, 'paid the contract price');
    assert.strictEqual(w.contracts.active.length, 0);
});

t('contracts: missing the deadline costs a penalty', () => {
    const w = plainWorld(44);
    w.contracts.offers.push({ id: 50, buyer: 'left', amount: 400, price: 1.5, days: 1, expiresIn: 3 });
    assert.ok(Sim.act(w, 'player', { type: 'acceptContract', id: 50 }).ok);
    const money = w.players.player.money;
    w.time.dayTimer = C.MS_PER_DAY - 1;
    Sim.step(w, 2);
    const failed = w.events.find(e => e.type === 'contract_failed');
    assert.ok(failed && failed.penalty === Math.round(400 * 1.5 * C.CONTRACT_PENALTY));
    assert.ok(w.players.player.money < money - failed.penalty + 1);
});

t('drilling takes time and is paid per pixel', () => {
    const w = plainWorld(21);
    const start = w.players.player.money;
    const x = rigX(w);
    assert.ok(Sim.act(w, 'player', { type: 'drill', plotId: 3, x, y: C.GROUND_LEVEL + 100 }).ok);
    const n = Sim.getNetworkForPlot(w, 3);
    w.oilPockets = []; // nic k navrtání
    Sim.step(w, 1000);
    assert.ok(Math.abs(n.drilled - C.DRILL_SPEED) < 0.5, 'one second of sand ' + n.drilled);
    assert.ok(Math.abs(start - w.players.player.money - n.drilled * C.DRILL_COST_PER_PX) < 1, 'paid per px');
    for (let i = 0; i < 300; i++) Sim.step(w, 16);
    assert.strictEqual(n.drillState, 'idle');
    assert.ok(Math.abs(n.drilled - 100) < 0.01);
    const g = plainWorld(21, 'granite');
    g.oilPockets = [];
    Sim.act(g, 'player', { type: 'drill', plotId: 3, x, y: C.GROUND_LEVEL + 100 });
    Sim.step(g, 1000);
    const gn = Sim.getNetworkForPlot(g, 3);
    assert.ok(gn.drilled < n.drilled / 4, 'granite is slow ' + gn.drilled);
    assert.ok((1 - gn.bit) / gn.drilled > (1 - n.bit) / n.drilled * 4, 'granite wears the bit faster per px');
});

t('drill cannot climb steeply, drillStop cuts the plan', () => {
    const w = plainWorld(22);
    w.oilPockets = [];
    const x = rigX(w);
    Sim.act(w, 'player', { type: 'drill', plotId: 3, x, y: C.GROUND_LEVEL + 200 });
    assert.strictEqual(Sim.act(w, 'player', { type: 'drill', plotId: 3, x: x + 10, y: C.GROUND_LEVEL + 100 }).reason, 'angle');
    assert.ok(Sim.act(w, 'player', { type: 'drill', plotId: 3, x: x + 200, y: C.GROUND_LEVEL + 180 }).ok, 'slight rise is fine');
    Sim.step(w, 1000);
    assert.ok(Sim.act(w, 'player', { type: 'drillStop', plotId: 3 }).ok);
    const n = Sim.getNetworkForPlot(w, 3);
    assert.strictEqual(n.drillState, 'idle');
    assert.ok(Math.abs(Sim.pathLength(n.path) - n.drilled) < 0.01, 'path ends at the bit');
});

t('worn bit stops the drill until replaced', () => {
    const w = plainWorld(23);
    w.oilPockets = [];
    Sim.act(w, 'player', { type: 'drill', plotId: 3, x: rigX(w), y: C.GROUND_LEVEL + 300 });
    const n = Sim.getNetworkForPlot(w, 3);
    n.bit = 0.001;
    Sim.step(w, 100);
    assert.strictEqual(n.drillState, 'worn');
    const at = n.drilled;
    Sim.step(w, 500);
    assert.strictEqual(n.drilled, at, 'no progress on a worn bit');
    assert.ok(Sim.act(w, 'player', { type: 'bit', plotId: 3 }).ok);
    Sim.step(w, C.BIT_SWAP_MS + 20);
    assert.strictEqual(n.bit, 1);
    Sim.step(w, 200);
    assert.ok(n.drilled > at);
});

t('gas kick: preventer saves the well, ignoring it blows out', () => {
    const setup = () => {
        const w = plainWorld(24);
        w.oilPockets = [];
        w.hazards = [{ id: 0, kind: 'gas', x: rigX(w), y: C.GROUND_LEVEL + 60, r: 15, hit: false, revealedBy: [] }];
        Sim.act(w, 'player', { type: 'drill', plotId: 3, x: rigX(w), y: C.GROUND_LEVEL + 200 });
        for (let i = 0; i < 200 && Sim.getNetworkForPlot(w, 3).drillState === 'drilling'; i++) Sim.step(w, 16);
        return w;
    };
    const saved = setup();
    const n = Sim.getNetworkForPlot(saved, 3);
    assert.strictEqual(n.drillState, 'kick');
    assert.ok(Sim.act(saved, 'player', { type: 'bop', plotId: 3 }).ok);
    Sim.step(saved, C.KICK_SHUT_MS + 20);
    assert.strictEqual(n.drillState, 'drilling');
    assert.ok(!saved.events.some(e => e.type === 'blowout'));

    const lost = setup();
    const money = lost.players.player.money;
    Sim.step(lost, C.KICK_MS + 20);
    const ln = Sim.getNetworkForPlot(lost, 3);
    assert.ok(lost.events.some(e => e.type === 'blowout' && e.kick));
    assert.strictEqual(ln.drillState, 'worn');
    assert.ok(lost.players.player.money <= money - Sim.getBlowoutFine(lost));
});

t('water layer waters the well, cement fixes it', () => {
    const w = plainWorld(25);
    const pk = w.oilPockets[0];
    const x = rigX(w);
    Object.assign(pk, { x: x - 50, y: C.GROUND_LEVEL + 150, width: 100, height: 60, oil: 8000, maxOil: 8000, drive0: 1 });
    pk.vertices = [{ x: x - 50, y: C.GROUND_LEVEL + 150 }, { x: x + 50, y: C.GROUND_LEVEL + 150 }, { x: x + 50, y: C.GROUND_LEVEL + 210 }, { x: x - 50, y: C.GROUND_LEVEL + 210 }];
    w.oilPockets = [pk];
    pk.id = 0;
    w.hazards = [{ id: 0, kind: 'water', x, y: C.GROUND_LEVEL + 80, r: 20, hit: false, revealedBy: [] }];
    assert.ok(drillTo(w, 'player', 3, { x, y: C.GROUND_LEVEL + 180 }).struck);
    const n = Sim.getNetworkForPlot(w, 3);
    assert.ok(Math.abs(n.waterCut - C.WATER_CUT_HIT) < 1e-9);
    const wet = Sim.wellRate(w, n);
    assert.ok(Sim.act(w, 'player', { type: 'cement', plotId: 3 }).ok);
    assert.ok(Sim.wellRate(w, n) > wet * 1.4, 'cemented well flows more');
});

t('reservoir: rate declines as the pocket drains, injection lifts it', () => {
    const w = plainWorld(26);
    const pk = w.oilPockets[0];
    w.oilPockets = [pk];
    const x = pocketCenter(pk).x;
    w.plots[3].x = x - w.plots[3].width / 2;
    assert.ok(drillTo(w, 'player', 3, pocketCenter(pk)).struck);
    const n = Sim.getNetworkForPlot(w, 3);
    pk.oil = pk.maxOil;
    const full = Sim.wellRate(w, n);
    pk.oil = pk.maxOil / 2;
    const half = Sim.wellRate(w, n);
    assert.ok(half < full * 0.5, `decline full=${full} half=${half}`);
    // druhý vrt do stejného ložiska vtláčí vodu
    Sim.act(w, 'player', { type: 'buyPlot', plotId: 4 });
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: 4 });
    w.plots[4].x = x - w.plots[4].width / 2 + 30;
    assert.ok(drillTo(w, 'player', 4, pocketCenter(pk)).struck, 'second well into the same pocket');
    const injector = Sim.getNetworkForPlot(w, 4);
    assert.ok(Sim.act(w, 'player', { type: 'inject', plotId: 4 }).ok);
    assert.ok(!injector.isPumping && injector.injecting);
    const money = w.players.player.money;
    pk.oil = pk.maxOil / 2;
    const before = Sim.pocketDrive(pk);
    for (let i = 0; i < 625; i++) { Sim.step(w, 16); pk.oil = pk.maxOil / 2; }
    assert.ok(Sim.pocketDrive(pk) > before + 0.1, 'injection raises drive');
    assert.ok(pk.waterCut > 0, 'and waters the field');
    assert.ok(w.players.player.money < money - 40, 'and costs money');
});

t('linked pockets: oil flows to the drained one', () => {
    const w = plainWorld(27);
    const [a, b] = w.oilPockets;
    w.links = [[a.id, b.id]];
    a.oil = a.maxOil * 0.2;
    b.oil = b.maxOil;
    const total = a.oil + b.oil;
    for (let i = 0; i < 600; i++) Sim.step(w, 16);
    assert.ok(a.oil > a.maxOil * 0.2, 'drained pocket refills');
    assert.ok(Math.abs(a.oil + b.oil - total) < 1e-6, 'oil is conserved');
});

t('strata and hazards are generated from the seed', () => {
    const w = Sim.createWorld({ seed: 31 });
    assert.ok(w.strata.layers.length >= 5);
    assert.ok(w.hazards.some(h => h.kind === 'gas') && w.hazards.some(h => h.kind === 'water'));
    assert.ok(Sim.ROCKS[Sim.rockAt(w, 800, C.GROUND_LEVEL + 50)]);
    assert.deepStrictEqual(Sim.createWorld({ seed: 31 }).hazards, w.hazards);
});

t('claims: 7-9 irregular widths fill the span, terrain changes price and costs', () => {
    const w = Sim.createWorld({ seed: 51 });
    assert.ok(w.plots.length >= 7 && w.plots.length <= 9, 'count ' + w.plots.length);
    const span = w.plots.reduce((s, p) => s + p.width, 0);
    assert.ok(Math.abs(span - C.CLAIM_SPAN) < 0.01, 'claims fill the span');
    assert.ok(w.plots.every((p, i) => i === 0 || Math.abs(p.x - (w.plots[i - 1].x + w.plots[i - 1].width)) < 0.01), 'contiguous');
    assert.ok(Math.max(...w.plots.map(p => p.width)) > Math.min(...w.plots.map(p => p.width)) * 1.3, 'widths differ');
    assert.ok(w.plots.every(p => Sim.TERRAIN[p.terrain]));
    // Kopec: vrt a silo stojí 1,5×
    const hill = w.plots[2];
    hill.terrain = 'hill';
    w.players.player.money = 10000;
    Sim.act(w, 'player', { type: 'buyPlot', plotId: hill.id });
    const before = w.players.player.money;
    Sim.act(w, 'player', { type: 'buildDerrick', plotId: hill.id });
    assert.strictEqual(before - w.players.player.money, Math.round(C.VRT_COST * 1.5));
    // Skála: žula pod povrchem jen v tom claimu
    const rock = w.plots[4];
    rock.terrain = 'rock';
    rock.rockDepth = 80;
    const cx = rock.x + rock.width / 2;
    assert.strictEqual(Sim.rockAt(w, cx, C.GROUND_LEVEL + 40), 'granite');
    assert.notStrictEqual(Sim.rockAt(w, cx, C.GROUND_LEVEL + 200), 'granite');
    const flatPlot = w.plots.find(p => p.terrain !== 'rock');
    assert.notStrictEqual(Sim.rockAt(w, flatPlot.x + flatPlot.width / 2, C.GROUND_LEVEL + 40), 'granite');
});

t('claims: river makes injection cheap', () => {
    const w = plainWorld(52);
    const pk = w.oilPockets[0];
    w.oilPockets = [pk];
    const x = pocketCenter(pk).x;
    w.plots[3].x = x - w.plots[3].width / 2;
    assert.ok(drillTo(w, 'player', 3, pocketCenter(pk)).struck);
    const costOn = terrain => {
        w.plots[3].terrain = terrain;
        const n = Sim.getNetworkForPlot(w, 3);
        n.injecting = true;
        n.isPumping = false;
        const money = w.players.player.money;
        Sim.step(w, 1000);
        n.injecting = false;
        return money - w.players.player.money;
    };
    const flat = costOn('flat');
    const river = costOn('river');
    assert.ok(Math.abs(river - flat * Sim.TERRAIN.river.injectMult) < 0.01, `river ${river} vs flat ${flat}`);
});

console.log(out.join('\n'));
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
