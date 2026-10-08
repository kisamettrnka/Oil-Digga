// Balanční simulace: boti hrají celé hry, měří se ekonomika, kupci, éry, zakázky.
// npm run balance [solo|small|big|nocontracts|allcontracts|links|race3|race1|shared2|shared4|all]
const Sim = require('../sim');
const C = Sim.C;
const DT = 50;

// Bot: rozšiřuje se, když má rezervu; vrtá k nejbližšímu ložisku (zná mapu, ale platí seismiku);
// obsluhuje kopance, korunky, ventil; zakázky bere podle strategie.
function makeBot(w, pid, opts) {
    // links: ropovody a vlečky jsou pohodlí (bez vozů a stávek), ne zisk navíc; výchozí bot je nestaví
    const o = Object.assign({ maxWells: 6, reserve: 900, contracts: 'smart', trucksPerWell: 1.5, inject: false, silos: 1, links: false }, opts);
    const st = { wells: [], contractsTaken: 0 };
    function myPlots() { return w.plots.filter(p => p.owner === pid); }
    function expand() {
        const p = w.players[pid];
        if (p.over || st.wells.length >= o.maxWells || st.pending) return;
        // nejlevnější volný pozemek, nad kterým (do 250 px) je netěžené ložisko
        const cands = w.plots.filter(pl => !pl.owner).map(pl => {
            const cx = pl.x + pl.width / 2;
            const pk = w.oilPockets.filter(k => k.oil > 1500).sort((a, b) =>
                Math.hypot(a.x + a.width / 2 - cx, a.y - C.GROUND_LEVEL) - Math.hypot(b.x + b.width / 2 - cx, b.y - C.GROUND_LEVEL))[0];
            return { pl, pk, d: pk ? Math.abs(pk.x + pk.width / 2 - cx) : 1e9 };
        }).filter(c => c.pk && c.d < 260).sort((a, b) => (a.pl.price + a.d * 3) - (b.pl.price + b.d * 3));
        const c = cands[0];
        if (!c) return;
        const drillEstimate = (c.pk.y - C.GROUND_LEVEL + c.d) * C.DRILL_COST_PER_PX * 1.3 + C.BIT_COST;
        const cost = c.pl.price + C.VRT_COST + C.SEISMIC_COST + drillEstimate + C.SILO_COST * o.silos + C.TRUCK_COST * o.trucksPerWell;
        if (p.money < cost + o.reserve) return;
        Sim.act(w, pid, { type: 'buyPlot', plotId: c.pl.id });
        // Sdílená mapa: koupě je dražba, stavět jde až po vítězství (viz develop)
        if (w.shared) { st.pending = { plot: c.pl, pk: c.pk }; return; }
        develop(c.pl, c.pk);
    }
    function develop(pl, pk) {
        const p = w.players[pid];
        p.money -= C.SEISMIC_COST; // průzkum
        Sim.act(w, pid, { type: 'buildDerrick', plotId: pl.id });
        const c = { pl, pk };
        for (let i = 0; i < o.silos; i++) Sim.act(w, pid, { type: 'buildSilo', plotId: c.pl.id });
        const cx = c.pl.x + c.pl.width / 2;
        const tx = c.pk.x + c.pk.width / 2, ty = c.pk.y + c.pk.height / 2;
        // nejdřív svisle, pak šikmo (vrták neumí stoupat)
        Sim.act(w, pid, { type: 'drill', plotId: c.pl.id, x: cx + (tx - cx) * 0.3, y: C.GROUND_LEVEL + (ty - C.GROUND_LEVEL) * 0.5 });
        Sim.act(w, pid, { type: 'drill', plotId: c.pl.id, x: tx, y: ty });
        st.wells.push(c.pl.id);
    }
    function service() {
        const p = w.players[pid];
        if (p.over) return;
        if (st.pending) { // dražba: vyhráli jsme, nebo nás přehodili
            const { plot, pk } = st.pending;
            const auction = w.auctions.find(a => a.plotId === plot.id);
            if (plot.owner === pid) { st.pending = null; develop(plot, pk); }
            else if (auction && auction.bidder !== pid && p.money > auction.amount + C.AUCTION_MIN_RAISE + o.reserve && auction.amount < plot.price * 2) {
                Sim.act(w, pid, { type: 'bid', plotId: plot.id, amount: auction.amount + C.AUCTION_MIN_RAISE });
            } else if (!auction || plot.owner) st.pending = null;
        }
        w.pipeNetworks.forEach(n => {
            if (n.owner !== pid) return;
            if (n.drillState === 'kick') Sim.act(w, pid, { type: 'bop', plotId: n.derrickId });
            if (n.drillState === 'worn' && !(n.blowout > 0)) Sim.act(w, pid, { type: 'bit', plotId: n.derrickId });
            if (n.drillState === 'idle' && n.pocket < 0) { // minul ložisko: vrtat dolů
                const last = n.path[n.path.length - 1];
                if (last.y < C.WORLD_H - 140) Sim.act(w, pid, { type: 'drill', plotId: n.derrickId, x: last.x, y: last.y + 60 });
            }
            if (Sim.canVentRig(n)) Sim.act(w, pid, { type: 'vent', plotId: n.derrickId });
            if (n.waterCut > 0.3 && p.money > 2000) Sim.act(w, pid, { type: 'cement', plotId: n.derrickId });
        });
        // Odbyt: vlečka od Železnice, jinak ropovod k nejlépe platícímu kupci (když je na to)
        if (o.links) {
            w.pipeNetworks.filter(n => n.owner === pid && n.pocket >= 0 && !n.link).forEach(n => {
                const plot = w.plots[n.derrickId];
                const era = w.town.era;
                const cushion = o.reserve + 1500; // odbyt je luxus: až když je z čeho
                // vlečka až když vozy nestačí (plná flotila), ropovod k nejlépe platícímu kupci,
                // který denně spotřebuje aspoň to, co ropovod přivede
                if (era >= C.SIDING_ERA && p.trucksOwned >= C.MAX_TRUCKS && p.money > C.SIDING_COST + cushion) Sim.act(w, pid, { type: 'siding', plotId: plot.id });
                else if (era >= C.PIPELINE_ERA) {
                    const perDay = C.PIPELINE_RATE * C.MS_PER_DAY / 1000;
                    // jen tam, kde ropovod vydělá víc než vozy: kupec platí nad základ a nezaplaví se
                    const best = w.market.order.map(id => w.market[id]).filter(b => b.open && b.id !== 'right' && b.demand >= perDay && b.quote > b.base * 1.1).sort((a, b) => b.quote - a.quote)[0];
                    if (best && p.money > Sim.linkCost(w, plot, 'pipeline', best.id) + cushion) Sim.act(w, pid, { type: 'pipeline', plotId: plot.id, buyer: best.id });
                }
            });
        }
        const pumping = w.pipeNetworks.filter(n => n.owner === pid && n.pocket >= 0).length;
        const want = Math.min(C.MAX_TRUCKS, Math.ceil(Math.max(1, pumping) * o.trucksPerWell));
        if (p.trucksOwned < want && p.money > C.TRUCK_COST + o.reserve / 2) Sim.act(w, pid, { type: 'buyTruck' });
        // vtláčení: druhý vrt na stejném ložisku vtláčí, když tlak klesne pod 45 %
        if (o.inject) {
            const byPocket = {};
            w.pipeNetworks.filter(n => n.owner === pid && n.pocket >= 0).forEach(n => (byPocket[n.pocket] = byPocket[n.pocket] || []).push(n));
            Object.values(byPocket).forEach(list => {
                if (list.length < 2) return;
                const pk = w.oilPockets[list[0].pocket];
                const inj = list.find(n => n.injecting);
                if (!inj && Sim.pocketDrive(pk) < 0.45 && p.money > 1500) Sim.act(w, pid, { type: 'inject', plotId: list[list.length - 1].derrickId });
            });
        }
    }
    function contracts() {
        const p = w.players[pid];
        if (p.over || o.contracts === 'none') return;
        w.contracts.offers.forEach(of => {
            if (o.contracts === 'all') { if (Sim.act(w, pid, { type: 'acceptContract', id: of.id }).ok) st.contractsTaken++; return; }
            // smart: vlastní denní těžba × dny × 0,6 musí pokrýt zakázku (mínus už běžící)
            // jen těžba, která může k tomu kupci dojet: vrty bez odbytu nebo s odbytem právě k němu
            const rate = w.pipeNetworks.filter(n => n.owner === pid).reduce((s, n) => s + Math.max(0, Sim.wellRate(w, n) - (n.link && n.link.buyer !== of.buyer ? n.link.rate : 0)), 0) * C.MS_PER_DAY / 1000;
            const busy = w.contracts.active.filter(a => a.owner === pid).reduce((s, a) => s + a.amount - a.delivered, 0);
            if (rate * of.days * 0.6 - busy >= of.amount && Sim.act(w, pid, { type: 'acceptContract', id: of.id }).ok) st.contractsTaken++;
        });
    }
    return { st, tick() { expand(); service(); contracts(); } };
}

