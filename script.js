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
    PLOT_COUNT, VRT_COST, SILO_COST, TRUCK_COST, PIPE_COST_PER_PIXEL, TRUCK_CAPACITY, OIL_PER_SECOND,
    MAX_SILOS_PER_PLOT, MAX_TRUCKS, MS_PER_DAY, SURVIVAL_TAX_STEP, TRUCK_LENGTH, TRUCK_GAP_PAD,
    VENT_MIN, PRESSURE_WARN, SEISMIC_COST, DRONE_COST, RADAR_COST, SEISMIC_RADIUS, SEISMIC_WAVE_MS,
    RADAR_RADIUS, RADAR_PULSE_MS, DRONE_BEAM_HALF, ECHO_MS
} = OilSim.C;
const SOLO_RULES = OilSim.RULES.solo;
const RACE_RULES = OilSim.RULES.race;
const ECHO_FADE_MS = 1500;
const DRONE_Y_OFFSET = 205;   // výška letu dronu nad přední hranou desky (jen kresba)

let buyerNews = { left: { mult: 1, closed: false }, right: { mult: 1, closed: false } };
let world = null;        // aktuální svět; na sdílené mapě kopie ze serveru, mezi zprávami se dopočítává
let myId = 'player';     // za kterého hráče se hraje (sólo 'player', v síti id hráče)
let sharedMode = false;  // sdílená mapa: akce jdou na server (net.js), svět chodí ze serveru
const GROUND_RATIO = 0.44;        // povrch (přední hrana desky) ve 44 % výšky plátna
const POCKET_BOTTOM_MARGIN = 125; // spodní pás plátna zakrývá panel nástrojů

function getGroundLevel() {
    return Math.floor(canvas.height * GROUND_RATIO);
}

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
let plotWidth;

// Ceny a kamiony
let leftIncPrice = 1.00;
let rightIncPrice = 1.00;
let leftPriceTrend = 0;
let rightPriceTrend = 0;
let trucksOwned = 0;
let plotBlinkTimers = {};
let trucksAssignedLeft = 0;
let trucksAssignedRight = 0;

// HUD: deník událostí a zisk za poslední den (jen pro zobrazení)
const EVENT_LOG_LEN = 4;
let eventLog = [];
let lastDayIncome = 0;

// Historie cen pro graf na budovách firem
let leftPriceHistory = [1.00];
let rightPriceHistory = [1.00];

// Částice (kouř z aut, "+$" při prodeji) a zvuk
const MAX_PARTICLES = 450; // gejzír při erupci jich potřebuje hodně
let particles = [];
let soundMuted = false;
let audioCtx = null;

// Hitboxy pro ovládací prvky na plátně
let companyControls = {
    leftUp: {}, leftDown: {},
    rightUp: {}, rightDown: {}
};

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
    // Pevné rozlišení pro konzistentní vzhled
    canvas.width = 1600;
    canvas.height = 900;
    gameCanvasContainer.innerHTML = ''; // Vyčistí "Načítání..."
    gameCanvasContainer.appendChild(canvas);

    // Ujisti se, že canvas vždy odkazuje na DOM element
    canvas = document.getElementById('turmoil-game');

    ctx = canvas.getContext('2d');

    // Plátno font Rye samo nenačte (není v DOM), proto ho vyžádáme
    // Plátno písma samo nenačte (nejsou v DOM), proto je vyžádáme
    if (document.fonts) {
        ['18px "Rye"', '600 12px "Barlow Condensed"', '700 12px "Barlow Condensed"', '800 12px "Barlow Condensed"', '700 12px "Courier Prime"']
            .forEach(font => document.fonts.load(font).catch(() => { }));
    }

    // Svět (sólo, náhodný); závod a sdílená mapa ho nahradí přes restartGame / net.js
    plotWidth = OilSim.C.PLOT_WIDTH;
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
    trucksAssignedLeft = me.assigned.left;
    trucksAssignedRight = me.assigned.right;
    lastDayIncome = me.lastDayIncome;
    isGameOver = me.over;
    gameOverReason = me.reason || '';
    const m = world.market;
    // Výkupní cena po vlivu mimořádných zpráv; zavřený výkupce nevykupuje
    leftIncPrice = m.left.quote ?? m.left.price;
    rightIncPrice = m.right.quote ?? m.right.price;
    buyerNews.left = { mult: m.left.mult ?? 1, closed: !!m.left.closed };
    buyerNews.right = { mult: m.right.mult ?? 1, closed: !!m.right.closed };
    leftPriceTrend = m.left.trend;
    rightPriceTrend = m.right.trend;
    leftPriceHistory = m.left.history;
    rightPriceHistory = m.right.history;
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
}

function isMine(thing) {
    return !!thing && thing.owner === myId;
}

function playerColor(id) {
    return world?.players[id]?.color || '#ffb45a';
}

