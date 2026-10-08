// Jádro klienta: konstanty, zrcadlo světa (syncFromWorld), akce (doAction), události světa, předvolby, start.
// Součást hry Oil digga: klasický skript sdílející globální rozsah s ostatními soubory v js/.
// Pořadí načítání určuje index.html; tento soubor předpokládá sim.js a net.js před sebou.

console.log("script.js: Skript se spustil.");

// Anti-cache: index.html nastaví window.ASSET_VERSION při každém načtení a přidá ji ke všem souborům
// (?v=...), aby Discord ani prohlížeč nedržely starou verzi hry.
function assetUrl(path) {
    return window.ASSET_VERSION ? `${path}?v=${window.ASSET_VERSION}` : path;
}

// Discord, lobby a závod řeší net.js (načítá se před tímto souborem)

// --- Globální proměnné a konstanty ---
// Závod: net.js nastaví { raceId } a restartGame(seed); rychlost je pak zamčená na 1× a pauza vypnutá,
// aby všichni hráli stejnou mapu se stejným vývojem cen ve stejném čase
let raceMode = null;

// Herní logika je v sim.js (OilSim): svět, akce hráčů a krok času. Tady je kreslení, ovládání a zvuk.
// Globální proměnné níž (money, plots, trucks...) jsou jen zrcadlo světa pro kreslení a HUD,
// plní je syncFromWorld(). Měnit stav jde jen přes doAction().
const {
    VRT_COST, SILO_COST, TRUCK_COST, TRUCK_CAPACITY, DRILL_SPEED, DRILL_COST_PER_PX, DRILL_MAX_RISE,
    BIT_COST, KICK_MS, CEMENT_COST, INJECT_COST_PER_S,
    MAX_SILOS_PER_PLOT, MAX_TRUCKS, MS_PER_DAY, SURVIVAL_TAX_STEP, TRUCK_LENGTH, TRUCK_GAP_PAD,
    VENT_MIN, PRESSURE_WARN, SEISMIC_COST, DRONE_COST, RADAR_COST, SEISMIC_RADIUS, SEISMIC_WAVE_MS,
    RADAR_RADIUS, RADAR_PULSE_MS, DRONE_BEAM_HALF, ECHO_MS
} = OilSim.C;
const SOLO_RULES = OilSim.RULES.solo;
const RACE_RULES = OilSim.RULES.race;
const ECHO_FADE_MS = 1500;
const DRONE_Y_OFFSET = 205;   // výška letu dronu nad přední hranou desky (jen kresba)

let world = null;        // aktuální svět; na sdílené mapě kopie ze serveru, mezi zprávami se dopočítává
let myId = 'player';     // za kterého hráče se hraje (sólo 'player', v síti id hráče)
let sharedMode = false;  // sdílená mapa: akce jdou na server (net.js), svět chodí ze serveru
const GROUND_RATIO = 0.44;        // povrch (přední hrana desky) ve 44 % výšky plátna
const POCKET_BOTTOM_MARGIN = 125; // spodní pás plátna zakrývá panel nástrojů

function getGroundLevel() {
    return Math.floor(VIEW_H * GROUND_RATIO);
}

// Logický svět je vždy 1600×900; plátno má tolik pixelů, kolik má na obrazovce (ostrost na retině),
// a základní transformace viewScale převádí logické souřadnice na pixely plátna
const VIEW_W = 1600;
const VIEW_H = 900;
let viewScale = 1;
let canvas = null;
let ctx = null;
let lastTime = 0;
// Pravidla (sólo / závod) a daň bere sim.js podle světa
function getRules() {
    return world ? OilSim.getRules(world) : SOLO_RULES;
}

function getLandTax() {
    return world ? OilSim.getLandTax(world) : SOLO_RULES.landTax;
}

let money = SOLO_RULES.startMoney;
let isGameOver = false;
let gameOverReason = '';
let isPaused = false;
let gameSpeed = 1;
let totalRevenue = 0;
let totalOilSold = 0;

// Herní svět
let oilPockets = [];
let plots = [];
let pipeNetworks = [];
let hazards = [];         // zrcadlo world.hazards (plyn, voda)
let auctions = [];        // zrcadlo world.auctions (sdílená mapa)
let myRoute = null;       // zrcadlo players[myId].route: kupec, ke kterému jezdí mé vozy
let buyerControls = {};   // hitboxy razítek Vozit sem na cenících (přepočítává kreslení)
let buyerHover = false;
let trucks = [];
let lastBoughtHighlightTimer = 0;
let lastBoughtPlotId = null;

// Konstanty hry
const MAX_FRAME_MS = 100; // Strop reálného času jednoho snímku (po návratu na kartu apod.)
const CONTROL_HIT_PAD = 8; // Zvětšení klikací plochy šipek na plátně
const DEV = false;

// Stav UI a ovládání
let mousePos = { x: 0, y: 0 };
let currentBuildMode = null; // 'vrt', 'silo', 'seismic', 'radar'
let selectedDerrickPlotId = null; // Pro pokládání potrubí

// Vozy a město (kupci se čtou přímo z world.market)
let trucksOwned = 0;
let plotBlinkTimers = {};
let townEra = 0;          // zrcadlo world.town.era