function play({ seed, days = 365, race = null, players = 1, shared = false, bot = {} }) {
    const ps = Array.from({ length: players }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const w = Sim.createWorld({ seed, race, shared, players: ps });
    w.time.started = true;
    const bots = ps.map(p => makeBot(w, p.id, bot));
    const stats = { sales: {}, revenue: {}, eraDays: [], contractsDone: 0, contractsFailed: 0, penalty: 0, blowouts: 0, kicks: 0, bankruptDay: {}, moneyAt: {} };
    let lastEra = 0;
    const steps = days * C.MS_PER_DAY / DT;
    for (let i = 0; i < steps && !w.over; i++) {
        if (i % 20 === 0) bots.forEach(b => b.tick());
        Sim.step(w, DT);
        w.events.splice(0).forEach(e => {
            if (e.type === 'sale') { stats.sales[e.company] = (stats.sales[e.company] || 0) + 1; stats.revenue[e.company] = (stats.revenue[e.company] || 0) + e.amount; }
            if (e.type === 'contract_done') stats.contractsDone++;
            if (e.type === 'contract_failed') { stats.contractsFailed++; stats.penalty += e.penalty; }
            if (e.type === 'blowout') stats.blowouts++;
            if (e.type === 'kick') stats.kicks++;
            if (e.type === 'water') stats.water = (stats.water || 0) + 1;
            if (e.type === 'strike') stats.strikes = (stats.strikes || 0) + 1;
            if (e.type === 'player_over' && e.reason === 'bankrupt') stats.bankruptDay[e.playerId] = w.time.dayIndex;
        });
        if (w.town.era !== lastEra) { lastEra = w.town.era; stats.eraDays.push(w.time.dayIndex); }
        const d = w.time.dayIndex;
        if ([30, 90, 180].includes(d) && !stats.moneyAt[d]) stats.moneyAt[d] = Math.round(ps.reduce((s, p) => s + w.players[p.id].money, 0) / players);
    }
    const sold = ps.reduce((s, p) => s + w.players[p.id].sold, 0);
    const rev = ps.reduce((s, p) => s + w.players[p.id].revenue, 0);
    return {
        w, stats, bots,
        money: ps.map(p => Math.round(w.players[p.id].money)),
        perBbl: sold ? rev / sold : 0, sold,
        wells: bots.map(b => b.st.wells.length)
    };
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '-';
const SEEDS = Array.from({ length: 16 }, (_, i) => 100 + i * 7);

function report(name, cfg) {
    const res = SEEDS.map(seed => play({ seed, ...cfg }));
    const money = res.flatMap(r => r.money);
    const sales = {}; const revenue = {};
    res.forEach(r => { Object.entries(r.stats.sales).forEach(([k, v]) => sales[k] = (sales[k] || 0) + v); Object.entries(r.stats.revenue).forEach(([k, v]) => revenue[k] = (revenue[k] || 0) + v); });
    const totalRev = Object.values(revenue).reduce((a, b) => a + b, 0);
    const eras = [0, 1, 2].map(k => { const ds = res.map(r => r.stats.eraDays[k]).filter(x => x != null); return ds.length ? `${median(ds)}d(${ds.length}/${res.length})` : '—'; });
    const bankrupt = res.reduce((s, r) => s + Object.keys(r.stats.bankruptDay).length, 0);
    const cd = res.reduce((s, r) => s + r.stats.contractsDone, 0), cf = res.reduce((s, r) => s + r.stats.contractsFailed, 0);
    const at = d => median(res.map(r => r.stats.moneyAt[d]).filter(x => x != null));
    console.log(`\n== ${name}`);
    console.log(`  money end median ${median(money)} min ${Math.min(...money)} max ${Math.max(...money)} | d30 ${at(30)} d90 ${at(90)} d180 ${at(180)} | bankrupt ${bankrupt}/${money.length}`);
    console.log(`  $/bbl median ${median(res.map(r => r.perBbl)).toFixed(2)} | sold median ${Math.round(median(res.map(r => r.sold)))} | wells median ${median(res.flatMap(r => r.wells))}`);
    console.log(`  revenue share ${Object.entries(revenue).map(([k, v]) => `${k} ${pct(v, totalRev)}`).join(', ')}`);
    console.log(`  eras boom/rail/auto ${eras.join(' ')} | contracts done ${cd} failed ${cf} | strikes ${res.reduce((s, r) => s + (r.stats.strikes || 0), 0)} kicks ${res.reduce((s, r) => s + r.stats.kicks, 0)} water ${res.reduce((s, r) => s + (r.stats.water || 0), 0)} blowouts ${res.reduce((s, r) => s + r.stats.blowouts, 0)}`);
    return res;
}

if (require.main !== module) return module.exports = { play, report };
const which = process.argv[2] || 'all';
const scen = {
    solo: () => report('solo rok, bot roste do 6 vrtů', {}),
    small: () => report('solo rok, malý těžař (max 2 vrty)', { bot: { maxWells: 2 } }),
    big: () => report('solo rok, velký (max 8 vrtů, malá rezerva)', { bot: { maxWells: 8, reserve: 300 } }),
    nocontracts: () => report('solo rok bez zakázek', { bot: { contracts: 'none' } }),
    links: () => report('solo rok, bot staví ropovody a vlečky', { bot: { links: true } }),
    allcontracts: () => report('solo rok, bere všechny zakázky', { bot: { contracts: 'all' } }),
    race3: () => report('závod 3 měsíce (race pravidla)', { days: 93, race: { months: 3, mode: 'richest' }, bot: { reserve: 150, silos: 0, trucksPerWell: 1 } }),
    race1: () => report('závod 1 měsíc', { days: 31, race: { months: 1, mode: 'richest' }, bot: { reserve: 150, silos: 0, trucksPerWell: 1 } }),
    shared2: () => report('sdílená 2 hráči, 6 měsíců', { days: 181, players: 2, shared: true, race: { months: 6, mode: 'richest' }, bot: { reserve: 150, silos: 0, trucksPerWell: 1 } }),
    shared4: () => report('sdílená 4 hráči, 6 měsíců', { days: 181, players: 4, shared: true, race: { months: 6, mode: 'richest' }, bot: { reserve: 150, silos: 0, trucksPerWell: 1 } })
};
if (which === 'all') Object.values(scen).forEach(f => f()); else scen[which]();