// Jediná cesta ke změně stavu: lokálně hned přes sim.js, na sdílené mapě po síti na server
function doAction(action) {
    if (!world) return { ok: false };
    if (sharedMode) {
        if (typeof Net !== 'undefined') Net.sendAction(action);
        return { ok: true, pending: true };
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
    const groundLevel = getGroundLevel();
    events.forEach(e => {
        const mine = !e.playerId || e.playerId === myId;
        switch (e.type) {
            case 'plot_bought':
                if (!mine) break;
                playSound('build');
                lastBoughtPlotId = e.plotId;
                lastBoughtHighlightTimer = 30;
                notify('Pozemek koupen', `Pozemek ${e.plotId + 1} za $${e.price}`, 'cool', 'flag');
                break;
            case 'derrick_built':
                if (!mine) break;
                playSound('build');
                notify('Vrt postaven', 'Klikni do podzemí a veď potrubí k ložisku', 'cool', 'derrick');
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
                if (mine) logEvent(`Koupen kamion (${e.count}/${MAX_TRUCKS}).`);
                break;
            case 'strike': {
                // Oslava: z věže vystřelí ohňostroj (vidí ho všichni)
                const rigTop = groundLevel - STRUCTURE_BASE_OFFSET - DERRICK_HEIGHT;
                for (let i = 0; i < 3; i++) launchFirework(e.x + (i - 1) * 14, rigTop, FIREWORK_COLORS[i]);
                if (!mine) break;
                playSound('strike');
                notify('Ropa navrtána!', `Ložisko s ${e.oil.toLocaleString('cs-CZ')} barely`, 'good', 'gusher');
                if (selectedDerrickPlotId === e.plotId) selectedDerrickPlotId = null;
                break;
            }
            case 'vent':
                if (!mine) break;
                playSound('vent');
                logEvent(`Ventil odpuštěn na pozemku ${e.plotId + 1}.`);
                break;
            case 'warn':
                if (!mine) break;
                playSound('warn');
                notify('Přetlak na vrtu!', `Pozemek ${e.plotId + 1}: odvez ropu, nebo klikni na vrt a odpusť ventil`, 'bad', 'warning');
                break;
            case 'blowout':
                if (!mine) break;
                shakeCamera(12);
                playSound('gush');
                notify('Erupce ropy!', `Vrt na pozemku ${e.plotId + 1}: únik a pokuta $${e.fine}`, 'bad', 'blowout');
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
                if (e.found) notify('Georadar našel ropu', `${e.found}× ložisko odhaleno`, 'cool', 'radar');
                else logEvent('Georadar: v okolí nic.');
                cancelBuildMode();
                break;
            case 'month':
                logEvent(`Začíná ${MONTH_FULL_NAMES[e.month]}.`);
                break;
            case 'news':
                showBreakingNews(e);
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
        if (network.blowout > 0) emitGusher(network, x, dt);
        else {
            if (network.vent > 0) emitSteam(x, dt, 1);
            if (network.pressure > 0.45) emitSteam(x, dt, (network.pressure - 0.45) * 0.4); // syčící ventily
        }
    });
}

// --- Život ve scéně: lidé, auta, letadla, ohňostroje ---
// Kulisy, které nehrají: poloha je většinou funkcí času ambientClock (s), stav mají jen
// ohňostroje. ambientClock běží reálným časem (ne herní rychlostí) a stojí v pauze.
const FIREWORK_GRAVITY = 70;          // px/s²
const FIREWORK_COLORS = ['255, 190, 90', '255, 120, 80', '140, 200, 255', '255, 240, 200', '190, 140, 255'];
let ambientClock = 0;
let fireworks = [];                    // rakety { x, y, vy, targetY, color } a jiskry { x, y, vx, vy, age, life, color }
let nextFireworkAt = 6;

function updateAmbient(frameMs) {
    const dt = frameMs / 1000;
    ambientClock += dt;

    if (ambientClock >= nextFireworkAt) { // občas někdo ve městě slaví
        const groundLevel = getGroundLevel();
        launchFirework(120 + Math.random() * (canvas.width - 240), getSlabBackY(groundLevel) + 40);
        nextFireworkAt = ambientClock + 9 + Math.random() * 10;
    }

    const next = [];
    fireworks.forEach(f => {
        if (f.kind === 'rocket') {
            f.y += f.vy * dt;
            f.trail = (f.trail || 0) + dt;
            if (f.trail > 0.03) { // jiskry za raketou
                f.trail = 0;
                next.push({ kind: 'spark', x: f.x, y: f.y, vx: (Math.random() - 0.5) * 12, vy: 20, age: 0, life: 0.5, color: '255, 200, 120', size: 1.2 });
            }
            if (f.y <= f.targetY) {
                const count = 34;
                for (let i = 0; i < count; i++) {
                    const a = (i / count) * Math.PI * 2;
                    const speed = 60 + Math.random() * 40;
                    next.push({ kind: 'spark', x: f.x, y: f.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0, life: 1.4 + Math.random() * 0.5, color: f.color, size: 2 });
                }
            } else {
                next.push(f);
            }
        } else {
            f.age += dt;
            f.vy += FIREWORK_GRAVITY * dt;
            f.vx *= 1 - dt * 0.8;
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            if (f.age < f.life) next.push(f);
        }
    });
    fireworks = next.slice(-500);
}

// Raketa vystřelí z bodu (x, y) do noční oblohy
function launchFirework(x, y, color) {
    fireworks.push({
        kind: 'rocket', x, y, vy: -260 - Math.random() * 60,
        targetY: 40 + Math.random() * 80,
        color: color || FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]
    });
}

function drawFireworks() {
    if (!fireworks.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    fireworks.forEach(f => {
        if (f.kind === 'rocket') {
            ctx.fillStyle = 'rgba(255, 230, 180, 0.95)';
            ctx.fillRect(f.x - 1, f.y - 3, 2, 5);
            return;
        }
        const k = 1 - f.age / f.life;
        ctx.fillStyle = `rgba(${f.color}, ${k})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * (0.5 + k * 0.5), 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

// Opakovaný přelet: vrací postup 0–1 během letu, jinak null (period a duration v sekundách)
function flightProgress(period, duration, offset) {
    const phase = (ambientClock + offset) % period;
    return phase < duration ? phase / duration : null;
}

function drawSkyLife(groundLevel) {
    const t = ambientClock;
    const backY = getSlabBackY(groundLevel);

    // Padající hvězda
    const starCycle = Math.floor((t + 3) / 7);
    const starPhase = ((t + 3) % 7) / 0.7;
    if (starPhase < 1) {
        const sx = 200 + (starCycle * 397) % (canvas.width - 400);
        const sy = 20 + (starCycle * 53) % 60;
        const x = sx + starPhase * 160, y = sy + starPhase * 50;
        const grad = ctx.createLinearGradient(x - 60, y - 19, x, y);
        grad.addColorStop(0, 'rgba(220, 230, 255, 0)');
        grad.addColorStop(1, `rgba(230, 240, 255, ${0.9 * (1 - starPhase)})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 60, y - 19);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    // Vzducholoď s reklamou a světlometem na město
    const blimp = flightProgress(90, 70, 20);
    if (blimp !== null) drawBlimp(-160 + blimp * (canvas.width + 320), backY - 62 + Math.sin(t * 0.6) * 4, groundLevel);

    // Netopýři
    const bats = flightProgress(34, 16, 5);
    if (bats !== null) {
        for (let i = 0; i < 7; i++) {
            const x = canvas.width + 60 - bats * (canvas.width + 200) + (i % 4) * 26 + Math.sin(t * 2 + i) * 8;
            const y = backY - 40 + (i * 13) % 34 + Math.sin(t * 3 + i * 1.7) * 6;
            const flap = Math.sin(t * 16 + i * 2) * 4;
            ctx.strokeStyle = '#0c0b12';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x - 6, y - flap);
            ctx.quadraticCurveTo(x - 3, y - 2, x, y);
            ctx.quadraticCurveTo(x + 3, y - 2, x + 6, y - flap);
            ctx.stroke();
        }
    }

    // Dvouplošník s navigačními světly a kouřovou stopou
    const plane = flightProgress(27, 11, 0);
    if (plane !== null) drawBiplane(canvas.width + 80 - plane * (canvas.width + 160), 58 + Math.sin(t * 1.4) * 8, -1);

    drawFireworks();
}

function drawBlimp(x, y, groundLevel) {
    const t = ambientClock;
    // Kužel světlometu přejíždí po městě
    const aimX = x + Math.sin(t * 0.7) * 140;
    const aimY = getSlabBackY(groundLevel) + 70;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(x, y + 14, aimX, aimY);
    beam.addColorStop(0, 'rgba(255, 240, 200, 0.22)');
    beam.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 14);
    ctx.lineTo(x + 3, y + 14);
    ctx.lineTo(aimX + 34, aimY);
    ctx.lineTo(aimX - 34, aimY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 230, 180, 0.08)';
    ctx.beginPath();
    ctx.ellipse(aimX, aimY, 36, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const body = ctx.createLinearGradient(0, y - 22, 0, y + 22);
    body.addColorStop(0, '#5c5e78');
    body.addColorStop(0.5, '#3a3b52');
    body.addColorStop(1, '#1d1e2c');
    ctx.fillStyle = '#1d1e2c'; // ocasní plochy
    ctx.beginPath();
    ctx.moveTo(x - 62, y);
    ctx.lineTo(x - 82, y - 18);
    ctx.lineTo(x - 70, y);
    ctx.lineTo(x - 82, y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y, 72, 21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 195, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, 72, 21, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    // Svítící nápis
    ctx.font = '13px "Rye", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcf80';
    ctx.fillText('OIL DIGGA', x + 4, y + 1);
    drawGlow(x + 4, y, 50, '255, 170, 80', 0.12);
    // Gondola a světla
    ctx.fillStyle = '#15151f';
    pathRoundRect(x - 12, y + 18, 24, 8, 3);
    ctx.fill();
    ctx.fillStyle = '#ffd890';
    ctx.fillRect(x - 8, y + 20, 3, 3);
    ctx.fillRect(x - 1, y + 20, 3, 3);
    ctx.fillRect(x + 6, y + 20, 3, 3);
    const blink = Math.sin(t * 4) > 0.6;
    if (blink) drawGlow(x + 72, y, 10, '255, 60, 50', 0.9);
    if (!blink) drawGlow(x - 70, y - 14, 8, '255, 255, 255', 0.6);
}

function drawBiplane(x, y, dir) {
    const t = ambientClock;
    // Kouřová stopa za letadlem
    for (let i = 1; i <= 8; i++) {
        const px = x - dir * i * 14;
        ctx.fillStyle = `rgba(150, 150, 175, ${0.16 * (1 - i / 9)})`;
        ctx.beginPath();
        ctx.arc(px, y + Math.sin(t * 3 + i) * 1.5, 2 + i * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.fillStyle = '#1a1a24';
    ctx.beginPath(); // trup
    ctx.moveTo(14, -2);
    ctx.lineTo(-14, -1);
    ctx.lineTo(-20, -6);
    ctx.lineTo(-18, 2);
    ctx.lineTo(14, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-4, -8, 12, 2); // horní křídlo
    ctx.fillRect(-4, 3, 12, 2);  // dolní křídlo
    ctx.fillStyle = 'rgba(180, 195, 255, 0.5)';
    ctx.fillRect(-4, -8, 12, 0.8);
    ctx.fillStyle = 'rgba(200, 210, 240, 0.35)'; // vrtule
    ctx.beginPath();
    ctx.ellipse(16, 0, 1.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const blink = Math.sin(t * 7) > 0;
    drawGlow(x + 2, y - 8, 6, blink ? '255, 60, 50' : '60, 255, 120', 0.9);
}

// Malý panáček: hlava, tělo, kmitající nohy; lamp = svítí lucernou nebo čelovkou
function drawWalker(x, y, s, phase, dir, opts = {}) {
    const moving = opts.moving !== false;
    const leg = moving ? Math.sin(phase) * 2.2 * s : 0.6 * s;
    ctx.strokeStyle = opts.color || '#0e0d16';
    ctx.lineWidth = 1.4 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - 5 * s);
    ctx.lineTo(x - leg, y);
    ctx.moveTo(x, y - 5 * s);
    ctx.lineTo(x + leg, y);
    ctx.moveTo(x, y - 5 * s);
    ctx.lineTo(x, y - 10 * s);
    ctx.moveTo(x, y - 9 * s);
    ctx.lineTo(x + dir * 2.5 * s, y - 6.5 * s + (moving ? Math.cos(phase) * s : 0));
    ctx.stroke();
    ctx.fillStyle = opts.helmet || opts.color || '#0e0d16';
    ctx.beginPath();
    ctx.arc(x, y - 12 * s, 1.9 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 190, 255, 0.35)'; // měsíc na rameni
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + s, y - 10 * s);
    ctx.lineTo(x + s, y - 6 * s);
    ctx.stroke();
    if (opts.lamp) drawGlow(x + dir * 3 * s, y - (opts.helmet ? 12 : 6) * s, 9 * s, '255, 190, 100', 0.55);
}

// Auto ve městě (staré "plechovka" s reflektory)
function drawTownCar(x, y, s, dir, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * s, s);
    ctx.fillStyle = 'rgba(5, 5, 12, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 0.5, 11, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(-10, -6, 20, 4);
    ctx.fillRect(-6, -10, 9, 4);
    ctx.fillStyle = 'rgba(255, 200, 120, 0.6)'; // okno se světlem z palubní desky
    ctx.fillRect(-4, -9, 5, 2.5);
    ctx.fillStyle = '#0b0b12';
    ctx.beginPath();
    ctx.arc(-6, -1.5, 2.2, 0, Math.PI * 2);
    ctx.arc(6, -1.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fx = x + dir * 10 * s;
    const beam = ctx.createLinearGradient(fx, 0, fx + dir * 40 * s, 0);
    beam.addColorStop(0, 'rgba(255, 220, 150, 0.35)');
    beam.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(fx, y - 4 * s);
    ctx.lineTo(fx + dir * 40 * s, y - 8 * s);
    ctx.lineTo(fx + dir * 40 * s, y + 1 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawGlow(x - dir * 10 * s, y - 4 * s, 4 * s, '255, 50, 40', 0.7);
}

const TOWN_CAR_COLORS = ['#3b2a2a', '#22303f', '#2f3a2a', '#3a3340', '#4a3a22'];

// Chůze se zastávkami: cyklus period s, z toho walk s chůze, zbytek stojí.
// Vrací ušlou dráhu v sekundách chůze a jestli se zrovna jde.
function stopAndGo(t, period, walk) {
    const cycle = Math.floor(t / period);
    const inCycle = t - cycle * period;
    return { walked: cycle * walk + Math.min(inCycle, walk), moving: inCycle < walk };
}

function wrapX(x, span) {
    return ((x % span) + span) % span - 30;
}

// Hlavní ulice: chodci se drží chodníků (za ulicí doleva, před ní doprava), občas se zastaví;
// pod lampami stojí skupinky; auta jedou ve dvou pruzích stálou rychlostí, takže se nepředjíždějí.
// Kreslí se před přední řadou domů, ta je pak zakryje.
const STREET_GROUPS = [230, 610, 1010, 1380];

function drawTownLife(groundLevel) {
    const t = ambientClock;
    const L = getTownLayout(groundLevel);
    const s = L.streetScale;
    const span = canvas.width + 60;

    [{ y: L.streetY - 3 * s, dir: -1, speed: 46 }, { y: L.streetY + 4 * s, dir: 1, speed: 38 }].forEach((lane, li) => {
        for (let i = 0; i < 3; i++) {
            const x = wrapX(i * span / 3 + li * 170 + lane.dir * t * lane.speed * s, span);
            drawTownCar(x, lane.y, s, lane.dir, TOWN_CAR_COLORS[(i * 2 + li) % TOWN_CAR_COLORS.length]);
        }
    });

    [{ y: L.sidewalkNorth, dir: -1, count: 9 }, { y: L.sidewalkSouth, dir: 1, count: 9 }].forEach((walk, wi) => {
        for (let i = 0; i < walk.count; i++) {
            const period = 10 + (i % 3) * 2;
            const { walked, moving } = stopAndGo(t + i * 3.1, period, period - 3);
            const x = wrapX(i * span / walk.count + wi * 60 + walk.dir * walked * 10 * s, span);
            drawWalker(x, walk.y, s * 1.3, t * 7 + i, walk.dir, { moving, lamp: i % 4 === 0 });
        }
    });

    // Skupinky pod lampami: stojí čelem k sobě a pohupují se
    STREET_GROUPS.forEach((gx, gi) => {
        const gy = gi % 2 ? L.sidewalkSouth : L.sidewalkNorth;
        const size = 2 + gi % 2;
        for (let k = 0; k < size; k++) {
            const x = gx + (k - (size - 1) / 2) * 7 * s + Math.sin(t * 0.8 + gi + k) * 0.6;
            drawWalker(x, gy, s * 1.3, 0, k < size / 2 ? 1 : -1, { moving: false, lamp: k === 0 && gi === 2 });
        }
    });
}

// Přední řada domů a promenáda před městem (pomalé procházky v obou směrech)
function drawTownFront(groundLevel) {
    ctx.drawImage(getTownFrontCache(), 0, 0);
    const t = ambientClock;
    const L = getTownLayout(groundLevel);
    const s = slabScaleAt(L.promenadeY, groundLevel);
    const span = canvas.width + 60;
    for (let i = 0; i < 8; i++) {
        const dir = i % 2 ? 1 : -1;
        const { walked, moving } = stopAndGo(t + i * 2.3, 14, 9);
        const x = wrapX(i * span / 8 + dir * walked * 7 * s, span);
        drawWalker(x, L.promenadeY + (dir > 0 ? 2 : -2) * s, s * 1.3, t * 6 + i, dir, { moving, lamp: i === 3 });
    }
}

// Dělníci u vrtu chodí sem a tam, mají přilbu s čelovkou
// panic: při přetlaku, erupci nebo kaluži dělníci pobíhají rychleji
function drawRigWorkers(centerX, baseY, plotId, panic = false) {
    const t = ambientClock;
    for (let k = 0; k < 2; k++) {
        const phase = t * (panic ? 1.6 : 0.35) + plotId * 1.7 + k * 2.4;
        const x = centerX + Math.sin(phase) * 42 + (k ? 20 : -20);
        const dir = Math.cos(phase) >= 0 ? 1 : -1;
        drawWalker(x, baseY + 3 + k * 2, 1.15, t * (panic ? 14 : 6) + k * 3, dir, { helmet: '#ffc23a', lamp: true });
    }
}

// --- Kamera: přiblížení, posun a třes ---
// Svět má souřadnice plátna při zoomu 1. Kamera ukazuje výřez od (x, y) o velikosti plátna / zoom;
// tx/ty/tzoom jsou cíle, ke kterým se kamera plynule dotahuje.
const CAMERA_MAX_ZOOM = 2.2;
const DRAG_THRESHOLD = 6;
const CAMERA_KEY_STEP = 70;

let camera = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1, shake: 0 };
let dragState = null;
let suppressNextClick = false;
let pointerScreen = { x: 800, y: 450 }; // poslední poloha myši v pixelech plátna (paralaxa)

function clampCamera(alsoCurrent = false) {
    const maxX = canvas.width - canvas.width / camera.tzoom;
    const maxY = canvas.height - canvas.height / camera.tzoom;
    camera.tx = Math.max(0, Math.min(maxX, camera.tx));
    camera.ty = Math.max(0, Math.min(maxY, camera.ty));
    if (alsoCurrent) {
        camera.x = Math.max(0, Math.min(canvas.width - canvas.width / camera.zoom, camera.x));
        camera.y = Math.max(0, Math.min(canvas.height - canvas.height / camera.zoom, camera.y));
    }
}

// Přiblíží kolem bodu (px, py) v pixelech plátna, bod pod kurzorem zůstane na místě
function zoomCameraAt(px, py, factor) {
    const worldX = camera.tx + px / camera.tzoom;
    const worldY = camera.ty + py / camera.tzoom;
    camera.tzoom = Math.max(1, Math.min(CAMERA_MAX_ZOOM, camera.tzoom * factor));
    camera.tx = worldX - px / camera.tzoom;
    camera.ty = worldY - py / camera.tzoom;
    clampCamera();
}

function resetCamera(instant = false) {
    camera.tx = camera.ty = 0;
    camera.tzoom = 1;
    if (instant) {
        camera.x = camera.y = 0;
        camera.zoom = 1;
        camera.shake = 0;
    }
}

function shakeCamera(strength) {
    camera.shake = Math.max(camera.shake, strength);
}

function updateCamera(frameMs) {
    const k = 1 - Math.exp(-frameMs / 90);
    camera.zoom += (camera.tzoom - camera.zoom) * k;
    camera.x += (camera.tx - camera.x) * k;
    camera.y += (camera.ty - camera.y) * k;
    if (Math.abs(camera.tzoom - camera.zoom) < 0.001) camera.zoom = camera.tzoom;
    clampCamera(true);
    camera.shake *= Math.exp(-frameMs / 120);
    if (camera.shake < 0.2) camera.shake = 0;
}

function applyCameraTransform() {
    const sx = camera.shake ? (Math.random() - 0.5) * camera.shake : 0;
    const sy = camera.shake ? (Math.random() - 0.5) * camera.shake : 0;
    const z = camera.zoom;
    ctx.setTransform(z, 0, 0, z, -camera.x * z + sx, -camera.y * z + sy);
}

function handleCameraKey(event) {
    const step = CAMERA_KEY_STEP / camera.tzoom;
    switch (event.key) {
        case 'ArrowLeft': case 'a': case 'A': camera.tx -= step; break;
        case 'ArrowRight': case 'd': case 'D': camera.tx += step; break;
        case 'ArrowUp': case 'w': case 'W': camera.ty -= step; break;
        case 'ArrowDown': case 's': case 'S': camera.ty += step; break;
        case '+': case '=': zoomCameraAt(canvas.width / 2, canvas.height / 2, 1.25); return;
        case '-': case '_': zoomCameraAt(canvas.width / 2, canvas.height / 2, 1 / 1.25); return;
        case '0': resetCamera(); return;
        default: return;
    }
    event.preventDefault();
    clampCamera();
}

// --- Herní smyčka a kreslení ---

let lastFrameTime = 0;

function gameLoop(timestamp) {
    // Kamera, kulisy a průzkumné nástroje běží i před koupí prvního pozemku
    const frameMs = Math.min(timestamp - (lastFrameTime || timestamp), MAX_FRAME_MS);
    lastFrameTime = timestamp;
    updateCamera(frameMs);
    if (!isPaused) {
        if (!isGameOver) updateAmbient(frameMs);
        // Strop snímku (MAX_FRAME_MS): po návratu na kartu nebo při lagu nesmí přijít obří dt
        if (frameMs > 0) update(frameMs * (sharedMode ? 1 : gameSpeed));
    }

    if (isGameOver) drawGameOver();
    else draw();
    requestAnimationFrame(gameLoop);
}

// Krok světa o dt ms (z konzole: isPaused = true; update(16) krokuje ručně).
// Na sdílené mapě se svět mezi zprávami serveru dopočítává jen pro plynulost, události
// a peníze z toho kroku nic neznamenají (server je pošle sám).
function update(dt) {
    if (!world || dt <= 0) return;
    OilSim.step(world, dt);
    const events = world.events.splice(0);
    if (!sharedMode) handleWorldEvents(events);
    syncFromWorld();
    emitClientEffects(dt);
    updateParticles(dt);
}

function draw() {
    const groundLevel = getGroundLevel();

    // Vyčištění a pozadí; svět se kreslí přes kameru, překryvy (vinětace, pauza) v souřadnicích obrazovky
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyCameraTransform();
    drawFarLayer(groundLevel);
    drawSkyAndGround(groundLevel);
    drawSkyLife(groundLevel);
    drawTownLife(groundLevel);
    drawTownFront(groundLevel);

    // Kreslení herních prvků (podzemí, pak deska odzadu dopředu)
    drawOilPockets(groundLevel);
    drawToolEffects(groundLevel);
    drawPipeNetworks();
    drawPlots(groundLevel);

    const structureY = groundLevel - STRUCTURE_BASE_OFFSET;
    plots.forEach(plot => {
        const centerX = plot.x + plotWidth / 2;
        const network = pipeNetworks.find(n => n.derrickId === plot.id);
        drawSpill(plot, groundLevel);
        if (plot.hasVrt) {
            drawDerrick(centerX, structureY, plot.id, network ? network.isPumping : false, network);
            const panic = !!network && (network.blowout > 0 || (network.pressure || 0) >= PRESSURE_WARN || plot.spill > 0.05);
            drawRigWorkers(centerX, structureY, plot.id, panic);
        }
        // Kreslení sil (hladina ukazuje zaplnění zásobníku vrtu)
        const siloFill = network && network.oilCapacity > 0
            ? Math.min(1, network.oilStored / network.oilCapacity) : 0;
        for (let i = 0; i < plot.siloCount; i++) {
            drawSilo(centerX + SILO_OFFSET_X + i * SILO_STEP, structureY + 4 + i * 2, siloFill);
        }
    });

    // Budovy a UI na plátně
    drawCompanyBuildings(groundLevel);

    // Silnice je zapečená v pozadí, auta jezdí po předním pásu desky
    drawTrucks(groundLevel);
    drawParticles();
    drawAmbientDust();
    drawDrones(groundLevel);

    // Štítky zásobníků a manometry až nad kapkami a kouřem, ať jsou vždy čitelné
    plots.forEach(plot => {
        const network = pipeNetworks.find(n => n.derrickId === plot.id);
        if (plot.hasVrt && network && isMine(plot)) drawStorageChip(plot.x + plotWidth / 2, structureY - DERRICK_HEIGHT - 26, network);
    });

    // Kreslení dočasných efektů a náhledů
    drawEffectsAndPreviews(groundLevel);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(getVignette(), 0, 0);

    // Aktualizace HTML UI
    updateUI();

    // Pauza overlay
    if (isPaused) drawPauseScreen();

    // Snímkové časovače (blikání cedule, zvýraznění koupě) tikají v draw, takže fungují i před startem hry
    Object.keys(plotBlinkTimers).forEach(key => {
        plotBlinkTimers[key]--;
        if (plotBlinkTimers[key] <= 0) delete plotBlinkTimers[key];
    });
    if (lastBoughtHighlightTimer > 0) {
        lastBoughtHighlightTimer--;
        if (lastBoughtHighlightTimer === 0) lastBoughtPlotId = null;
    }
}

// Zapíše text jen při změně: updateUI běží každý snímek a zbytečné zápisy do DOM stojí výkon
function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

function formatRate(value, prefix = '') {
    const rounded = Math.round(value);
    return `${rounded >= 0 ? '+' : '−'}${prefix}${Math.abs(rounded).toLocaleString('cs-CZ')}/den`;
}

function updateUI() {
    // Peníze a zdroje
    setText('money-value', Math.floor(money).toLocaleString('cs-CZ'));
    const pumpingRigs = pipeNetworks.filter(n => isMine(n) && n.isPumping);
    setText('stat-rigs', `${pumpingRigs.length}/${plots.filter(p => p.hasVrt && isMine(p)).length}`);
    setText('stat-trucks', `${trucksOwned}/${MAX_TRUCKS}`);
    const storedOil = pipeNetworks.reduce((sum, n) => sum + (isMine(n) ? n.oilStored : 0), 0);
    setText('stat-oil', Math.floor(storedOil).toLocaleString('cs-CZ'));
    setText('stat-oil-rate', formatRate(pumpingRigs.length * OIL_PER_SECOND * MS_PER_DAY / 1000));
    setText('stat-sold', Math.floor(totalOilSold).toLocaleString('cs-CZ'));
    setText('stat-income', formatRate(lastDayIncome, '$'));
    document.getElementById('stat-income').classList.toggle('negative', lastDayIncome < 0);

    // Kalendář: kruh kolem data ukazuje, kolik roku uběhlo
    setText('month', monthNames[month]);
    setText('day', String(day));
    const daysBefore = daysInMonth.slice(1, month).reduce((a, b) => a + b, 0);
    // V závodě kruh ukazuje průběh závodu, jinak průběh roku
    const totalDays = raceMode ? daysInMonth.slice(1, raceMode.months + 1).reduce((a, b) => a + b, 0) : 365;
    document.getElementById('date-dial').style.setProperty('--year', Math.min(1, (daysBefore + day - 1) / totalDays).toFixed(4));

    renderGoals();
    renderActiveNews();

    // Tlačítka
    const buttons = [
        { el: document.getElementById('vrt-btn'), cost: VRT_COST, mode: 'vrt' },
        { el: document.getElementById('silo-btn'), cost: SILO_COST, mode: 'silo' },
        { el: document.getElementById('truck-btn'), cost: TRUCK_COST, isTruck: true },
        { el: document.getElementById('seismic-btn'), cost: SEISMIC_COST, mode: 'seismic', needsOwnedPlot: true },
        { el: document.getElementById('drone-btn'), cost: DRONE_COST, isDrone: true },
        { el: document.getElementById('radar-btn'), cost: RADAR_COST, mode: 'radar' },
    ];

    buttons.forEach(item => {
        if (!item.el) return;

        let isDisabled = money < item.cost;
        if (item.isTruck) isDisabled = isDisabled || trucksOwned >= MAX_TRUCKS;
        if (item.mode === 'silo') {
            const canBuildSilo = plots.some(p => p.owner === myId && p.hasVrt && p.siloCount < MAX_SILOS_PER_PLOT);
            isDisabled = isDisabled || !canBuildSilo;
        }
        const myDrone = drones.some(d => d.owner === myId);
        if (item.isDrone) isDisabled = isDisabled || myDrone;
        if (item.needsOwnedPlot) isDisabled = isDisabled || !plots.some(p => p.owner === myId);
        item.el.disabled = isDisabled;

        if (item.isTruck) {
            const priceEl = item.el.querySelector('.price');
            if (priceEl) priceEl.textContent = `$${item.cost} (${trucksOwned})`;
        }

        if (item.mode) {
            item.el.classList.toggle('active-build-mode', currentBuildMode === item.mode);
        }
        if (item.isDrone) item.el.classList.toggle('active-build-mode', myDrone);
    });

    // Rychlost hry (v závodě zamčená)
    const pauseBtn = document.getElementById('pause-btn');
    pauseBtn.classList.toggle('active', isPaused);
    pauseBtn.disabled = !!raceMode;
    document.querySelectorAll('.time-btn[data-speed]').forEach(btn => {
        btn.classList.toggle('active', !isPaused && Number(btn.dataset.speed) === gameSpeed);
        btn.disabled = !!raceMode;
    });
}

// --- HUD: cíle, oznámení a deník ---

// Cíle roku jsou zatím jen ukazatel postupu, hra je nevyhodnocuje
function getYearGoals() {
    const pumping = pipeNetworks.filter(n => isMine(n) && n.isPumping).length;
    return {
        main: [
            { name: 'Vydělej $20 000', value: totalRevenue, target: 20000, money: true },
            { name: 'Měj 3 čerpající vrty', value: pumping, target: 3 }
        ],
        optional: [
            { name: 'Prodej 2 000 barelů', value: totalOilSold, target: 2000 },
            { name: 'Vlastni 6 kamionů', value: trucksOwned, target: 6 }
        ]
    };
}

let lastGoalsHtml = '';

function renderGoals() {
    const goals = getYearGoals();
    const row = g => {
        const ratio = Math.min(1, g.value / g.target);
        const fmt = v => (g.money ? '$' : '') + Math.floor(v).toLocaleString('cs-CZ');
        return `<div class="goal${ratio >= 1 ? ' done' : ''}">` +
            `<div class="goal-name"><span>${g.name}</span><span class="value">${fmt(Math.min(g.value, g.target))} / ${fmt(g.target)}</span></div>` +
            `<div class="bar"><div style="width:${(ratio * 100).toFixed(1)}%"></div></div></div>`;
    };
    const html = '<div class="goals-title">Ropná horečka</div>' + goals.main.map(row).join('') +
        '<div class="goals-optional">Volitelné</div>' + goals.optional.map(row).join('');
    if (html !== lastGoalsHtml) {
        document.getElementById('hud-goals').innerHTML = html;
        lastGoalsHtml = html;
    }
}

// --- Mimořádné zprávy ---
const NEWS_FLASH_MS = 8000;
let newsFlashTimer = null;
let lastNewsHtml = '';

// Dopad zprávy čitelně: "Rafinerie +35 %, Nádraží zavřené, daň 0"
function describeNewsEffects(effects) {
    const parts = [];
    const pct = mult => `${mult >= 1 ? '+' : '−'}${Math.round(Math.abs(mult - 1) * 100)} %`;
    if (effects.leftClosed) parts.push('Rafinerie zavřená');
    else if (effects.left && effects.left !== 1) parts.push(`Rafinerie ${pct(effects.left)}`);
    if (effects.rightClosed) parts.push('Nádraží zavřené');
    else if (effects.right && effects.right !== 1) parts.push(`Nádraží ${pct(effects.right)}`);
    if (effects.taxMult !== undefined) parts.push(effects.taxMult === 0 ? 'daň z pozemků 0' : `daň ×${effects.taxMult}`);
    if (effects.fineMult) parts.push(`pokuty za erupce ×${effects.fineMult}`);
    if (effects.truckSpeed) parts.push(`kamiony ${pct(effects.truckSpeed)}`);
    return parts;
}

function daysText(n) {
    return `${n} ${n === 1 ? 'den' : (n < 5 ? 'dny' : 'dní')}`;
}

// Velký pruh "Mimořádné zprávy" se znělkou, po chvíli zmizí (zpráva zůstane v seznamu běžících)
function showBreakingNews(e) {
    const box = document.getElementById('news-flash');
    if (!box) return;
    // Zvláštní vydání novin: hlavička, datum, titulek, článek a "burza" s dopadem
    box.innerHTML = '<div class="np-masthead">Pouštní kurýr</div>' +
        '<div class="np-dateline"><span>Zvláštní vydání</span><span class="np-date"></span><span>Cena 5 centů</span></div>' +
        '<div class="np-headline"></div><div class="np-columns"><p class="np-lead"></p><div class="np-market"><b>Burza</b><span></span></div></div>';
    box.querySelector('.np-date').textContent = `${day}. ${MONTH_FULL_NAMES[month]}`;
    box.querySelector('.np-headline').textContent = e.title;
    box.querySelector('.np-lead').textContent = e.desc;
    box.querySelector('.np-market span').textContent = `${describeNewsEffects(e.effects).join(' · ')} · ${daysText(e.days)}`;
    box.classList.remove('hidden', 'leaving');
    void box.offsetWidth; // restart animace, když přijde další zpráva hned po předchozí
    box.classList.add('show');
    clearTimeout(newsFlashTimer);
    newsFlashTimer = setTimeout(() => box.classList.add('leaving'), NEWS_FLASH_MS);
    playSound('news');
    logEvent(`Zprávy: ${e.title}`);
}

// Seznam běžících zpráv pod horní lištou
function renderActiveNews() {
    const active = world?.news?.active || [];
    const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Výstřižky z novin: titulek a dopad, každý trochu nakřivo
    const html = active.map((n, i) => `<div class="news-clip" style="--tilt:${i % 2 ? 0.8 : -0.9}deg" title="${esc(n.desc)}">` +
        `<b>${esc(n.title)}</b><span>${esc(describeNewsEffects(n.effects).join(' · '))} · ${daysText(n.daysLeft)}</span></div>`).join('');
    if (html !== lastNewsHtml) {
        document.getElementById('hud-news').innerHTML = html;
        lastNewsHtml = html;
    }
}

const TOAST_MS = 4500;
const MAX_TOASTS = 3;

// Oznámení vlevo nahoře; zároveň se zapíše do deníku událostí
// --- Ikony (vlastní SVG, žádné emoji): tah currentColor, viewBox 24 ---
const ICONS = {
    flag: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
    derrick: '<path d="M8 21 11 4h2l3 17M9.5 13h5M10.4 8.5h3.2M8.6 18l6.6-6M15.4 18l-6.6-6M5 21h14"/>',
    gusher: '<path d="M12 21v-6M9 21h6M12 15c-3-3-3-6 0-11 3 5 3 8 0 11Z"/><path d="M5 9l2 1M19 9l-2 1M6 4l2 2M18 4l-2 2"/>',
    warning: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    blowout: '<path d="M12 3v4M5 6l3 3M19 6l-3 3M3 13h4M17 13h4"/><path d="M8 21c0-4 1.5-7 4-8 2.5 1 4 4 4 8"/>',
    barrel: '<ellipse cx="12" cy="5" rx="6" ry="2"/><path d="M6 5v14c0 1.1 2.7 2 6 2s6-.9 6-2V5M6 10c0 1.1 2.7 2 6 2s6-.9 6-2M6 15c0 1.1 2.7 2 6 2s6-.9 6-2"/>',
    radar: '<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>',
    skull: '<path d="M5 11a7 7 0 0 1 14 0v3l-2 1v4H7v-4l-2-1v-3Z"/><circle cx="9.5" cy="11.5" r="1.4"/><circle cx="14.5" cy="11.5" r="1.4"/><path d="M10 19v-2M14 19v-2"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
    wire: '<path d="M12 21V5M7 5h10M8 9h8M4 5l3 4M20 5l-3 4"/><circle cx="7" cy="5" r=".8"/><circle cx="17" cy="5" r=".8"/>',
    news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5ZM17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12.5h7M7 16h4"/>',
    soundOn: '<path d="M4 9h3l5-4v14l-5-4H4V9Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    soundOff: '<path d="M4 9h3l5-4v14l-5-4H4V9Z"/><path d="m16 9 5 6M21 9l-5 6"/>',
    people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15.5 14.2c3 .2 5.5 2.5 5.5 5.8"/>',
    fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'
};

function iconSvg(name, cls = 'icon-svg') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.wire}</svg>`;
}

// Oznámení jako telegram: papírový proužek, strojopis, věty končí "STOP", razítko podle druhu
function notify(title, sub, kind = '', icon = 'wire') {
    logEvent(`${title}${sub ? ' – ' + sub : ''}`);
    const box = document.getElementById('hud-toasts');
    if (!box) return;
    const toast = document.createElement('div');
    toast.className = `telegram ${kind}`;
    toast.style.setProperty('--tilt', `${(Math.random() * 2.4 - 1.2).toFixed(2)}deg`);
    toast.innerHTML = `<div class="tg-head"><span class="tg-stamp">${iconSvg(icon)}</span><span class="tg-label">Telegram</span><span class="tg-date"></span></div><div class="tg-body"></div>`;
    toast.querySelector('.tg-date').textContent = `${day}. ${monthNames[month]}`;
    const stop = text => text.replace(/[.!]+$/, '').toUpperCase() + ' STOP';
    toast.querySelector('.tg-body').textContent = [title, sub].filter(Boolean).map(stop).join(' ');
    box.prepend(toast);
    while (box.children.length > MAX_TOASTS) box.lastChild.remove();
    setTimeout(() => toast.classList.add('leaving'), TOAST_MS);
    setTimeout(() => toast.remove(), TOAST_MS + 700);
}

function logEvent(text) {
    eventLog.unshift({ when: `${day}. ${monthNames[month]}`, text });
    if (eventLog.length > EVENT_LOG_LEN) eventLog.length = EVENT_LOG_LEN;
    renderEventLog();
}

function renderEventLog() {
    const box = document.getElementById('hud-log');
    if (!box) return;
    box.innerHTML = '';
    eventLog.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'log-row';
        row.innerHTML = '<span class="when"></span><span class="text"></span>';
        row.querySelector('.when').textContent = entry.when;
        row.querySelector('.text').textContent = entry.text;
        box.appendChild(row);
    });
}


// --- Kreslící pod-funkce ---

// --- Vizuál: dioráma (2.5D) ---
// Herní logika zůstává 2D: groundLevel je přední hrana desky povrchu, nad ní se kreslí
// šikmá deska viděná zvysoka (SLAB_DEPTH px) s nočním městem, pod ní řez podzemím.
// Statické vrstvy (nebe, město, horniny) se předkreslí jednou do sceneCache.
// Paleta: studené měsíční světlo na písku + teplé lampy, plameny rafinerií a žhnoucí ropa.
const SLAB_DEPTH = 250;            // výška horní desky na obrazovce
const VANISH_Y = -520;             // úběžník dělicích čar pozemků (x = střed plátna)
const ROAD_DEPTH = 34;             // silnice zabírá přední pás desky
const STRUCTURE_BASE_OFFSET = 40;  // vrty a sila stojí hned za silnicí
const BUILDING_BASE_OFFSET = 34;   // budovy firem stojí na zadní hraně silnice
const TOWN_DEPTH = 118;            // město zabírá zadní pás desky, vpředu je místo pro vrty
const DERRICK_HEIGHT = 118;
const MOON_X = 1180;               // měsíc, podle něj se nasvěcují hrany
const MOON_Y = 92;
const LIP_HEIGHT = 30;             // průměrná výška skalní hrany řezu pod deskou

let sceneCache = null;
let vignetteCache = null;
let sceneChimneys = []; // komíny ve městě, kouří se z nich za běhu
let townFrontCache = null; // domy před hlavní ulicí: kreslí se až po chodcích, aby je zakryly
let townFrontItems = [];

// Deterministické náhody pro kulisy, ať scéna vypadá při každém načtení stejně
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

function getSlabBackY(groundLevel) {
    return groundLevel - SLAB_DEPTH;
}

// Měřítko perspektivy v hloubce y (1 = přední hrana desky)
function slabScaleAt(y, groundLevel) {
    return (y - VANISH_Y) / (groundLevel - VANISH_Y);
}

// X v hloubce y na desce pro bod, který je na přední hraně v x (perspektiva ke středu)
function slabXAt(x, y, groundLevel) {
    return canvas.width / 2 + (x - canvas.width / 2) * slabScaleAt(y, groundLevel);
}

function slabBackX(x, groundLevel) {
    return slabXAt(x, getSlabBackY(groundLevel), groundLevel);
}

// Lichoběžník pozemku na desce, od frontY (výchozí přední hrana) po backY (výchozí zadní hrana)
function traceSlabQuad(x0, x1, groundLevel, frontY = groundLevel, backY = getSlabBackY(groundLevel)) {
    ctx.beginPath();
    ctx.moveTo(slabXAt(x0, frontY, groundLevel), frontY);
    ctx.lineTo(slabXAt(x1, frontY, groundLevel), frontY);
    ctx.lineTo(slabXAt(x1, backY, groundLevel), backY);
    ctx.lineTo(slabXAt(x0, backY, groundLevel), backY);
    ctx.closePath();
}

function createLayer() {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    return layer;
}

// Kreslí do vrstvy stejnými funkcemi jako do plátna (dočasně podvrhne globální ctx)
function paintLayer(layer, painter) {
    const mainCtx = ctx;
    ctx = layer.getContext('2d');
    try {
        painter();
    } finally {
        ctx = mainCtx;
    }
    return layer;
}

function getSceneCache() {
    if (!sceneCache) {
        const groundLevel = getGroundLevel();
        sceneChimneys = [];
        sceneCache = paintLayer(createLayer(), () => {
            const rand = seededRandom(1859); // rok prvního ropného vrtu
            drawSlab(groundLevel, rand);
            drawTown(groundLevel, rand);
            drawRoad(groundLevel);
            drawUnderground(groundLevel, rand);
            drawCliff(groundLevel, rand);
        });
        townFrontCache = paintLayer(createLayer(), () => {
            townFrontItems.forEach(item => drawTownItem(item, groundLevel));
        });
    }
    return sceneCache;
}

function getTownFrontCache() {
    getSceneCache();
    return townFrontCache;
}

// Vzdálená vrstva (nebe, měsíc, hory) je širší než plátno a posouvá se pomaleji než svět
// (paralaxa při posunu kamery a jemné naklonění podle myši)
const FAR_PAD = 40;
let farCache = null;

function getFarCache() {
    if (!farCache) {
        const groundLevel = getGroundLevel();
        farCache = document.createElement('canvas');
        farCache.width = canvas.width + FAR_PAD * 2;
        farCache.height = getSlabBackY(groundLevel) + 20;
        paintLayer(farCache, () => {
            const rand = seededRandom(1901);
            ctx.translate(FAR_PAD, 0);
            drawSky(groundLevel, rand);
            drawMountains(groundLevel, rand);
        });
    }
    return farCache;
}

function drawFarLayer() {
    const tiltX = (pointerScreen.x / canvas.width - 0.5) * -24;
    const tiltY = (pointerScreen.y / canvas.height) * -8;
    ctx.drawImage(getFarCache(), -FAR_PAD + camera.x * 0.45 + tiltX, camera.y * 0.35 + tiltY);
}

function getVignette() {
    if (!vignetteCache) {
        vignetteCache = paintLayer(createLayer(), () => {
            const w = canvas.width, h = canvas.height;
            const g = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h * 0.5, w * 0.6);
            g.addColorStop(0, 'rgba(0, 0, 0, 0)');
            g.addColorStop(1, 'rgba(4, 4, 10, 0.6)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        });
    }
    return vignetteCache;
}

function drawSkyAndGround() {
    ctx.drawImage(getSceneCache(), 0, 0);
}

function drawSky(groundLevel, rand) {
    const backY = getSlabBackY(groundLevel);
    const sky = ctx.createLinearGradient(0, 0, 0, backY);
    sky.addColorStop(0, '#070912');
    sky.addColorStop(0.6, '#141a2e');
    sky.addColorStop(1, '#2a2a40');
    ctx.fillStyle = sky;
    ctx.fillRect(-FAR_PAD, 0, canvas.width + FAR_PAD * 2, backY + 20);

    for (let i = 0; i < 90; i++) {
        const y = rand() * backY * 0.8;
        ctx.fillStyle = `rgba(220, 230, 255, ${0.15 + rand() * 0.55})`;
        ctx.fillRect(rand() * (canvas.width + FAR_PAD * 2) - FAR_PAD, y, 1.4, 1.4);
    }

    drawGlow(MOON_X, MOON_Y, 160, '150, 170, 230', 0.22);
    ctx.fillStyle = '#e8ecf7';
    ctx.beginPath();
    ctx.arc(MOON_X, MOON_Y, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160, 170, 200, 0.35)'; // krátery
    [[-5, -4, 4], [6, 3, 3], [-2, 7, 2]].forEach(([dx, dy, r]) => {
        ctx.beginPath();
        ctx.arc(MOON_X + dx, MOON_Y + dy, r, 0, Math.PI * 2);
        ctx.fill();
    });

    // Teplý opar nad městem u obzoru
    const haze = ctx.createLinearGradient(0, backY - 60, 0, backY + 2);
    haze.addColorStop(0, 'rgba(255, 140, 80, 0)');
    haze.addColorStop(1, 'rgba(255, 140, 80, 0.16)');
    ctx.fillStyle = haze;
    ctx.fillRect(-FAR_PAD, backY - 60, canvas.width + FAR_PAD * 2, 80);
}

// Stolové hory na obzoru: tmavé siluety s měsíčním světlem na hranách
function drawMountains(groundLevel, rand) {
    const backY = getSlabBackY(groundLevel);
    [
        { color: '#1b1f33', rim: 'rgba(150, 170, 230, 0.25)', maxH: 70, minH: 18 },
        { color: '#141623', rim: 'rgba(150, 170, 230, 0.18)', maxH: 44, minH: 8 }
    ].forEach(layer => {
        const pts = [];
        let x = -FAR_PAD;
        let h = layer.minH;
        pts.push([x, backY - h]);
        while (x < canvas.width + FAR_PAD) {
            const isMesa = rand() < 0.5;
            const nextH = isMesa ? layer.maxH * (0.5 + rand() * 0.5) : layer.minH + rand() * layer.minH;
            const slope = 12 + rand() * 22;
            const flat = isMesa ? 50 + rand() * 130 : 30 + rand() * 70;
            pts.push([x + slope, backY - nextH], [x + slope + flat, backY - nextH]);
            x += slope + flat;
            h = nextH;
        }
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.moveTo(-FAR_PAD, backY + 20); // pata hor je schovaná za deskou (paralaxa ji posouvá)
        pts.forEach(([px, py]) => ctx.lineTo(px, py));
        ctx.lineTo(canvas.width + FAR_PAD * 2, backY + 20);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = layer.rim;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.stroke();
    });
}

// Horní plocha desky: písek v měsíčním světle, vzadu chladnější, vepředu teplejší od lamp
function drawSlab(groundLevel, rand) {
    const backY = getSlabBackY(groundLevel);
    const ground = ctx.createLinearGradient(0, backY, 0, groundLevel);
    ground.addColorStop(0, '#34344a');
    ground.addColorStop(0.45, '#444056');
    ground.addColorStop(1, '#574640');
    ctx.fillStyle = ground;
    ctx.fillRect(0, backY, canvas.width, SLAB_DEPTH);

    // Měsíční lesk na písku
    drawGlow(MOON_X, backY + 40, 520, '140, 160, 220', 0.10);

    // Zrnitost, vepředu větší (perspektiva)
    for (let i = 0; i < 2600; i++) {
        const depth = rand();
        const y = backY + depth * SLAB_DEPTH;
        const size = 0.6 + depth * 1.8;
        ctx.fillStyle = rand() < 0.55 ? 'rgba(10, 8, 20, 0.22)' : 'rgba(200, 200, 230, 0.07)';
        ctx.fillRect(rand() * canvas.width, y, size, size * 0.6);
    }
    // Duny: měkké světlé a tmavé vlny
    for (let i = 0; i < 14; i++) {
        const y = backY + 20 + rand() * (SLAB_DEPTH - 60);
        const s = slabScaleAt(y, groundLevel);
        ctx.strokeStyle = 'rgba(170, 180, 220, 0.06)';
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        const x0 = rand() * canvas.width;
        ctx.moveTo(x0, y);
        ctx.quadraticCurveTo(x0 + 120 * s, y - 10 * s, x0 + 260 * s, y);
        ctx.stroke();
    }
}

// --- Noční město v zadní části desky (jen kulisa, nehraje se s ním) ---
// Geometrie města: hlavní ulice s chodníky a promenáda na jeho přední hraně
function getTownLayout(groundLevel) {
    const backY = getSlabBackY(groundLevel);
    const streetY = backY + 44;
    const s = slabScaleAt(streetY, groundLevel);
    return {
        backY,
        streetY,
        streetScale: s,
        streetHalf: 11 * s,                    // polovina šířky vozovky
        sidewalkNorth: streetY - 9 * s,        // chodník za ulicí (chodí se doleva)
        sidewalkSouth: streetY + 10 * s,       // chodník před ulicí (chodí se doprava)
        clearance: 20,                         // pás bez domů kolem ulice
        promenadeY: backY + TOWN_DEPTH + 5,    // dřevěný chodník před městem
        townEndY: backY + TOWN_DEPTH - 6       // poslední řada domů
    };
}

function drawTown(groundLevel, rand) {
    const L = getTownLayout(groundLevel);
    const backY = L.backY;

    // Cesty z města k polím (pod domy)
    ctx.strokeStyle = 'rgba(90, 75, 70, 0.4)';
    ctx.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
        const x = 120 + i * 270 + rand() * 60;
        ctx.beginPath();
        ctx.moveTo(x, L.streetY);
        ctx.quadraticCurveTo(x + (rand() - 0.5) * 80, L.streetY + 40, slabXAt(x, L.promenadeY, groundLevel), L.promenadeY);
        ctx.stroke();
    }

    // Hlavní ulice s obrubníky
    ctx.fillStyle = 'rgba(70, 60, 62, 0.75)';
    ctx.fillRect(0, L.streetY - L.streetHalf, canvas.width, L.streetHalf * 2);
    ctx.fillStyle = 'rgba(150, 140, 160, 0.18)';
    ctx.fillRect(0, L.streetY - L.streetHalf - 1.5, canvas.width, 1.5);
    ctx.fillRect(0, L.streetY + L.streetHalf, canvas.width, 1.5);
    ctx.fillStyle = 'rgba(255, 220, 150, 0.08)'; // středová čára
    for (let x = 0; x < canvas.width; x += 26) ctx.fillRect(x, L.streetY - 0.5, 12, 1);

    // Promenáda: prkenný chodník před městem
    const ps = slabScaleAt(L.promenadeY, groundLevel);
    ctx.fillStyle = 'rgba(95, 70, 55, 0.6)';
    ctx.fillRect(0, L.promenadeY - 4 * ps, canvas.width, 8 * ps);
    ctx.fillStyle = 'rgba(20, 12, 10, 0.35)';
    for (let x = 0; x < canvas.width; x += 9) ctx.fillRect(x, L.promenadeY - 4 * ps, 1, 8 * ps);

    // Každá stavba má vlastní seed, aby šla přední řada nakreslit znovu do jiné vrstvy
    const items = [];
    for (let i = 0; i < 26; i++) {
        const north = i % 2 === 0;
        items.push({ type: 'lamp', x: 40 + i * 60 + rand() * 20, y: north ? L.streetY - L.streetHalf - 3 : L.streetY + L.streetHalf + 4, seed: 0 });
    }
    for (let i = 0; i < 120; i++) {
        const r = rand();
        const type = r < 0.52 ? 'shack' : r < 0.64 ? 'tank' : r < 0.74 ? 'tent' : r < 0.86 ? 'derrick' : r < 0.9 ? 'water' : 'house';
        const y = backY + 8 + Math.pow(rand(), 0.85) * (L.townEndY - backY - 8);
        const x = rand() * canvas.width;
        const seed = Math.floor(rand() * 1e9);
        if (Math.abs(y - L.streetY) < L.clearance) continue; // ulice a chodníky zůstávají volné
        const item = fitTownItemInFront({ type, x, y, seed }, L, groundLevel);
        if (item) items.push(item);
    }
    items.sort((a, b) => a.y - b.y);
    townFrontItems = items.filter(item => item.y > L.streetY);
    items.filter(item => item.y <= L.streetY).forEach(item => drawTownItem(item, groundLevel));
}

// Nejvyšší možná výška stavby daného typu (bez měřítka), viz kreslicí funkce níž
const TOWN_ITEM_MAX_HEIGHT = { house: 74, derrick: 61, water: 53, shack: 54, tank: 26, tent: 15 }; // vč. komína

// Stavba před ulicí nesmí střechou zasáhnout do chodníku, jinak chodci za ní vypadají,
// jako by stáli na střeše. Když se nevejde, zkusí se nižší typ (bouda, nádrž, stan).
function fitTownItemInFront(item, L, groundLevel) {
    if (item.y <= L.streetY) return item;
    const room = item.y - L.sidewalkSouth - 3;
    const s = slabScaleAt(item.y, groundLevel);
    const candidates = [item.type, 'shack', 'tank', 'tent'];
    const type = candidates.find(t => TOWN_ITEM_MAX_HEIGHT[t] * s <= room);
    return type ? { ...item, type } : null;
}

function drawTownItem(item, groundLevel) {
    const s = slabScaleAt(item.y, groundLevel);
    const rand = seededRandom(item.seed);
    switch (item.type) {
        case 'shack': drawTownShack(item.x, item.y, s, rand, false); break;
        case 'house': drawTownShack(item.x, item.y, s, rand, true); break;
        case 'tank': drawTownTank(item.x, item.y, s); break;
        case 'tent': drawTownTent(item.x, item.y, s, rand); break;
        case 'derrick': drawTownDerrick(item.x, item.y, s); break;
        case 'water': drawTownWaterTower(item.x, item.y, s); break;
        case 'lamp': drawTownLamp(item.x, item.y, s); break;
    }
}

function drawGroundShadow(x, y, w, s) {
    ctx.fillStyle = 'rgba(5, 5, 15, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x - 6 * s, y + 1, w * 0.6, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
}

// Dřevěná bouda / dvoupatrový dům: čelo, bok do hloubky, střecha s měsíční hranou, svítící okna
function drawTownShack(x, y, s, rand, tall) {
    const w = (tall ? 46 : 30) * s + rand() * 22 * s;
    const h = (tall ? 40 : 20) * s + rand() * 14 * s;
    const depth = 9 * s;
    drawGroundShadow(x + w / 2, y, w, s);
    ctx.fillStyle = '#1c1b28'; // bok
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x - depth, y - h - depth * 0.6);
    ctx.lineTo(x - depth, y - depth * 0.6);
    ctx.closePath();
    ctx.fill();
    const wall = ctx.createLinearGradient(x, 0, x + w, 0);
    wall.addColorStop(0, '#2e2c3c');
    wall.addColorStop(1, '#3d3a4e');
    ctx.fillStyle = wall;
    ctx.fillRect(x, y - h, w, h);

    const gable = rand() < 0.55;
    ctx.fillStyle = '#17161f';
    ctx.beginPath();
    if (gable) {
        ctx.moveTo(x - depth - 2 * s, y - h - depth * 0.6);
        ctx.lineTo(x - 2 * s, y - h);
        ctx.lineTo(x + w / 2, y - h - 14 * s);
        ctx.lineTo(x + w + 2 * s, y - h);
        ctx.lineTo(x + w / 2 - depth, y - h - 14 * s - depth * 0.6);
    } else {
        ctx.moveTo(x - depth - 2 * s, y - h - depth * 0.6 - 3 * s);
        ctx.lineTo(x + w + 3 * s, y - h - 1 * s);
        ctx.lineTo(x + w + 3 * s, y - h + 2 * s);
        ctx.lineTo(x - depth - 2 * s, y - h - depth * 0.6);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 185, 235, 0.45)'; // měsíc na hřebeni
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (gable) {
        ctx.moveTo(x + w / 2 - depth, y - h - 14 * s - depth * 0.6);
        ctx.lineTo(x + w / 2, y - h - 14 * s);
        ctx.lineTo(x + w + 2 * s, y - h);
    } else {
        ctx.moveTo(x - depth - 2 * s, y - h - depth * 0.6 - 3 * s);
        ctx.lineTo(x + w + 3 * s, y - h - 1 * s);
    }
    ctx.stroke();

    // Okna: část svítí teple
    const rows = tall ? 2 : 1;
    const cols = Math.max(1, Math.floor(w / (13 * s)));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (rand() < 0.35) continue;
            const wx = x + 4 * s + c * (w - 8 * s) / cols;
            const wy = y - h + 5 * s + r * 16 * s;
            const lit = rand() < 0.75;
            ctx.fillStyle = lit ? '#ffbe6a' : '#14131c';
            ctx.fillRect(wx, wy, 5 * s, 6 * s);
            if (lit) drawGlow(wx + 2.5 * s, wy + 3 * s, 16 * s, '255, 160, 70', 0.28);
        }
    }
    if (rand() < 0.45) { // komín
        const cx = x + w * 0.7;
        const top = y - h - (gable ? 12 : 6) * s;
        ctx.fillStyle = '#121119';
        ctx.fillRect(cx, top - 8 * s, 4 * s, 9 * s);
        sceneChimneys.push({ x: cx + 2 * s, y: top - 8 * s, s, phase: rand() * 10 });
    }
}

function drawTownTank(x, y, s) {
    const w = 26 * s, h = 20 * s;
    drawGroundShadow(x + w / 2, y, w, s);
    const steel = ctx.createLinearGradient(x, 0, x + w, 0);
    steel.addColorStop(0, '#22222e');
    steel.addColorStop(0.7, '#3d3d52');
    steel.addColorStop(1, '#8890b8');
    ctx.fillStyle = steel;
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = '#4a4b64';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y - h, w / 2, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff9a4a'; // výstražné světélko
    ctx.fillRect(x + w / 2 - 1, y - h - 2 * s, 2, 2);
    drawGlow(x + w / 2, y - h - 1, 8 * s, '255, 120, 50', 0.4);
}

function drawTownTent(x, y, s, rand) {
    const w = 22 * s, h = 15 * s;
    drawGroundShadow(x + w / 2, y, w, s);
    ctx.fillStyle = '#6d6560';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w / 2, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a433f';
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y - h);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w * 0.6, y);
    ctx.closePath();
    ctx.fill();
    if (rand() < 0.7) { // lucerna uvnitř prosvítá plátnem
        ctx.fillStyle = 'rgba(255, 170, 90, 0.5)';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.35, y);
        ctx.lineTo(x + w / 2, y - h * 0.6);
        ctx.lineTo(x + w * 0.62, y);
        ctx.closePath();
        ctx.fill();
        drawGlow(x + w / 2, y - h * 0.3, 22 * s, '255, 150, 70', 0.3);
    }
}

// Vzdálená vrtná věž cizí firmy: silueta s lampou
function drawTownDerrick(x, y, s) {
    const h = 58 * s, half = 12 * s;
    drawGroundShadow(x, y, half * 2, s);
    ctx.strokeStyle = '#15141d';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(x - half, y);
    ctx.lineTo(x - 2 * s, y - h);
    ctx.lineTo(x + 2 * s, y - h);
    ctx.lineTo(x + half, y);
    for (let i = 1; i < 5; i++) {
        const yy = y - h * i / 5;
        const hw = half - (half - 2 * s) * i / 5;
        ctx.moveTo(x - hw, yy);
        ctx.lineTo(x + hw, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170, 185, 235, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + half, y);
    ctx.lineTo(x + 2 * s, y - h);
    ctx.stroke();
    ctx.fillStyle = '#ffcf80';
    ctx.fillRect(x - 1, y - h - 3 * s, 2, 2);
    drawGlow(x, y - h - 2 * s, 18 * s, '255, 160, 70', 0.45);
}

function drawTownWaterTower(x, y, s) {
    const h = 44 * s, w = 22 * s;
    drawGroundShadow(x, y, w, s);
    ctx.strokeStyle = '#15141d';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w / 3, y - h * 0.55);
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 3, y - h * 0.55);
    ctx.moveTo(x - w / 2.4, y - h * 0.25);
    ctx.lineTo(x + w / 2.4, y - h * 0.25);
    ctx.stroke();
    ctx.fillStyle = '#2c2a3a';
    ctx.fillRect(x - w / 2, y - h, w, h * 0.45);
    ctx.fillStyle = '#1b1a26';
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 2 * s, y - h);
    ctx.lineTo(x, y - h - 9 * s);
    ctx.lineTo(x + w / 2 + 2 * s, y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(170, 185, 235, 0.35)';
    ctx.fillRect(x + w / 2 - 3 * s, y - h, 3 * s, h * 0.45);
}

function drawTownLamp(x, y, s) {
    ctx.fillStyle = '#121119';
    ctx.fillRect(x, y - 16 * s, 1.5, 16 * s);
    ctx.fillStyle = '#ffd890';
    ctx.fillRect(x - 1, y - 18 * s, 3.5, 3);
    drawGlow(x, y - 16 * s, 22 * s, '255, 170, 80', 0.45);
    // Kruh světla na zemi
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 150, 70, 0.07)';
    ctx.beginPath();
    ctx.ellipse(x, y, 26 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawRoad(groundLevel) {
    const top = groundLevel - ROAD_DEPTH;
    const road = ctx.createLinearGradient(0, top, 0, groundLevel);
    road.addColorStop(0, '#2f2a33');
    road.addColorStop(1, '#3a2f2e');
    ctx.fillStyle = road;
    ctx.fillRect(0, top, canvas.width, ROAD_DEPTH);
    ctx.fillStyle = 'rgba(190, 200, 240, 0.06)'; // vyjeté koleje v měsíčním světle
    [top + 9, top + 13, top + 22, top + 27].forEach(y => ctx.fillRect(0, y, canvas.width, 1.5));
    ctx.fillStyle = 'rgba(10, 8, 15, 0.45)';
    ctx.fillRect(0, top, canvas.width, 2);
}

// Řez podzemím: tmavá skála z balvanů, jemné vrstvy, studené krystalky a tma ke dnu
function drawUnderground(groundLevel, rand) {
    const top = groundLevel;
    const h = canvas.height - top;
    const base = ctx.createLinearGradient(0, top, 0, canvas.height);
    base.addColorStop(0, '#2a1f1a');
    base.addColorStop(0.6, '#17110e');
    base.addColorStop(1, '#090706');
    ctx.fillStyle = base;
    ctx.fillRect(0, top, canvas.width, h);

    const shades = ['#2c211b', '#251c17', '#1e1713', '#33261e', '#211915'];
    const rocks = [];
    for (let i = 0; i < 520; i++) {
        rocks.push({ x: rand() * canvas.width, y: top + rand() * h, r: 8 + Math.pow(rand(), 2) * 46 });
    }
    rocks.sort((a, b) => b.r - a.r);
    rocks.forEach(rock => {
        const depthFade = 1 - (rock.y - top) / h * 0.6;
        const n = 6 + Math.floor(rand() * 3);
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
            const a = (j / n) * Math.PI * 2;
            const rr = rock.r * (0.7 + rand() * 0.35);
            const px = rock.x + Math.cos(a) * rr;
            const py = rock.y + Math.sin(a) * rr * 0.7;
            if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.globalAlpha = depthFade;
        ctx.fillStyle = shades[Math.floor(rand() * shades.length)];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 220, 190, 0.05)'; // horní hrana balvanu
        ctx.beginPath();
        ctx.ellipse(rock.x, rock.y, rock.r * 0.7, rock.r * 0.45, 0, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.globalAlpha = 1;
    });

    // Praskliny ve vrstvách
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
        const y0 = top + 70 + i * (h - 120) / 5 + rand() * 30;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= canvas.width; x += 40) ctx.lineTo(x, y0 + Math.sin(x * 0.006 + i) * 12 + (rand() - 0.5) * 8);
        ctx.stroke();
    }

    // Studené minerály: drobné modré body, kontrast k teplé ropě
    for (let i = 0; i < 28; i++) {
        const x = rand() * canvas.width;
        const y = top + 60 + rand() * (h - 160);
        ctx.fillStyle = 'rgba(150, 210, 255, 0.7)';
        ctx.fillRect(x, y, 2, 2);
        drawGlow(x + 1, y + 1, 7, '110, 180, 255', 0.35);
    }

    const fade = ctx.createLinearGradient(0, canvas.height - 180, 0, canvas.height);
    fade.addColorStop(0, 'rgba(5, 4, 4, 0)');
    fade.addColorStop(1, 'rgba(5, 4, 4, 0.85)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, canvas.height - 180, canvas.width, 180);
}

// Skalní hrana pod deskou: zubatý spodní okraj, svislé žíly, světlo na lomu a stín pod ní
function drawCliff(groundLevel, rand) {
    const top = groundLevel;
    const pts = [];
    for (let x = 0; x <= canvas.width + 14; x += 14) {
        pts.push([x, top + LIP_HEIGHT * (0.6 + rand() * 0.8)]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, top);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(canvas.width, top);
    ctx.closePath();
    const face = ctx.createLinearGradient(0, top, 0, top + LIP_HEIGHT * 1.4);
    face.addColorStop(0, '#4a3b3a');
    face.addColorStop(1, '#241a18');
    ctx.fillStyle = face;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 260; i++) {
        const x = rand() * canvas.width;
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x + (rand() - 0.5) * 6, top + LIP_HEIGHT * 1.4);
        ctx.stroke();
    }
    ctx.restore();

    // Stín pod převisem
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.clip();
    const ao = ctx.createLinearGradient(0, top + LIP_HEIGHT * 0.6, 0, top + LIP_HEIGHT + 60);
    ao.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    ao.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ao;
    ctx.fillRect(0, top, canvas.width, LIP_HEIGHT + 70);
    ctx.restore();

    ctx.fillStyle = 'rgba(200, 200, 235, 0.45)'; // měsíc na hraně desky
    ctx.fillRect(0, top, canvas.width, 1.5);
}

// Kouř z komínů města a prach v měsíčním světle; jen kresba, poloha je funkcí času
function drawAmbientDust() {
    const t = performance.now() / 1000;
    const groundLevel = getGroundLevel();
    ctx.save();
    sceneChimneys.forEach(ch => {
        for (let k = 0; k < 3; k++) {
            const life = ((t * 0.35 + ch.phase + k / 3) % 1);
            const r = (2 + life * 7) * ch.s;
            ctx.fillStyle = `rgba(120, 120, 145, ${0.22 * (1 - life)})`;
            ctx.beginPath();
            ctx.arc(ch.x - life * 10 * ch.s, ch.y - life * 26 * ch.s, r, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 30; i++) {
        const speed = 5 + (i * 7) % 11;
        const x = ((i * 389.7 + t * speed) % (canvas.width + 40)) - 20;
        const y = 60 + ((i * 53.3) % (groundLevel - 80)) + Math.sin(t * 0.7 + i) * 6;
        const alpha = 0.08 + 0.07 * Math.sin(t * 1.3 + i * 2.1);
        ctx.fillStyle = `rgba(200, 215, 255, ${Math.max(0, alpha)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Měkká záře (aditivní), pro lampy, okna, světla aut a ložiska
function drawGlow(x, y, radius, color, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${color}, ${alpha})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
}

// Přidám globální pole pro hitboxy cedulí
let plotSignHitboxes = [];
let plotsHoverPointer = false; // myš je nad cedulí nebo stavitelným pozemkem

const PLOT_SIGN_PAD = 10;
const PLOT_SIGN_POST = 30; // výška sloupku: cedule musí být nad střechami projíždějících aut
const PLOT_SIGN_FONT = 'bold 18px "Rye", Georgia, serif';

function getPlotSignRect(plot, groundLevel) {
    const signWidth = 92;
    const signHeight = 32;
    const postHeight = PLOT_SIGN_POST;
    const signX = Math.round(plot.x + (plotWidth / 2) - (signWidth / 2));
    const signY = Math.round(groundLevel - STRUCTURE_BASE_OFFSET - postHeight - signHeight);
    return { plotId: plot.id, x: signX, y: signY, width: signWidth, height: signHeight };
}

function getPlotSignHitbox(sign) {
    return {
        x: sign.x - PLOT_SIGN_PAD,
        y: sign.y - PLOT_SIGN_PAD,
        width: sign.width + PLOT_SIGN_PAD * 2,
        height: sign.height + PLOT_SIGN_PAD * 2
    };
}

function isPlotSurfaceHovered(plot, groundLevel) {
    return mousePos.y <= groundLevel &&
        mousePos.x >= plot.x && mousePos.x < plot.x + plotWidth;
}

function isPlotSignHovered(sign) {
    return isPointInRect(mousePos, getPlotSignHitbox(sign));
}

function drawPlotPurchaseHighlight(plot, groundLevel, canAfford) {
    const color = canAfford ? '255, 200, 90' : '255, 80, 70';
    ctx.save();
    // Světelný sloupec nad pozemkem a rozsvícená plocha desky
    const backY = getSlabBackY(groundLevel);
    const beam = ctx.createLinearGradient(0, 0, 0, backY);
    beam.addColorStop(0, `rgba(${color}, 0)`);
    beam.addColorStop(1, `rgba(${color}, 0.16)`);
    ctx.fillStyle = beam;
    ctx.fillRect(slabBackX(plot.x, groundLevel), 0,
        slabBackX(plot.x + plotWidth, groundLevel) - slabBackX(plot.x, groundLevel), backY);
    traceSlabQuad(plot.x, plot.x + plotWidth, groundLevel);
    ctx.fillStyle = `rgba(${color}, 0.16)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${color}, 0.7)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function getPlotToPurchase(clickPos, groundLevel) {
    updatePlotSignHitboxes(groundLevel);
    for (const sign of plotSignHitboxes) {
        if (isPointInRect(clickPos, sign)) {
            const plot = plots.find(p => p.id === sign.plotId);
            if (plot && !plot.owner) return plot;
        }
    }
    return getPurchasablePlotAt(clickPos, groundLevel);
}

function updatePlotSignHitboxes(groundLevel) {
    plotSignHitboxes = [];
    plots.forEach(plot => {
        if (plot.owner === null) {
            const rect = getPlotSignRect(plot, groundLevel);
            plotSignHitboxes.push({
                plotId: rect.plotId,
                x: rect.x - PLOT_SIGN_PAD,
                y: rect.y - PLOT_SIGN_PAD,
                width: rect.width + PLOT_SIGN_PAD * 2,
                height: rect.height + PLOT_SIGN_PAD * 2
            });
        }
    });
}

function getCanvasViewport() {
    const rect = canvas.getBoundingClientRect();
    const canvasAspect = canvas.width / canvas.height;
    const rectAspect = rect.width / rect.height;

    let renderWidth, renderHeight, offsetX, offsetY;

    if (rectAspect > canvasAspect) {
        renderHeight = rect.height;
        renderWidth = renderHeight * canvasAspect;
        offsetX = (rect.width - renderWidth) / 2;
        offsetY = 0;
    } else {
        renderWidth = rect.width;
        renderHeight = renderWidth / canvasAspect;
        offsetX = 0;
        offsetY = (rect.height - renderHeight) / 2;
    }

    return { rect, renderWidth, renderHeight, offsetX, offsetY };
}

function getCanvasPosition(event) {
    const { rect, renderWidth, renderHeight, offsetX, offsetY } = getCanvasViewport();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;

    const rawX = (clientX - rect.left - offsetX) * (canvas.width / renderWidth);
    const rawY = (clientY - rect.top - offsetY) * (canvas.height / renderHeight);
    const px = Math.max(0, Math.min(canvas.width, rawX));
    const py = Math.max(0, Math.min(canvas.height, rawY));

    // x/y jsou souřadnice světa (přes kameru), px/py pixely plátna
    return {
        x: camera.x + px / camera.zoom,
        y: camera.y + py / camera.zoom,
        px,
        py,
        inBounds: rawX >= 0 && rawX <= canvas.width && rawY >= 0 && rawY <= canvas.height
    };
}

function isPointInRect(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + rect.height;
}

function getPlotAtX(x) {
    if (x < 0 || x > canvas.width) return null;
    for (const plot of plots) {
        if (x >= plot.x && x < plot.x + plotWidth) {
            return plot;
        }
    }
    return null;
}

function getPlotAtPosition(x, y, groundLevel) {
    if (y > groundLevel) return null;
    return getPlotAtX(x);
}

function getPurchasablePlotAt(clickPos, groundLevel) {
    if (clickPos.y > groundLevel) return null;
    return plots.find(p => p.owner === null &&
        clickPos.x >= p.x && clickPos.x < p.x + plotWidth) || null;
}

function tryPurchasePlot(plot, groundLevel) {
    if (!plot || plot.owner) return 'none';
    if (money >= plot.price) {
        doAction({ type: 'buyPlot', plotId: plot.id });
        updatePlotSignHitboxes(groundLevel);
        return 'bought';
    }
    plotBlinkTimers[plot.id] = 20;
    return 'too_expensive';
}

function drawPlots(groundLevel) {
    const backY = getSlabBackY(groundLevel);
    const fieldBackY = getTownLayout(groundLevel).promenadeY + 8; // pole pozemků začínají za promenádou
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 10]);
    for (let i = 1; i < PLOT_COUNT; i++) {
        const x = plots[i].x;
        // Na desce se hranice sbíhají k úběžníku, v podzemí jdou kolmo dolů
        ctx.strokeStyle = 'rgba(255, 225, 180, 0.22)';
        ctx.beginPath();
        ctx.moveTo(slabXAt(x, groundLevel - ROAD_DEPTH, groundLevel), groundLevel - ROAD_DEPTH);
        ctx.lineTo(slabXAt(x, fieldBackY, groundLevel), fieldBackY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 220, 180, 0.07)';
        ctx.beginPath();
        ctx.moveTo(x, groundLevel + LIP_HEIGHT);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Koupené pozemky: zoraná tmavší půda, praporek a rozsvícená přední hrana v barvě vlastníka.
    // Na sdílené mapě nese praporek soupeře i jeho jméno.
    plots.forEach(plot => {
        if (!plot.owner) return;
        const mine = plot.owner === myId;
        const color = sharedMode ? playerColor(plot.owner) : '#ffb347';
        ctx.save();
        traceSlabQuad(plot.x + 3, plot.x + plotWidth - 3, groundLevel, groundLevel - ROAD_DEPTH, fieldBackY);
        ctx.fillStyle = mine ? 'rgba(30, 14, 8, 0.32)' : 'rgba(10, 10, 25, 0.28)';
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = color;
        ctx.fillRect(plot.x + 4, groundLevel, plotWidth - 8, 2);
        ctx.globalAlpha = 1;
        const fy = fieldBackY + 34;
        const fx = slabXAt(plot.x + 10, fy, groundLevel) + 4;
        ctx.fillStyle = '#2a1a12';
        ctx.fillRect(fx, fy - 26, 2, 26);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(fx + 2, fy - 26);
        ctx.lineTo(fx + 16, fy - 21);
        ctx.lineTo(fx + 2, fy - 16);
        ctx.closePath();
        ctx.fill();
        if (sharedMode && !mine) {
            ctx.font = '600 11px "Barlow Condensed", system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(10, 10, 20, 0.8)';
            const name = world.players[plot.owner]?.name || '';
            ctx.strokeText(name, fx + 19, fy - 21);
            ctx.fillText(name, fx + 19, fy - 21);
        }
        ctx.restore();
    });

    updatePlotSignHitboxes(groundLevel);
    let hoveredAny = false;
    let hoveredBuildable = false;
    plots.forEach(plot => {
        if (plot.owner === null) {
            const sign = getPlotSignRect(plot, groundLevel);
            const signX = sign.x;
            const signY = sign.y;
            const signWidth = sign.width;
            const signHeight = sign.height;
            const postHeight = PLOT_SIGN_POST;
            const canAfford = money >= plot.price;
            const plotHovered = isPlotSurfaceHovered(plot, groundLevel);
            const signHovered = isPlotSignHovered(sign);
            const isHovered = plotHovered || signHovered;
            if (isHovered) hoveredAny = true;

            if (isHovered) {
                drawPlotPurchaseHighlight(plot, groundLevel, canAfford);
            }

            const postBase = groundLevel - STRUCTURE_BASE_OFFSET;
            const postX = Math.round(plot.x + (plotWidth / 2) - 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // stín sloupku
            ctx.beginPath();
            ctx.ellipse(postX + 2, postBase, 9, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#3a2216';
            ctx.fillRect(postX, postBase - postHeight, 4, postHeight);

            ctx.save();
            if (isHovered) {
                ctx.shadowColor = canAfford ? 'rgba(255, 200, 90, 0.8)' : 'rgba(255, 80, 70, 0.7)';
                ctx.shadowBlur = 16;
            }
            pathRoundRect(signX, signY, signWidth, signHeight, 5);
            const board = ctx.createLinearGradient(0, signY, 0, signY + signHeight);
            board.addColorStop(0, '#5a3522');
            board.addColorStop(1, '#3b2216');
            ctx.fillStyle = board;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = isHovered ? (canAfford ? '#ffc864' : '#ff6b5a') : 'rgba(255, 210, 160, 0.35)';
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 220, 170, 0.12)'; // horní hrana chytá světlo
            ctx.fillRect(signX + 3, signY + 2, signWidth - 6, 2);
            ctx.restore();

            ctx.font = PLOT_SIGN_FONT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = canAfford ? '#ffd98a' : '#ff8a70';
            ctx.fillText(`$${plot.price}`, plot.x + plotWidth / 2, signY + signHeight / 2 + 1);

            if (plotBlinkTimers[plot.id] && plotBlinkTimers[plot.id] % 4 < 2) {
                ctx.fillStyle = 'rgba(255, 60, 40, 0.4)';
                pathRoundRect(signX, signY, signWidth, signHeight, 5);
                ctx.fill();
            }
        } else if (plot.id === lastBoughtPlotId && lastBoughtHighlightTimer > 0) {
            // Zvýraznění právě koupeného pozemku: zablikne plocha desky, NE vrt!
            ctx.save();
            traceSlabQuad(plot.x, plot.x + plotWidth, groundLevel);
            ctx.fillStyle = `rgba(255, 200, 90, ${0.35 * lastBoughtHighlightTimer / 30})`;
            ctx.fill();
            ctx.restore();
        }
        // Nově: pokud je aktivní build mód vrtu a myš je nad vlastněným pozemkem bez vrtu
        if (currentBuildMode === 'vrt' && plot.owner === myId && !plot.hasVrt) {
            const px = plot.x;
            const py = groundLevel;
            if (mousePos.x >= px && mousePos.x <= px + plotWidth && mousePos.y >= 0 && mousePos.y <= py) {
                hoveredBuildable = true;
            }
        }
    });
    // Kurzor nastaví až drawEffectsAndPreviews (jinak by ho přepsal)
    plotsHoverPointer = hoveredAny || hoveredBuildable;
}

// Organický obrys ložiska jen pro kresbu: hrany polygonu rozdělené a zvlněné ven.
// Kolize dál počítá s pocket.vertices; obrys je o pár px vysunutý ven, aby kresba
// polygon spíš překrývala, než aby trubka trefila ložisko mimo nakreslený tvar.
const pocketShapes = new Map(); // pocket.id -> obrys; resetLocalUi ho maže při novém světě

function getPocketShape(pocket) {
    const cached = pocketShapes.get(pocket.id);
    if (cached) return cached;
    const rand = seededRandom(9137 + pocket.id * 7919);
    const v = pocket.vertices;
    const cx = pocket.x + pocket.width / 2;
    const cy = pocket.y + pocket.height / 2;
    const pts = [];
    for (let i = 0; i < v.length; i++) {
        const a = v[i], b = v[(i + 1) % v.length];
        const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 12));
        for (let k = 0; k < steps; k++) {
            const px = a.x + (b.x - a.x) * k / steps;
            const py = a.y + (b.y - a.y) * k / steps;
            const d = Math.hypot(px - cx, py - cy) || 1;
            const push = 2 + rand() * 6;
            pts.push({ x: px + (px - cx) / d * push, y: py + (py - cy) / d * push });
        }
    }
    pocketShapes.set(pocket.id, pts);
    return pts;
}

function tracePocket(pocket) {
    const pts = getPocketShape(pocket);
    ctx.beginPath();
    const last = pts[pts.length - 1];
    ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], n = pts[(i + 1) % pts.length];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    ctx.closePath();
}

function drawOilPockets(groundLevel) {
    const t = performance.now() / 1000;
    oilPockets.forEach(pocket => {
        const fillRatio = pocket.maxOil > 0 ? pocket.oil / pocket.maxOil : 0;
        const cx = pocket.x + pocket.width / 2;
        const cy = pocket.y + pocket.height / 2;

        // Zobrazit plné ložisko jen pokud bylo zasaženo vrtem nebo odhaleno krtkem
        if (DEV || pocket.tapped || pocket.revealed) {
            const pumping = pipeNetworks.some(n => n.connectedPocket === pocket && n.isPumping);
            const pulse = 0.8 + 0.2 * Math.sin(t * 2.2 + cx);
            const heat = pumping ? fillRatio * pulse : 0; // těžené ložisko žhne, s ubývající ropou slábne
            const size = Math.max(pocket.width, pocket.height);
            if (pumping) drawGlow(cx, cy, size * 1.1, '255, 110, 30', 0.38 * (0.25 + heat));

            ctx.save();
            tracePocket(pocket);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'; // vyhloubená dutina ve skále
            ctx.lineWidth = 12;
            ctx.stroke();
            const oil = ctx.createRadialGradient(cx, cy + pocket.height * 0.1, 2, cx, cy, size * 0.6);
            if (pumping) {
                oil.addColorStop(0, `rgba(255, 200, 100, ${0.25 + 0.7 * heat})`);
                oil.addColorStop(0.35, `rgba(220, 90, 25, ${0.35 + 0.5 * heat})`);
                oil.addColorStop(1, 'rgba(25, 8, 3, 0.96)');
            } else {
                oil.addColorStop(0, `rgba(60, 42, 30, ${0.6 + fillRatio * 0.35})`);
                oil.addColorStop(1, `rgba(6, 4, 3, ${0.7 + fillRatio * 0.28})`);
            }
            ctx.fillStyle = oil;
            ctx.fill();
            ctx.strokeStyle = pumping ? `rgba(255, 170, 70, ${0.4 + 0.5 * heat})` : 'rgba(255, 190, 120, 0.25)';
            ctx.lineWidth = pumping ? 2 : 1.2;
            ctx.stroke();
            ctx.clip();
            if (pumping) { // bublinky stoupající ke stropu dutiny
                ctx.globalCompositeOperation = 'lighter';
                for (let b = 0; b < 6; b++) {
                    const life = (t * 0.4 + b / 6 + cx * 0.01) % 1;
                    const bx = cx + Math.sin(b * 2.3 + cx) * pocket.width * 0.3;
                    const by = cy + pocket.height * 0.4 - life * pocket.height * 0.8;
                    ctx.fillStyle = `rgba(255, 210, 120, ${0.5 * (1 - life) * heat})`;
                    ctx.beginPath();
                    ctx.arc(bx, by, 1.5 + b % 3, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            }
            ctx.fillStyle = 'rgba(255, 230, 200, 0.10)'; // lesk hladiny
            ctx.beginPath();
            ctx.ellipse(cx - pocket.width * 0.15, cy - pocket.height * 0.22, pocket.width * 0.22, pocket.height * 0.08, -0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    });

    // Štítky až po všech ložiscích, aby je záře sousedního ložiska nepřekryla
    oilPockets.forEach(pocket => {
        if (!(DEV || pocket.tapped || pocket.revealed)) return;
        drawPocketChip(pocket, pipeNetworks.some(n => n.connectedPocket === pocket && n.isPumping));
    });
}

// Štítek ložiska vpravo od něj: zbývající ropa a stav
function drawPocketChip(pocket, pumping) {
    const w = 150, h = 38;
    const x = Math.min(pocket.x + pocket.width - 6, canvas.width - w - 8);
    const y = pocket.y + pocket.height * 0.5 - 18;
    ctx.save();
    pathRoundRect(x, y, w, h, 6);
    ctx.fillStyle = 'rgba(14, 10, 16, 0.78)';
    ctx.fill();
    ctx.strokeStyle = pumping ? 'rgba(255, 170, 80, 0.55)' : 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Ikona kapky v kroužku
    ctx.fillStyle = pumping ? 'rgba(255, 150, 60, 0.25)' : 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(x + 17, y + h / 2, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pumping ? '#ffb45a' : '#e8d8c4';
    ctx.beginPath();
    ctx.moveTo(x + 17, y + h / 2 - 7);
    ctx.quadraticCurveTo(x + 24, y + h / 2 + 2, x + 17, y + h / 2 + 5);
    ctx.quadraticCurveTo(x + 10, y + h / 2 + 2, x + 17, y + h / 2 - 7);
    ctx.fill();
    ctx.font = '600 9px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 230, 200, 0.6)';
    ctx.fillText('ROPNÉ LOŽISKO', x + 34, y + 13);
    ctx.font = '700 14px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillStyle = '#fff2df';
    ctx.fillText(Math.floor(pocket.oil).toLocaleString('cs-CZ'), x + 34, y + 29);
    ctx.font = '600 10px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = pocket.oil <= 0 ? '#ff8a70' : (pumping ? '#ffb45a' : '#9ad1ff');
    ctx.fillText(pocket.oil <= 0 ? 'Vyčerpáno' : (pumping ? 'Těží se' : 'Odhaleno'), x + w - 9, y + 29);
    ctx.restore();
}

// Dřevěná vrtná věž s lampou na vrcholu a kývající pumpou. y = pata věže na desce.
// Potrubí vede po desce k přední hraně řezu, kde začíná síť (network.path[0]).
function drawDerrick(x, y, plotId, isPumping, network) {
    const h = DERRICK_HEIGHT;
    const t = performance.now() / 1000;
    const lit = Math.sign(MOON_X - x) || 1; // strana věže obrácená k měsíci
    const selected = selectedDerrickPlotId === plotId;
    // Přetlak rozechvěje věž, při erupci se třese nejvíc
    const pressure = network ? (network.blowout > 0 ? 1.3 : network.pressure || 0) : 0;
    const shake = pressure > VENT_MIN ? (pressure - VENT_MIN) * 3.5 : 0;
    ctx.save();
    ctx.translate(x + (shake ? (Math.random() - 0.5) * shake : 0), y);

    if (network && network.path.length > 0) {
        ctx.strokeStyle = '#1c1714';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, STRUCTURE_BASE_OFFSET);
        ctx.stroke();
        ctx.strokeStyle = '#7d6a58';
        ctx.lineWidth = 4;
        ctx.stroke();
    }

    if (selected) { // vybraný vrt: pulzující kruh na zemi
        const r = 46 + Math.sin(t * 5) * 3;
        ctx.strokeStyle = 'rgba(255, 200, 90, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.22, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; // stín
    ctx.beginPath();
    ctx.ellipse(-lit * 8, 1, 44, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    if (isPumping) { // kruh světla pracovních lamp na zemi
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255, 150, 70, 0.10)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 80, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Betonová patka (horní plocha světlejší = dojem hloubky)
    ctx.fillStyle = '#4a4046';
    ctx.fillRect(-36, -6, 72, 7);
    ctx.fillStyle = '#7d7078';
    ctx.beginPath();
    ctx.moveTo(-36, -6);
    ctx.lineTo(36, -6);
    ctx.lineTo(30, -12);
    ctx.lineTo(-30, -12);
    ctx.closePath();
    ctx.fill();

    // Zadní nohy (tmavší, posunuté do hloubky), pak přední nohy a výztuhy
    const legs = (dx, dy, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(-26 + dx, -10 + dy);
        ctx.lineTo(-6 + dx, -h + dy);
        ctx.moveTo(26 + dx, -10 + dy);
        ctx.lineTo(6 + dx, -h + dy);
        ctx.stroke();
    };
    legs(5, -5, '#2a1a12', 3);
    legs(0, 0, '#4a2e1e', 4);
    ctx.strokeStyle = 'rgba(170, 190, 255, 0.55)'; // hrana nohy na straně měsíce
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lit * 27, -10);
    ctx.lineTo(lit * 7, -h);
    ctx.stroke();

    ctx.strokeStyle = '#3d2618';
    ctx.lineWidth = 2;
    const levels = 5;
    for (let i = 0; i < levels; i++) {
        const y0 = -10 - (h - 10) * (i / levels);
        const y1 = -10 - (h - 10) * ((i + 1) / levels);
        const half0 = 26 - 20 * (i / levels);
        const half1 = 26 - 20 * ((i + 1) / levels);
        ctx.beginPath();
        ctx.moveTo(-half0, y0);
        ctx.lineTo(half1, y1);
        ctx.moveTo(half0, y0);
        ctx.lineTo(-half1, y1);
        ctx.moveTo(-half1, y1);
        ctx.lineTo(half1, y1);
        ctx.stroke();
    }

    // Korunka s lampou
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(-10, -h - 8, 20, 9);
    ctx.fillStyle = '#5a3a26';
    ctx.fillRect(-10, -h - 8, 20, 2);
    const lampOn = isPumping ? 0.75 + 0.25 * Math.sin(t * 3 + x) : 0.25;
    ctx.fillStyle = `rgba(255, 210, 130, ${0.5 + lampOn * 0.5})`;
    ctx.beginPath();
    ctx.arc(0, -h - 12, 3, 0, Math.PI * 2);
    ctx.fill();
    drawGlow(0, -h - 12, 38, '255, 170, 80', 0.45 * lampOn);
    if (selected) drawGlow(0, -h * 0.5, 90, '255, 200, 90', 0.18);
    if (network && network.blowout > 0) drawGusherJet(0, -h - 10);
    else if (pressure >= PRESSURE_WARN) drawGlow(0, -h - 12, 30, '255, 50, 40', 0.4 + 0.3 * Math.sin(t * 10)); // výstražné světlo

    // Kývající pumpa vlevo od věže
    const pumpX = -56;
    const angle = isPumping ? Math.sin(t * 2.4 + x) * 0.28 : 0;
    ctx.strokeStyle = '#2a1a12';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pumpX - 9, 0);
    ctx.lineTo(pumpX, -26);
    ctx.lineTo(pumpX + 9, 0);
    ctx.stroke();
    ctx.save();
    ctx.translate(pumpX, -26);
    ctx.rotate(angle);
    ctx.fillStyle = '#3a2a24';
    ctx.fillRect(-24, -3, 44, 6);
    ctx.fillStyle = '#5a463c';
    ctx.beginPath(); // "koňská hlava"
    ctx.moveTo(-24, -7);
    ctx.lineTo(-30, -3);
    ctx.lineTo(-30, 8);
    ctx.lineTo(-24, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(170, 190, 255, 0.45)';
    ctx.fillRect(-24, -3, 44, 1.2);
    ctx.restore();

    ctx.restore();
}

// Plovoucí štítek zásobníku nad vrtem (ropa / kapacita), při plném zásobníku bliká
function drawStorageChip(x, y, network) {
    if (!network || network.oilCapacity <= 0) return;
    const fillRatio = Math.min(1, network.oilStored / network.oilCapacity);
    const full = network.isPumping && fillRatio >= 0.98;
    const blink = full && Math.sin(performance.now() / 200) > 0;
    const label = `${Math.floor(network.oilStored)} / ${network.oilCapacity}`;
    ctx.save();
    ctx.font = '700 12px "Barlow Condensed", system-ui, sans-serif';
    const w = Math.max(74, ctx.measureText(label).width + 34);
    const h = 22;
    const bx = x - w / 2;
    pathRoundRect(bx, y - h / 2, w, h, 11);
    ctx.fillStyle = 'rgba(14, 10, 16, 0.8)';
    ctx.fill();
    ctx.strokeStyle = blink ? '#ff5a4a' : (full ? 'rgba(255, 90, 70, 0.6)' : 'rgba(255, 255, 255, 0.16)');
    ctx.lineWidth = blink ? 2 : 1;
    ctx.stroke();
    // Ukazatel naplnění podél spodní hrany štítku
    ctx.fillStyle = fillRatio > 0.8 ? '#ff7a5a' : '#ffb45a';
    ctx.fillRect(bx + 8, y + h / 2 - 3, (w - 16) * fillRatio, 2);
    // Kapka ropy
    ctx.fillStyle = '#ffb45a';
    ctx.beginPath();
    ctx.moveTo(bx + 13, y - 6);
    ctx.quadraticCurveTo(bx + 19, y + 1, bx + 13, y + 4);
    ctx.quadraticCurveTo(bx + 7, y + 1, bx + 13, y - 6);
    ctx.fill();
    ctx.fillStyle = '#fff2df';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 23, y);
    const pressure = network.pressure || 0;
    let message = full ? 'PLNO – čeká na auto' : '';
    if (network.blowout > 0) message = 'ERUPCE!';
    else if (pressure >= VENT_MIN && network.isPumping) message = 'PŘETLAK – klikni na vrt';
    if (message) {
        ctx.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = blink || network.blowout > 0 ? '#ff7a6a' : '#ffd0c8';
        ctx.fillText(message, x, y - h / 2 - 9);
    }
    ctx.restore();
    if (pressure > 0.02 || network.blowout > 0) drawPressureGauge(bx - 16, y, network.blowout > 0 ? 1 : pressure);
}

const SILO_OFFSET_X = 40; // posun prvního sila od středu pozemku
const SILO_STEP = 11;     // posun každého dalšího sila
const SILO_WIDTH = 38;
const SILO_HEIGHT = 58;

// Ocelová nádrž s kopulí a žebříkem. fillRatio (0–1) = hladina ropy v okénku.
function drawSilo(x, y, fillRatio = 0) {
    const w = SILO_WIDTH, h = SILO_HEIGHT;
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'; // stín
    ctx.beginPath();
    ctx.ellipse(-4, 1, w / 2 + 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ocel v noci: tmavá, strana k měsíci chytá studené světlo
    const lit = Math.sign(MOON_X - x) || 1;
    const steel = ctx.createLinearGradient(-w / 2 * lit, 0, w / 2 * lit, 0);
    steel.addColorStop(0, '#3a3540');
    steel.addColorStop(0.6, '#6a5f66');
    steel.addColorStop(1, '#9aa3c8');
    ctx.fillStyle = steel;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1.5;

    pathRoundRect(-w / 2, -h, w, h, 3); // válec
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // kopule
    ctx.ellipse(0, -h, w / 2, 7, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'; // pásy plechu
    ctx.lineWidth = 1;
    [0.33, 0.66].forEach(f => {
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h * f);
        ctx.lineTo(w / 2, -h * f);
        ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(40, 40, 40, 0.8)'; // žebřík
    const lx = w / 2 - 6;
    ctx.beginPath();
    ctx.moveTo(lx, -h + 6);
    ctx.lineTo(lx, -2);
    ctx.stroke();
    for (let ry = -h + 10; ry < -3; ry += 6) {
        ctx.beginPath();
        ctx.moveTo(lx - 3, ry);
        ctx.lineTo(lx + 3, ry);
        ctx.stroke();
    }

    const gx = -w / 2 + 6, gy = -h + 10, gw = 6, gh = h - 20; // okénko s hladinou
    ctx.fillStyle = '#E9E4D3';
    ctx.fillRect(gx, gy, gw, gh);
    if (fillRatio > 0) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(gx, gy + gh * (1 - Math.min(1, fillRatio)), gw, gh * Math.min(1, fillRatio));
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeRect(gx, gy, gw, gh);

    ctx.restore();
}

function tracePath(path, offsetY = 0) {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y + offsetY);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y + offsetY);
}

// Kovové potrubí ve vrstvách (stín, obrys, tělo, odlesk); při těžbě jím teče svítící ropa
// směrem k vrtu a klouby žhnou.
function drawPipeNetworks() {
    const t = performance.now();
    pipeNetworks.forEach(network => {
        if (network.path.length < 2) return;
        const path = network.path;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        tracePath(path, 4);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 16;
        ctx.stroke();
        tracePath(path);
        ctx.strokeStyle = '#17120f';
        ctx.lineWidth = 13;
        ctx.stroke();
        ctx.strokeStyle = '#8a6a4a'; // bronz
        ctx.lineWidth = 9;
        ctx.stroke();
        ctx.strokeStyle = '#5e4632';
        ctx.lineWidth = 3;
        tracePath(path, 2.5);
        ctx.stroke();
        tracePath(path, -2.5);
        ctx.strokeStyle = 'rgba(255, 220, 170, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Spojovací objímky po ~28 px
        ctx.strokeStyle = '#2a1f17';
        ctx.lineWidth = 3;
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 1) continue;
            const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
            for (let d = 20; d < len - 10; d += 28) {
                const px = a.x + (b.x - a.x) * d / len, py = a.y + (b.y - a.y) * d / len;
                ctx.beginPath();
                ctx.moveTo(px - nx * 7, py - ny * 7);
                ctx.lineTo(px + nx * 7, py + ny * 7);
                ctx.stroke();
            }
        }

        if (network.isPumping) {
            ctx.globalCompositeOperation = 'lighter';
            tracePath(path);
            ctx.strokeStyle = 'rgba(255, 160, 60, 0.85)';
            ctx.lineWidth = 3.5;
            ctx.setLineDash([7, 13]);
            ctx.lineDashOffset = (t / 25) % 20; // posun k začátku cesty = k vrtu
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalCompositeOperation = 'source-over';
        }

        // Klouby v bodech, kde hráč klikal
        for (let i = 1; i < path.length; i++) {
            const p = path[i];
            if (network.isPumping) drawGlow(p.x, p.y, 22, '255, 150, 60', 0.45);
            ctx.fillStyle = '#211812';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = network.isPumping ? '#ffb45a' : '#a8875f';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.fillStyle = network.isPumping ? '#ffd890' : '#6a5440';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        // Příruba na hraně řezu
        ctx.fillStyle = '#2a211b';
        ctx.fillRect(path[0].x - 9, path[0].y - 2, 18, 7);
        ctx.fillStyle = '#a08a70';
        ctx.fillRect(path[0].x - 9, path[0].y - 2, 18, 1.5);
        ctx.restore();
    });
}

// --- Výkupci ropy: Rafinerie (vlevo) a Nádraží (vpravo) ---
// Herně jsou to dál firmy 'left'/'right' (ceny, sloty kamionů), kreslí se ale jako dva různé
// areály: rafinerie s kolonami a flérou a železniční překladiště s cisternami a lokomotivou.
// Nad každým je karta s cenou, grafem a přidělením kamionů (−/+ nebo kolečko myši).
const BUYER_CARD_TOP = 96;
const BUYER_CARD_H = 148;
const BUYERS = {
    left: { name: 'RAFINERIE', sub: 'Černé zlato', accent: '255, 150, 70' },
    right: { name: 'NÁDRAŽÍ', sub: 'Západní dráha', accent: '120, 180, 240' }
};

// Fléra rafinerie: komín s plápolajícím plamenem spalovaného plynu
function drawFlare(x, baseY, height) {
    const t = performance.now() / 1000;
    ctx.fillStyle = '#16141c';
    ctx.fillRect(x - 3, baseY - height, 6, height);
    ctx.fillStyle = 'rgba(170, 190, 255, 0.35)';
    ctx.fillRect(x + 2, baseY - height, 1, height);
    const topY = baseY - height;
    const flick = Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.5;
    drawGlow(x, topY - 10, 70, '255, 120, 40', 0.35 + flick * 0.05);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    [[14, '255, 110, 30', 0.6], [9, '255, 180, 70', 0.75], [5, '255, 240, 180', 0.9]].forEach(([r, color, a]) => {
        const fh = r * 2.4 + flick * 3;
        ctx.fillStyle = `rgba(${color}, ${a})`;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.6, topY);
        ctx.quadraticCurveTo(x - r * 0.7 + flick * 2, topY - fh * 0.6, x + flick * 3, topY - fh);
        ctx.quadraticCurveTo(x + r * 0.7 + flick * 2, topY - fh * 0.6, x + r * 0.6, topY);
        ctx.closePath();
        ctx.fill();
    });
    ctx.restore();
}

// Svislý ocelový válec s prstenci, plošinami a světly (destilační kolona)
function drawColumn(x, baseY, w, h, t, blinkOffset) {
    const steel = ctx.createLinearGradient(x, 0, x + w, 0);
    steel.addColorStop(0, '#1c1c27');
    steel.addColorStop(0.65, '#3b3c52');
    steel.addColorStop(1, '#9aa3c8');
    ctx.fillStyle = steel;
    ctx.fillRect(x, baseY - h, w, h);
    ctx.beginPath();
    ctx.ellipse(x + w / 2, baseY - h, w / 2, 3, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let y = baseY - h + 10; y < baseY - 4; y += 12) ctx.fillRect(x, y, w, 1.5);
    [0.35, 0.7].forEach(f => { // plošiny s lampami
        const py = baseY - h * f;
        ctx.fillStyle = '#121219';
        ctx.fillRect(x - 4, py, w + 8, 2);
        ctx.fillStyle = '#ffd890';
        ctx.fillRect(x - 3, py - 2, 1.5, 1.5);
        drawGlow(x - 2, py - 1, 9, '255, 180, 90', 0.5);
    });
    if (Math.sin(t * 2.5 + blinkOffset) > 0.3) drawGlow(x + w / 2, baseY - h - 4, 9, '255, 50, 40', 0.9);
    ctx.fillStyle = '#ff4a3a';
    ctx.fillRect(x + w / 2 - 1, baseY - h - 5, 2, 2);
}

function drawRefinery(x0, baseY) {
    const t = ambientClock;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x0 + 46, baseY + 1, 62, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2833'; // betonová plocha
    ctx.fillRect(x0, baseY - 5, 100, 5);
    ctx.fillStyle = 'rgba(170, 190, 255, 0.25)';
    ctx.fillRect(x0, baseY - 5, 100, 1);

    drawFlare(x0 + 92, baseY - 4, 84);
    drawColumn(x0 + 14, baseY - 4, 16, 100, t, 0);
    drawColumn(x0 + 36, baseY - 4, 12, 74, t, 1.7);

    // Potrubní most mezi kolonami a nádrží
    ctx.strokeStyle = '#2c2a36';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 30, baseY - 44);
    ctx.lineTo(x0 + 70, baseY - 44);
    ctx.lineTo(x0 + 70, baseY - 34);
    ctx.moveTo(x0 + 48, baseY - 30);
    ctx.lineTo(x0 + 58, baseY - 30);
    ctx.stroke();

    // Kulová nádrž na nožičkách
    ctx.strokeStyle = '#15141c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 60, baseY - 4);
    ctx.lineTo(x0 + 64, baseY - 20);
    ctx.moveTo(x0 + 80, baseY - 4);
    ctx.lineTo(x0 + 76, baseY - 20);
    ctx.stroke();
    const sphere = ctx.createRadialGradient(x0 + 76, baseY - 32, 2, x0 + 70, baseY - 24, 15);
    sphere.addColorStop(0, '#9aa3c8');
    sphere.addColorStop(0.5, '#3d3e55');
    sphere.addColorStop(1, '#1a1a24');
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(x0 + 70, baseY - 24, 14, 0, Math.PI * 2);
    ctx.fill();

    // Velín se svítícími okny
    ctx.fillStyle = '#23222e';
    ctx.fillRect(x0 + 50, baseY - 22, 34, 18);
    ctx.fillStyle = '#15141c';
    ctx.fillRect(x0 + 48, baseY - 24, 38, 3);
    [0, 1, 2].forEach(i => {
        ctx.fillStyle = '#ffbe6a';
        ctx.fillRect(x0 + 54 + i * 10, baseY - 17, 6, 6);
        drawGlow(x0 + 57 + i * 10, baseY - 14, 14, '255, 160, 70', 0.3);
    });
}

function drawRailDepot(x0, baseY) {
    const t = ambientClock;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x0 + 56, baseY + 1, 60, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nádražní budova s hodinami ve štítu
    const sx = x0 + 34, sw = 58, sh = 40, sBase = baseY - 10;
    ctx.fillStyle = '#1b1a26';
    ctx.fillRect(sx - 6, sBase - sh - 6, 6, sh + 6);
    const wall = ctx.createLinearGradient(sx, 0, sx + sw, 0);
    wall.addColorStop(0, '#2b2a3a');
    wall.addColorStop(1, '#45435c');
    ctx.fillStyle = wall;
    ctx.fillRect(sx, sBase - sh, sw, sh);
    ctx.fillStyle = '#15141d';
    ctx.beginPath();
    ctx.moveTo(sx - 4, sBase - sh);
    ctx.lineTo(sx + sw / 2, sBase - sh - 16);
    ctx.lineTo(sx + sw + 4, sBase - sh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 190, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + sw / 2, sBase - sh - 16);
    ctx.lineTo(sx + sw + 4, sBase - sh);
    ctx.stroke();
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(sx + sw / 2, sBase - sh - 6, 4.5, 0, Math.PI * 2);
    ctx.fill();
    drawGlow(sx + sw / 2, sBase - sh - 6, 12, '255, 200, 120', 0.4);
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + sw / 2, sBase - sh - 6);
    ctx.lineTo(sx + sw / 2, sBase - sh - 9);
    ctx.moveTo(sx + sw / 2, sBase - sh - 6);
    ctx.lineTo(sx + sw / 2 + 2.5, sBase - sh - 6);
    ctx.stroke();
    [0, 1, 2].forEach(i => { // obloukovitá okna
        const wx = sx + 8 + i * 17;
        ctx.fillStyle = '#ffbe6a';
        ctx.beginPath();
        ctx.moveTo(wx, sBase - 8);
        ctx.lineTo(wx, sBase - 24);
        ctx.arc(wx + 4, sBase - 24, 4, Math.PI, 0);
        ctx.lineTo(wx + 8, sBase - 8);
        ctx.closePath();
        ctx.fill();
        drawGlow(wx + 4, sBase - 16, 16, '255, 160, 70', 0.3);
    });
    // Nástupiště s přístřeškem
    ctx.fillStyle = '#2a2833';
    ctx.fillRect(x0, sBase, 100, 4);
    ctx.fillStyle = '#15141d';
    ctx.fillRect(x0 + 4, sBase - 28, 30, 3);
    ctx.fillRect(x0 + 6, sBase - 25, 2, 25);
    ctx.fillRect(x0 + 30, sBase - 25, 2, 25);
    drawGlow(x0 + 18, sBase - 22, 16, '255, 190, 110', 0.35);

    // Návěstidlo: střídá stůj / volno
    const go = Math.sin(t * 0.8) > 0;
    ctx.fillStyle = '#15141d';
    ctx.fillRect(x0 + 2, baseY - 70, 2, 66);
    ctx.fillRect(x0, baseY - 74, 6, 10);
    drawGlow(x0 + 3, go ? baseY - 67 : baseY - 71, 10, go ? '80, 255, 140' : '255, 60, 50', 0.9);

    // Kolej, cisternový vagon a lokomotiva na kraji
    const railY = baseY - 2;
    ctx.fillStyle = '#1a1820';
    for (let x = x0; x < x0 + 104; x += 7) ctx.fillRect(x, railY - 1, 4, 3);
    ctx.fillStyle = '#6a6f88';
    ctx.fillRect(x0, railY - 2, 104, 1);
    const tank = ctx.createLinearGradient(0, railY - 22, 0, railY - 6);
    tank.addColorStop(0, '#4a4b62');
    tank.addColorStop(1, '#14141c');
    ctx.fillStyle = tank;
    pathRoundRect(x0 + 18, railY - 22, 48, 14, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 180, 90, 0.7)';
    ctx.font = '700 7px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CRUDE', x0 + 42, railY - 15);
    ctx.fillStyle = '#0d0d13';
    [26, 36, 48, 58].forEach(wx => {
        ctx.beginPath();
        ctx.arc(x0 + wx, railY - 5, 3, 0, Math.PI * 2);
        ctx.fill();
    });
    // Lokomotiva (zčásti za okrajem mapy)
    ctx.fillStyle = '#17161f';
    ctx.fillRect(x0 + 72, railY - 20, 30, 14);
    ctx.fillRect(x0 + 90, railY - 28, 12, 8);
    ctx.fillRect(x0 + 76, railY - 28, 5, 8);
    ctx.fillStyle = 'rgba(170, 190, 255, 0.4)';
    ctx.fillRect(x0 + 72, railY - 20, 30, 1);
    ctx.fillStyle = '#ffd890';
    ctx.fillRect(x0 + 71, railY - 16, 2, 3);
    drawGlow(x0 + 71, railY - 15, 18, '255, 220, 150', 0.5);
    for (let k = 0; k < 4; k++) { // pára z komína
        const life = (t * 0.5 + k / 4) % 1;
        ctx.fillStyle = `rgba(190, 195, 215, ${0.3 * (1 - life)})`;
        ctx.beginPath();
        ctx.arc(x0 + 78 - life * 18, railY - 30 - life * 34, 3 + life * 9, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Karta výkupce: název, cena s trendem, graf, přidělené kamiony (−/+) a kolik jich jede
function drawBuyerCard(side, x, y, w, h, hovered) {
    const buyer = BUYERS[side];
    const price = side === 'left' ? leftIncPrice : rightIncPrice;
    const trend = side === 'left' ? leftPriceTrend : rightPriceTrend;
    const history = side === 'left' ? leftPriceHistory : rightPriceHistory;
    const assigned = side === 'left' ? trucksAssignedLeft : trucksAssignedRight;
    const driving = trucks.filter(t => t.state !== 'idle' && t.targetCompany === side).length;

    ctx.save();
    if (hovered) {
        ctx.shadowColor = `rgba(${buyer.accent}, 0.6)`;
        ctx.shadowBlur = 18;
    }
    pathRoundRect(x, y, w, h, 8);
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, 'rgba(14, 14, 24, 0.94)');
    bg.addColorStop(1, 'rgba(14, 14, 24, 0.82)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = hovered ? `rgba(${buyer.accent}, 0.9)` : 'rgba(190, 200, 240, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = `rgba(${buyer.accent}, 0.9)`; // barevný proužek výkupce
    ctx.fillRect(x + 1, y + 8, 2.5, 22);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff2df';
    ctx.font = '800 11px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(buyer.name, x + 9, y + 17);
    ctx.fillStyle = 'rgba(220, 220, 235, 0.55)';
    ctx.font = '600 8.5px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(buyer.sub, x + 9, y + 28);

    ctx.fillStyle = '#ffd36b';
    ctx.font = '800 21px "Barlow Condensed", system-ui, sans-serif';
    const priceText = `$${price.toFixed(2)}`;
    ctx.fillText(priceText, x + 8, y + 55);
    const priceWidth = ctx.measureText(priceText).width;
    ctx.fillStyle = trend >= 0 ? '#6ee39a' : '#ff7a6a';
    ctx.font = '10px sans-serif';
    ctx.fillText(trend >= 0 ? '▲' : '▼', x + 12 + priceWidth, y + 54);
    // Vliv mimořádných zpráv: ZAVŘENO, nebo o kolik zprávy cenu mění
    const effect = buyerNews[side];
    if (effect.closed || Math.abs(effect.mult - 1) > 0.001) {
        const label = effect.closed ? 'ZAVŘENO' : `ZPRÁVY ${effect.mult > 1 ? '+' : '−'}${Math.round(Math.abs(effect.mult - 1) * 100)} %`;
        const good = !effect.closed && effect.mult > 1;
        ctx.font = '800 7.5px "Barlow Condensed", system-ui, sans-serif';
        const lw = ctx.measureText(label).width + 8;
        pathRoundRect(x + 7, y + 57, lw, 11, 5);
        ctx.fillStyle = good ? 'rgba(110, 227, 154, 0.22)' : 'rgba(255, 110, 90, 0.25)';
        ctx.fill();
        ctx.fillStyle = good ? '#6ee39a' : '#ff8a70';
        ctx.fillText(label, x + 11, y + 65.5);
    } else {
        ctx.fillStyle = 'rgba(220, 220, 235, 0.5)';
        ctx.font = '600 7.5px "Barlow Condensed", system-ui, sans-serif';
        ctx.fillText('ZA BAREL', x + 9, y + 64);
    }
    if (effect.closed) { // přeškrtnutá cena
        ctx.strokeStyle = 'rgba(255, 110, 90, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 49);
        ctx.lineTo(x + 12 + priceWidth, y + 49);
        ctx.stroke();
    }

    drawPriceChart(history, x + 8, y + 70, w - 16, 16);

    ctx.fillStyle = 'rgba(190, 200, 240, 0.14)';
    ctx.fillRect(x + 8, y + 92, w - 16, 1);

    const rowY = y + 99;
    const minus = { x: x + 7, y: rowY, width: 22, height: 22 };
    const plus = { x: x + w - 29, y: rowY, width: 22, height: 22 };
    drawCardButton(minus, '−', buyer.accent);
    drawCardButton(plus, '+', buyer.accent);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff2df';
    ctx.font = '800 18px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(String(assigned), x + w / 2, rowY + 17);
    ctx.fillStyle = 'rgba(220, 220, 235, 0.55)';
    ctx.font = '600 7.5px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText('PŘIDĚLENO', x + w / 2, rowY + 31);
    ctx.fillStyle = hovered ? `rgba(${buyer.accent}, 1)` : 'rgba(220, 220, 235, 0.7)';
    ctx.font = '600 8.5px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText(hovered ? 'kolečko myši ±' : `${driving} ${driving === 1 ? 'kamion jede' : 'kamionů jede'}`, x + w / 2, y + h - 8);
    ctx.restore();
    return { minus, plus };
}

function drawCardButton(rect, label, accent) {
    const hovered = isPointNearRect(mousePos, rect, 2);
    ctx.save();
    pathRoundRect(rect.x, rect.y, rect.width, rect.height, 6);
    ctx.fillStyle = hovered ? `rgba(${accent}, 0.35)` : 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = hovered ? `rgba(${accent}, 0.9)` : 'rgba(190, 200, 240, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff2df';
    ctx.font = '700 15px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
    ctx.restore();
}

function drawCompanyBuildings(groundLevel) {
    const baseY = groundLevel - BUILDING_BASE_OFFSET;
    const rightX = canvas.width - COMPANY_ZONE_WIDTH;
    drawRefinery(0, baseY);
    drawRailDepot(rightX, baseY);

    const hovered = getCompanyZoneAt(mousePos);
    const left = drawBuyerCard('left', 4, BUYER_CARD_TOP, COMPANY_ZONE_WIDTH - 8, BUYER_CARD_H, hovered === 'left');
    const right = drawBuyerCard('right', rightX + 4, BUYER_CARD_TOP, COMPANY_ZONE_WIDTH - 8, BUYER_CARD_H, hovered === 'right');
    // Hitboxy pro handleCanvasClick: "nahoru" = přidat kamion, "dolů" = ubrat
    companyControls.leftUp = left.plus;
    companyControls.leftDown = left.minus;
    companyControls.rightUp = right.plus;
    companyControls.rightDown = right.minus;
}

// Malý čárový graf cen. Osa Y se přizpůsobí, minimální rozsah 0,30 $, ať drobné změny nevypadají dramaticky.
function drawPriceChart(history, x, y, w, h) {
    ctx.save();
    pathRoundRect(x, y, w, h, 3);
    ctx.fillStyle = 'rgba(14, 10, 16, 0.6)';
    ctx.fill();
    if (history.length >= 2) {
        let min = Math.min(...history);
        let max = Math.max(...history);
        const pad = Math.max(0, (0.3 - (max - min)) / 2);
        min -= pad;
        max += pad;
        const px = i => x + (i / (history.length - 1)) * w;
        const py = v => y + h - 2 - ((v - min) / (max - min)) * (h - 4);
        const rising = history[history.length - 1] >= history[0];
        ctx.strokeStyle = rising ? '#5be38a' : '#ff6b5a';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        history.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(px(history.length - 1), py(history[history.length - 1]), 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// --- Silnice a auta ---
const TRUCK_COLORS = { left: '#C77D2E', right: '#4F86B5' }; // laděné k barvám výkupců (rafinerie, nádraží)

function pathRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}

// Cisterna, kabina vpravo. facing = -1 ji zrcadlí (jede doleva). loadRatio 0–1 = hladina v okénku.
function drawTankerTruck(x, baseY, facing, color, loadRatio) {
    ctx.save();
    ctx.translate(x, baseY);
    ctx.scale(facing, 1);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; // stín
    ctx.beginPath();
    ctx.ellipse(0, 1, 40, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2B2B2B'; // podvozek
    ctx.fillRect(-38, -13, 76, 5);

    // cisterna
    pathRoundRect(-38, -33, 50, 21, 9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(-32, -30, 38, 3);
    ctx.fillStyle = '#2B2B2B'; // poklopy
    ctx.fillRect(-28, -36, 8, 3);
    ctx.fillRect(-6, -36, 8, 3);

    // okénko s hladinou ropy
    ctx.fillStyle = '#E9E4D3';
    ctx.fillRect(-30, -24, 32, 7);
    if (loadRatio > 0) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(-30, -24, 32 * Math.min(1, loadRatio), 7);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-30, -24, 32, 7);

    // kabina
    ctx.beginPath();
    ctx.moveTo(14, -12);
    ctx.lineTo(14, -29);
    ctx.lineTo(30, -29);
    ctx.lineTo(38, -19);
    ctx.lineTo(38, -12);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath(); // okno
    ctx.moveTo(19, -26);
    ctx.lineTo(28, -26);
    ctx.lineTo(34, -19);
    ctx.lineTo(19, -19);
    ctx.closePath();
    ctx.fillStyle = '#BFE3F5';
    ctx.fill();
    ctx.fillStyle = '#FFE680'; // světlo
    ctx.fillRect(36, -17, 2, 3);
    ctx.fillStyle = '#ff4a3a'; // koncové světlo
    ctx.fillRect(-38, -16, 2, 3);

    // kola
    [-27, -11, 27].forEach(wx => {
        ctx.fillStyle = '#1B1B1B';
        ctx.beginPath();
        ctx.arc(wx, -6, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9A9A9A';
        ctx.beginPath();
        ctx.arc(wx, -6, 2.6, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

// Kužel světlometů a záře koncových světel (aditivně, kreslí se před autem)
function drawTruckLights(x, baseY, facing) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fx = x + facing * 38;
    const beam = ctx.createLinearGradient(fx, 0, fx + facing * 90, 0);
    beam.addColorStop(0, 'rgba(255, 220, 150, 0.32)');
    beam.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(fx, baseY - 17);
    ctx.lineTo(fx + facing * 90, baseY - 26);
    ctx.lineTo(fx + facing * 90, baseY - 2);
    ctx.lineTo(fx, baseY - 13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawGlow(x - facing * 37, baseY - 15, 10, '255, 60, 40', 0.45);
}

function drawTrucks(groundLevel) {
    // Čekající auta u vrtu se řadí za sebe, ať nejsou na jedné hromadě
    const queueCount = {};
    const items = trucks.filter(t => t.state !== 'idle').map(truck => {
        const facing = truck.facing || 1;
        let renderX = truck.x;
        if (truck.state === 'waiting_at_rig') {
            const n = queueCount[truck.homeNetworkId] || 0;
            queueCount[truck.homeNetworkId] = n + 1;
            renderX -= facing * n * (TRUCK_LENGTH + 8);
        }
        // Dva pruhy podle směru jízdy (doprava dole, doleva nahoře), čekající auto parkuje u vrtu
        const lane = truck.state === 'waiting_at_rig' ? -1 : (facing > 0 ? 1 : 0);
        return { truck, facing, renderX, lane };
    });

    items.sort((a, b) => a.lane - b.lane); // vzdálenější pruh se kreslí první
    items.forEach(({ truck, facing, renderX }) => {
        // Na sdílené mapě má každý hráč kamiony ve své barvě, jinak podle výkupce
        const color = sharedMode ? playerColor(truck.owner) : (TRUCK_COLORS[truck.targetCompany] || '#777777');
        const baseY = getTruckBaseY(truck, groundLevel);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // stín na desce
        ctx.beginPath();
        ctx.ellipse(renderX - 4, baseY + 1, 44, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        drawTankerTruck(renderX, baseY, facing, color, truck.oil / TRUCK_CAPACITY);
        if (truck.state !== 'waiting_at_rig') drawTruckLights(renderX, baseY, facing);
    });
}

// Spodní hrana kol: pruh na předním pásu desky podle směru jízdy (doprava blíž, doleva dál)
function getTruckBaseY(truck, groundLevel) {
    if (truck.state === 'waiting_at_rig') return groundLevel - 22; // zaparkované u vrtu, projíždějící auta ho překryjí
    return groundLevel - 12 + ((truck.facing || 1) > 0 ? 1 : 0) * 11;
}

// --- Částice ---
function spawnParticle(particle) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(particle);
}

function updateParticles(dt) {
    particles.forEach(p => {
        p.age += dt;
        if (p.gravity) p.vy += p.gravity * dt / 1000;
        p.x += p.vx * dt / 1000;
        p.y += p.vy * dt / 1000;
        // Kapka ropy dopadla na desku a zmizí (kaluž roste v sim.js podle délky erupce)
        if (p.type === 'oil' && p.vy > 0 && p.y >= p.groundY) p.age = p.life;
    });
    particles = particles.filter(p => p.age < p.life);
}

function drawParticles() {
    particles.forEach(p => {
        const t = p.age / p.life;
        ctx.save();
        if (p.type === 'puff') {
            ctx.fillStyle = `rgba(${p.shade}, ${p.shade}, ${p.shade}, ${0.45 * (1 - t)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 + t * 1.5), 0, Math.PI * 2);
            ctx.fill();
        } else if (p.type === 'oil') {
            // Kapka ropy nasvícená lampou věže zespodu
            ctx.fillStyle = '#140c08';
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.size * 0.8, p.size * 1.2, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 160, 80, 0.55)';
            ctx.beginPath();
            ctx.arc(p.x + p.size * 0.3, p.y + p.size * 0.4, p.size * 0.35, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.type === 'text') {
            ctx.globalAlpha = 1 - t * t;
            ctx.font = '800 24px "Barlow Condensed", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(30, 16, 8, 0.85)';
            ctx.strokeText(p.text, p.x, p.y);
            ctx.fillStyle = p.color || '#ffd36b'; // cizí prodej v barvě soupeře
            ctx.fillText(p.text, p.x, p.y);
        }
        ctx.restore();
    });
}

// Kouř z komína kabiny; naložené auto kouří tmavěji
function emitTruckSmoke(truck, dt) {
    truck.smokeTimer = (truck.smokeTimer || 0) + dt;
    if (truck.smokeTimer < 220) return;
    truck.smokeTimer = 0;
    const facing = truck.facing || 1;
    const groundLevel = getGroundLevel();
    spawnParticle({
        type: 'puff',
        x: truck.x + facing * 12,
        y: getTruckBaseY(truck, groundLevel) - 34,
        vx: -facing * 14,
        vy: -24,
        age: 0,
        life: 900,
        size: 3,
        shade: truck.oil > 0 ? 55 : 150
    });
}

// Pára z korunky čerpajícího vrtu
function emitDerrickSmoke(dt) {
    const groundLevel = getGroundLevel();
    pipeNetworks.forEach(network => {
        if (!network.isPumping || network.derrickId < 0) return;
        network.smokeTimer = (network.smokeTimer || 0) + dt;
        if (network.smokeTimer < 380) return;
        network.smokeTimer = 0;
        spawnParticle({
            type: 'puff',
            x: getNetworkPickupX(network) + (Math.random() - 0.5) * 6,
            y: groundLevel - STRUCTURE_BASE_OFFSET - DERRICK_HEIGHT - 14,
            vx: -10 + Math.random() * 6,
            vy: -18,
            age: 0,
            life: 2200,
            size: 4,
            shade: 120
        });
    });
}

// --- Zvuk (WebAudio, žádné soubory) ---
// Zvuky se syntetizují (žádné soubory): kovový FM zvonek a filtrovaný šum.
// Prodej = pokladna: cvaknutí šuplíku a dva tóny zvonku; strike = zvonková arpeggia;
// build = dřevěné ťuknutí; boom = hluboký výbuch nálože.
const MASTER_VOLUME = 0.5;
const SALE_SOUND_GAP_MS = 140; // víc prodejů naráz nezní jako kulomet
let lastSaleSoundAt = 0;
let noiseBuffer = null;

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });
    return audioCtx;
}