// HUD: deník událostí a zisk za poslední den (jen pro zobrazení)
const EVENT_LOG_LEN = 4;
let eventLog = [];
let lastDayIncome = 0;

// Částice (kouř z aut, "+$" při prodeji) a zvuk
const MAX_PARTICLES = 450; // gejzír při erupci jich potřebuje hodně
let particles = [];
// Předvolby hráče: patří jen tomuto prohlížeči, svět hry nikdy nemění
const PREFS_KEY = 'oilDiggaPrefs';
const DEFAULT_PREFS = { sound: true, volume: 0.5, shake: true, life: true, newsFlash: true, ads: true, guide: true, focus: true };
const PREF_FIELDS = [
    { key: 'sound', label: 'Zvuk', options: [[true, 'Zapnutý'], [false, 'Vypnutý', 'klávesa M']] },
    { key: 'volume', label: 'Hlasitost', options: [[0.25, 'Tichá'], [0.5, 'Střední'], [0.85, 'Hlasitá']] },
    { key: 'shake', label: 'Otřesy', options: [[true, 'Ano', 'erupce a výbuchy třesou obrazem'], [false, 'Ne']] },
    { key: 'life', label: 'Život', options: [[true, 'Plný', 'chodci, provoz, letadla, ohňostroje'], [false, 'Úsporný', 'klidné město, méně kouře, šetří výkon']] },
    { key: 'focus', label: 'Kamera', options: [[true, 'Najede na vrt', 'při přetlaku, kopanci a erupci, po chvíli se vrátí'], [false, 'Zůstane']] },
    { key: 'guide', label: 'Průvodce', options: [[true, 'Ano', 'rady krok za krokem v nové sólo hře'], [false, 'Ne']] },
    { key: 'newsFlash', label: 'Noviny', options: [[true, 'Zvláštní vydání', 'přes obrazovku'], [false, 'Telegramem', 'krátce v rohu']] },
    { key: 'ads', label: 'Reklamy', options: [[true, 'Zobrazovat'], [false, 'Skrýt']], visible: () => adsAvailable() }
];
let prefs = loadPrefs();
let audioCtx = null;

