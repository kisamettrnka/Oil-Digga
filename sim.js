// --- Herní logika Oil digga (bez kreslení) ---
// Jeden objekt světa (world) se všemi hráči: pozemky, ložiska, potrubí, kamiony, trh, čas.
// Běží v prohlížeči (window.OilSim; sólo a závod si svět počítají samy) i na serveru
// (require('./sim'); sdílená mapa: server počítá svět a posílá ho hráčům).
// Změny stavu jdou jen přes act(world, playerId, action); step(world, dt) posouvá čas.
// Co se stalo (prodej, navrtání, erupce...), se zapisuje do world.events pro zvuky a oznámení.
(function (root, factory) {
    const sim = factory();
    if (typeof module === 'object' && module.exports) module.exports = sim;
    else root.OilSim = sim;
})(typeof self !== 'undefined' ? self : globalThis, function () {
    'use strict';

    const C = {
        WORLD_W: 1600,
        WORLD_H: 900,
        GROUND_RATIO: 0.44,          // povrch (přední hrana desky) ve 44 % výšky světa
        POCKET_BOTTOM_MARGIN: 125,   // spodní pás zakrývá panel nástrojů, ložiska jsou nad ním
        PLOT_COUNT: 8,
        SIDE_MARGIN: 110,            // šířka budovy výkupce + mezera
        VRT_COST: 350,
        SILO_COST: 250,
        TRUCK_COST: 150,
        // Vrtání: vrták jede po trase reálným časem, platí se za vyvrtaný pixel podle horniny
        DRILL_SPEED: 46,             // px/s v pískovci
        DRILL_COST_PER_PX: 1.5,
        DRILL_MAX_RISE: 0.36,        // trasa smí stoupat nejvýš ~20° (dy/dx)
        BIT_WEAR_PER_PX: 0.0024,     // opotřebení korunky za pixel × tvrdost horniny
        BIT_COST: 120,
        BIT_SWAP_MS: 3500,           // vytažení soutyčí a nasazení nové korunky
        KICK_MS: 5000,               // plynový kopanec: tolik času na zavření preventeru
        KICK_SHUT_MS: 2600,          // zavřený preventer: plyn hoří na fléře, vrták stojí
        WATER_CUT_HIT: 0.35,         // navrtaná zvodnělá vrstva přidá tolik vody do těžby
        MAX_WATER_CUT: 0.85,
        CEMENT_COST: 180,
        TRUCK_SPEED: 150,
        TRUCK_CAPACITY: 100,
        TRUCK_LENGTH: 76,
        TRUCK_GAP_PAD: 6,            // minimální mezera mezi auty jedoucími za sebou
        PRICE_UPDATE_INTERVAL: 5000,
        PRICE_HISTORY_LEN: 24,
        SILO_CAPACITY_BONUS: 500,
        DERRICK_BASE_CAPACITY: 50,
        // Živé ložisko: průtok = OIL_PER_SECOND × tlak ložiska × (1 − podíl vody)
        OIL_PER_SECOND: 10,
        MIN_DRIVE: 0.12,             // i vyčerpané ložisko trochu teče
        DECLINE_EXP: 1.3,            // tlak = počáteční tlak × naplnění^DECLINE_EXP
        INJECT_COST_PER_S: 5,        // vtláčení vody: $/s
        INJECT_BOOST_PER_S: 0.018,   // o kolik vtláčení zvedá tlak ložiska za sekundu
        INJECT_BOOST_MAX: 0.5,
        BOOST_DECAY_PER_S: 0.004,    // bez vtláčení tlak zase opadá
        INJECT_WATER_PER_S: 0.002,   // vtláčení pomalu zavodňuje celé ložisko
        MIGRATE_RATE: 0.001,         // propojená ložiska: tok podle rozdílu naplnění
        LINK_MAX_DIST: 300,
        MAX_SILOS_PER_PLOT: 4,
        MIN_LOAD_AMOUNT: 25,
        MAX_TRUCKS: 8,
        MS_PER_DAY: 10000,           // kolik ms herního času trvá den
        DAYS_IN_MONTH: [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        SURVIVAL_TAX_STEP: 15,       // režim přežití: daň za pozemek roste každý měsíc o tolik
        // Přetlak: plný zásobník čerpajícího vrtu zvedá tlak, při 100 % erupce
        PRESSURE_RELIEF_MS: 5000,
        VENT_MIN: 0.3,
        PRESSURE_WARN: 0.6,
        PRESSURE_AFTER_BLOWOUT: 0.35,
        VENT_MS: 1600,
        BLOWOUT_MS: 4500,
        BLOWOUT_WASTE_PER_SECOND: 40,
        BLOWOUT_SPILL_PER_MS: 0.65 / 4500, // jedna erupce udělá zhruba dvoutřetinovou kaluž
        SPILL_FADE_MS: 40000,
        // Průzkum: seismika, dron, georadar
        SEISMIC_COST: 150,
        DRONE_COST: 450,
        RADAR_COST: 250,
        SEISMIC_RADIUS: 340,
        SEISMIC_WAVE_MS: 1600,
        RADAR_RADIUS: 120,
        RADAR_PULSE_MS: 900,
        DRONE_SPEED: 230,
        DRONE_BEAM_HALF: 55,
        ECHO_MS: 8000,
        RICH_MEDIUM_OIL: 8500,
        RICH_LARGE_OIL: 11500,
        // Sdílená mapa: každá dodávka trochu sráží výkupní cenu (hráči si konkurují)
        SHARED_SALE_PRICE_DROP: 0.02,
        MAX_SHARED_PLAYERS: 4
    };
    C.GROUND_LEVEL = Math.floor(C.WORLD_H * C.GROUND_RATIO);
    C.PLOT_WIDTH = (C.WORLD_W - 2 * C.SIDE_MARGIN) / C.PLOT_COUNT;

    // Pravidla: v závodě a na sdílené mapě tvrdší, sólo zůstává přívětivé
    const RULES = {
        solo: { startMoney: 3000, landTax: 15, pressureBuildMs: 20000, blowoutFine: 250 },
        race: { startMoney: 2000, landTax: 25, pressureBuildMs: 12000, blowoutFine: 400 }
    };

    const PLAYER_COLORS = ['#ffb45a', '#6ec6ff', '#7ee08a', '#ff7aa8'];

    // Horniny: speed = násobek rychlosti vrtání, wear = opotřebení korunky, cost = násobek ceny za pixel
    const ROCKS = {
        clay: { name: 'Jíl', speed: 0.75, wear: 0.1, cost: 0.9 },
        sand: { name: 'Pískovec', speed: 1, wear: 0.25, cost: 1 },
        shale: { name: 'Břidlice', speed: 0.6, wear: 0.5, cost: 1.2 },
        lime: { name: 'Vápenec', speed: 0.42, wear: 0.8, cost: 1.4 },
        granite: { name: 'Žula', speed: 0.2, wear: 2.2, cost: 2 }
    };
    const SHALLOW_ROCKS = ['sand', 'clay', 'sand', 'shale'];
    const DEEP_ROCKS = ['shale', 'lime', 'granite', 'lime', 'sand'];

    // --- Mimořádné zprávy ---
    // Události ze světa na pár dní mění trh (násobí výkupní cenu, zavírají výkupce) nebo pravidla.
    // left = Rafinerie, right = Nádraží. Spouští se při přechodu dne; náhoda je odvozená ze seedu
    // a pořadí dne, takže v závodě mají všichni stejné zprávy ve stejný den.
    const NEWS = [
        { key: 'tariffs', title: 'Trump uvalil cla na dovoz ropy', desc: 'Domácí ropa je žádanější: rafinerie přidává, export vázne.', days: 6, effects: { left: 1.35, right: 0.9 } },
        { key: 'hormuz', title: 'Írán uzavřel Hormuzský průliv', desc: 'Svět se bojí nedostatku ropy, ceny letí vzhůru.', days: 5, effects: { left: 1.6, right: 1.6 } },
        { key: 'opec_cut', title: 'OPEC+ škrtá těžbu', desc: 'Méně ropy na trhu, oba výkupci přidávají.', days: 8, effects: { left: 1.25, right: 1.25 } },
        { key: 'opec_flood', title: 'OPEC zaplavil trh levnou ropou', desc: 'Cenová válka: výkupci srážejí ceny.', days: 7, effects: { left: 0.7, right: 0.7 } },
        { key: 'rail_strike', title: 'Stávka železničářů', desc: 'Nádraží nevykupuje, kamiony jezdí do rafinerie.', days: 3, effects: { rightClosed: true } },
        { key: 'refinery_fire', title: 'Požár v rafinerii Černé zlato', desc: 'Rafinerie stojí, výkup jen na nádraží.', days: 3, effects: { leftClosed: true, right: 1.15 } },
        { key: 'sanctions', title: 'Sankce na ruskou ropu', desc: 'Evropa shání ropu jinde: export přes nádraží vynáší.', days: 6, effects: { right: 1.4 } },
        { key: 'recession', title: 'Recese: lidé méně jezdí autem', desc: 'Poptávka padá u obou výkupců.', days: 10, effects: { left: 0.8, right: 0.8 } },
        { key: 'hurricane', title: 'Hurikán zavřel plošiny v Mexickém zálivu', desc: 'Konkurence stojí, ropa z pouště je zlatá.', days: 4, effects: { left: 1.3, right: 1.3 } },
        { key: 'eco_law', title: 'Nový ekologický zákon', desc: 'Pokuty za erupce se zdvojnásobují.', days: 10, effects: { fineMult: 2 } },
        { key: 'tax_break', title: 'Daňové prázdniny pro těžaře', desc: 'Stát odpustil daň z pozemků.', days: 5, effects: { taxMult: 0 } },
        { key: 'driver_shortage', title: 'Řidiči odešli na zlatou horečku', desc: 'Chybí šoféři, kamiony jezdí pomaleji.', days: 5, effects: { truckSpeed: 0.7 } }
    ];
    const NEWS_FIRST_DAY = 5;            // první zpráva kolem pátého dne
    const NEWS_GAP_MIN = 6;              // pak každých 6–11 dní
    const NEWS_GAP_RANGE = 6;
    const MAX_ACTIVE_NEWS = 2;

    function seededRandom(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // --- Vytvoření světa ---
    // players: [{ id, name }]; race: { months, mode, target } nebo null (sólo)
    function createWorld({ seed = null, players = [{ id: 'player', name: 'Ty' }], race = null, shared = false } = {}) {
        const rand = seed == null ? Math.random : seededRandom(seed);
        const rules = race ? RULES.race : RULES.solo;
        const world = {
            seed, race, shared,
            rulesName: race ? 'race' : 'solo',
            plots: [],
            oilPockets: [],
            links: [],      // propojená ložiska [idA, idB]: ropa mezi nimi pomalu teče
            strata: null,   // vrstvy hornin
            hazards: [],    // plynové kapsy a zvodnělé vrstvy (skryté)
            pipeNetworks: [],
            trucks: [],
            players: {},
            playerOrder: [],
            market: {
                // price = základní cena (náhodná procházka), quote = cena po vlivu zpráv, closed = nevykupuje
                left: { price: 1, quote: 1, mult: 1, closed: false, trend: 0, history: [1] },
                right: { price: 1, quote: 1, mult: 1, closed: false, trend: 0, history: [1] },
                timer: 0
            },
            time: { day: 1, month: 1, dayTimer: 0, started: false, dayIndex: 0 },
            news: { active: [], nextInDays: NEWS_FIRST_DAY },
            tools: { clock: 0, waves: [], pulses: [], drones: [] },
            nextNetworkId: 0,
            nextTruckId: 0,
            over: false,
            events: []
        };
        players.forEach((p, i) => {
            world.players[p.id] = {
                id: p.id,
                name: p.name || 'Hráč',
                color: PLAYER_COLORS[i % PLAYER_COLORS.length],
                money: rules.startMoney,
                revenue: 0,
                sold: 0,
                trucksOwned: 0,
                assigned: { left: 0, right: 0 },
                revenueAtDayStart: 0,
                lastDayIncome: 0,
                over: false,
                reason: null
            };
            world.playerOrder.push(p.id);
        });

        for (let i = 0; i < C.PLOT_COUNT; i++) {
            world.plots.push({
                id: i,
                x: C.SIDE_MARGIN + i * C.PLOT_WIDTH,
                y: C.GROUND_LEVEL,
                owner: null,
                hasVrt: false,
                siloCount: 0,
                spill: 0,
                price: 50 + Math.floor(rand() * 451) // 50 až 500
            });
        }

        const numberOfPockets = 5 + Math.floor(rand() * 5);
        for (let i = 0; i < numberOfPockets; i++) {
            const pocketWidth = 80 + rand() * 170;
            const x = rand() * (C.WORLD_W - pocketWidth);
            const height = 40 + rand() * 80;
            // Celé ložisko musí být nad spodním panelem HUD, jinak by na něj nešlo kliknout
            const minY = C.GROUND_LEVEL + 80;
            const maxY = C.WORLD_H - C.POCKET_BOTTOM_MARGIN - height;
            const y = minY + rand() * Math.max(0, maxY - minY);
            // Hloubka = riziko i odměna: hlubší ložiska jsou bohatší a mají vyšší tlak
            const depth = maxY > minY ? (y - minY) / (maxY - minY) : 0.5;
            const richness = (4000 + rand() * 7000) * (0.75 + 0.8 * depth);
            const drive0 = 0.55 + 0.45 * depth + (rand() - 0.5) * 0.1;
            const vertices = [];
            const numberOfVertices = 3 + Math.floor(rand() * 4);
            for (let j = 0; j < numberOfVertices; j++) {
                const angle = (j / numberOfVertices) * Math.PI * 2;
                vertices.push({
                    x: x + pocketWidth / 2 + Math.cos(angle) * (pocketWidth / 2),
                    y: y + height / 2 + Math.sin(angle) * (height / 2)
                });
            }
            world.oilPockets.push({
                id: i, x, y, width: pocketWidth, height, vertices,
                oil: richness,
                maxOil: richness,
                drive0,         // počáteční tlak ložiska
                boost: 0,       // tlak navíc z vtláčení vody
                waterCut: 0,    // zavodnění ložiska vtláčením
                tappedBy: [],   // hráči, jejichž vrt z ložiska čerpá (na sdílené mapě víc najednou)
                revealedBy: [], // komu ho odhalil georadar (vrtatelné dál)
                echo: {}        // playerId -> do kdy je vidět ozvěna (tools.clock)
            });
        }
        world.links = createLinks(world.oilPockets, rand);
        world.strata = createStrata(rand);
        world.hazards = createHazards(world.oilPockets, rand);

        // Náhoda trhu se nesdílí přes síť (funkce se do JSON nezapíše); klient na sdílené mapě trh nepočítá
        world._market = seed == null ? Math.random : seededRandom((seed ^ 0x9E3779B9) >>> 0);
        return world;
    }

    // Propojená pole: sousední ložiska spojí propustná vrstva (každé nejvýš jedno spojení)
    function createLinks(pockets, rand) {
        const links = [];
        const linked = new Set();
        const center = p => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 });
        pockets.forEach(a => {
            if (linked.has(a.id)) return;
            let best = null, bestDist = C.LINK_MAX_DIST;
            pockets.forEach(b => {
                if (b === a || linked.has(b.id)) return;
                const d = Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);
                if (d < bestDist) { best = b; bestDist = d; }
            });
            if (best && rand() < 0.65) {
                links.push([a.id, best.id]);
                linked.add(a.id);
                linked.add(best.id);
            }
        });
        return links;
    }

    // Vrstvy hornin: zvlněné hranice (bounds) shora dolů, layers[i] leží nad bounds[i].
    // Mělko spíš měkké horniny, hloubka spíš tvrdé; dvě stejné vrstvy pod sebou nejdou.
    function createStrata(rand) {
        const top = C.GROUND_LEVEL + 40;
        const bottom = C.WORLD_H;
        const count = 4 + Math.floor(rand() * 2);
        const spacing = (bottom - top) / (count + 1);
        const bounds = [];
        for (let i = 0; i < count; i++) {
            bounds.push({
                y: top + spacing * (i + 1) + (rand() - 0.5) * spacing * 0.3,
                amp: 6 + rand() * 14,
                freq: 0.003 + rand() * 0.006,
                phase: rand() * Math.PI * 2
            });
        }
        const layers = [];
        for (let i = 0; i <= count; i++) {
            const pool = i < (count + 1) / 2 ? SHALLOW_ROCKS : DEEP_ROCKS;
            let kind = pool[Math.floor(rand() * pool.length)];
            if (layers.length && layers[layers.length - 1] === kind) kind = pool[(pool.indexOf(kind) + 1) % pool.length];
            layers.push(kind);
        }
        return { bounds, layers };
    }

    // Plynové kapsy (hlouběji častější) a zvodnělé vrstvy; nesmí ležet v ložisku
    function createHazards(pockets, rand) {
        const hazards = [];
        const minY = C.GROUND_LEVEL + 70;
        const maxY = C.WORLD_H - C.POCKET_BOTTOM_MARGIN;
        const place = (kind, r, yFrom) => {
            for (let tries = 0; tries < 12; tries++) {
                const x = 40 + rand() * (C.WORLD_W - 80);
                const y = yFrom + rand() * (maxY - yFrom);
                if (pockets.some(p => distanceToPocket(x, y, p) < r + 12)) continue;
                if (hazards.some(h => Math.hypot(h.x - x, h.y - y) < h.r + r + 20)) continue;
                hazards.push({ id: hazards.length, kind, x, y, r, hit: false, revealedBy: [] });
                return;
            }
        };
        const gas = 3 + Math.floor(rand() * 3);
        for (let i = 0; i < gas; i++) place('gas', 16 + rand() * 14, minY + (maxY - minY) * 0.35);
        const water = 2 + Math.floor(rand() * 3);
        for (let i = 0; i < water; i++) place('water', 22 + rand() * 16, minY);
        return hazards;
    }

    // --- Pomocné dotazy ---
    function getRules(world) {
        return RULES[world.rulesName] || RULES.solo;
    }

    function getLandTax(world) {
        const base = getRules(world).landTax;
        const tax = world.race && world.race.mode === 'survival'
            ? base + C.SURVIVAL_TAX_STEP * (world.time.month - 1) : base;
        return Math.round(tax * newsEffect(world, 'taxMult'));
    }

    // Součin násobitelů daného efektu ze všech běžících zpráv (1 = beze změny)
    function newsEffect(world, name) {
        return (world.news?.active || []).reduce((mult, n) => mult * (n.effects[name] ?? 1), 1);
    }

    function newsFlag(world, name) {
        return (world.news?.active || []).some(n => n.effects[name]);
    }

    // Přepočte výkupní ceny po vlivu zpráv (price -> quote) a zavřené výkupce
    function updateQuotes(world) {
        const m = world.market;
        ['left', 'right'].forEach(side => {
            m[side].mult = newsEffect(world, side);
            m[side].closed = newsFlag(world, side + 'Closed');
            m[side].quote = Math.max(0.1, Math.min(5, m[side].price * m[side].mult));
        });
    }

    function getBlowoutFine(world) {
        return Math.round(getRules(world).blowoutFine * newsEffect(world, 'fineMult'));
    }

    // Náhoda pro zprávy podle seedu a pořadí dne (nezávisí na délce snímků klienta)
    function dayRandom(world) {
        if (world.seed == null) return Math.random;
        return seededRandom((world.seed ^ Math.imul(world.time.dayIndex + 1, 0x9E3779B1)) >>> 0);
    }

    function stepNews(world) {
        const news = world.news;
        news.active.forEach(n => { n.daysLeft--; });
        news.active.filter(n => n.daysLeft <= 0).forEach(n => emit(world, { type: 'news_end', key: n.key, title: n.title }));
        news.active = news.active.filter(n => n.daysLeft > 0);
        news.nextInDays--;
        if (news.nextInDays <= 0 && news.active.length < MAX_ACTIVE_NEWS) {
            const rand = dayRandom(world);
            const pool = NEWS.filter(n => !news.active.some(a => a.key === n.key) && n.key !== news.lastKey);
            const pick = pool[Math.floor(rand() * pool.length)];
            news.active.push({ key: pick.key, title: pick.title, desc: pick.desc, days: pick.days, daysLeft: pick.days, effects: pick.effects });
            news.lastKey = pick.key;
            news.nextInDays = NEWS_GAP_MIN + Math.floor(rand() * NEWS_GAP_RANGE);
            emit(world, { type: 'news', key: pick.key, title: pick.title, desc: pick.desc, days: pick.days, effects: pick.effects });
        }
        updateQuotes(world);
    }

    function getPlot(world, id) {
        return world.plots.find(p => p.id === id) || null;
    }

    function getNetworkForPlot(world, plotId) {
        return world.pipeNetworks.find(n => n.derrickId === plotId) || null;
    }

    function getNetworkPickupX(world, network) {
        const plot = getPlot(world, network.derrickId);
        return plot ? plot.x + C.PLOT_WIDTH / 2 : C.WORLD_W / 2;
    }

    function canVentRig(network) {
        return network.isPumping && !network.blowout && (network.pressure || 0) >= C.VENT_MIN;
    }

    function getPocketRichness(pocket) {
        return pocket.maxOil > C.RICH_LARGE_OIL ? 'velké' : (pocket.maxOil > C.RICH_MEDIUM_OIL ? 'střední' : 'malé');
    }

    // --- Horniny a ložisko ---
    function strataBoundaryY(bound, x) {
        return bound.y + bound.amp * Math.sin(x * bound.freq + bound.phase) +
            bound.amp * 0.4 * Math.sin(x * bound.freq * 2.7 + bound.phase * 1.3);
    }

    function rockAt(world, x, y) {
        const strata = world.strata;
        if (!strata) return 'sand';
        let i = 0;
        while (i < strata.bounds.length && y > strataBoundaryY(strata.bounds[i], x)) i++;
        return strata.layers[i];
    }

    // Tlak ložiska: klesá s vytěženou ropou, vtláčení ho zvedá
    function pocketDrive(pocket) {
        const fill = pocket.maxOil > 0 ? Math.max(0, pocket.oil) / pocket.maxOil : 0;
        const drive = (pocket.drive0 ?? 1) * Math.pow(fill, C.DECLINE_EXP) + (pocket.boost || 0);
        return Math.max(C.MIN_DRIVE, Math.min(1.6, drive));
    }

    function waterCutOf(world, network) {
        const pocket = world.oilPockets[network.pocket];
        return Math.min(C.MAX_WATER_CUT, (network.waterCut || 0) + (pocket ? pocket.waterCut || 0 : 0));
    }

    // Barelů za sekundu, které vrt právě těží (0 = netěží)
    function wellRate(world, network) {
        const pocket = world.oilPockets[network.pocket];
        if (!pocket || !network.isPumping || pocket.oil <= 0) return 0;
        return C.OIL_PER_SECOND * pocketDrive(pocket) * (1 - waterCutOf(world, network));
    }

    // --- Trasa vrtu ---
    function pathLength(path) {
        let len = 0;
        for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        return len;
    }

    // Bod ve vzdálenosti dist od začátku trasy (index = segment, ve kterém leží)
    function pointAlong(path, dist) {
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (dist <= len || i === path.length - 1) {
                const t = len > 0 ? Math.max(0, Math.min(1, dist / len)) : 1;
                return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, index: i };
            }
            dist -= len;
        }
        return { x: path[0].x, y: path[0].y, index: 0 };
    }

    function drillHead(network) {
        return pointAlong(network.path, network.drilled || 0);
    }

    // Uřízne trasu v místě vrtáku (zbytek naplánované trasy zmizí)
    function cutPathAtHead(network) {
        const head = drillHead(network);
        if (network.path.length < 2 || head.index === 0) return;
        network.path = network.path.slice(0, head.index);
        const last = network.path[network.path.length - 1];
        if (Math.hypot(last.x - head.x, last.y - head.y) > 0.5) network.path.push({ x: head.x, y: head.y });
        network.drilled = pathLength(network.path);
    }

    function segmentHitsCircle(a, b, c) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) <= c.r;
    }

    function emit(world, event) {
        world.events.push(event);
    }

    // --- Geometrie ---
    function isPointInPolygon(point, vertices) {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const a = vertices[i], b = vertices[j];
            if ((a.y > point.y) !== (b.y > point.y) &&
                point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
                inside = !inside;
            }
        }
        return inside;
    }

    function lineIntersectsLine(l1p1, l1p2, l2p1, l2p2) {
        let q = (l1p1.y - l2p1.y) * (l2p2.x - l2p1.x) - (l1p1.x - l2p1.x) * (l2p2.y - l2p1.y);
        const d = (l1p2.x - l1p1.x) * (l2p2.y - l2p1.y) - (l1p2.y - l1p1.y) * (l2p2.x - l2p1.x);
        if (d === 0) return false;
        const r = q / d;
        q = (l1p1.y - l2p1.y) * (l1p2.x - l1p1.x) - (l1p1.x - l2p1.x) * (l1p2.y - l1p1.y);
        const s = q / d;
        // Včetně krajů: trubka procházející přesně vrcholem polygonu se počítá jako zásah
        return r >= 0 && r <= 1 && s >= 0 && s <= 1;
    }

    // Úsečka p1-p2 zasahuje polygon, když některý konec leží uvnitř nebo protíná jeho hranu
    function isSegmentIntersectingPolygon(p1, p2, vertices) {
        if (isPointInPolygon(p1, vertices) || isPointInPolygon(p2, vertices)) return true;
        for (let i = 0; i < vertices.length; i++) {
            if (lineIntersectsLine(p1, p2, vertices[i], vertices[(i + 1) % vertices.length])) return true;
        }
        return false;
    }

    // Vzdálenost bodu od ložiska (od jeho obrysu, uvnitř 0)
    function distanceToPocket(x, y, pocket) {
        if (isPointInPolygon({ x, y }, pocket.vertices)) return 0;
        let best = Infinity;
        const v = pocket.vertices;
        for (let i = 0; i < v.length; i++) {
            const a = v[i], b = v[(i + 1) % v.length];
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
        }
        return best;
    }

    // Ložisko, do kterého vrták právě vjel. Do jednoho ložiska smí vést víc vrtů (i různých hráčů),
    // každý pak těží podle tlaku ložiska, takže se ložisko vyprázdní rychleji.
    function findHitPocket(world, start, end) {
        for (const pocket of world.oilPockets) {
            if (isSegmentIntersectingPolygon(start, end, pocket.vertices)) return pocket;
        }
        return null;
    }

    // --- Akce hráčů ---
    // Vrací { ok, reason }. Kontroluje vše, co dřív hlídalo UI, protože na sdílené mapě přichází po síti.
    function act(world, playerId, action) {
        const player = world.players[playerId];
        if (!player || player.over || world.over || !action || typeof action.type !== 'string') return fail('invalid');
        switch (action.type) {
            case 'buyPlot': return buyPlot(world, player, action.plotId);
            case 'buildDerrick': return buildDerrick(world, player, action.plotId);
            case 'buildSilo': return buildSilo(world, player, action.plotId);
            case 'buyTruck': return buyTruck(world, player);
            case 'assignTruck': return assignTruck(player, action.company, action.delta);
            case 'drill': return addDrillPoint(world, player, action.plotId, action.x, action.y);
            case 'drillStop': return stopDrill(world, player, action.plotId);
            case 'bop': return closePreventer(world, player, action.plotId);
            case 'bit': return replaceBit(world, player, action.plotId);
            case 'cement': return cementWell(world, player, action.plotId);
            case 'inject': return toggleInjection(world, player, action.plotId);
            case 'vent': return vent(world, player, action.plotId);
            case 'seismic': return fireSeismic(world, player, action.plotId, action.x);
            case 'drone': return launchDrone(world, player);
            case 'radar': return fireRadar(world, player, action.x, action.y);
            default: return fail('unknown');
        }
    }

    function fail(reason) {
        return { ok: false, reason };
    }

    function ownedPlot(world, player, plotId) {
        const plot = getPlot(world, plotId);
        return plot && plot.owner === player.id ? plot : null;
    }

    function buyPlot(world, player, plotId) {
        const plot = getPlot(world, plotId);
        if (!plot || plot.owner) return fail('taken');
        if (player.money < plot.price) return fail('money');
        player.money -= plot.price;
        plot.owner = player.id;
        emit(world, { type: 'plot_bought', playerId: player.id, plotId: plot.id, price: plot.price });
        return { ok: true };
    }

    function buildDerrick(world, player, plotId) {
        const plot = ownedPlot(world, player, plotId);
        if (!plot || plot.hasVrt) return fail('plot');
        if (player.money < C.VRT_COST) return fail('money');
        player.money -= C.VRT_COST;
        plot.hasVrt = true;
        emit(world, { type: 'derrick_built', playerId: player.id, plotId: plot.id });
        return { ok: true };
    }

    function buildSilo(world, player, plotId) {
        const plot = ownedPlot(world, player, plotId);
        if (!plot || !plot.hasVrt || plot.siloCount >= C.MAX_SILOS_PER_PLOT) return fail('plot');
        if (player.money < C.SILO_COST) return fail('money');
        player.money -= C.SILO_COST;
        plot.siloCount++;
        const network = getNetworkForPlot(world, plot.id);
        if (network) network.oilCapacity += C.SILO_CAPACITY_BONUS;
        emit(world, { type: 'silo_built', playerId: player.id, plotId: plot.id });
        return { ok: true };
    }

    function buyTruck(world, player) {
        if (player.trucksOwned >= C.MAX_TRUCKS) return fail('limit');
        if (player.money < C.TRUCK_COST) return fail('money');
        player.money -= C.TRUCK_COST;
        player.trucksOwned++;
        world.trucks.push({
            id: world.nextTruckId++, owner: player.id, x: -50, state: 'idle',
            homeNetworkId: null, targetCompany: null, oil: 0, facing: 1
        });
        emit(world, { type: 'truck_bought', playerId: player.id, count: player.trucksOwned });
        return { ok: true };
    }

    function assignTruck(player, company, delta) {
        if (company !== 'left' && company !== 'right') return fail('company');
        const a = player.assigned;
        if (delta > 0) {
            if (a.left + a.right >= player.trucksOwned) return fail('limit');
            a[company]++;
        } else if (a[company] > 0) {
            a[company]--;
        }
        return { ok: true };
    }

    // Další bod trasy vrtu. První klik založí vrt na přední hraně pozemku; vrták pak jede
    // po trase reálným časem (stepDrilling) a platí se za vyvrtaný pixel.
    function addDrillPoint(world, player, plotId, x, y) {
        const plot = ownedPlot(world, player, plotId);
        if (!plot || !plot.hasVrt) return fail('plot');
        x = Number(x);
        y = Number(y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('point');
        if (y <= C.GROUND_LEVEL || y > C.WORLD_H || x < 0 || x > C.WORLD_W) return fail('point');
        let network = getNetworkForPlot(world, plot.id);
        if (network && network.pocket >= 0) return fail('pumping');
        const lastPoint = network
            ? network.path[network.path.length - 1]
            : { x: plot.x + C.PLOT_WIDTH / 2, y: C.GROUND_LEVEL };
        // Vrták neumí stoupat strmě vzhůru
        if (lastPoint.y - y > Math.abs(x - lastPoint.x) * C.DRILL_MAX_RISE) return fail('angle');
        if (Math.hypot(x - lastPoint.x, y - lastPoint.y) < 4) return fail('point');
        if (!network) {
            network = {
                id: world.nextNetworkId++,
                derrickId: plot.id,
                owner: player.id,
                path: [{ x: plot.x + C.PLOT_WIDTH / 2, y: C.GROUND_LEVEL }],
                drilled: 0,          // kolik px trasy je vyvrtáno
                drillState: 'drilling', // drilling | idle | kick | shut | swap | worn | done
                drillTimer: 0,
                bit: 1,              // korunka 1 = nová, 0 = opotřebená
                stalled: false,      // došly peníze
                drillCost: 0,
                waterCut: 0,         // voda ze zvodnělé vrstvy
                injecting: false,
                isPumping: false,
                oilStored: 0,
                oilCapacity: C.DERRICK_BASE_CAPACITY + plot.siloCount * C.SILO_CAPACITY_BONUS,
                pocket: -1,          // index ložiska v world.oilPockets
                pressure: 0,
                warned: false,
                vent: 0,
                blowout: 0
            };
            world.pipeNetworks.push(network);
        }
        network.path.push({ x, y });
        if (network.drillState === 'idle') network.drillState = 'drilling';
        return { ok: true };
    }

    function rigOf(world, player, plotId) {
        const plot = ownedPlot(world, player, plotId);
        return plot ? getNetworkForPlot(world, plot.id) : null;
    }

    // Zastaví vrták na místě: zbytek naplánované trasy se zahodí
    function stopDrill(world, player, plotId) {
        const network = rigOf(world, player, plotId);
        if (!network || network.pocket >= 0) return fail('drill');
        cutPathAtHead(network);
        if (network.drillState === 'drilling') network.drillState = 'idle';
        return { ok: true };
    }

    // Preventer: zavře vrt při plynovém kopanci
    function closePreventer(world, player, plotId) {
        const network = rigOf(world, player, plotId);
        if (!network || network.drillState !== 'kick') return fail('bop');
        network.drillState = 'shut';
        network.drillTimer = C.KICK_SHUT_MS;
        emit(world, { type: 'bop', playerId: player.id, plotId });
        return { ok: true };
    }

    // Nová korunka: chvíli trvá (vytažení soutyčí), pak se vrtá dál
    function replaceBit(world, player, plotId) {
        const network = rigOf(world, player, plotId);
        if (!network || network.pocket >= 0 || network.bit >= 1) return fail('bit');
        if (!['drilling', 'idle', 'worn'].includes(network.drillState)) return fail('bit');
        if (player.money < C.BIT_COST) return fail('money');
        player.money -= C.BIT_COST;
        network.drillState = 'swap';
        network.drillTimer = C.BIT_SWAP_MS;
        emit(world, { type: 'bit_swap', playerId: player.id, plotId });
        return { ok: true };
    }

    // Cementace utěsní zvodnělou vrstvu (voda z ložiska po vtláčení zůstává)
    function cementWell(world, player, plotId) {
        const network = rigOf(world, player, plotId);
        if (!network || !(network.waterCut > 0)) return fail('cement');
        if (player.money < C.CEMENT_COST) return fail('money');
        player.money -= C.CEMENT_COST;
        network.waterCut = 0;
        emit(world, { type: 'cement', playerId: player.id, plotId });
        return { ok: true };
    }

    // Vrt přepne mezi těžbou a vtláčením vody do ložiska
    function toggleInjection(world, player, plotId) {
        const network = rigOf(world, player, plotId);
        const pocket = network && world.oilPockets[network.pocket];
        if (!pocket || pocket.oil <= 0 || network.blowout > 0) return fail('inject');
        network.injecting = !network.injecting;
        network.isPumping = !network.injecting;
        if (network.injecting) {
            network.pressure = 0;
            network.warned = false;
        }
        emit(world, { type: 'inject', playerId: player.id, plotId, on: network.injecting });
        return { ok: true };
    }

    function vent(world, player, plotId) {
        const plot = ownedPlot(world, player, plotId);
        const network = plot && getNetworkForPlot(world, plot.id);
        if (!network || !canVentRig(network)) return fail('vent');
        network.pressure = 0;
        network.vent = C.VENT_MS;
        network.warned = false;
        emit(world, { type: 'vent', playerId: player.id, plotId: plot.id });
        return { ok: true };
    }

    function fireSeismic(world, player, plotId, x) {
        const plot = ownedPlot(world, player, plotId);
        if (!plot) return fail('plot');
        if (player.money < C.SEISMIC_COST) return fail('money');
        player.money -= C.SEISMIC_COST;
        const cx = Math.max(plot.x + 10, Math.min(plot.x + C.PLOT_WIDTH - 10, Number(x) || plot.x + C.PLOT_WIDTH / 2));
        world.tools.waves.push({ x: cx, y: C.GROUND_LEVEL, age: 0, owner: player.id, hit: [] });
        emit(world, { type: 'seismic', playerId: player.id, plotId: plot.id, x: cx });
        return { ok: true };
    }

    function launchDrone(world, player) {
        if (world.tools.drones.some(d => d.owner === player.id)) return fail('flying');
        if (player.money < C.DRONE_COST) return fail('money');
        player.money -= C.DRONE_COST;
        world.tools.drones.push({ x: -60, owner: player.id });
        emit(world, { type: 'drone', playerId: player.id });
        return { ok: true };
    }

    function fireRadar(world, player, x, y) {
        x = Number(x);
        y = Number(y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || y <= C.GROUND_LEVEL) return fail('point');
        if (player.money < C.RADAR_COST) return fail('money');
        player.money -= C.RADAR_COST;
        world.tools.pulses.push({ x, y, age: 0, owner: player.id });
        let found = 0;
        world.oilPockets.forEach(pocket => {
            if (pocket.tappedBy.length || distanceToPocket(x, y, pocket) > C.RADAR_RADIUS) return;
            if (!pocket.revealedBy.includes(player.id)) {
                pocket.revealedBy.push(player.id);
                found++;
            }
        });
        let hazards = 0;
        world.hazards.forEach(h => {
            if (h.spent || Math.hypot(h.x - x, h.y - y) > C.RADAR_RADIUS + h.r || h.revealedBy.includes(player.id)) return;
            h.revealedBy.push(player.id);
            hazards++;
        });
        emit(world, { type: 'radar', playerId: player.id, found, hazards });
        return { ok: true, found, hazards };
    }

    // --- Čas ---
    function step(world, dt) {
        if (dt <= 0) return;
        stepTools(world, dt);
        if (!world.time.started || world.over) return;
        stepCalendar(world, dt);
        if (world._market) stepMarket(world, dt);
        stepDrilling(world, dt);
        stepReservoir(world, dt);
        stepPumping(world, dt);
        stepPressure(world, dt);
        stepTrucks(world, dt);
    }

    function stepCalendar(world, dt) {
        const time = world.time;
        time.dayTimer += dt;
        if (time.dayTimer < C.MS_PER_DAY) return;
        time.dayTimer -= C.MS_PER_DAY;
        time.day++;
        time.dayIndex++;
        stepNews(world);
        const landTax = getLandTax(world);
        world.playerOrder.forEach(id => {
            const player = world.players[id];
            if (player.over) return;
            const ownedPlots = world.plots.filter(p => p.owner === id).length;
            player.lastDayIncome = player.revenue - player.revenueAtDayStart - ownedPlots * landTax;
            player.revenueAtDayStart = player.revenue;
            if (ownedPlots > 0) {
                player.money -= ownedPlots * landTax;
                if (player.money < 0) endPlayer(world, player, 'bankrupt');
            }
        });
        if (time.day > C.DAYS_IN_MONTH[time.month]) {
            if (world.race && time.month >= world.race.months) {
                // Konec závodu: poslední den zvolené délky
                time.day = C.DAYS_IN_MONTH[time.month];
                endAll(world, 'race_end');
            } else if (time.month === 12) {
                // Konec roku: kalendář zůstane na posledním dni, nikdy nejde na měsíc 13
                time.day = C.DAYS_IN_MONTH[time.month];
                endAll(world, 'year_end');
            } else {
                time.day = 1;
                time.month++;
                emit(world, { type: 'month', month: time.month });
            }
        }
    }

    // Hráč končí (bankrot, konec závodu). Na sdílené mapě jeho vrty přestanou čerpat a kamiony zmizí.
    function endPlayer(world, player, reason) {
        if (player.over) return;
        player.over = true;
        player.reason = reason;
        if (world.shared) {
            world.pipeNetworks.forEach(n => {
                if (n.owner === player.id) {
                    n.isPumping = false;
                    n.injecting = false;
                }
            });
            world.trucks = world.trucks.filter(t => t.owner !== player.id);
        }
        emit(world, { type: 'player_over', playerId: player.id, reason });
        if (world.playerOrder.every(id => world.players[id].over)) world.over = true;
    }

    function endAll(world, reason) {
        world.playerOrder.forEach(id => endPlayer(world, world.players[id], reason));
        world.over = true;
    }

    function stepMarket(world, dt) {
        const m = world.market;
        m.timer += dt;
        if (m.timer <= C.PRICE_UPDATE_INTERVAL) return;
        m.timer = 0;
        const rnd = world._market;
        const leftDelta = (rnd() - 0.45 + m.left.trend * 0.15) * 0.12;
        const rightDelta = (rnd() - 0.45 + m.right.trend * 0.15) * 0.12;
        m.left.price = Math.max(0.25, Math.min(2.80, m.left.price + leftDelta));
        m.right.price = Math.max(0.25, Math.min(2.80, m.right.price + rightDelta));
        m.left.trend = Math.max(-1, Math.min(1, m.left.trend + (rnd() - 0.5) * 0.4));
        m.right.trend = Math.max(-1, Math.min(1, m.right.trend + (rnd() - 0.5) * 0.4));
        updateQuotes(world);
        ['left', 'right'].forEach(side => {
            m[side].history.push(m[side].quote);
            if (m[side].history.length > C.PRICE_HISTORY_LEN) m[side].history.shift();
        });
    }

    // --- Vrtání ---
    // Vrták jede po trase rychlostí podle horniny, platí se za pixel, korunka se opotřebovává.
    // Cestou může navrtat plyn (kopanec: zavřít preventer), vodu (zavodnění) nebo ložisko (těžba).
    function stepDrilling(world, dt) {
        world.pipeNetworks.forEach(network => {
            if (network.derrickId < 0 || !network.drillState || network.pocket >= 0) return;
            const player = world.players[network.owner];
            if (!player || player.over) return;
            switch (network.drillState) {
                case 'kick':
                    network.drillTimer -= dt;
                    if (network.drillTimer <= 0) kickBlowout(world, network, player);
                    break;
                case 'shut':
                    network.drillTimer -= dt;
                    if (network.drillTimer <= 0) {
                        network.drillState = 'drilling';
                        emit(world, { type: 'kick_over', playerId: player.id, plotId: network.derrickId });
                    }
                    break;
                case 'swap':
                    network.drillTimer -= dt;
                    if (network.drillTimer <= 0) {
                        network.bit = 1;
                        network.drillState = 'drilling';
                        emit(world, { type: 'bit_ready', playerId: player.id, plotId: network.derrickId });
                    }
                    break;
                case 'drilling':
                    advanceDrill(world, network, player, dt);
                    break;
            }
        });
    }

    function advanceDrill(world, network, player, dt) {
        const total = pathLength(network.path);
        const remaining = total - network.drilled;
        if (remaining <= 0.01) {
            network.drillState = 'idle';
            return;
        }
        if (network.blowout > 0) return;
        const from = drillHead(network);
        const rock = ROCKS[rockAt(world, from.x, from.y)];
        const px = Math.min(remaining, C.DRILL_SPEED * rock.speed * dt / 1000);
        const cost = px * C.DRILL_COST_PER_PX * rock.cost;
        if (player.money < cost) {
            if (!network.stalled) emit(world, { type: 'drill_stalled', playerId: player.id, plotId: network.derrickId });
            network.stalled = true;
            return;
        }
        network.stalled = false;
        player.money -= cost;
        network.drillCost += cost;
        network.drilled += px;
        network.bit = Math.max(0, network.bit - px * C.BIT_WEAR_PER_PX * rock.wear);
        const to = drillHead(network);

        network.hits = network.hits || [];
        for (const hazard of world.hazards) {
            if (hazard.spent || network.hits.includes(hazard.id) || !segmentHitsCircle(from, to, hazard)) continue;
            network.hits.push(hazard.id);
            hazard.hit = true;
            if (hazard.kind === 'gas') {
                hazard.spent = true; // kapsa se kopancem vyprázdní
                network.drillState = 'kick';
                network.drillTimer = C.KICK_MS;
                emit(world, { type: 'kick', playerId: player.id, plotId: network.derrickId, x: to.x, y: to.y });
                return;
            }
            network.waterCut = Math.min(C.MAX_WATER_CUT, network.waterCut + C.WATER_CUT_HIT);
            emit(world, { type: 'water', playerId: player.id, plotId: network.derrickId, x: to.x, y: to.y });
        }

        const pocket = findHitPocket(world, from, to);
        if (pocket) {
            cutPathAtHead(network);
            network.pocket = pocket.id;
            network.isPumping = pocket.oil > 0;
            network.drillState = 'done';
            if (!pocket.tappedBy.includes(player.id)) pocket.tappedBy.push(player.id);
            emit(world, { type: 'strike', playerId: player.id, plotId: network.derrickId, oil: Math.floor(pocket.oil), x: network.path[0].x });
            return;
        }
        if (network.bit <= 0) {
            network.drillState = 'worn';
            emit(world, { type: 'bit_worn', playerId: player.id, plotId: network.derrickId });
        } else if (network.drilled >= total - 0.01) {
            network.drillState = 'idle';
        }
    }

    // Nezvládnutý kopanec: plyn vyrazí z vrtu, pokuta jako za erupci a zničená korunka
    function kickBlowout(world, network, player) {
        const fine = getBlowoutFine(world);
        player.money -= fine;
        network.blowout = C.BLOWOUT_MS;
        network.bit = 0;
        network.drillState = 'worn';
        emit(world, { type: 'blowout', playerId: player.id, plotId: network.derrickId, fine, kick: true });
    }

    // --- Ložisko ---
    // Propojená ložiska vyrovnávají naplnění, vtláčení vody zvedá tlak a zavodňuje
    function stepReservoir(world, dt) {
        const s = dt / 1000;
        (world.links || []).forEach(([ia, ib]) => {
            const a = world.oilPockets[ia], b = world.oilPockets[ib];
            if (!a || !b) return;
            const fa = a.oil / a.maxOil, fb = b.oil / b.maxOil;
            const balance = (fa - fb) * a.maxOil * b.maxOil / (a.maxOil + b.maxOil); // přesun do vyrovnání
            let flow = C.MIGRATE_RATE * (fa - fb) * Math.min(a.maxOil, b.maxOil) * s;
            flow = flow > 0 ? Math.min(flow, balance) : Math.max(flow, balance);
            a.oil -= flow;
            b.oil += flow;
        });
        world.oilPockets.forEach(p => {
            if (p.boost > 0) p.boost = Math.max(0, p.boost - C.BOOST_DECAY_PER_S * s);
        });
        world.pipeNetworks.forEach(network => {
            if (!network.injecting) return;
            const pocket = world.oilPockets[network.pocket];
            const player = world.players[network.owner];
            const cost = C.INJECT_COST_PER_S * s;
            if (!pocket || pocket.oil <= 0 || !player || player.money < cost) {
                network.injecting = false;
                network.isPumping = !!pocket && pocket.oil > 0;
                emit(world, { type: 'inject', playerId: network.owner, plotId: network.derrickId, on: false, forced: true });
                return;
            }
            player.money -= cost;
            pocket.boost = Math.min(C.INJECT_BOOST_MAX, pocket.boost + (C.INJECT_BOOST_PER_S + C.BOOST_DECAY_PER_S) * s);
            pocket.waterCut = Math.min(C.MAX_WATER_CUT, pocket.waterCut + C.INJECT_WATER_PER_S * s);
        });
    }

    // Těžba: průtok podle tlaku ložiska a podílu vody, do zásobníku vrtu
    function stepPumping(world, dt) {
        world.pipeNetworks.forEach(network => {
            if (!network.isPumping || network.oilStored >= network.oilCapacity) return;
            const pocket = world.oilPockets[network.pocket];
            if (!pocket || pocket.oil <= 0) {
                network.isPumping = false;
                emit(world, { type: 'exhausted', playerId: network.owner, plotId: network.derrickId });
                return;
            }
            const room = network.oilCapacity - network.oilStored;
            const extracted = Math.min(wellRate(world, network) * (dt / 1000), pocket.oil, room);
            network.oilStored += extracted;
            pocket.oil -= extracted;
            if (pocket.oil <= 0) {
                pocket.oil = 0;
                network.isPumping = false;
                emit(world, { type: 'exhausted', playerId: network.owner, plotId: network.derrickId });
            }
        });
    }

    // Přetlak: plný zásobník zvedá tlak; od VENT_MIN jde odpustit, při 100 % erupce
    function stepPressure(world, dt) {
        const rules = getRules(world);
        world.pipeNetworks.forEach(network => {
            if (network.blowout > 0) {
                network.blowout -= dt;
                const pocket = world.oilPockets[network.pocket];
                if (pocket) pocket.oil = Math.max(0, pocket.oil - C.BLOWOUT_WASTE_PER_SECOND * dt / 1000);
                const plot = getPlot(world, network.derrickId);
                if (plot) plot.spill = Math.min(1, (plot.spill || 0) + C.BLOWOUT_SPILL_PER_MS * dt);
                if (network.blowout <= 0) {
                    network.blowout = 0;
                    network.pressure = C.PRESSURE_AFTER_BLOWOUT;
                }
                return;
            }
            if (network.vent > 0) network.vent = Math.max(0, network.vent - dt);
            const pressure = network.pressure || 0;
            const full = network.isPumping && network.oilStored >= network.oilCapacity - 0.01;
            network.pressure = full
                ? Math.min(1, pressure + dt / rules.pressureBuildMs)
                : Math.max(0, pressure - dt / C.PRESSURE_RELIEF_MS);
            if (network.pressure >= C.PRESSURE_WARN && !network.warned) {
                network.warned = true;
                emit(world, { type: 'warn', playerId: network.owner, plotId: network.derrickId });
            }
            if (network.pressure < C.VENT_MIN) network.warned = false;
            if (network.pressure >= 1) {
                network.blowout = C.BLOWOUT_MS;
                const player = world.players[network.owner];
                const fine = getBlowoutFine(world);
                if (player) player.money -= fine;
                emit(world, { type: 'blowout', playerId: network.owner, plotId: network.derrickId, fine });
            }
        });
        world.plots.forEach(plot => {
            if (plot.spill > 0) plot.spill = Math.max(0, plot.spill - dt / C.SPILL_FADE_MS);
        });
    }

    // --- Kamiony ---
    // Vrt pro další jízdu: nejvíc ropy, méně když tam už jiná auta jedou, kousek dál = trochu horší.
    // Jen vrty vlastníka kamionu.
    function findNetworkForTruck(world, truck) {
        let best = null;
        let bestScore = -Infinity;
        world.pipeNetworks.forEach(network => {
            if (network.owner !== truck.owner || !rigHasOil(network)) return;
            const claimed = world.trucks.filter(t => t !== truck && t.homeNetworkId === network.id &&
                (t.state === 'to_rig' || t.state === 'waiting_at_rig')).length;
            const distance = Math.abs(getNetworkPickupX(world, network) - truck.x);
            const score = network.oilStored - claimed * C.TRUCK_CAPACITY - distance * 0.01;
            if (score > bestScore) {
                bestScore = score;
                best = network;
            }
        });
        return best;
    }

    // Firma pro kamion: nejdřív přidělené sloty vlastníka, zbytek jede k lepší ceně
    function chooseCompanyFor(world, truck) {
        const player = world.players[truck.owner];
        const m = world.market;
        // Zavřený výkupce (stávka, požár): všechno jede k druhému
        if (m.left.closed !== m.right.closed) return m.left.closed ? 'right' : 'left';
        const others = world.trucks.filter(t => t !== truck && t.owner === truck.owner && t.state !== 'idle');
        const activeLeft = others.filter(t => t.targetCompany === 'left').length;
        const activeRight = others.filter(t => t.targetCompany === 'right').length;
        if (activeLeft < player.assigned.left) return 'left';
        if (activeRight < player.assigned.right) return 'right';
        if (m.left.quote > m.right.quote + 0.05) return 'left';
        if (m.right.quote > m.left.quote + 0.05) return 'right';
        if (player.assigned.left > player.assigned.right) return 'left';
        if (player.assigned.right > player.assigned.left) return 'right';
        return truck.id % 2 ? 'left' : 'right';
    }

    // Vrt, ke kterému má smysl jet: těží, nebo má v zásobníku aspoň na jednu fůru
    function rigHasOil(network) {
        return network.isPumping || network.oilStored >= C.MIN_LOAD_AMOUNT;
    }

    function tryLoadTruckAtRig(truck, network) {
        const loadAmount = Math.min(C.TRUCK_CAPACITY, Math.floor(network.oilStored));
        if (loadAmount < C.MIN_LOAD_AMOUNT) return false;
        network.oilStored -= loadAmount;
        truck.oil = loadAmount;
        return true;
    }

    function dispatchIdleTruck(world, truck) {
        const network = findNetworkForTruck(world, truck);
        if (!network) return;
        truck.homeNetworkId = network.id;
        truck.targetCompany = chooseCompanyFor(world, truck);
        truck.state = 'to_rig';
        // Vjezd z okraje mapy; když tam už jiné auto je, postaví se za něj
        const edgeDir = truck.targetCompany === 'left' ? -1 : 1;
        const minGap = C.TRUCK_LENGTH + C.TRUCK_GAP_PAD;
        let spawnX = truck.targetCompany === 'left' ? -50 : C.WORLD_W + 50;
        for (let guard = 0; guard < 20 &&
            world.trucks.some(o => o !== truck && o.state !== 'idle' && Math.abs(o.x - spawnX) < minGap); guard++) {
            spawnX += edgeDir * minGap;
        }
        truck.x = spawnX;
        truck.facing = -edgeDir; // jede dovnitř mapy
    }

    // Omezí krok kamionu, aby nenajel na auto před sebou. Pruhy se podle směru nepotkávají,
    // auto čekající u vrtu brzdí jen ta, která jedou ke stejnému vrtu.
    function trafficLimitedStep(world, truck, targetX, stepPx) {
        const dir = Math.sign(targetX - truck.x);
        if (dir === 0) return stepPx;
        const minGap = C.TRUCK_LENGTH + C.TRUCK_GAP_PAD;
        let allowed = stepPx;
        world.trucks.forEach(other => {
            if (other === truck || other.state === 'idle') return;
            if (other.state === 'waiting_at_rig') {
                if (truck.state !== 'to_rig' || truck.homeNetworkId !== other.homeNetworkId) return;
            } else if ((other.facing || 1) !== dir) {
                return;
            }
            const ahead = (other.x - truck.x) * dir;
            if (ahead <= 0) return;
            allowed = Math.min(allowed, Math.max(0, ahead - minGap));
        });
        return allowed;
    }

    // Posune kamion k cíli o nejvýš stepPx. Vrací true, když dorazil (bez přeskoku cíle).
    function moveTruckToward(truck, targetX, stepPx) {
        const distance = targetX - truck.x;
        if (distance !== 0) truck.facing = Math.sign(distance);
        if (Math.abs(distance) <= stepPx) {
            truck.x = targetX;
            return true;
        }
        truck.x += Math.sign(distance) * stepPx;
        return false;
    }

    function sellLoad(world, truck, targetX) {
        const buyer = world.market[truck.targetCompany];
        const sale = truck.oil * buyer.quote;
        const player = world.players[truck.owner];
        if (player) {
            player.money += sale;
            player.revenue += sale;
            player.sold += truck.oil;
        }
        emit(world, { type: 'sale', playerId: truck.owner, amount: Math.round(sale), x: targetX, company: truck.targetCompany });
        // Sdílená mapa: každá dodávka sráží cenu, výkupci jsou zahlcení
        if (world.shared) {
            buyer.price = Math.max(0.25, buyer.price - C.SHARED_SALE_PRICE_DROP * truck.oil / C.TRUCK_CAPACITY);
            updateQuotes(world);
        }
        truck.oil = 0;
    }

    function stepTrucks(world, dt) {
        const speed = C.TRUCK_SPEED * newsEffect(world, 'truckSpeed') * (dt / 1000);
        world.trucks.filter(t => t.state === 'idle').forEach(truck => dispatchIdleTruck(world, truck));

        world.trucks.forEach(truck => {
            if (truck.state === 'idle') return;
            const network = world.pipeNetworks.find(n => n.id === truck.homeNetworkId) || null;
            switch (truck.state) {
                case 'waiting_at_rig': {
                    if (!network || !rigHasOil(network)) {
                        truck.state = 'idle';
                        truck.homeNetworkId = null;
                        break;
                    }
                    truck.x = getNetworkPickupX(world, network);
                    if (tryLoadTruckAtRig(truck, network)) {
                        truck.targetCompany = chooseCompanyFor(world, truck);
                        truck.state = 'to_company';
                    } else {
                        // Tento vrt nemá co naložit: přejeď k jinému, který ropu má
                        const other = findNetworkForTruck(world, truck);
                        if (other && other.id !== network.id && other.oilStored >= C.MIN_LOAD_AMOUNT) {
                            truck.homeNetworkId = other.id;
                            truck.state = 'to_rig';
                        }
                    }
                    break;
                }
                case 'to_rig': {
                    if (!network || !rigHasOil(network)) {
                        truck.state = 'idle';
                        truck.homeNetworkId = null;
                        break;
                    }
                    const targetX = getNetworkPickupX(world, network);
                    if (moveTruckToward(truck, targetX, trafficLimitedStep(world, truck, targetX, speed))) {
                        if (tryLoadTruckAtRig(truck, network)) {
                            truck.targetCompany = chooseCompanyFor(world, truck);
                            truck.state = 'to_company';
                        } else {
                            truck.state = 'waiting_at_rig';
                        }
                    }
                    break;
                }
                case 'to_company': {
                    // Výkupce zavřel cestou: otočit k druhému, jsou-li zavření oba, počkat
                    if (world.market[truck.targetCompany].closed) {
                        const other = truck.targetCompany === 'left' ? 'right' : 'left';
                        if (world.market[other].closed) break;
                        truck.targetCompany = other;
                    }
                    const targetX = truck.targetCompany === 'left' ? 50 : C.WORLD_W - 50;
                    if (moveTruckToward(truck, targetX, trafficLimitedStep(world, truck, targetX, speed))) {
                        sellLoad(world, truck, targetX);
                        // Další jízda: vrt se vybírá znovu (nový nebo plnější vrt)
                        const nextNetwork = findNetworkForTruck(world, truck);
                        if (nextNetwork) {
                            truck.homeNetworkId = nextNetwork.id;
                            truck.state = 'to_rig';
                        } else {
                            truck.state = 'idle';
                            truck.homeNetworkId = null;
                        }
                    }
                    break;
                }
            }
        });
    }

    // --- Průzkum ---
    function echoPocket(world, pocket, playerId) {
        pocket.echo[playerId] = world.tools.clock + C.ECHO_MS;
    }

    function stepTools(world, dt) {
        const tools = world.tools;
        tools.clock += dt;
        tools.waves.forEach(wave => {
            wave.age += dt;
            const radius = C.SEISMIC_RADIUS * Math.min(1, wave.age / C.SEISMIC_WAVE_MS);
            world.oilPockets.forEach(pocket => {
                if (wave.hit.includes(pocket.id) || distanceToPocket(wave.x, wave.y, pocket) > radius) return;
                wave.hit.push(pocket.id);
                echoPocket(world, pocket, wave.owner);
            });
        });
        tools.waves = tools.waves.filter(w => w.age < C.SEISMIC_WAVE_MS + 500);
        tools.pulses.forEach(p => { p.age += dt; });
        tools.pulses = tools.pulses.filter(p => p.age < C.RADAR_PULSE_MS);
        tools.drones.forEach(drone => {
            drone.x += C.DRONE_SPEED * dt / 1000;
            world.oilPockets.forEach(pocket => {
                const cx = pocket.x + pocket.width / 2;
                if (Math.abs(cx - drone.x) < C.DRONE_BEAM_HALF + pocket.width / 2) echoPocket(world, pocket, drone.owner);
            });
        });
        tools.drones = tools.drones.filter(d => d.x <= C.WORLD_W + 80);
    }

    // --- Síť ---
    // Stav pro odeslání: bez funkcí a událostí (ty jdou zvlášť)
    function serialize(world) {
        return JSON.stringify(world, (key, value) => (key === 'events' || key === '_market' ? undefined : value));
    }

    return {
        C, RULES, PLAYER_COLORS, NEWS, ROCKS,
        seededRandom, createWorld, act, step, serialize,
        getRules, getLandTax, getBlowoutFine, newsEffect, getPlot, getNetworkForPlot, getNetworkPickupX, canVentRig, getPocketRichness,
        isPointInPolygon, isSegmentIntersectingPolygon, distanceToPocket, endPlayer, endAll,
        strataBoundaryY, rockAt, pocketDrive, waterCutOf, wellRate, pathLength, pointAlong, drillHead
    };
});