function getNoiseBuffer(ac) {
    if (!noiseBuffer || noiseBuffer.sampleRate !== ac.sampleRate) {
        noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
}

// FM zvonek: nosná vlna modulovaná neceločíselným násobkem dává kovový tón,
// modulace slábne rychleji než hlasitost, takže úder je jasný a dozvuk čistý
function playBell(ac, out, at, freq, volume, decay = 0.6) {
    const carrier = ac.createOscillator();
    const modulator = ac.createOscillator();
    const modGain = ac.createGain();
    const amp = ac.createGain();
    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 3.5;
    modGain.gain.setValueAtTime(freq * 2.2, at);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, at + decay * 0.5);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(volume, at + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    modulator.connect(modGain).connect(carrier.frequency);
    carrier.connect(amp).connect(out);
    modulator.start(at);
    carrier.start(at);
    modulator.stop(at + decay + 0.05);
    carrier.stop(at + decay + 0.05);
}

// Krátký šum přes filtr (cvaknutí, ťuknutí, rachot)
function playNoise(ac, out, at, { duration, volume, type = 'bandpass', freq = 2000, q = 1, sweepTo = null }) {
    const src = ac.createBufferSource();
    src.buffer = getNoiseBuffer(ac);
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + duration);
    filter.Q.value = q;
    const amp = ac.createGain();
    amp.gain.setValueAtTime(volume, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter).connect(amp).connect(out);
    src.start(at);
    src.stop(at + duration + 0.02);
}