// Herní čas
let day = 1;
let month = 1;
const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthNames = ["", "LED", "ÚNO", "BŘE", "DUB", "KVĚ", "ČER", "ČVC", "SRP", "ZÁŘ", "ŘÍJ", "LIS", "PRO"];
const MONTH_FULL_NAMES = ["", "leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];

// Hra nemá obrázky na plátně (vše je vektorové), ikony v HUD se načítají přes index.html
function loadImages() {
    initializeGame();
}


// --- Inicializace hry ---
let isGameStarted = false;

function initializeGame() {
    console.log("initializeGame: Spouštění hlavní inicializace...");
    const gameCanvasContainer = document.getElementById('game-canvas-container');
    if (!gameCanvasContainer) {
        console.error("Kontejner pro herní plátno nebyl nalezen!");
        return;
    }

    canvas = document.createElement('canvas');
    canvas.id = 'turmoil-game';
    gameCanvasContainer.innerHTML = ''; // Vyčistí "Načítání..."
    gameCanvasContainer.appendChild(canvas);

    // Ujisti se, že canvas vždy odkazuje na DOM element
    canvas = document.getElementById('turmoil-game');

    ctx = canvas.getContext('2d');
    resizeCanvasBacking();
    window.addEventListener('resize', resizeCanvasBacking);
    if (window.ResizeObserver) new ResizeObserver(resizeCanvasBacking).observe(gameCanvasContainer);

    // Plátno font Rye samo nenačte (není v DOM), proto ho vyžádáme
    // Plátno písma samo nenačte (nejsou v DOM), proto je vyžádáme
    if (document.fonts) {
        ['18px "Rye"', '600 12px "Barlow Condensed"', '700 12px "Barlow Condensed"', '800 12px "Barlow Condensed"', '700 12px "Courier Prime"']
            .forEach(font => document.fonts.load(font).catch(() => { }));
    }

    // Svět (sólo, náhodný); závod a sdílená mapa ho nahradí přes restartGame / net.js
    world = OilSim.createWorld({ players: [{ id: myId, name: 'Ty' }] });
    syncFromWorld();

    // Připojení posluchačů událostí
    addEventListeners();

    // Kreslicí smyčka běží hned (hover, kurzor, blikání), herní čas teče až po koupi pozemku
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    console.log("Hra čeká na koupi pozemku.");
}

// Herní čas začne běžet (sólo po koupi prvního pozemku, závod po odpočtu)
function startGameLoop() {
    if (world && !world.time.started) {
        world.time.started = true;
        syncFromWorld();
        updateUI(); // Aktualizace kalendáře a UI hned po startu hry
    }
}

// Vrátí všechen herní stav do výchozího a vygeneruje nový svět.
// seed = závod (stejná mapa i ceny pro všechny); raceMode nastavuje net.js předem.
function restartGame(seed = null) {
    if (!canvas) return;
    sharedMode = false;
    const race = raceMode ? { months: raceMode.months, mode: raceMode.mode, target: raceMode.target } : null;
    world = OilSim.createWorld({ seed, race, players: [{ id: myId, name: 'Ty' }] });
    resetLocalUi();
    syncFromWorld();
    updateUI();
}

// Stav, který patří jen tomuto klientovi (výběry, časovače, částice, deník)
function resetLocalUi() {
    isPaused = false;
    gameSpeed = 1;
    lastBoughtHighlightTimer = 0;
    lastBoughtPlotId = null;
    currentBuildMode = null;
    selectedDerrickPlotId = null;
    plotBlinkTimers = {};
    particles = [];
    pocketShapes.clear();
    eventLog = [];
    renderEventLog();
    document.getElementById('hud-toasts').innerHTML = '';
    document.getElementById('news-flash')?.classList.add('hidden');
    toggleSurveyMap(false);
    if (typeof togglePerks === 'function') togglePerks(false);
    resetGuide();
}

// Zrcadlí svět do globálních proměnných, které čte kreslení a HUD
function syncFromWorld() {
    if (!world) return;
    const me = world.players[myId] || world.players[world.playerOrder[0]];
    plots = world.plots;
    oilPockets = world.oilPockets;
    pipeNetworks = world.pipeNetworks;
    trucks = world.trucks;
    money = me.money;
    totalRevenue = me.revenue;
    totalOilSold = me.sold;
    trucksOwned = me.trucksOwned;
    lastDayIncome = me.lastDayIncome;
    isGameOver = me.over;
    gameOverReason = me.reason || '';
    townEra = world.town ? world.town.era : 0;
    auctions = world.auctions || [];
    myRoute = me.route || null;
    day = world.time.day;
    month = world.time.month;
    isGameStarted = world.time.started;
    toolClock = world.tools.clock;
    seismicWaves = world.tools.waves;
    radarPulses = world.tools.pulses;
    drones = world.tools.drones;
    // Pohled tohoto hráče: odhalení georadarem a ozvěny jsou soukromé
    oilPockets.forEach(pocket => {
        pocket.tapped = pocket.tappedBy.length > 0;
        pocket.revealed = pocket.revealedBy.includes(myId);
        pocket.echoUntil = pocket.echo[myId] || 0;
    });
    pipeNetworks.forEach(network => {
        network.connectedPocket = oilPockets[network.pocket] || null;
    });
    // Rizika v hornině: vidí je, kdo je navrtal (všichni) nebo odhalil georadarem
    hazards = world.hazards || [];
    hazards.forEach(h => { h.visible = !h.hidden && (h.hit || h.revealedBy.includes(myId)); });
}

function isMine(thing) {
    return !!thing && thing.owner === myId;
}

function playerName(id) {
    return world?.players[id]?.name || 'Hráč';
}

function playerColor(id) {
    return world?.players[id]?.color || '#ffb45a';
}

// Jediná cesta ke změně stavu: lokálně hned přes sim.js, na sdílené mapě po síti na server
function doAction(action) {
    if (!world) return { ok: false };
    uiDirty = true;
    if (sharedMode) {
        // Sdílená mapa: akce jde na server a zároveň se hned provede v místní kopii, ať reaguje bez
        // čekání na snapshot; místní události se zahodí (přijdou ze serveru), snapshot stav opraví
        if (typeof Net !== 'undefined') Net.sendAction(action);
        const local = OilSim.act(world, myId, action);
        world.events.splice(0);
        syncFromWorld();
        updateUI();
        return { ...local, pending: true };
    }
    const result = OilSim.act(world, myId, action);
    // Sólo: herní čas se rozběhne první koupí pozemku
    if (result.ok && action.type === 'buyPlot' && !raceMode) startGameLoop();
    handleWorldEvents(world.events.splice(0));
    syncFromWorld();
    updateUI();
    return result;
}

// Sdílená mapa: svět přišel ze serveru (začátek hry nebo návrat po výpadku spojení)
function startSharedWorld(snapshot, playerId) {
    if (!canvas) return;
    myId = playerId;
    sharedMode = true;
    world = snapshot;
    world.events = [];
    resetLocalUi();
    syncFromWorld();
    updateUI();
}

// Další stav ze serveru nahradí dopočítaný svět; události ze serveru = zvuky a oznámení
function applySharedSnapshot(snapshot, events) {
    if (!sharedMode) return;
    world = snapshot;
    world.events = [];
    handleWorldEvents(events || []);
    syncFromWorld();
}

// Konec sdílené hry / závodu: zpátky na vlastního lokálního hráče
function leaveSharedWorld() {
    sharedMode = false;
    myId = 'player';
}

// Ukončí hru tomuto hráči (net.js: konec závodu od serveru)
function endLocalGame(reason) {
    if (!world || sharedMode) return;
    OilSim.endPlayer(world, world.players[myId], reason);
    world.events.splice(0);
    syncFromWorld();
}

// Události ze světa: zvuky, oznámení, částice. Na sdílené mapě chodí od serveru.
function handleWorldEvents(events) {
    if (events.length) uiDirty = true;
    const groundLevel = getGroundLevel();
    events.forEach(e => {
        const mine = !e.playerId || e.playerId === myId;
        switch (e.type) {
            case 'plot_bought':
                if (!mine) {
                    if (e.auction) notify('Claim vydražen', `${playerName(e.playerId)} získal claim ${e.plotId + 1} za $${e.price}`, '', 'flag');
                    break;
                }
                playSound('build');
                lastBoughtPlotId = e.plotId;
                lastBoughtHighlightTimer = 30;
                notify(e.auction ? 'Claim vydražen' : 'Pozemek koupen', `Claim ${e.plotId + 1} za $${e.price}`, 'cool', 'flag');
                break;
            case 'auction':
                if (mine) {
                    playSound('build');
                    logEvent(e.start ? `Dražba claimu ${e.plotId + 1} začíná na $${e.amount}.` : `Přihozeno $${e.amount} na claim ${e.plotId + 1}.`);
                } else {
                    const outbid = auctions.some(a => a.plotId === e.plotId) || e.start;
                    notify(e.start ? 'Dražba claimu' : 'Přihodil soupeř', `${playerName(e.playerId)}: claim ${e.plotId + 1} za $${e.amount}${outbid ? '. Klikni na ceduli a přihoď.' : ''}`, 'bad', 'flag');
                }
                break;
            case 'auction_failed':
                if (mine) notify('Dražba propadla', `Na claim ${e.plotId + 1} nebyly peníze, zůstává volný`, 'bad', 'flag');
                else logEvent(`Dražba claimu ${e.plotId + 1} propadla.`);
                break;
            case 'deal_offer':
                if (mine) {
                    playSound('build');
                    notify('Nabídka ropy', `${playerName(e.from)} nabízí ${e.oil} bbl za $${e.price.toFixed(2)}/bbl`, 'cool', 'barrel');
                } else if (e.from === myId) logEvent(`Nabídka ${e.oil} bbl poslána hráči ${playerName(e.to)}.`);
                break;
            case 'deal_done':
                if (mine || e.from === myId) {
                    playSound('sale');
                    notify('Obchod uzavřen', mine ? `Koupeno ${e.oil} bbl od ${playerName(e.from)} za $${e.amount}` : `Prodáno ${e.oil} bbl hráči ${playerName(e.playerId)} za $${e.amount}`, 'good', 'barrel');
                }
                break;
            case 'deal_declined':
                if (mine) logEvent(`${playerName(e.to)} nabídku ropy odmítl.`);
                break;
            case 'deal_failed':
                if (mine) notify('Obchod nevyšel', e.reason === 'room' ? 'Nemáš místo v zásobnících' : 'Nemáš dost peněz', 'bad', 'barrel');
                break;
            case 'cartel_proposal':
                if (mine) logEvent(`Navržen kartel proti kupci ${e.name} na ${daysText(e.days)}.`);
                else notify('Návrh kartelu', `${playerName(e.playerId)}: nevozit kupci ${e.name} ${daysText(e.days)}. Přidej se v zakázkách.`, 'cool', 'wire');
                break;
            case 'cartel_join':
                logEvent(`${mine ? 'Ty' : playerName(e.playerId)} v kartelu.`);
                break;
            case 'cartel_on':
                playSound('build');
                notify('Kartel platí', `Nikdo nevozí kupci ${e.name} ${daysText(e.days)}. Kdo doveze, zradí.`, 'cool', 'wire');
                break;
            case 'cartel_broken':
                playSound('warn');
                notify(mine ? 'Zradil jsi kartel' : 'Zrada!', mine ? `Dovezl jsi kupci ${e.name}, kartel padl` : `${playerName(e.playerId)} dovezl kupci ${e.name}, kartel padl`, 'bad', 'skull');
                break;
            case 'cartel_end':
                logEvent(`Kartel proti kupci ${e.name} skončil.`);
                break;
            case 'cartel_expired':
                logEvent(`Návrh kartelu proti kupci ${e.name} vypršel.`);
                break;
            case 'sabotage':
                if (mine) {
                    playSound('warn');
                    notify('Stávka řidičů!', e.by ? `Vozy stojí. Zaplatil ji ${playerName(e.by)}.` : 'Vozy stojí 1,5 dne. Kdo za tím je, se neví.', 'bad', 'warning');
                } else if (e.by === myId) logEvent(`Stávka u hráče ${playerName(e.playerId)} zaplacena.`);
                else logEvent(`U hráče ${playerName(e.playerId)} stávkují řidiči.`);
                break;
            case 'sabotage_over':
                if (mine) notify('Stávka skončila', 'Vozy zase jezdí', 'good', 'wire');
                break;
            case 'derrick_built':
                if (!mine) {
                    if (sharedMode) logEvent(`${playerName(e.playerId)} postavil vrt na claimu ${e.plotId + 1}.`);
                    break;
                }
                playSound('build');
                notify('Vrt postaven', 'Klikej do podzemí: vrták pojede po trase a platí se za metr', 'cool', 'derrick');
                selectedDerrickPlotId = e.plotId;
                cancelBuildMode(false);
                break;
            case 'silo_built':
                if (!mine) break;
                playSound('build');
                logEvent(`Silo postaveno na pozemku ${e.plotId + 1}.`);
                cancelBuildMode();
                break;
            case 'truck_bought':
                if (mine) logEvent(`Koupen ${townEra < 2 ? 'povoz' : 'kamion'} (${e.count}/${MAX_TRUCKS}).`);
                break;
            case 'strike': {
                // Oslava: z věže vystřelí ohňostroj (vidí ho všichni)
                const rigTop = groundLevel - STRUCTURE_BASE_OFFSET - DERRICK_HEIGHT;
                for (let i = 0; i < 3; i++) launchFirework(e.x + (i - 1) * 14, rigTop, FIREWORK_COLORS[i]);
                if (!mine) {
                    if (sharedMode) notify('Soupeř navrtal ropu', `${playerName(e.playerId)}: ložisko s ${e.oil.toLocaleString('cs-CZ')} barely`, '', 'gusher');
                    break;
                }
                playSound('strike');
                notify('Ropa navrtána!', `Ložisko s ${e.oil.toLocaleString('cs-CZ')} barely`, 'good', 'gusher');
                break;
            }
            case 'kick':
                if (!mine) break;
                focusCameraOnPlot(e.plotId);
                shakeCamera(7);
                playSound('warn');
                if (e.auto) notify('Plynový kopanec', `Pozemek ${e.plotId + 1}: preventer se zavřel sám, plyn hoří na fléře`, 'cool', 'warning');
                else notify('Plynový kopanec!', `Pozemek ${e.plotId + 1}: klikni na vrt a zavři preventer, máš ${Math.round(KICK_MS / 1000)} s`, 'bad', 'warning');
                break;
            case 'bop':
                if (!mine) break;
                playSound('vent');
                logEvent(`Preventer zavřen, plyn hoří na fléře (pozemek ${e.plotId + 1}).`);
                break;
            case 'kick_over':
                if (mine) logEvent(`Plyn vyhořel, vrtá se dál (pozemek ${e.plotId + 1}).`);
                break;
            case 'water':
                if (!mine) break;
                playSound('build');
                notify('Navrtaná voda', `Pozemek ${e.plotId + 1}: vrt bude těžit i vodu, jde zacementovat`, 'bad', 'drop');
                break;
            case 'bit_worn':
                if (!mine) break;
                playSound('warn');
                notify('Korunka je tupá', `Pozemek ${e.plotId + 1}: vrták stojí, vyměň korunku za $${BIT_COST}`, 'bad', 'derrick');
                break;
            case 'bit_swap':
                if (mine) logEvent(`Tahá se soutyčí, nová korunka (pozemek ${e.plotId + 1}).`);
                break;
            case 'bit_ready':
                if (mine) logEvent(`Nová korunka nasazena (pozemek ${e.plotId + 1}).`);
                break;
            case 'drill_stalled':
                if (mine) notify('Vrták stojí', 'Došly peníze na vrtání, pojede dál, až přibydou', 'bad', 'derrick');
                break;
            case 'link_built':
                if (!mine) {
                    if (sharedMode) logEvent(`${playerName(e.playerId)} postavil ${e.kind === 'siding' ? 'vlečku' : 'ropovod'} → ${e.name}.`);
                    break;
                }
                playSound('build');
                notify(e.kind === 'siding' ? 'Vlečka postavena' : 'Ropovod postaven', `Pozemek ${e.plotId + 1} → ${e.name} za $${e.cost}`, 'good', e.kind === 'siding' ? 'rail' : 'pipe');
                break;
            case 'cement':
                if (!mine) break;
                playSound('build');
                logEvent(`Vrt zacementován, voda utěsněna (pozemek ${e.plotId + 1}).`);
                break;
            case 'inject':
                if (!mine) break;
                if (e.forced) notify('Vtláčení zastaveno', `Pozemek ${e.plotId + 1}: vrt zase těží`, 'bad', 'drop');
                else logEvent(e.on ? `Pozemek ${e.plotId + 1}: vtláčí vodu do ložiska.` : `Pozemek ${e.plotId + 1}: zpátky na těžbu.`);
                break;
            case 'vent':
                if (!mine) break;
                playSound('vent');
                logEvent(e.auto ? `Automatický ventil odpustil tlak na pozemku ${e.plotId + 1}.` : `Ventil odpuštěn na pozemku ${e.plotId + 1}.`);
                break;
            case 'perk':
                if (!mine) break;
                playSound('build');
                notify('Vylepšení koupeno', `${e.name} za $${e.cost.toLocaleString('cs-CZ')}`, 'good', 'flag');
                break;
            case 'warn':
                if (!mine) break;
                focusCameraOnPlot(e.plotId);
                playSound('warn');
                notify('Přetlak na vrtu!', `Pozemek ${e.plotId + 1}: odvez ropu, nebo klikni na vrt a odpusť ventil`, 'bad', 'warning');
                break;
            case 'blowout':
                if (!mine) {
                    if (sharedMode) logEvent(`U hráče ${playerName(e.playerId)} ${e.kick ? 'vyrazil plyn z vrtu' : 'vybuchl vrt'}.`);
                    break;
                }
                focusCameraOnPlot(e.plotId);
                shakeCamera(12);
                playSound('gush');
                if (e.kick) notify('Plyn vyrazil z vrtu!', `Pozemek ${e.plotId + 1}: pokuta $${e.fine}, korunka zničená`, 'bad', 'blowout');
                else notify('Erupce ropy!', `Vrt na pozemku ${e.plotId + 1}: únik a pokuta $${e.fine}`, 'bad', 'blowout');
                break;
            case 'exhausted':
                if (mine) notify('Ložisko vyčerpáno', `Vrt na pozemku ${e.plotId + 1} přestal čerpat`, 'bad', 'barrel');
                break;
            case 'sale':
                spawnParticle({
                    type: 'text', text: `+$${e.amount}`, x: e.x, y: groundLevel - 50, vx: 0, vy: -42,
                    age: 0, life: 1400, color: mine ? null : playerColor(e.playerId)
                });
                if (mine) playSound('sale');
                break;
            case 'seismic':
                for (let i = 0; i < 14; i++) {
                    spawnParticle({
                        type: 'puff', x: e.x + (Math.random() - 0.5) * 30, y: groundLevel - STRUCTURE_BASE_OFFSET + 10,
                        vx: (Math.random() - 0.5) * 80, vy: -30 - Math.random() * 60,
                        age: 0, life: 1400, size: 4 + Math.random() * 4, shade: 110
                    });
                }
                if (!mine) break;
                shakeCamera(9);
                playSound('boom');
                logEvent(`Seismický průzkum na pozemku ${e.plotId + 1}.`);
                cancelBuildMode();
                break;
            case 'drone':
                if (mine) logEvent('Průzkumný dron vzlétl.');
                break;
            case 'radar':
                if (!mine) break;
                playSound(e.found ? 'strike' : 'build');
                if (e.found) notify('Georadar našel ropu', `${e.found}× ložisko odhaleno${e.hazards ? `, ${e.hazards}× riziko v hornině` : ''}`, 'cool', 'radar');
                else if (e.hazards) notify('Georadar: pozor v hornině', `${e.hazards}× plyn nebo voda v okolí`, 'cool', 'radar');
                else logEvent('Georadar: v okolí nic.');
                cancelBuildMode();
                break;
            case 'month':
                logEvent(`Začíná ${MONTH_FULL_NAMES[e.month]}.`);
                break;
            case 'news':
                showBreakingNews(e);
                break;
            case 'era':
                showEraNews(e);
                shakeCamera(4);
                break;
            case 'route':
                if (mine) logEvent(e.buyer ? `Vozy jezdí k: ${buyerName(e.buyer)}.` : 'Vozy si zase vybírají kupce samy.');
                break;
            case 'contract_offer':
                playSound('build');
                notify('Nabídka zakázky', `${e.name}: ${e.amount} bbl za $${e.price.toFixed(2)} do ${daysUntilText(e.days)}`, 'cool', 'wire');
                break;
            case 'contract_taken':
                if (mine) logEvent(`Zakázka přijata: ${buyerName(e.buyer)}, ${e.amount} bbl.`);
                else notify('Zakázku vzal soupeř', `${world.players[e.playerId]?.name || 'Hráč'}: ${buyerName(e.buyer)}, ${e.amount} bbl`, '', 'wire');
                break;
            case 'contract_done':
                if (!mine) {
                    if (sharedMode) logEvent(`${playerName(e.playerId)} splnil zakázku pro ${buyerName(e.buyer)}.`);
                    break;
                }
                playSound('strike');
                notify('Zakázka splněna', `${buyerName(e.buyer)}: ${e.amount} bbl dodáno`, 'good', 'barrel');
                break;
            case 'contract_failed':
                if (!mine) break;
                playSound('warn');
                notify('Zakázka propadla', `${buyerName(e.buyer)}: penále $${e.penalty}`, 'bad', 'warning');
                break;
            case 'news_end':
                logEvent(`Konec: ${e.title}.`);
                break;
            case 'player_over':
                if (!mine && e.reason === 'bankrupt') {
                    notify('Soupeř zkrachoval', `${world.players[e.playerId]?.name || 'Hráč'} je mimo hru`, 'cool', 'skull');
                }
                break;
        }
    });
}

// Vizuální efekty ze stavu světa (kouř, pára, gejzír); nemění hru
function emitClientEffects(dt) {
    trucks.forEach(truck => {
        if (truck.state === 'to_rig' || truck.state === 'to_company') emitTruckSmoke(truck, dt);
    });
    emitDerrickSmoke(dt);
    pipeNetworks.forEach(network => {
        const x = getNetworkPickupX(network);
        if (network.pocket < 0 && network.drillState === 'drilling' && !network.stalled) emitDrillDust(network, x, dt);
        if (network.drillState === 'kick') emitSteam(x, dt, 0.8);
        if (network.blowout > 0) emitGusher(network, x, dt);
        else {
            if (network.vent > 0) emitSteam(x, dt, 1);
            if (network.pressure > 0.45) emitSteam(x, dt, (network.pressure - 0.45) * 0.4); // syčící ventily
        }
    });
}

// --- Předvolby: uložení, formulář a promítnutí do hry ---
function loadPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        // Jen známé klíče se známými hodnotami; staré nebo rozbité uložení nic nerozbije
        const valid = PREF_FIELDS.filter(f => f.options.some(([value]) => value === saved[f.key]));
        return { ...DEFAULT_PREFS, ...Object.fromEntries(valid.map(f => [f.key, saved[f.key]])) };
    } catch (e) {
        return { ...DEFAULT_PREFS };
    }
}

