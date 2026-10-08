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
        // Claimy: nepravidelné šířky mezi okrajovými kupci, terén mění cenu a stavbu
        CLAIM_MIN: 7,
        CLAIM_RANGE: 3,              // 7–9 claimů
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
        INJECT_COST_PER_S: 3.5,      // vtláčení vody: $/s
        INJECT_BOOST_PER_S: 0.03,    // o kolik vtláčení zvedá tlak ložiska za sekundu
        INJECT_BOOST_MAX: 0.7,
        BOOST_DECAY_PER_S: 0.004,    // bez vtláčení tlak zase opadá
        INJECT_WATER_PER_S: 0.0004,  // vtláčení pomalu zavodňuje celé ložisko (~25 % za 60 dní)
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
        // Sdílená mapa: dražby claimů, obchod mezi hráči, kartel, sabotáž
        AUCTION_MS: 15000,           // dražba končí 1,5 dne po posledním příhozu
        AUCTION_MIN_RAISE: 25,
        DEAL_DAYS: 2,                // nabídka ropy platí tolik dní
        CARTEL_PROPOSAL_DAYS: 2,
        CARTEL_MAX_DAYS: 10,
        STRIKE_COST: 500,
        STRIKE_MS: 15000,            // podplacená stávka: vozy soupeře stojí 1,5 dne
        STRIKE_TRACE_CHANCE: 0.4,    // s touto pravděpodobností se ví, kdo platil
        // Město jako trh: cena kupce klesá, když má plný sklad (dny zásoby podle poptávky)
        STOCK_DAYS: 2,               // při zásobě na tolik dní je cena základní × 0,65
        SHARED_DEMAND_PER_PLAYER: 0.4, // sdílená mapa: poptávka roste s počtem hráčů (míň než hráčů, ať si konkurují)
        WAGON_SPEED_MULT: 0.72,      // povozy do éry železnice jezdí pomaleji než kamiony
        // Odbyt bez vozů: ropovod (od Boomtownu, ke každému kupci, průtok omezený) a vlečka
        // (od Železnice, jen na nádraží, velký průtok). Jeden odbyt na vrt.
        PIPELINE_COST_PER_PX: 0.6,
        PIPELINE_RATE: 4,            // bbl/s
        PIPELINE_ERA: 1,
        SIDING_COST: 700,
        SIDING_RATE: 10,
        SIDING_ERA: 2,
        LINK_SALE_BATCH: 100,        // událost prodeje po tolika barelech
        LINK_STOCK_DAYS: 0.5,        // ropovod stojí, když má kupec zásobu na půl dne (cena blízko základu)
        LINK_PRICE_BONUS: 1.08,      // stálý odběr potrubím platí kupec o kousek líp
        // Zakázky telegramem
        CONTRACT_FIRST_DAY: 4,
        CONTRACT_GAP_MIN: 5,
        CONTRACT_GAP_RANGE: 5,
        CONTRACT_OFFER_DAYS: 3,      // jak dlouho nabídka visí
        MAX_CONTRACT_OFFERS: 2,
        MAX_ACTIVE_CONTRACTS: 2,
        CONTRACT_PENALTY: 0.3,       // penále = podíl hodnoty nedodané ropy
        MAX_SHARED_PLAYERS: 4
    };
    C.GROUND_LEVEL = Math.floor(C.WORLD_H * C.GROUND_RATIO);
    C.CLAIM_SPAN = C.WORLD_W - 2 * C.SIDE_MARGIN;

    // Pravidla: v závodě a na sdílené mapě tvrdší, sólo zůstává přívětivé
    const RULES = {
        solo: { startMoney: 3000, landTax: 15, pressureBuildMs: 20000, blowoutFine: 250 },
        race: { startMoney: 2000, landTax: 25, pressureBuildMs: 12000, blowoutFine: 400 }
    };

    const PLAYER_COLORS = ['#ffb45a', '#6ec6ff', '#7ee08a', '#ff7aa8'];

    // Terén claimu: kopec zdražuje stavby, řeka zlevňuje vtláčení vody, skála má pod povrchem žulu
    // (pomalý a drahý začátek vrtu), rovina nic. Cena pozemku to zohledňuje.
    const TERRAIN = {
        flat: { name: 'Rovina', priceMult: 1, buildMult: 1, injectMult: 1 },
        hill: { name: 'Kopec', priceMult: 0.8, buildMult: 1.5, injectMult: 1 },
        river: { name: 'Řeka', priceMult: 1.25, buildMult: 1, injectMult: 0.35 },
        rock: { name: 'Skála', priceMult: 0.65, buildMult: 1, injectMult: 1 }
    };

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

    // --- Město jako trh ---
    // Éry posouvá ropa dodaná do města (delivered); každá éra zvedá poptávku a otevírá nové kupce.
    // Na sdílené mapě se prahy násobí počtem hráčů, ať město neroste čtyřikrát rychleji.
    const ERAS = [
        { key: 'camp', name: 'Tábor', delivered: 0, desc: 'Stany, boudy a petrolejové lampy.' },
        { key: 'boom', name: 'Boomtown', delivered: 1500, desc: 'Dřevěné domy, saloon a víc světla. Rafinerie a petrolejka berou víc.' },
        { key: 'rail', name: 'Železnice', delivered: 7000, desc: 'Přijela trať: nádraží vykupuje ropu na export, povozy nahradily kamiony.' },
        { key: 'auto', name: 'Automobil', delivered: 20000, desc: 'Elektřina, cihlové bloky a první auta. Otevřela benzinka.' }
    ];

    // Kupci: x = místo vykládky na silnici, era = od které éry kupují, demand = barelů/den podle éry.
    // Role: obchody ve městě (petrolejka, benzinka) platí nejvíc, ale malou poptávku rychle zaplní;
    // rafinerie je velký stálý odběratel; nádraží vyváží, poptávka je obrovská a nezahltí se,
    // cena je nižší a hýbou s ní hlavně světové zprávy.
    const BUYERS = [
        { id: 'left', name: 'Rafinerie', sub: 'velký odběr', x: 50, era: 0, base: 1.05, demand: [110, 160, 210, 260] },
        { id: 'lamps', name: 'Petrolejka', sub: 'málo, ale draze', x: 800, era: 0, base: 1.3, demand: [35, 50, 40, 25] },
        { id: 'right', name: 'Nádraží', sub: 'export bez limitu', x: C.WORLD_W - 50, era: 2, base: 0.92, demand: [0, 0, 700, 900] },
        { id: 'garage', name: 'Benzinka', sub: 'málo, nejdráž', x: 972, era: 3, base: 1.4, demand: [0, 0, 0, 50] }
    ];
    const BUYER_IDS = BUYERS.map(b => b.id);

    // --- Mimořádné zprávy ---
    // Dobové (1880–1910) události na pár dní mění trh (násobí výkupní cenu, zavírají výkupce) nebo pravidla.
    // left = Rafinerie, right = Nádraží. Spouští se při přechodu dne; náhoda je odvozená ze seedu
    // a pořadí dne, takže v závodě mají všichni stejné zprávy ve stejný den.
    const NEWS = [
        { key: 'tariffs', title: 'Kongres uvalil cla na dovoz ropy', desc: 'Domácí ropa je žádanější: rafinerie přidává, export vázne.', days: 6, effects: { left: 1.35, right: 0.9 } },
        { key: 'hormuz', title: 'Válka na Balkáně: Evropa shání ropu', desc: 'Svět se bojí nedostatku: export letí vzhůru, ve městě to je znát míň.', days: 5, effects: { all: 1.2, right: 1.5 } },
        { key: 'opec_cut', title: 'Pensylvánské vrty vysychají', desc: 'Méně ropy na trhu, všichni kupci přidávají.', days: 8, effects: { all: 1.25 } },
        { key: 'opec_flood', title: 'Nový gejzír v Texasu zaplavil trh', desc: 'Cenová válka: kupci srážejí ceny.', days: 7, effects: { all: 0.7 } },
        { key: 'rail_strike', title: 'Stávka železničářů', desc: 'Nádraží nevykupuje, vozy jezdí jinam.', days: 3, effects: { rightClosed: true }, requires: 'right' },
        { key: 'refinery_fire', title: 'Požár v rafinerii Černé zlato', desc: 'Rafinerie stojí, ostatní kupci přidávají.', days: 3, effects: { leftClosed: true, lamps: 1.15, right: 1.15 } },
        { key: 'sanctions', title: 'Standard Oil skupuje vše na východě', desc: 'Trust platí za export po trati víc než kdy dřív.', days: 6, effects: { right: 1.4 }, requires: 'right' },
        { key: 'recession', title: 'Panika na burze: lidé šetří', desc: 'Poptávka padá u všech kupců.', days: 10, effects: { all: 0.8 } },
        { key: 'hurricane', title: 'Hurikán zavřel přístav v Galvestonu', desc: 'Konkurence z pobřeží stojí, ropa z pouště je zlatá.', days: 4, effects: { all: 1.3 } },
        { key: 'eco_law', title: 'Městská rada: pokuty za erupce dvojnásobné', desc: 'Radní mají dost ropy v ulicích.', days: 10, effects: { fineMult: 2 } },
        { key: 'tax_break', title: 'Guvernér odpustil daň z pozemků', desc: 'Těžaři mají prázdniny od daní.', days: 5, effects: { taxMult: 0 } },
        { key: 'driver_shortage', title: 'Vozkové odešli na zlatou horečku', desc: 'Chybí ruce na kozlíku, vozy jezdí pomaleji.', days: 5, effects: { truckSpeed: 0.7 }, maxEra: 1 },
        { key: 'driver_shortage_auto', title: 'Šoféři stávkují za vyšší mzdu', desc: 'Kamiony jezdí s poloviční posádkou, pomaleji.', days: 5, effects: { truckSpeed: 0.7 }, minEra: 2 },
        { key: 'cold_winter', title: 'Tuhá zima', desc: 'Lidé svítí a topí: petrolejka a rafinerie přidávají.', days: 6, effects: { lamps: 1.5, left: 1.15 } },
        { key: 'edison', title: 'Edison rozsvítil první ulici', desc: 'Elektřina vytlačuje lampy, petrolejka bere míň.', days: 8, effects: { lamps: 0.6 }, minEra: 2 },
        { key: 'ford_t', title: 'Ford spustil pásovou výrobu', desc: 'Aut přibývá, benzinka platí víc.', days: 8, effects: { garage: 1.5 }, requires: 'garage' }
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
            // Kupci ve městě (world.market[id]): price = cena podle zásoby a šumu, quote = po vlivu zpráv
            market: createMarket(players.length, shared),
            town: { era: 0, delivered: 0 },
            contracts: { offers: [], active: [], nextInDays: C.CONTRACT_FIRST_DAY, nextId: 0 },
            // Sdílená mapa: dražby claimů, nabídky ropy mezi hráči a kartel
            auctions: [],
            deals: { offers: [], nextId: 0 },
            cartel: null,
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
                revenueAtDayStart: 0,
                lastDayIncome: 0,
                strikeMs: 0,         // podplacená stávka: vozy stojí
                route: null,         // kupec, ke kterému mají jezdit všechny vozy (null = sám podle ceny)
                over: false,
                reason: null
            };
            world.playerOrder.push(p.id);
        });

        world.plots = createClaims(rand);

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
        updateQuotes(world);
        BUYER_IDS.forEach(id => { world.market[id].history = [world.market[id].quote]; });
        return world;
    }

    function createMarket(playerCount, shared) {
        const market = { order: BUYER_IDS.slice(), timer: 0, demandMult: shared ? 1 + C.SHARED_DEMAND_PER_PLAYER * Math.max(0, playerCount - 1) : 1 };
        BUYERS.forEach(b => {
            market[b.id] = {
                id: b.id, name: b.name, sub: b.sub, x: b.x, era: b.era, base: b.base,
                open: b.era === 0,   // kupec už ve městě je (éra)
                noise: 1,            // náhodná procházka kolem 1
                trend: 0,
                stock: b.demand[0] * market.demandMult, // zásoba na den: cena začíná na základní úrovni
                demand: b.demand[0] * market.demandMult,
                price: b.base, quote: b.base, mult: 1, closed: b.era !== 0, history: []
            };
        });
        return market;
    }

    // Claimy: pás mezi kupci rozdělený na 7–9 dílů různé šířky, každý s terénem.
    // Cena roste se šířkou (víc místa = víc ložisek pod ním) a s terénem.
    function createClaims(rand) {
        const count = C.CLAIM_MIN + Math.floor(rand() * C.CLAIM_RANGE);
        const weights = [];
        for (let i = 0; i < count; i++) weights.push(0.7 + rand() * 1.0);
        const sum = weights.reduce((a, b) => a + b, 0);
        const plots = [];
        let x = C.SIDE_MARGIN;
        for (let i = 0; i < count; i++) {
            const width = C.CLAIM_SPAN * weights[i] / sum;
            const r = rand();
            const terrain = r < 0.45 ? 'flat' : r < 0.65 ? 'hill' : r < 0.82 ? 'river' : 'rock';
            const base = (60 + rand() * 300) * (width / (C.CLAIM_SPAN / 8));
            plots.push({
                id: i,
                x, width,
                y: C.GROUND_LEVEL,
                terrain,
                rockDepth: terrain === 'rock' ? 70 + Math.floor(rand() * 50) : 0, // žulová čepice pod povrchem
                owner: null,
                hasVrt: false,
                siloCount: 0,
                spill: 0,
                price: Math.max(40, Math.min(650, Math.round(base * TERRAIN[terrain].priceMult)))
            });
            x += width;
        }
        return plots;
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
        // Plynová čepice: plyn se drží nad ropou, takže vrták k ložisku do ní často narazí.
        // Hlubší ložiska ji mají častěji. Kapsa leží těsně nad stropem ložiska, kousek vedle středu.
        pockets.forEach(p => {
            const depth = (p.y - C.GROUND_LEVEL) / (maxY - C.GROUND_LEVEL);
            if (rand() > 0.3 + 0.4 * depth) return;
            const r = 14 + rand() * 10;
            const x = p.x + p.width * (0.25 + rand() * 0.5);
            const y = p.y - r + 4;
            if (y - r < minY || hazards.some(h => Math.hypot(h.x - x, h.y - y) < h.r + r + 6)) return;
            hazards.push({ id: hazards.length, kind: 'gas', x, y, r, hit: false, revealedBy: [] });
        });
        const gas = 2 + Math.floor(rand() * 2);
        for (let i = 0; i < gas; i++) place('gas', 16 + rand() * 14, minY + (maxY - minY) * 0.35);
        // Zvodnělé vrstvy: širší kapsy v mělčí půlce, kudy vede většina vrtů
        const water = 4 + Math.floor(rand() * 3);
        for (let i = 0; i < water; i++) place('water', 26 + rand() * 18, minY);
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

    // Násobek ceny podle zásoby: prázdný sklad platí víc, přeplněný míň
    function stockFactor(stock, demand) {
        const days = stock / Math.max(1, demand * C.STOCK_DAYS);
        return Math.max(0.35, Math.min(1.4, 1.35 - 0.7 * days));
    }

    function buyerDef(id) {
        return BUYERS.find(b => b.id === id);
    }

    // Přepočte poptávku, ceny po vlivu zásoby, šumu a zpráv (price -> quote) a zavřené kupce
    function updateQuotes(world) {
        const m = world.market;
        const era = world.town ? world.town.era : 0;
        BUYER_IDS.forEach(id => {
            const b = m[id];
            b.open = era >= b.era;
            b.demand = buyerDef(id).demand[era] * (m.demandMult || 1);
            b.mult = newsEffect(world, id) * newsEffect(world, 'all');
            b.closed = !b.open || newsFlag(world, id + 'Closed');
            b.price = b.base * b.noise * stockFactor(b.stock, b.demand);
            b.quote = Math.max(0.1, Math.min(5, b.price * b.mult));
        });
    }

    // Cena, kterou by kupec dal při dané zásobě (odhad pro vozy, které teprve jedou)
    function quoteAtStock(buyer, stock) {
        return Math.max(0.1, Math.min(5, buyer.base * buyer.noise * stockFactor(stock, buyer.demand) * buyer.mult));
    }

    function openBuyers(world) {
        return world.market.order.map(id => world.market[id]).filter(b => !b.closed);
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
            const era = world.town ? world.town.era : 0;
            const pool = NEWS.filter(n => !news.active.some(a => a.key === n.key) && n.key !== news.lastKey &&
                (!n.requires || world.market[n.requires]?.open) && era >= (n.minEra || 0) && era <= (n.maxEra ?? 9));
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
        return plot ? plotCenterX(plot) : C.WORLD_W / 2;
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

    function plotAtX(world, x) {
        return world.plots.find(p => x >= p.x && x < p.x + p.width) || null;
    }

    function terrainOf(plot) {
        return TERRAIN[plot && plot.terrain] || TERRAIN.flat;
    }

    function plotCenterX(plot) {
        return plot.x + plot.width / 2;
    }

    function rockAt(world, x, y) {
        const strata = world.strata;
        if (!strata) return 'sand';
        // Skalnatý claim: žulová čepice hned pod povrchem
        const plot = plotAtX(world, x);
        if (plot && plot.terrain === 'rock' && y < C.GROUND_LEVEL + plot.rockDepth) return 'granite';
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
            case 'acceptContract': return acceptContract(world, player, action.id);
            case 'setRoute': return setRoute(world, player, action.buyer);
            case 'bid': return placeBid(world, player, action.plotId, action.amount);
            case 'offerDeal': return offerDeal(world, player, action.to, action.oil, action.price);
            case 'acceptDeal': return answerDeal(world, player, action.id, true);
            case 'declineDeal': return answerDeal(world, player, action.id, false);
            case 'proposeCartel': return proposeCartel(world, player, action.buyer, action.days);
            case 'joinCartel': return joinCartel(world, player);
            case 'sabotage': return sabotage(world, player, action.target);
            case 'drill': return addDrillPoint(world, player, action.plotId, action.x, action.y);
            case 'drillStop': return stopDrill(world, player, action.plotId);
            case 'bop': return closePreventer(world, player, action.plotId);
            case 'bit': return replaceBit(world, player, action.plotId);
            case 'cement': return cementWell(world, player, action.plotId);
            case 'inject': return toggleInjection(world, player, action.plotId);
            case 'pipeline': return buildLink(world, player, action.plotId, 'pipeline', action.buyer);
            case 'siding': return buildLink(world, player, action.plotId, 'siding', 'right');
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
        // Sdílená mapa: koupě je první příhoz v dražbě, ostatní mohou přihodit
        if (world.shared) {
            if (world.auctions.some(a => a.plotId === plot.id)) return placeBid(world, player, plot.id, plot.price);
            world.auctions.push({ plotId: plot.id, bidder: player.id, amount: plot.price, timer: C.AUCTION_MS });
            emit(world, { type: 'auction', playerId: player.id, plotId: plot.id, amount: plot.price, start: true });
            return { ok: true, auction: true };
        }
        player.money -= plot.price;
        plot.owner = player.id;
        emit(world, { type: 'plot_bought', playerId: player.id, plotId: plot.id, price: plot.price });
        return { ok: true };
    }

    function buildDerrick(world, player, plotId) {
        const plot = ownedPlot(world, player, plotId);
        if (!plot || plot.hasVrt) return fail('plot');
        const cost = Math.round(C.VRT_COST * terrainOf(plot).buildMult);
        if (player.money < cost) return fail('money');
        player.money -= cost;
        plot.hasVrt = true;
        emit(world, { type: 'derrick_built', playerId: player.id, plotId: plot.id });
        return { ok: true };
    }

    function buildSilo(world, player, plotId) {
        const plot = ownedPlot(world, player, plotId);
        if (!plot || !plot.hasVrt || plot.siloCount >= C.MAX_SILOS_PER_PLOT) return fail('plot');
        const cost = Math.round(C.SILO_COST * terrainOf(plot).buildMult);
        if (player.money < cost) return fail('money');
        player.money -= cost;
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

    // Zakázka z telegramu: kdo ji přijme první, ten ji má (sdílená mapa)
    function acceptContract(world, player, id) {
        const c = world.contracts;
        const offer = c.offers.find(o => o.id === id);
        if (!offer) return fail('contract');
        if (c.active.filter(a => a.owner === player.id).length >= C.MAX_ACTIVE_CONTRACTS) return fail('limit');
        c.offers = c.offers.filter(o => o !== offer);
        const contract = { id: offer.id, buyer: offer.buyer, amount: offer.amount, price: offer.price, daysLeft: offer.days, delivered: 0, owner: player.id };
        c.active.push(contract);
        emit(world, { type: 'contract_taken', playerId: player.id, id: offer.id, buyer: offer.buyer, amount: offer.amount, price: offer.price, days: offer.days });
        return { ok: true };
    }

    // Vozy jezdí k vybranému kupci (razítko na ceníku); null = samy k nejlepší ceně
    function setRoute(world, player, buyer) {
        if (buyer != null && !world.market[buyer]) return fail('buyer');
        player.route = buyer ?? null;
        emit(world, { type: 'route', playerId: player.id, buyer: player.route });
        return { ok: true };
    }

    // --- Odbyt vrtu: ropovod nebo vlečka ---
    function linkCost(world, plot, kind, buyerId) {
        if (kind === 'siding') return C.SIDING_COST;
        const buyer = world.market[buyerId];
        return buyer ? Math.ceil(Math.abs(buyer.x - plotCenterX(plot)) * C.PIPELINE_COST_PER_PX) : Infinity;
    }

    function buildLink(world, player, plotId, kind, buyerId) {
        const plot = ownedPlot(world, player, plotId);
        const network = plot && getNetworkForPlot(world, plot.id);
        if (!network || network.link) return fail('plot');
        const era = world.town?.era || 0;
        const buyer = world.market[buyerId];
        if (!buyer || !buyer.open) return fail('buyer');
        if (era < (kind === 'siding' ? C.SIDING_ERA : C.PIPELINE_ERA)) return fail('era');
        if (kind !== 'siding' && kind !== 'pipeline') return fail('kind');
        const cost = linkCost(world, plot, kind, buyerId);
        if (player.money < cost) return fail('money');
        player.money -= cost;
        network.link = { kind, buyer: buyerId, rate: kind === 'siding' ? C.SIDING_RATE : C.PIPELINE_RATE, sold: 0, money: 0 };
        emit(world, { type: 'link_built', playerId: player.id, plotId: plot.id, kind, buyer: buyerId, name: buyer.name, cost });
        return { ok: true };
    }

    // Ropa teče ze zásobníku rovnou kupci; prodej se hlásí po dávkách, ať nelétá částice každý snímek
    function stepLinks(world, dt) {
        let sold = false;
        world.pipeNetworks.forEach(network => {
            const link = network.link;
            if (!link || network.oilStored <= 0) return;
            const buyer = world.market[link.buyer];
            const player = world.players[network.owner];
            if (!buyer || buyer.closed || !player || player.over) return;
            // Zásoba na den a víc: ropovod stojí, ať nesráží cenu pod základ (vozy mohou jinam)
            if (buyer.stock >= buyer.demand * C.LINK_STOCK_DAYS) return;
            const oil = Math.min(link.rate * dt / 1000, network.oilStored);
            network.oilStored -= oil;
            const contract = applyContract(world, network.owner, buyer.id, oil);
            const sale = contract.paid + (oil - contract.part) * buyer.quote * C.LINK_PRICE_BONUS;
            player.money += sale;
            player.revenue += sale;
            player.sold += oil;
            buyer.stock += oil;
            growTown(world, oil);
            checkCartelBreach(world, network.owner, buyer.id);
            link.sold += oil;
            link.money += sale;
            if (link.sold >= C.LINK_SALE_BATCH) {
                emit(world, { type: 'sale', playerId: network.owner, amount: Math.round(link.money), x: buyer.x, company: buyer.id, link: link.kind });
                link.sold = 0;
                link.money = 0;
            }
            sold = true;
        });
        if (sold) updateQuotes(world);
    }

    // --- Sdílená mapa: dražby, obchod, kartel, sabotáž ---
    function placeBid(world, player, plotId, amount) {
        const auction = world.auctions.find(a => a.plotId === plotId);
        if (!auction) return fail('auction');
        amount = Math.round(Number(amount));
        if (!Number.isFinite(amount) || amount < auction.amount + C.AUCTION_MIN_RAISE) return fail('low');
        if (auction.bidder === player.id) return fail('own');
        if (player.money < amount) return fail('money');
        auction.bidder = player.id;
        auction.amount = amount;
        auction.timer = C.AUCTION_MS;
        emit(world, { type: 'auction', playerId: player.id, plotId, amount });
        return { ok: true };
    }

    function stepAuctions(world, dt) {
        if (!world.auctions?.length) return;
        world.auctions.forEach(a => { a.timer -= dt; });
        world.auctions.filter(a => a.timer <= 0).forEach(a => {
            const plot = getPlot(world, a.plotId);
            const winner = world.players[a.bidder];
            if (plot && !plot.owner && winner && !winner.over && winner.money >= a.amount) {
                winner.money -= a.amount;
                plot.owner = winner.id;
                emit(world, { type: 'plot_bought', playerId: winner.id, plotId: plot.id, price: a.amount, auction: true });
            } else {
                emit(world, { type: 'auction_failed', playerId: a.bidder, plotId: a.plotId });
            }
        });
        world.auctions = world.auctions.filter(a => a.timer > 0);
    }

    function storedOil(world, playerId) {
        return world.pipeNetworks.filter(n => n.owner === playerId).reduce((s, n) => s + n.oilStored, 0);
    }

    // Nabídka ropy jinému hráči: tolik barelů ze zásobníků za pevnou cenu za barel
    function offerDeal(world, player, to, oil, price) {
        const target = world.players[to];
        if (!world.shared || !target || target.id === player.id || target.over) return fail('player');
        oil = Math.round(Number(oil));
        price = Math.round(Number(price) * 100) / 100;
        if (!(oil >= 25) || !(price > 0) || price > 10) return fail('terms');
        if (storedOil(world, player.id) < oil) return fail('oil');
        if (world.deals.offers.some(d => d.from === player.id && d.to === to)) return fail('pending');
        const deal = { id: world.deals.nextId++, from: player.id, to, oil, price, expiresIn: C.DEAL_DAYS };
        world.deals.offers.push(deal);
        emit(world, { type: 'deal_offer', ...deal, playerId: to });
        return { ok: true };
    }

    // Příjemce přijme: ropa se přelije ze zásobníků prodávajícího do zásobníků kupujícího
    function answerDeal(world, player, id, accept) {
        const deal = world.deals.offers.find(d => d.id === id);
        if (!deal || deal.to !== player.id) return fail('deal');
        world.deals.offers = world.deals.offers.filter(d => d !== deal);
        const seller = world.players[deal.from];
        if (!accept || !seller || seller.over) {
            emit(world, { type: 'deal_declined', id, playerId: deal.from, to: player.id });
            return { ok: true };
        }
        const room = world.pipeNetworks.filter(n => n.owner === player.id).reduce((s, n) => s + Math.max(0, n.oilCapacity - n.oilStored), 0);
        const oil = Math.min(deal.oil, storedOil(world, deal.from), room);
        const cost = oil * deal.price;
        if (oil < 1 || player.money < cost) {
            emit(world, { type: 'deal_failed', id, playerId: player.id, from: deal.from, reason: oil < 1 ? 'room' : 'money' });
            return fail(oil < 1 ? 'room' : 'money');
        }
        moveOil(world, deal.from, player.id, oil);
        player.money -= cost;
        seller.money += cost;
        seller.revenue += cost;
        emit(world, { type: 'deal_done', id, playerId: player.id, from: deal.from, oil, price: deal.price, amount: Math.round(cost) });
        return { ok: true };
    }

    function moveOil(world, fromId, toId, oil) {
        let left = oil;
        world.pipeNetworks.filter(n => n.owner === fromId).forEach(n => {
            const take = Math.min(left, n.oilStored);
            n.oilStored -= take;
            left -= take;
        });
        left = oil;
        world.pipeNetworks.filter(n => n.owner === toId).forEach(n => {
            const put = Math.min(left, Math.max(0, n.oilCapacity - n.oilStored));
            n.oilStored += put;
            left -= put;
        });
    }

    // Kartel: dohoda nevozit ropu danému kupci, aby mu vyschl sklad a cena vyletěla.
    // Nic nevynucuje; kdo tam přesto doveze, kartel rozbije a všichni se to dozví.
    function proposeCartel(world, player, buyer, days) {
        if (!world.shared || world.cartel) return fail('cartel');
        if (!world.market[buyer] || !world.market[buyer].open) return fail('buyer');
        days = Math.max(2, Math.min(C.CARTEL_MAX_DAYS, Math.round(Number(days)) || 5));
        const others = world.playerOrder.filter(id => id !== player.id && !world.players[id].over);
        if (!others.length) return fail('alone');
        world.cartel = { buyer, by: player.id, days, members: [player.id], pending: others, active: false, daysLeft: C.CARTEL_PROPOSAL_DAYS };
        emit(world, { type: 'cartel_proposal', playerId: player.id, buyer, days, name: world.market[buyer].name });
        return { ok: true };
    }

    function joinCartel(world, player) {
        const c = world.cartel;
        if (!c || c.active || !c.pending.includes(player.id)) return fail('cartel');
        c.pending = c.pending.filter(id => id !== player.id);
        c.members.push(player.id);
        emit(world, { type: 'cartel_join', playerId: player.id, buyer: c.buyer });
        if (!c.pending.length) {
            c.active = true;
            c.daysLeft = c.days;
            emit(world, { type: 'cartel_on', buyer: c.buyer, days: c.days, name: world.market[c.buyer].name });
        }
        return { ok: true };
    }

    function stepCartel(world) {
        const c = world.cartel;
        if (!c) return;
        c.daysLeft--;
        if (c.daysLeft > 0) return;
        emit(world, { type: c.active ? 'cartel_end' : 'cartel_expired', buyer: c.buyer, name: world.market[c.buyer].name });
        world.cartel = null;
    }

    // Prodej členem kartelu u kartelového kupce = zrada
    function checkCartelBreach(world, playerId, buyerId) {
        const c = world.cartel;
        if (!c || !c.active || c.buyer !== buyerId || !c.members.includes(playerId)) return;
        world.cartel = null;
        emit(world, { type: 'cartel_broken', playerId, buyer: buyerId, name: world.market[buyerId].name });
    }

    // Podplacená stávka: vozy soupeře na čas stojí; občas se provalí, kdo platil
    function sabotage(world, player, targetId) {
        const target = world.players[targetId];
        if (!world.shared || !target || target.id === player.id || target.over) return fail('player');
        if (target.strikeMs > 0) return fail('busy');
        if (player.money < C.STRIKE_COST) return fail('money');
        player.money -= C.STRIKE_COST;
        target.strikeMs = C.STRIKE_MS;
        const rnd = world._market || Math.random;
        const traced = rnd() < C.STRIKE_TRACE_CHANCE;
        emit(world, { type: 'sabotage', playerId: target.id, by: traced ? player.id : null, ms: C.STRIKE_MS });
        return { ok: true };
    }

    function stepStrikes(world, dt) {
        world.playerOrder.forEach(id => {
            const p = world.players[id];
            if (p.strikeMs > 0) {
                p.strikeMs = Math.max(0, p.strikeMs - dt);
                if (p.strikeMs === 0) emit(world, { type: 'sabotage_over', playerId: id });
            }
        });
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
            : { x: plotCenterX(plot), y: C.GROUND_LEVEL };
        // Vrták neumí stoupat strmě vzhůru
        if (lastPoint.y - y > Math.abs(x - lastPoint.x) * C.DRILL_MAX_RISE) return fail('angle');
        if (Math.hypot(x - lastPoint.x, y - lastPoint.y) < 4) return fail('point');
        if (!network) {
            network = {
                id: world.nextNetworkId++,
                derrickId: plot.id,
                owner: player.id,
                path: [{ x: plotCenterX(plot), y: C.GROUND_LEVEL }],
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
        const cx = Math.max(plot.x + 10, Math.min(plot.x + plot.width - 10, Number(x) || plotCenterX(plot)));
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
        stepAuctions(world, dt);
        stepStrikes(world, dt);
        stepCalendar(world, dt);
        if (world._market) stepMarket(world, dt);
        stepBuyers(world, dt);
        stepDrilling(world, dt);
        stepReservoir(world, dt);
        stepPumping(world, dt);
        stepLinks(world, dt);
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
        stepContracts(world);
        stepCartel(world);
        if (world.deals) {
            world.deals.offers.forEach(d => { d.expiresIn--; });
            world.deals.offers = world.deals.offers.filter(d => d.expiresIn > 0);
        }
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
            world.auctions = (world.auctions || []).filter(a => a.bidder !== player.id);
            if (world.deals) world.deals.offers = world.deals.offers.filter(d => d.from !== player.id && d.to !== player.id);
            if (world.cartel) world.cartel.pending = world.cartel.pending.filter(id => id !== player.id);
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

    // Šum cen: každých PRICE_UPDATE_INTERVAL se pohne náhodná procházka a zapíše historie
    function stepMarket(world, dt) {
        const m = world.market;
        m.timer += dt;
        if (m.timer <= C.PRICE_UPDATE_INTERVAL) return;
        m.timer = 0;
        const rnd = world._market;
        BUYER_IDS.forEach(id => {
            const b = m[id];
            b.noise = Math.max(0.75, Math.min(1.3, b.noise + (rnd() - 0.5 + b.trend * 0.15) * 0.06));
            b.trend = Math.max(-1, Math.min(1, b.trend + (rnd() - 0.5) * 0.4));
        });
        updateQuotes(world);
        BUYER_IDS.forEach(id => {
            const b = m[id];
            b.history.push(b.quote);
            if (b.history.length > C.PRICE_HISTORY_LEN) b.history.shift();
        });
    }

    // Město spotřebovává zásoby kupců podle poptávky (běží i u klienta na sdílené mapě)
    function stepBuyers(world, dt) {
        const m = world.market;
        BUYER_IDS.forEach(id => {
            const b = m[id];
            if (b.open) b.stock = Math.max(0, b.stock - b.demand * dt / C.MS_PER_DAY);
        });
        updateQuotes(world);
    }

    // Mapa má jen 8 pozemků, takže víc hráčů těží dohromady jen o málo víc: prahy rostou mírně
    function eraThreshold(world, era) {
        const players = world.shared ? world.playerOrder.length : 1;
        return ERAS[era].delivered * (1 + 0.15 * Math.max(0, players - 1));
    }

    // Ropa dodaná do města posouvá éru
    function growTown(world, oil) {
        const town = world.town;
        town.delivered += oil;
        while (town.era < ERAS.length - 1 && town.delivered >= eraThreshold(world, town.era + 1)) {
            town.era++;
            const era = ERAS[town.era];
            updateQuotes(world);
            // Nový kupec začíná s prázdným skladem: první dodávky se vyplatí
            BUYER_IDS.forEach(id => {
                const b = world.market[id];
                if (b.era === town.era) {
                    b.stock = 0;
                    b.history = [b.quote];
                }
            });
            emit(world, { type: 'era', era: town.era, key: era.key, name: era.name, desc: era.desc });
        }
    }

    // --- Zakázky ---
    // Každých pár dní pošle některý kupec telegram: dodej X barelů do N dní za pevnou cenu.
    // Náhoda je ze seedu a dne (jako zprávy), takže v závodě mají všichni stejné nabídky.
    function contractRandom(world) {
        if (world.seed == null) return Math.random;
        return seededRandom((world.seed ^ Math.imul(world.time.dayIndex + 7, 0x85EBCA77) ^ 0xC0FFEE) >>> 0);
    }

    function stepContracts(world) {
        const c = world.contracts;
        if (!c) return;
        c.offers.forEach(o => { o.expiresIn--; });
        c.offers = c.offers.filter(o => o.expiresIn > 0);
        c.active.forEach(contract => {
            contract.daysLeft--;
            if (contract.daysLeft > 0) return;
            const player = world.players[contract.owner];
            const missing = contract.amount - contract.delivered;
            const penalty = Math.round(missing * contract.price * C.CONTRACT_PENALTY);
            if (player && !player.over) {
                player.money -= penalty;
                if (player.money < 0) endPlayer(world, player, 'bankrupt');
            }
            emit(world, { type: 'contract_failed', playerId: contract.owner, id: contract.id, buyer: contract.buyer, penalty });
        });
        c.active = c.active.filter(contract => contract.daysLeft > 0);
        c.nextInDays--;
        if (c.nextInDays > 0 || c.offers.length >= C.MAX_CONTRACT_OFFERS) return;
        const rand = contractRandom(world);
        const buyers = openBuyers(world);
        c.nextInDays = C.CONTRACT_GAP_MIN + Math.floor(rand() * C.CONTRACT_GAP_RANGE);
        if (!buyers.length) return;
        const buyer = buyers[Math.floor(rand() * buyers.length)];
        const days = 6 + Math.floor(rand() * 5);
        const offer = {
            id: c.nextId++,
            buyer: buyer.id,
            amount: Math.max(100, Math.round(buyer.demand * (2.5 + rand() * 2.5) / 50) * 50),
            price: Math.round(buyer.base * (1.3 + rand() * 0.25) * 100) / 100,
            days,
            expiresIn: C.CONTRACT_OFFER_DAYS
        };
        c.offers.push(offer);
        emit(world, { type: 'contract_offer', ...offer, name: buyer.name });
    }

    // Část dodávky, která plní zakázku hráče u tohoto kupce: { paid, contract }
    function applyContract(world, playerId, buyerId, oil) {
        const contract = world.contracts?.active.find(a => a.owner === playerId && a.buyer === buyerId);
        if (!contract) return { paid: 0, part: 0 };
        const part = Math.min(oil, contract.amount - contract.delivered);
        contract.delivered += part;
        if (contract.delivered >= contract.amount - 0.01) {
            world.contracts.active = world.contracts.active.filter(a => a !== contract);
            emit(world, { type: 'contract_done', playerId, id: contract.id, buyer: buyerId, amount: contract.amount });
        }
        return { paid: part * contract.price, part };
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
            const cost = C.INJECT_COST_PER_S * terrainOf(getPlot(world, network.derrickId)).injectMult * s;
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

    // Kupec pro vůz: nejvyšší očekávaná cena po započtení ropy, kterou k němu už vezou jiné vozy
    // (plný sklad = nižší cena), mínus kus za vzdálenost. Rozjednaná zakázka vlastníka má přednost.
    function chooseCompanyFor(world, truck) {
        const owner = world.players[truck.owner];
        const forced = owner && owner.route ? world.market[owner.route] : null;
        if (forced && !forced.closed) return forced.id;
        const load = truck.oil || C.TRUCK_CAPACITY;
        let best = null, bestScore = -Infinity;
        openBuyers(world).forEach(buyer => {
            const incoming = world.trucks.reduce((sum, t) => sum +
                (t !== truck && t.state === 'to_company' && t.targetCompany === buyer.id ? t.oil : 0), 0);
            let price = quoteAtStock(buyer, buyer.stock + incoming + load / 2);
            const contract = world.contracts?.active.find(a => a.owner === truck.owner && a.buyer === buyer.id);
            if (contract) price = Math.max(price, contract.price) + 0.4;
            // Vzdálenost váží málo: vozů bývá dost, rozhoduje cena za barel
            const score = price - Math.abs(buyer.x - truck.x) * 0.00008;
            if (score > bestScore) {
                bestScore = score;
                best = buyer;
            }
        });
        return best ? best.id : null;
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
        truck.targetCompany = null;
        truck.state = 'to_rig';
        // Vjezd z bližšího okraje mapy; když tam už jiné auto je, postaví se za něj
        const edgeDir = getNetworkPickupX(world, network) < C.WORLD_W / 2 ? -1 : 1;
        const minGap = C.TRUCK_LENGTH + C.TRUCK_GAP_PAD;
        let spawnX = edgeDir < 0 ? -50 : C.WORLD_W + 50;
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
        const player = world.players[truck.owner];
        const contract = applyContract(world, truck.owner, buyer.id, truck.oil);
        const sale = contract.paid + (truck.oil - contract.part) * buyer.quote;
        if (player) {
            player.money += sale;
            player.revenue += sale;
            player.sold += truck.oil;
        }
        emit(world, { type: 'sale', playerId: truck.owner, amount: Math.round(sale), x: targetX, company: buyer.id });
        checkCartelBreach(world, truck.owner, buyer.id);
        // Sklad kupce roste, cena klesá (na sdílené mapě si tak hráči konkurují)
        buyer.stock += truck.oil;
        growTown(world, truck.oil);
        updateQuotes(world);
        truck.oil = 0;
    }

    // Do éry železnice jezdí koňské povozy, pak kamiony
    function truckSpeed(world) {
        const wagons = (world.town?.era || 0) < 2;
        return C.TRUCK_SPEED * (wagons ? C.WAGON_SPEED_MULT : 1) * newsEffect(world, 'truckSpeed');
    }

    function stepTrucks(world, dt) {
        const speed = truckSpeed(world) * (dt / 1000);
        world.trucks.filter(t => t.state === 'idle').forEach(truck => dispatchIdleTruck(world, truck));

        world.trucks.forEach(truck => {
            if (truck.state === 'idle') return;
            if ((world.players[truck.owner]?.strikeMs || 0) > 0) return; // stávka: vůz stojí, kde je
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
                    // Kupec zavřel cestou (nebo ještě nebyl vybrán): vybrat jiného, když nikdo nebere, počkat
                    if (!truck.targetCompany || world.market[truck.targetCompany].closed) {
                        truck.targetCompany = chooseCompanyFor(world, truck);
                        if (!truck.targetCompany) break;
                    }
                    const targetX = world.market[truck.targetCompany].x;
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
        C, RULES, PLAYER_COLORS, NEWS, ROCKS, ERAS, BUYERS, BUYER_IDS, TERRAIN,
        seededRandom, createWorld, act, step, serialize,
        getRules, getLandTax, getBlowoutFine, newsEffect, getPlot, getNetworkForPlot, getNetworkPickupX, canVentRig, getPocketRichness,
        isPointInPolygon, isSegmentIntersectingPolygon, distanceToPocket, endPlayer, endAll,
        eraThreshold, truckSpeed, quoteAtStock, storedOil, linkCost, plotAtX, terrainOf, plotCenterX, strataBoundaryY, rockAt, pocketDrive, waterCutOf, wellRate, pathLength, pointAlong, drillHead
    };
});