// Tón s klesající výškou (dunění, ťuknutí)
function playThump(ac, out, at, fromFreq, toFreq, duration, volume) {
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fromFreq, at);
    osc.frequency.exponentialRampToValueAtTime(toFreq, at + duration);
    amp.gain.setValueAtTime(volume, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp).connect(out);
    osc.start(at);
    osc.stop(at + duration + 0.02);
}

const SOUNDS = {
    sale(ac, out, at) {
        const detune = 1 + (Math.random() - 0.5) * 0.03; // ať po sobě jdoucí prodeje nezní stejně
        playNoise(ac, out, at, { duration: 0.035, volume: 0.25, freq: 3800, q: 2.5 });          // cvak šuplíku
        playNoise(ac, out, at + 0.03, { duration: 0.06, volume: 0.12, freq: 1800, q: 1.2 });
        playBell(ac, out, at + 0.05, 1568 * detune, 0.11, 0.55);  // G6
        playBell(ac, out, at + 0.11, 2093 * detune, 0.09, 0.7);   // C7
    },
    strike(ac, out, at) {
        [523, 659, 784, 1047].forEach((f, i) => playBell(ac, out, at + i * 0.09, f, 0.1, 0.9));
        playThump(ac, out, at, 160, 60, 0.35, 0.25);
    },
    build(ac, out, at) {
        playThump(ac, out, at, 240, 110, 0.09, 0.3);
        playNoise(ac, out, at, { duration: 0.05, volume: 0.18, type: 'lowpass', freq: 1400 });
        playThump(ac, out, at + 0.1, 200, 95, 0.08, 0.22);
    },
    news(ac, out, at) { // znělka zpráv: tři stoupající tóny a úder
        playThump(ac, out, at, 140, 70, 0.25, 0.3);
        [784, 1047, 1319].forEach((f, i) => playBell(ac, out, at + 0.05 + i * 0.11, f, 0.09, 0.5));
        playBell(ac, out, at + 0.45, 1568, 0.07, 0.9);
    },
    warn(ac, out, at) { // dvoutónová houkačka
        [[740, 0], [554, 0.16], [740, 0.32], [554, 0.48]].forEach(([f, d]) => {
            const osc = ac.createOscillator();
            const amp = ac.createGain();
            osc.type = 'triangle';
            osc.frequency.value = f;
            amp.gain.setValueAtTime(0.0001, at + d);
            amp.gain.exponentialRampToValueAtTime(0.12, at + d + 0.02);
            amp.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.15);
            osc.connect(amp).connect(out);
            osc.start(at + d);
            osc.stop(at + d + 0.17);
        });
    },
    vent(ac, out, at) { // syčení páry, klesá
        playNoise(ac, out, at, { duration: 1.2, volume: 0.22, type: 'highpass', freq: 5000, sweepTo: 1500, q: 0.7 });
        playThump(ac, out, at, 300, 180, 0.08, 0.15);
    },
    gush(ac, out, at) { // erupce: dunění a dlouhý šum proudu
        playThump(ac, out, at, 90, 35, 0.9, 0.5);
        playNoise(ac, out, at, { duration: 2.2, volume: 0.3, type: 'lowpass', freq: 700, sweepTo: 250 });
        playNoise(ac, out, at + 0.1, { duration: 1.6, volume: 0.12, type: 'bandpass', freq: 1400, q: 0.8 });
    },
    boom(ac, out, at) {
        playThump(ac, out, at, 120, 32, 0.7, 0.5);
        playNoise(ac, out, at, { duration: 0.9, volume: 0.35, type: 'lowpass', freq: 900, sweepTo: 120 });
    }
};