// Cena stavby u kurzoru, když ji terén mění (kopec)
function drawBuildCostLabel(plot, base, groundLevel) {
    const cost = plotBuildCost(plot, base);
    if (cost === base) return;
    const label = `$${cost} · ${OilSim.terrainOf(plot).name.toLowerCase()}`;
    ctx.save();
    ctx.font = '700 12px "Barlow Condensed", system-ui, sans-serif';
    const lw = ctx.measureText(label).width + 14;
    fillPaper(mousePos.x + 12, mousePos.y - 24, lw, 20, 2, -0.03);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = money >= cost ? INK : INK_RED;
    ctx.fillText(label, mousePos.x + 19, mousePos.y - 14);
    ctx.restore();
}

function setPref(key, value) {
    prefs[key] = value;
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
        // Bez úložiště platí předvolby jen do zavření hry
    }
    if (key === 'sound') updateSoundButton();
    if (key === 'volume') playSound('sale'); // ukázka nové hlasitosti
    if (key === 'ads') blimpAd = undefined; // vzducholoď si reklamu vylosuje znovu (nebo poletí bez ní)
    renderPrefs();
}

function renderPrefs() {
    const box = document.getElementById('prefs-fields');
    if (!box) return;
    box.innerHTML = PREF_FIELDS.filter(f => !f.visible || f.visible()).map(f => `
        <div class="form-field"><div class="form-label">${f.label}</div><div class="prefs-choices">${f.options.map(([value, name, note], i) => `
            <button class="length-btn${prefs[f.key] === value ? ' active' : ''}" data-key="${f.key}" data-index="${i}">${name}${note ? `<small>${note}</small>` : ''}</button>`).join('')}
        </div></div>`).join('');
}