function playSound(kind) {
    if (soundMuted || !SOUNDS[kind]) return;
    if (kind === 'sale') {
        const now = performance.now();
        if (now - lastSaleSoundAt < SALE_SOUND_GAP_MS) return;
        lastSaleSoundAt = now;
    }
    try {
        const ac = getAudioContext();
        if (!ac) return;
        const out = ac.createGain();
        out.gain.value = MASTER_VOLUME;
        out.connect(ac.destination);
        SOUNDS[kind](ac, out, ac.currentTime + 0.005);
    } catch (e) {
        // Zvuk je jen bonus: bez AudioContextu hra funguje dál
    }
}

function toggleSound() {
    soundMuted = !soundMuted;
    const btn = document.getElementById('sound-btn');
    if (btn) {
        btn.innerHTML = iconSvg(soundMuted ? 'soundOff' : 'soundOn');
        btn.classList.toggle('muted', soundMuted);
    }
}

function drawEffectsAndPreviews(groundLevel) {
    let newCursor = plotsHoverPointer ? 'pointer' : (getCompanyZoneAt(mousePos) ? 'ns-resize' : (camera.tzoom > 1.01 ? 'grab' : 'default'));

    // Náhled stavby
    if (currentBuildMode === 'vrt') {
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === myId && !hoveredPlot.hasVrt) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawDerrick(hoveredPlot.x + plotWidth / 2, groundLevel - STRUCTURE_BASE_OFFSET, -1, false);
            ctx.restore();
            newCursor = 'pointer';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (currentBuildMode === 'silo') {
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === myId && hoveredPlot.hasVrt) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawSilo(hoveredPlot.x + plotWidth / 2 + SILO_OFFSET_X + hoveredPlot.siloCount * SILO_STEP,
                groundLevel - STRUCTURE_BASE_OFFSET + 4 + hoveredPlot.siloCount * 2, 0);
            ctx.restore();
            newCursor = 'pointer';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (selectedDerrickPlotId !== null) {
        newCursor = 'crosshair';
        const network = pipeNetworks.find(n => n.derrickId === selectedDerrickPlotId);
        const startPlot = plots.find(p => p.id === selectedDerrickPlotId);
        if (startPlot) {
            const lastPoint = network?.path[network.path.length - 1] || {
                x: startPlot.x + plotWidth / 2,
                y: groundLevel
            };
            if (mousePos.y > groundLevel) {
                const distance = Math.hypot(mousePos.x - lastPoint.x, mousePos.y - lastPoint.y);
                const cost = Math.ceil(distance * PIPE_COST_PER_PIXEL);
                ctx.save();
                ctx.strokeStyle = money >= cost ? 'rgba(255, 200, 120, 0.75)' : 'rgba(255, 90, 70, 0.8)';
                ctx.lineWidth = 3;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(lastPoint.x, lastPoint.y);
                ctx.lineTo(mousePos.x, mousePos.y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '700 13px "Barlow Condensed", system-ui, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const costLabel = `$${cost}`;
                const lw = ctx.measureText(costLabel).width + 14;
                pathRoundRect(mousePos.x + 10, mousePos.y - 26, lw, 20, 10);
                ctx.fillStyle = 'rgba(14, 10, 16, 0.8)';
                ctx.fill();
                ctx.fillStyle = money >= cost ? '#ffd98a' : '#ff7a6a';
                ctx.fillText(costLabel, mousePos.x + 17, mousePos.y - 16);
                ctx.restore();
            }
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
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffe3b0';
    ctx.font = '64px "Rye", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAUZA', canvas.width / 2, canvas.height / 2);
    ctx.textBaseline = 'alphabetic';
}

function drawGameOver() {
    resetCamera(true); // tlačítko restartu je v souřadnicích obrazovky
    draw();
    // V závodě ukazuje výsledky noviny z net.js; scéna za nimi má zůstat vidět
    ctx.fillStyle = raceMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (raceMode) return;

    ctx.fillStyle = 'white';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    const title = gameOverReason === 'bankrupt' ? 'BANKROT!' : 'KONEC ROKU';
    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 120);

    ctx.font = '32px sans-serif';
    ctx.fillText(`Finální kapitál: $${Math.floor(money)}`, canvas.width / 2, canvas.height / 2 - 40);
    ctx.fillText(`Celkové tržby: $${Math.floor(totalRevenue)}`, canvas.width / 2, canvas.height / 2 + 10);
    ctx.fillText(`Prodáno ropy: ${Math.floor(totalOilSold)} barelů`, canvas.width / 2, canvas.height / 2 + 55);

    const ownedPlots = plots.filter(p => p.owner === myId).length;
    const activeRigs = plots.filter(p => p.hasVrt && isMine(p)).length;
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.fillText(`Pozemky: ${ownedPlots}  |  Vrty: ${activeRigs}  |  Kamiony: ${trucksOwned}`, canvas.width / 2, canvas.height / 2 + 110);

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


// --- Herní logika a mechaniky ---

function getNetworkPickupX(network) {
    return OilSim.getNetworkPickupX(world, network);
}

// Přidělení kamionů výkupci (−/+ na kartě, kolečko myši)
function assignTruck(company, change) {
    doAction({ type: 'assignTruck', company, delta: change });
}

function cancelBuildMode(clearDerrick = true) {
    currentBuildMode = null;
    if (clearDerrick) selectedDerrickPlotId = null;
    updateUI();
}

// --- Posluchače událostí ---
function addEventListeners() {
    // Pohyb myši
    canvas.addEventListener('pointermove', (event) => {
        const pos = getCanvasPosition(event);
        pointerScreen.x = pos.px;
        pointerScreen.y = pos.py;
        if (dragState) {
            const dx = pos.px - dragState.px;
            const dy = pos.py - dragState.py;
            if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD && camera.tzoom > 1.01) dragState.moved = true;
            if (dragState.moved) {
                camera.tx = camera.x = dragState.camX - dx / camera.zoom;
                camera.ty = camera.y = dragState.camY - dy / camera.zoom;
                clampCamera(true);
                canvas.style.cursor = 'grabbing';
                return;
            }
        }
        mousePos.x = pos.x;
        mousePos.y = pos.y;
    });

    // Tažení myší posouvá přiblíženou scénu; krátký klik zůstává klikem
    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        const pos = getCanvasPosition(event);
        dragState = { px: pos.px, py: pos.py, camX: camera.x, camY: camera.y, moved: false };
        canvas.setPointerCapture?.(event.pointerId);
    });
    const endDrag = () => {
        if (dragState && dragState.moved) suppressNextClick = true;
        dragState = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Kliknutí pravým tlačítkem (zrušení akce)
    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        cancelBuildMode();
    });

    // Kliknutí levým tlačítkem (hlavní interakce)
    canvas.addEventListener('click', handleCanvasClick);

    // Tlačítka v horní liště
    document.getElementById('vrt-btn').addEventListener('click', () => {
        if (money >= VRT_COST) {
            currentBuildMode = (currentBuildMode === 'vrt') ? null : 'vrt';
            updateUI();
        }
    });

    document.getElementById('silo-btn').addEventListener('click', () => {
        if (money >= SILO_COST) {
            currentBuildMode = (currentBuildMode === 'silo') ? null : 'silo';
            updateUI();
        }
    });

    document.getElementById('truck-btn').addEventListener('click', () => {
        if (money >= TRUCK_COST && trucksOwned < MAX_TRUCKS) doAction({ type: 'buyTruck' });
    });

    document.getElementById('seismic-btn').addEventListener('click', () => {
        if (money >= SEISMIC_COST && plots.some(p => p.owner === myId)) {
            currentBuildMode = (currentBuildMode === 'seismic') ? null : 'seismic';
            selectedDerrickPlotId = null;
            updateUI();
        }
    });

    document.getElementById('drone-btn').addEventListener('click', () => {
        if (money >= DRONE_COST && !drones.some(d => d.owner === myId)) doAction({ type: 'drone' });
    });

    document.getElementById('radar-btn').addEventListener('click', () => {
        if (money >= RADAR_COST) {
            currentBuildMode = (currentBuildMode === 'radar') ? null : 'radar';
            selectedDerrickPlotId = null;
            updateUI();
        }
    });

    // Ovládání času
    document.getElementById('pause-btn').addEventListener('click', () => {
        if (!raceMode) isPaused = !isPaused;
    });
    document.querySelectorAll('.time-btn[data-speed]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (raceMode) return;
            gameSpeed = Number(btn.dataset.speed);
            isPaused = false;
            updateUI();
        });
    });
    document.getElementById('sound-btn').addEventListener('click', toggleSound);

    window.addEventListener('resize', () => {
        if (canvas && ctx) draw();
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'm' || event.key === 'M') toggleSound();
        handleCameraKey(event);
    });

    document.getElementById('zoom-in').addEventListener('click', () => zoomCameraAt(canvas.width / 2, canvas.height / 2, 1.35));
    document.getElementById('zoom-out').addEventListener('click', () => zoomCameraAt(canvas.width / 2, canvas.height / 2, 1 / 1.35));
    document.getElementById('zoom-reset').addEventListener('click', () => resetCamera());

    // Kolečko myši nad firmou přidává (nahoru) a ubírá (dolů) přidělená auta
    canvas.addEventListener('wheel', handleCompanyWheel, { passive: false });
}

const WHEEL_THRESHOLD = 90;    // jedno cvaknutí kolečka (~100) = jedno auto; trackpad se sčítá
const WHEEL_COOLDOWN_MS = 110; // setrvačnost trackpadu nesmí přidělit půlku flotily naráz
let wheelAccumulator = 0;
let lastWheelStep = 0;

function handleCompanyWheel(event) {
    const pos = getCanvasPosition(event);
    const company = pos.inBounds ? getCompanyZoneAt(pos) : null;
    if (!company) {
        // Mimo výkupce kolečko přibližuje kolem kurzoru
        wheelAccumulator = 0;
        if (!pos.inBounds) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 33 : (event.deltaMode === 2 ? 100 : 1);
        zoomCameraAt(pos.px, pos.py, Math.exp(-event.deltaY * unit * 0.0015));
        return;
    }
    event.preventDefault(); // stránka se nesmí hýbat
    if (isGameOver) return;

    const unit = event.deltaMode === 1 ? 33 : (event.deltaMode === 2 ? 100 : 1); // řádky/stránky na pixely
    const delta = event.deltaY * unit;
    if (delta === 0) return;

    // Cvaknutí kolečka myši (velká delta) = vždy jedno auto, i při rychlém protočení.
    // Drobné delty trackpadu se sčítají a mají cooldown, ať setrvačnost nepřidělí půlku flotily.
    if (Math.abs(delta) >= WHEEL_THRESHOLD) {
        wheelAccumulator = 0;
        // Jedna událost může nést víc cvaknutí (zrychlené kolečko): ~100 na cvaknutí
        const notches = Math.max(1, Math.round(Math.abs(delta) / 100));
        for (let i = 0; i < notches; i++) assignTruck(company, delta < 0 ? 1 : -1); // nahoru = přidat auto
        return;
    }

    wheelAccumulator = Math.max(-WHEEL_THRESHOLD * 2, Math.min(WHEEL_THRESHOLD * 2, wheelAccumulator + delta));
    const now = performance.now();
    if (Math.abs(wheelAccumulator) >= WHEEL_THRESHOLD && now - lastWheelStep >= WHEEL_COOLDOWN_MS) {
        assignTruck(company, wheelAccumulator < 0 ? 1 : -1);
        wheelAccumulator = 0;
        lastWheelStep = now;
    }
}