function togglePrefs(open) {
    const overlay = document.getElementById('prefs');
    if (!overlay) return;
    const show = open ?? overlay.classList.contains('hidden');
    if (show) renderPrefs();
    overlay.classList.toggle('hidden', !show);
}

function handlePrefsClick(event) {
    const btn = event.target.closest('button[data-key]');
    if (!btn) return;
    const field = PREF_FIELDS.find(f => f.key === btn.dataset.key);
    const option = field?.options[Number(btn.dataset.index)];
    if (option) setPref(field.key, option[0]);
}

// Vrt jde prodloužit, dokud není napojený na ložisko, které ještě teče
function canExtendRig(network) {
    if (!network || network.pocket < 0) return true;
    const pocket = oilPockets[network.pocket];
    return !pocket || pocket.oil <= 0;
}

// Odhad vrtání k bodu pod kurzorem: horniny po cestě dávají cenu a čas, strmé stoupání nejde
function estimateDrill(from, to) {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(len / 4));
    let cost = 0, seconds = 0;
    for (let i = 0; i < steps; i++) {
        const f = (i + 0.5) / steps;
        const rock = OilSim.ROCKS[OilSim.rockAt(world, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f)];
        cost += (len / steps) * DRILL_COST_PER_PX * rock.cost;
        seconds += (len / steps) / (DRILL_SPEED * rock.speed);
    }
    return { cost: Math.ceil(cost), seconds };
}