// Zóna firmy pro kolečko: budova a sloupec se šipkami nad ní (od horní lišty po zem)
const COMPANY_ZONE_WIDTH = 100;
const COMPANY_ZONE_TOP = 30;

function getCompanyZoneAt(point) {
    const groundLevel = getGroundLevel();
    if (point.y < COMPANY_ZONE_TOP || point.y > groundLevel) return null;
    if (point.x <= COMPANY_ZONE_WIDTH) return 'left';
    if (point.x >= canvas.width - COMPANY_ZONE_WIDTH) return 'right';
    return null;
}

function getRestartButtonRect() {
    return { x: canvas.width / 2 - 140, y: canvas.height / 2 + 150, width: 280, height: 64 };
}

// Klikací plocha ovládacích prvků je o CONTROL_HIT_PAD větší než jejich kresba
function isPointNearRect(point, rect, pad = CONTROL_HIT_PAD) {
    return isPointInRect(point, {
        x: rect.x - pad,
        y: rect.y - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2
    });
}

function handleCanvasClick(event) {
    if (suppressNextClick) { // konec tažení scény není klik
        suppressNextClick = false;
        return;
    }
    const clickPos = getCanvasPosition(event);

    if (isGameOver) {
        // V závodě se nerestartuje, další kolo spouští hostitel z výsledků (net.js)
        if (!raceMode && clickPos.inBounds && isPointInRect(clickPos, getRestartButtonRect())) restartGame();
        return;
    }

    if (!clickPos.inBounds) return;
    mousePos.x = clickPos.x;
    mousePos.y = clickPos.y;
    const groundLevel = getGroundLevel();

    updatePlotSignHitboxes(groundLevel);

    if (isPointNearRect(clickPos, companyControls.leftUp)) { assignTruck('left', 1); return; }
    if (isPointNearRect(clickPos, companyControls.leftDown)) { assignTruck('left', -1); return; }
    if (isPointNearRect(clickPos, companyControls.rightUp)) { assignTruck('right', 1); return; }
    if (isPointNearRect(clickPos, companyControls.rightDown)) { assignTruck('right', -1); return; }

    // Nákup pozemku — cedule i celý sloupec nad zemí (mimo aktivní režim krtka)
    if (currentBuildMode !== 'seismic' && currentBuildMode !== 'radar') {
        const purchasePlot = getPlotToPurchase(clickPos, groundLevel);
        if (purchasePlot) {
            const result = tryPurchasePlot(purchasePlot, groundLevel);
            if (result !== 'none') {
                draw();
                return;
            }
        }
    }

    const clickedPlot = getPlotAtPosition(clickPos.x, clickPos.y, groundLevel) || getPlotAtX(clickPos.x);
    if (currentBuildMode) {
        handleBuildModeClick(clickPos, clickedPlot, groundLevel);
    } else if (selectedDerrickPlotId !== null) {
        handlePipePlacementClick(clickPos, groundLevel);
    } else {
        handleDefaultClick(clickedPlot);
    }
}

function handleBuildModeClick(clickPos, plot, groundLevel) {
    switch (currentBuildMode) {
        case 'vrt':
            if (isMine(plot) && !plot.hasVrt && money >= VRT_COST) doAction({ type: 'buildDerrick', plotId: plot.id });
            break;
        case 'silo':
            if (isMine(plot) && plot.hasVrt && plot.siloCount < MAX_SILOS_PER_PLOT && money >= SILO_COST) {
                doAction({ type: 'buildSilo', plotId: plot.id });
            }
            break;
        case 'seismic':
            if (isMine(plot) && clickPos.y <= groundLevel) doAction({ type: 'seismic', plotId: plot.id, x: clickPos.x });
            break;
        case 'radar':
            if (clickPos.y > groundLevel) doAction({ type: 'radar', x: clickPos.x, y: clickPos.y });
            break;
    }
}

function handlePipePlacementClick(clickPos, groundLevel) {
    if (clickPos.y <= groundLevel) return;
    const network = pipeNetworks.find(n => n.derrickId === selectedDerrickPlotId);
    if (network && network.isPumping) return;
    doAction({ type: 'pipe', plotId: selectedDerrickPlotId, x: clickPos.x, y: clickPos.y });
}

function handleDefaultClick(plot) {
    if (isMine(plot) && plot.hasVrt) {
        const network = pipeNetworks.find(n => n.derrickId === plot.id);
        if (network && canVentRig(network)) {
            doAction({ type: 'vent', plotId: plot.id });
            return;
        }
        if (!network || !network.isPumping) {
            selectedDerrickPlotId = plot.id;
            updateUI();
        }
    }
}

// --- Přetlak a erupce vrtu (kresba) ---
// Logika je v sim.js (stepPressure): plný zásobník zvedá network.pressure, od VENT_MIN jde ventil
// odpustit kliknutím na vrt, při 100 % erupce (network.blowout), kaluž je plot.spill.
function getRigTopY() {
    return getGroundLevel() - STRUCTURE_BASE_OFFSET - DERRICK_HEIGHT - 12;
}

function canVentRig(network) {
    return OilSim.canVentRig(network);
}

// Pára z ventilů u paty vrtu; intensity 1 = odpouštění, menší = syčení při přetlaku
function emitSteam(x, dt, intensity) {
    const baseY = getGroundLevel() - STRUCTURE_BASE_OFFSET;
    const count = Math.random() < (dt / 16) * intensity ? 1 + Math.floor(intensity * 2) : 0;
    for (let i = 0; i < count; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnParticle({
            type: 'puff', x: x + side * 10, y: baseY - 8 - Math.random() * 6,
            vx: side * (40 + Math.random() * 60) * intensity, vy: -20 - Math.random() * 50,
            age: 0, life: 900 + Math.random() * 500, size: 3 + Math.random() * 3, shade: 225
        });
    }
}

// Gejzír z korunky věže: kapky ropy s gravitací dopadají kolem vrtu
function emitGusher(network, x, dt) {
    const baseY = getGroundLevel() - STRUCTURE_BASE_OFFSET;
    const count = Math.max(1, Math.round(dt / 16 * 3));
    for (let i = 0; i < count; i++) {
        spawnParticle({
            type: 'oil', x: x + (Math.random() - 0.5) * 6, y: getRigTopY(),
            vx: (Math.random() - 0.5) * 180, vy: -230 - Math.random() * 110,
            gravity: 520, groundY: baseY - 4 + Math.random() * 14, plotId: network.derrickId,
            age: 0, life: 3000, size: 1.6 + Math.random() * 2.2
        });
    }
}

// Sloup ropy nad korunkou během erupce (kapky dělají částice, tohle je hustý střed proudu)
function drawGusherJet(x, topY) {
    const t = performance.now() / 1000;
    const height = 70 + Math.sin(t * 9) * 8;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - 4, topY);
    for (let k = 0; k <= 10; k++) {
        const yy = topY - height * k / 10;
        ctx.lineTo(x - 4 - k * 1.2 + Math.sin(t * 14 + k) * 2, yy);
    }
    for (let k = 10; k >= 0; k--) {
        const yy = topY - height * k / 10;
        ctx.lineTo(x + 4 + k * 1.2 + Math.sin(t * 12 + k * 1.3) * 2, yy);
    }
    ctx.closePath();
    const jet = ctx.createLinearGradient(0, topY, 0, topY - height);
    jet.addColorStop(0, 'rgba(20, 12, 8, 0.95)');
    jet.addColorStop(1, 'rgba(20, 12, 8, 0)');
    ctx.fillStyle = jet;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 160, 80, 0.35)'; // odlesk lampy na proudu
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

// Kaluž ropy na desce kolem vrtu: lesklá, odráží měsíc a lampu
function drawSpill(plot, groundLevel) {
    if (!(plot.spill > 0.01)) return;
    const cx = plot.x + plotWidth / 2;
    const cy = groundLevel - STRUCTURE_BASE_OFFSET + 6;
    const k = plot.spill;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3);
    ctx.fillStyle = '#070509';
    [[-10, 0, 1], [18, 3, 0.7], [-34, 2, 0.55]].forEach(([dx, dy, f]) => {
        ctx.beginPath();
        ctx.ellipse(cx + dx * (0.5 + k), cy + dy, (24 + 60 * k) * f, (5 + 8 * k) * f, 0, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.strokeStyle = 'rgba(170, 190, 255, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy - 1, 14 + 30 * k, 2 + 3 * k, 0, Math.PI * 1.1, Math.PI * 1.7);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 170, 90, 0.35)';
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy + 2, 4 + 6 * k, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Manometr vedle štítku zásobníku: ručička 0–100 %, červené pole od PRESSURE_WARN
function drawPressureGauge(x, y, pressure) {
    const r = 11;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.save();
    ctx.fillStyle = 'rgba(14, 14, 24, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(x, y, r - 2, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = '#ff5a4a';
    ctx.beginPath();
    ctx.arc(x, y, r - 2, a0 + (a1 - a0) * PRESSURE_WARN, a1);
    ctx.stroke();
    const shake = pressure > PRESSURE_WARN ? Math.sin(performance.now() / 30) * 0.06 : 0;
    const a = a0 + (a1 - a0) * Math.min(1, pressure) + shake;
    ctx.strokeStyle = pressure >= PRESSURE_WARN ? '#ff7a6a' : '#ffd36b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3));
    ctx.stroke();
    ctx.fillStyle = '#fff2df';
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (pressure >= PRESSURE_WARN) drawGlow(x, y, 22, '255, 70, 50', 0.35 + 0.25 * Math.sin(performance.now() / 120));
}

// --- Průzkumné nástroje (kresba) ---
// Logika je v sim.js: seismika (vlna z vlastního pozemku, ozvěny), dron (paprsek přes mapu),
// georadar (trvale odhalí ložiska v kruhu). Ozvěny a odhalení jsou soukromé pro hráče.
let toolClock = 0;       // zrcadlo world.tools.clock (ms nástrojů, běží herní rychlostí)
let seismicWaves = [];   // zrcadlo world.tools.waves
let radarPulses = [];    // zrcadlo world.tools.pulses
let drones = [];         // zrcadlo world.tools.drones (každý hráč nejvýš jeden)

function getPocketRichness(pocket) {
    return OilSim.getPocketRichness(pocket);
}

function getPocketEcho(pocket) {
    if (!pocket.echoUntil) return 0;
    return Math.max(0, Math.min(1, (pocket.echoUntil - toolClock) / ECHO_FADE_MS));
}

// Seismické vlny, pulzy georadaru a ozvěny ložisek (kreslí se v podzemí, před potrubím)
function drawToolEffects(groundLevel) {
    ctx.save();
    seismicWaves.forEach(wave => {
        const t = Math.min(1, wave.age / SEISMIC_WAVE_MS);
        const fade = 1 - Math.max(0, (wave.age - SEISMIC_WAVE_MS) / 500);
        for (let k = 0; k < 3; k++) {
            const r = SEISMIC_RADIUS * Math.max(0, t - k * 0.12);
            if (r <= 0) continue;
            ctx.strokeStyle = `rgba(160, 220, 255, ${(0.55 - k * 0.15) * fade * (1 - t * 0.6)})`;
            ctx.lineWidth = 3 - k;
            ctx.beginPath();
            ctx.arc(wave.x, wave.y, r, 0, Math.PI); // jen do podzemí
            ctx.stroke();
        }
    });
    radarPulses.forEach(p => {
        const t = p.age / RADAR_PULSE_MS;
        ctx.strokeStyle = `rgba(120, 255, 170, ${0.8 * (1 - t)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, RADAR_RADIUS * t, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(120, 255, 170, ${0.12 * (1 - t)})`;
        ctx.fill();
    });
    ctx.restore();

    // Ozvěny: azurový obrys a odhad velikosti, dokud jsou čerstvé
    oilPockets.forEach(pocket => {
        const echo = getPocketEcho(pocket);
        if (echo <= 0 || pocket.tapped || pocket.revealed) return;
        ctx.save();
        tracePocket(pocket);
        ctx.fillStyle = `rgba(80, 200, 255, ${0.14 * echo})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(140, 225, 255, ${0.85 * echo})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -toolClock / 60;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(200, 240, 255, ${echo})`;
        ctx.fillText(getPocketRichness(pocket).toUpperCase(), pocket.x + pocket.width / 2, pocket.y + pocket.height / 2);
        ctx.restore();
    });
}

// Drony s paprskem, který prosvítí podzemí pod sebou
function drawDrones(groundLevel) {
    drones.forEach(d => drawDrone(d, groundLevel));
}

function drawDrone(drone, groundLevel) {
    const t = toolClock / 1000;
    const x = drone.x;
    const y = groundLevel - DRONE_Y_OFFSET + Math.sin(t * 3) * 4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(0, y, 0, canvas.height);
    beam.addColorStop(0, 'rgba(110, 210, 255, 0.28)');
    beam.addColorStop(0.4, 'rgba(110, 210, 255, 0.10)');
    beam.addColorStop(1, 'rgba(110, 210, 255, 0.02)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.lineTo(x + DRONE_BEAM_HALF, canvas.height);
    ctx.lineTo(x - DRONE_BEAM_HALF, canvas.height);
    ctx.closePath();
    ctx.fill();
    // Skenovací linka v podzemí
    const scanY = groundLevel + ((t * 260) % (canvas.height - groundLevel));
    const half = 6 + (DRONE_BEAM_HALF - 6) * (scanY - y) / (canvas.height - y);
    ctx.fillStyle = 'rgba(150, 230, 255, 0.5)';
    ctx.fillRect(x - half, scanY, half * 2, 2);
    ctx.restore();

    ctx.fillStyle = '#1b1c26'; // tělo a ramena
    ctx.fillRect(x - 22, y - 2, 44, 3);
    pathRoundRect(x - 9, y - 6, 18, 10, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(170, 190, 255, 0.5)';
    ctx.fillRect(x - 9, y - 6, 18, 1.5);
    [-22, 22].forEach(dx => { // rozmazané vrtule
        ctx.fillStyle = 'rgba(200, 210, 240, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x + dx, y - 4, 11, 2, 0, 0, Math.PI * 2);
        ctx.fill();
    });
    const blink = Math.sin(t * 9) > 0;
    ctx.fillStyle = blink ? '#ff4a3a' : '#5a1a14';
    ctx.fillRect(x - 24, y - 1, 3, 3);
    ctx.fillStyle = blink ? '#4aff8a' : '#14401f';
    ctx.fillRect(x + 21, y - 1, 3, 3);
    drawGlow(x, y + 4, 14, '120, 210, 255', 0.6);
}

// --- Spuštění při načtení stránky ---
document.addEventListener('DOMContentLoaded', () => {
    loadImages();
}); 