function drawDrillPreview(from, to) {
    const tooSteep = from.y - to.y > Math.abs(to.x - from.x) * DRILL_MAX_RISE;
    const { cost, seconds } = estimateDrill(from, to);
    const rock = OilSim.ROCKS[OilSim.rockAt(world, to.x, to.y)];
    const ok = !tooSteep && money >= cost;
    ctx.save();
    ctx.strokeStyle = ok ? 'rgba(255, 200, 120, 0.75)' : 'rgba(255, 90, 70, 0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Štítek: cena a čas, pod tím hornina u kurzoru
    const line1 = tooSteep ? 'Vrták neumí stoupat' : `≈ $${cost} · ${Math.max(1, Math.round(seconds))} s`;
    const line2 = rock.name;
    ctx.font = '700 13px "Barlow Condensed", system-ui, sans-serif';
    const lw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16;
    fillPaper(to.x + 10, to.y - 40, lw, 34, 2, -0.03);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ok ? INK : INK_RED;
    ctx.fillText(line1, to.x + 18, to.y - 30);
    ctx.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(line2.toUpperCase(), to.x + 18, to.y - 15);
    ctx.restore();
}

function drawEffectsAndPreviews(groundLevel) {
    const overBlimp = !currentBuildMode && blimpHitRect && isPointInRect(mousePos, blimpHitRect);
    let newCursor = plotsHoverPointer || overBlimp || buyerHover ? 'pointer' : (camera.tzoom > 1.01 ? 'grab' : 'default');

    // Náhled stavby
    if (currentBuildMode === 'vrt') {
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === myId && !hoveredPlot.hasVrt) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawDerrick(hoveredPlot.x + hoveredPlot.width / 2, groundLevel - STRUCTURE_BASE_OFFSET, -1, false);
            ctx.restore();
            drawBuildCostLabel(hoveredPlot, VRT_COST, groundLevel);
            newCursor = 'pointer';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (currentBuildMode === 'silo') {
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === myId && hoveredPlot.hasVrt) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawSilo(hoveredPlot.x + hoveredPlot.width / 2 + SILO_OFFSET_X + hoveredPlot.siloCount * SILO_STEP,
                groundLevel - STRUCTURE_BASE_OFFSET + 4 + hoveredPlot.siloCount * 2, 0);
            ctx.restore();
            drawBuildCostLabel(hoveredPlot, SILO_COST, groundLevel);
            newCursor = 'pointer';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (selectedDerrickPlotId !== null) {
        const network = pipeNetworks.find(n => n.derrickId === selectedDerrickPlotId);
        const startPlot = plots.find(p => p.id === selectedDerrickPlotId);
        newCursor = canExtendRig(network) ? 'crosshair' : 'default';
        if (startPlot && canExtendRig(network)) {
            const lastPoint = network?.path[network.path.length - 1] || {
                x: startPlot.x + startPlot.width / 2,
                y: groundLevel
            };
            if (mousePos.y > groundLevel) drawDrillPreview(lastPoint, mousePos);
        }
    } else if (currentBuildMode === 'seismic') {
        // Náhled dosahu nálože: půlkruh pod kurzorem na vlastním pozemku
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === myId && mousePos.y <= groundLevel) {
            ctx.save();
            ctx.strokeStyle = 'rgba(160, 220, 255, 0.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 8]);
            ctx.beginPath();
            ctx.arc(mousePos.x, groundLevel, SEISMIC_RADIUS, 0, Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ff5a3a'; // nálož
            ctx.fillRect(mousePos.x - 4, groundLevel - STRUCTURE_BASE_OFFSET + 2, 8, 12);
            ctx.restore();
            newCursor = 'crosshair';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (currentBuildMode === 'radar') {
        if (mousePos.y > groundLevel) {
            ctx.save();
            ctx.strokeStyle = 'rgba(120, 255, 170, 0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.lineDashOffset = -toolClock / 50;
            ctx.beginPath();
            ctx.arc(mousePos.x, mousePos.y, RADAR_RADIUS, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            newCursor = 'crosshair';
        } else {
            newCursor = 'not-allowed';
        }
    }

    if (dragState && dragState.moved) newCursor = 'grabbing';
    if (canvas.style.cursor !== newCursor) {
        canvas.style.cursor = newCursor;
    }

}

function drawPauseScreen() {
    ctx.fillStyle = 'rgba(10, 6, 14, 0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#ffe3b0';
    ctx.font = '64px "Rye", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAUZA', VIEW_W / 2, VIEW_H / 2);
    ctx.textBaseline = 'alphabetic';
}

function drawGameOver() {
    resetCamera(true); // tlačítko restartu je v souřadnicích obrazovky
    draw();
    // V závodě ukazuje výsledky noviny z net.js; scéna za nimi má zůstat vidět
    ctx.fillStyle = raceMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (raceMode) return;

    ctx.fillStyle = 'white';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    const title = gameOverReason === 'bankrupt' ? 'BANKROT!' : 'KONEC ROKU';
    ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 120);

    ctx.font = '32px sans-serif';
    ctx.fillText(`Finální kapitál: $${Math.floor(money)}`, VIEW_W / 2, VIEW_H / 2 - 40);
    ctx.fillText(`Celkové tržby: $${Math.floor(totalRevenue)}`, VIEW_W / 2, VIEW_H / 2 + 10);
    ctx.fillText(`Prodáno ropy: ${Math.floor(totalOilSold)} barelů`, VIEW_W / 2, VIEW_H / 2 + 55);

    const ownedPlots = plots.filter(p => p.owner === myId).length;
    const activeRigs = plots.filter(p => p.hasVrt && isMine(p)).length;
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.fillText(`Pozemky: ${ownedPlots}  |  Vrty: ${activeRigs}  |  Kamiony: ${trucksOwned}`, VIEW_W / 2, VIEW_H / 2 + 110);

    // Tlačítko restartu
    const btn = getRestartButtonRect();
    const hovered = isPointInRect(mousePos, btn);
    ctx.fillStyle = hovered ? '#FFD700' : '#E6B422';
    ctx.fillRect(btn.x, btn.y, btn.width, btn.height);
    ctx.strokeStyle = '#3D2B1F';
    ctx.lineWidth = 3;
    ctx.strokeRect(btn.x, btn.y, btn.width, btn.height);
    ctx.fillStyle = '#3D2B1F';
    ctx.font = 'bold 32px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('HRÁT ZNOVU', btn.x + btn.width / 2, btn.y + btn.height / 2 + 2);
    ctx.textBaseline = 'alphabetic';
    canvas.style.cursor = hovered ? 'pointer' : 'default';
}


// --- Spuštění při načtení stránky ---
document.addEventListener('DOMContentLoaded', () => {
    loadImages();
});
