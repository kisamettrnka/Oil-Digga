console.log("script.js: Skript se spustil.");

// --- Discord SDK Setup ---
// Tento kód je pro novější verzi SDK, která se inicializuje přes URL parametry.
// Test
let sdk = null;

async function setupDiscordSdk() {
    console.log("script.js: Volá se setupDiscordSdk(). Čeká se na sdk.ready()...");
    await sdk.ready();
    console.log("Discord SDK je připraveno!");

    // Získání informací o uživatelích v aktivitě
    try {
        const { participants } = await sdk.commands.getInstanceParticipants();
        console.log("Načteni počáteční hráči:", participants);
    } catch (e) {
        console.error("Nepodařilo se načíst účastníky", e);
    }
}


// --- Globální proměnné a konstanty ---
let canvas = null;
let ctx = null;
let lastTime = 0;
const START_MONEY = 3000;
let money = START_MONEY;
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
let temporaryEffects = [];
let lastBoughtHighlightTimer = 0;
let lastBoughtPlotId = null;

// Konstanty hry
const PLOT_COUNT = 8;
const VRT_COST = 350;
const SILO_COST = 250;
const TRUCK_COST = 150;
const DOWSER_COST = 100;
const SCANNER_COST = 500;
const MOLE_COST = 300;
const PIPE_COST_PER_PIXEL = 2;
const TRUCK_SPEED = 150;
const TRUCK_CAPACITY = 100;
const PRICE_UPDATE_INTERVAL = 5000;
const SILO_CAPACITY_BONUS = 500;
const DERRICK_BASE_CAPACITY = 50;
const OIL_PER_SECOND = 8;
const MAX_SILOS_PER_PLOT = 4;
const DAILY_LAND_TAX = 15;
const MIN_LOAD_AMOUNT = 25;
const MAX_TRUCKS = 8;
const MAX_FRAME_MS = 100; // Strop reálného času jednoho snímku (po návratu na kartu apod.)
const CONTROL_HIT_PAD = 8; // Zvětšení klikací plochy šipek na plátně
const DOWSER_MEDIUM_OIL = 8500;
const DOWSER_LARGE_OIL = 11500;
const DEV = false;

// Stav UI a ovládání
let mousePos = { x: 0, y: 0 };
let currentBuildMode = null; // 'vrt', 'silo', 'mole'
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
let priceUpdateTimer = 0;
let nextNetworkId = 0;

// Historie cen pro graf na budovách firem
const PRICE_HISTORY_LEN = 24;
let leftPriceHistory = [1.00];
let rightPriceHistory = [1.00];

// Částice (kouř z aut, "+$" při prodeji) a zvuk
const MAX_PARTICLES = 200;
let particles = [];
let soundMuted = false;
let audioCtx = null;

// Hitboxy pro ovládací prvky na plátně
let companyControls = {
    leftUp: {}, leftDown: {}, leftTrucks: {},
    rightUp: {}, rightDown: {}, rightTrucks: {}
};

// Herní čas
let day = 1;
let month = 1;
const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthNames = ["", "LED", "ÚNO", "BŘE", "DUB", "KVĚ", "ČER", "ČVC", "SRP", "ZÁŘ", "ŘÍJ", "LIS", "PRO"];
const MS_PER_DAY = 10000; // Kolik reálných ms trvá jeden herní den
let dayTimer = 0;

// Stavy nástrojů
let moleState = {
    active: false,
    startPoint: null
};
let scannerEffect = {
    active: false,
    duration: 0,
    totalDuration: 3000, // 3 sekundy
    progress: 0
};

// --- Načítání obrázků ---
let derrickImage = null, siloImage = null, truckImage = null;
let dowserImage = null, scannerImage = null, moleImage = null;
let imagesLoaded = 0;
const totalImages = 6;
let imagesFailed = 0;

function imageLoaded() {
    imagesLoaded++;
    if (imagesLoaded + imagesFailed === totalImages) {
        console.log("Všechny obrázky načteny nebo selhaly. Spouštím hru.");
        initializeGame();
    }
}

function imageFailed() {
    imagesFailed++;
    if (imagesLoaded + imagesFailed === totalImages) {
        console.log("Všechny obrázky načteny nebo selhaly. Spouštím hru.");
        initializeGame();
    }
}

function loadImages() {
    console.log("Zahajuji načítání obrázků...");
    derrickImage = new window.Image();
    derrickImage.onload = imageLoaded;
    derrickImage.onerror = imageFailed;
    derrickImage.src = 'img/oil-tower.png';

    siloImage = new window.Image();
    siloImage.onload = imageLoaded;
    siloImage.onerror = imageFailed;
    siloImage.src = 'img/tank.png';

    truckImage = new window.Image();
    truckImage.onload = imageLoaded;
    truckImage.onerror = imageFailed;
    truckImage.src = 'img/tanker.png';

    dowserImage = new window.Image();
    dowserImage.onload = imageLoaded;
    dowserImage.onerror = imageFailed;
    dowserImage.src = 'img/divining rod.png';

    scannerImage = new window.Image();
    scannerImage.onload = imageLoaded;
    scannerImage.onerror = imageFailed;
    scannerImage.src = 'img/binocular.png';

    moleImage = new window.Image();
    moleImage.onload = imageLoaded;
    moleImage.onerror = imageFailed;
    moleImage.src = 'img/mole.png';
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

    // Nastavení rozměrů a generování herních prvků
    generatePlotsAndPockets();

    // Připojení posluchačů událostí
    addEventListeners();

    // Kreslicí smyčka běží hned (hover, kurzor, blikání), herní čas teče až po koupi pozemku
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    console.log("Hra čeká na koupi pozemku.");
}

function startGameLoop() {
    if (!isGameStarted) {
        isGameStarted = true;
        lastTime = performance.now();
        updateUI(); // Aktualizace kalendáře a UI hned po startu hry
    }
}

// Vrátí všechen herní stav do výchozího a vygeneruje nový svět
function restartGame() {
    money = START_MONEY;
    isGameOver = false;
    gameOverReason = '';
    isPaused = false;
    gameSpeed = 1;
    totalRevenue = 0;
    totalOilSold = 0;

    pipeNetworks = [];
    trucks = [];
    temporaryEffects = [];
    lastBoughtHighlightTimer = 0;
    lastBoughtPlotId = null;

    currentBuildMode = null;
    selectedDerrickPlotId = null;

    leftIncPrice = 1.00;
    rightIncPrice = 1.00;
    leftPriceTrend = 0;
    rightPriceTrend = 0;
    trucksOwned = 0;
    plotBlinkTimers = {};
    trucksAssignedLeft = 0;
    trucksAssignedRight = 0;
    priceUpdateTimer = 0;
    nextNetworkId = 0;
    leftPriceHistory = [1.00];
    rightPriceHistory = [1.00];
    particles = [];

    day = 1;
    month = 1;
    dayTimer = 0;

    moleState = { active: false, startPoint: null };
    scannerEffect.active = false;
    scannerEffect.duration = 0;

    isGameStarted = false;
    generatePlotsAndPockets();
    lastTime = performance.now();
    updateUI();
}

function generatePlotsAndPockets() {
    const buildingWidth = 100; // Šířka budovy společnosti
    const gap = 10;
    const sideMargin = buildingWidth + gap;
    plotWidth = (canvas.width - 2 * sideMargin) / PLOT_COUNT;

    plots = [];
    for (let i = 0; i < PLOT_COUNT; i++) {
        plots.push({
            id: i,
            x: sideMargin + i * plotWidth,
            y: Math.floor(canvas.height / 3),
            owner: null,
            hasVrt: false,
            siloCount: 0,
            price: 50 + Math.floor(Math.random() * 451) // 50 až 500
        });
    }

    // Generování ložisek ropy
    oilPockets = [];
    const groundLevel = Math.floor(canvas.height / 3);
    const numberOfPockets = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numberOfPockets; i++) {
        const pocketWidth = 80 + Math.random() * 170;
        const x = Math.random() * (canvas.width - pocketWidth);
        const y = groundLevel + 100 + Math.random() * (canvas.height - groundLevel - 200);
        const height = 40 + Math.random() * 80;
        const richness = 5000 + Math.random() * 10000;
        let vertices = [];
        // between 3 and 6 vertices
        const numberOfVertices = 3 + Math.floor(Math.random() * 4);

        for (let j = 0; j < numberOfVertices; j++) {
            const angle = (j / numberOfVertices) * Math.PI * 2;
            const offsetX = Math.cos(angle) * (pocketWidth / 2);
            const offsetY = Math.sin(angle) * (height / 2);
            vertices.push({ x: x + pocketWidth / 2 + offsetX, y: y + height / 2 + offsetY });
        }
        oilPockets.push({
            x, y, width: pocketWidth, height,
            oil: richness,
            maxOil: richness,
            tapped: false,   // napojeno vrtem (jedno ložisko = jeden vrt)
            revealed: false, // odhaleno krtkem, stále vrtatelné
            vertices: vertices
        });
    }
}


// --- Herní smyčka a kreslení ---

function gameLoop(timestamp) {
    if (isGameOver) {
        drawGameOver();
        requestAnimationFrame(gameLoop);
        return;
    }

    if (isGameStarted && !isPaused) {
        // Strop snímku: po návratu na kartu nebo při lagu nesmí přijít obří dt
        const dt = Math.min(timestamp - lastTime, MAX_FRAME_MS) * gameSpeed;
        lastTime = timestamp;
        if (dt > 0) update(dt);
    } else {
        lastTime = timestamp;
    }

    draw();
    requestAnimationFrame(gameLoop);
}

function update(dt) {
    if (!isGameStarted || dt <= 0) return;

    // Herní čas
    dayTimer += dt;
    if (dayTimer >= MS_PER_DAY) {
        dayTimer -= MS_PER_DAY;
        day++;
        const ownedPlots = plots.filter(p => p.owner === 'player').length;
        if (ownedPlots > 0) {
            money -= ownedPlots * DAILY_LAND_TAX;
            if (money < 0) {
                isGameOver = true;
                gameOverReason = 'bankrupt';
            }
        }
        if (day > daysInMonth[month]) {
            if (month === 12) {
                // Konec roku: kalendář zůstane na posledním dni, nikdy nejde na měsíc 13
                day = daysInMonth[month];
                if (!isGameOver) {
                    isGameOver = true;
                    gameOverReason = 'year_end';
                }
            } else {
                day = 1;
                month++;
            }
        }
    }

    // Aktualizace cen s trendem
    priceUpdateTimer += dt;
    if (priceUpdateTimer > PRICE_UPDATE_INTERVAL) {
        priceUpdateTimer = 0;
        const leftDelta = (Math.random() - 0.45 + leftPriceTrend * 0.15) * 0.12;
        const rightDelta = (Math.random() - 0.45 + rightPriceTrend * 0.15) * 0.12;
        leftIncPrice = Math.max(0.25, Math.min(2.80, leftIncPrice + leftDelta));
        rightIncPrice = Math.max(0.25, Math.min(2.80, rightIncPrice + rightDelta));
        leftPriceTrend = Math.max(-1, Math.min(1, leftPriceTrend + (Math.random() - 0.5) * 0.4));
        rightPriceTrend = Math.max(-1, Math.min(1, rightPriceTrend + (Math.random() - 0.5) * 0.4));

        leftPriceHistory.push(leftIncPrice);
        rightPriceHistory.push(rightIncPrice);
        if (leftPriceHistory.length > PRICE_HISTORY_LEN) leftPriceHistory.shift();
        if (rightPriceHistory.length > PRICE_HISTORY_LEN) rightPriceHistory.shift();
    }

    // Těžba ropy — čerpá ze zapojeného ložiska
    pipeNetworks.forEach(network => {
        if (!network.isPumping || network.oilStored >= network.oilCapacity) return;
        const pocket = network.connectedPocket;
        if (!pocket || pocket.oil <= 0) {
            network.isPumping = false;
            return;
        }
        const room = network.oilCapacity - network.oilStored;
        const extracted = Math.min(OIL_PER_SECOND * (dt / 1000), pocket.oil, room);
        network.oilStored += extracted;
        pocket.oil -= extracted;
        if (pocket.oil <= 0) {
            pocket.oil = 0;
            network.isPumping = false;
        }
    });

    updateTrucks(dt);
    updateParticles(dt);

    temporaryEffects = temporaryEffects.filter(effect => {
        effect.duration -= dt;
        return effect.duration > 0;
    });

    if (scannerEffect.active) {
        scannerEffect.duration -= dt;
        if (scannerEffect.duration <= 0) scannerEffect.active = false;
    }
}

function draw() {
    const groundLevel = Math.floor(canvas.height / 3);

    // Vyčištění a pozadí
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSkyAndGround(groundLevel);

    // Kreslení herních prvků
    drawOilPockets(groundLevel);
    drawPipeNetworks();
    drawPlots(groundLevel);

    plots.forEach(plot => {
        const centerX = plot.x + plotWidth / 2;
        if (plot.hasVrt) {
            const network = pipeNetworks.find(n => n.derrickId === plot.id);
            drawDerrick(centerX, plot.y, plot.id, network ? network.isPumping : false, network);
        }
        // Kreslení sil (hladina ukazuje zaplnění zásobníku vrtu)
        const siloNetwork = pipeNetworks.find(n => n.derrickId === plot.id);
        const siloFill = siloNetwork && siloNetwork.oilCapacity > 0
            ? Math.min(1, siloNetwork.oilStored / siloNetwork.oilCapacity) : 0;
        for (let i = 0; i < plot.siloCount; i++) {
            drawSilo(centerX + SILO_OFFSET_X + i * SILO_STEP, plot.y, siloFill);
        }
    });

    // Budovy a UI na plátně
    drawCompanyBuildings(groundLevel);

    // Silnice nad zemí, po ní jezdí auta
    drawRoad(groundLevel);
    drawTrucks(groundLevel);
    drawParticles();

    // Kreslení dočasných efektů a náhledů
    drawEffectsAndPreviews(groundLevel);
    drawSoundButton();

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

function updateUI() {
    // Peníze
    document.getElementById('money-value').textContent = Math.floor(money);

    // Kalendář
    document.getElementById('month').textContent = monthNames[month];
    document.getElementById('day').textContent = day;

    // Tlačítka
    const buttons = [
        { el: document.getElementById('vrt-btn'), cost: VRT_COST, mode: 'vrt' },
        { el: document.getElementById('silo-btn'), cost: SILO_COST, mode: 'silo' },
        { el: document.getElementById('truck-btn'), cost: TRUCK_COST, isTruck: true },
        { el: document.getElementById('mole-btn'), cost: MOLE_COST, mode: 'mole' },
        { el: document.getElementById('scanner-btn'), cost: SCANNER_COST, isScanner: true },
        { el: document.getElementById('dowser-btn'), cost: DOWSER_COST, needsOwnedPlot: true },
    ];

    buttons.forEach(item => {
        if (!item.el) return;

        let isDisabled = money < item.cost;
        if (item.isTruck) isDisabled = isDisabled || trucksOwned >= MAX_TRUCKS;
        if (item.mode === 'silo') {
            const canBuildSilo = plots.some(p => p.owner === 'player' && p.hasVrt && p.siloCount < MAX_SILOS_PER_PLOT);
            isDisabled = isDisabled || !canBuildSilo;
        }
        if (item.isScanner) isDisabled = isDisabled || scannerEffect.active;
        if (item.needsOwnedPlot) isDisabled = isDisabled || !plots.some(p => p.owner === 'player');
        item.el.disabled = isDisabled;

        if (item.isTruck) {
            const priceEl = item.el.querySelector('.price');
            if (priceEl) priceEl.textContent = `$${item.cost} (${trucksOwned})`;
        }

        if (item.mode) {
            item.el.classList.toggle('active-build-mode', currentBuildMode === item.mode);
        }
    });

    // Rychlost hry
    const speedBtn = document.getElementById('speed-btn');
    if (speedBtn) {
        const speedLabels = { 1: '►', 2: '►►', 4: '►►►' };
        speedBtn.textContent = speedLabels[gameSpeed] || '►';
        speedBtn.style.filter = gameSpeed > 1 ? 'hue-rotate(120deg)' : 'none';
    }
}


// --- Kreslící pod-funkce ---

function drawSkyAndGround(groundLevel) {
    // Obloha
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, canvas.width, groundLevel);
    // Podzemí
    ctx.fillStyle = '#8B5A2B';
    ctx.fillRect(0, groundLevel, canvas.width, canvas.height - groundLevel);
}

// Přidám globální pole pro hitboxy cedulí
let plotSignHitboxes = [];
let plotsHoverPointer = false; // myš je nad cedulí nebo stavitelným pozemkem

const PLOT_SIGN_PAD = 10;
const PLOT_SIGN_POST = 42; // výška sloupku: cedule musí být nad střechami projíždějících aut
const PLOT_SIGN_FONT = 'bold 18px "Rye", Georgia, serif';

function getPlotSignRect(plot, groundLevel) {
    const signWidth = 92;
    const signHeight = 32;
    const postHeight = PLOT_SIGN_POST;
    const signX = Math.round(plot.x + (plotWidth / 2) - (signWidth / 2));
    const signY = Math.round(groundLevel - postHeight - signHeight);
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
    ctx.save();
    ctx.fillStyle = canAfford
        ? 'rgba(255, 215, 0, 0.22)'
        : 'rgba(255, 0, 0, 0.14)';
    ctx.fillRect(plot.x, 0, plotWidth, groundLevel);
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

    return {
        x: Math.max(0, Math.min(canvas.width, rawX)),
        y: Math.max(0, Math.min(canvas.height, rawY)),
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

function getOwnedPlotForTool(x) {
    const atCursor = getPlotAtX(x);
    if (atCursor && atCursor.owner === 'player') return atCursor;
    return plots.find(p => p.owner === 'player') || null;
}

function createPipeNetwork(derrickId, startPlot) {
    const groundLevel = Math.floor(canvas.height / 3);
    return {
        id: nextNetworkId++,
        derrickId,
        path: [{ x: startPlot.x + plotWidth / 2, y: groundLevel }],
        isPumping: false,
        oilStored: 0,
        oilCapacity: DERRICK_BASE_CAPACITY + startPlot.siloCount * SILO_CAPACITY_BONUS,
        connectedPocket: null
    };
}

function getPurchasablePlotAt(clickPos, groundLevel) {
    if (clickPos.y > groundLevel) return null;
    return plots.find(p => p.owner === null &&
        clickPos.x >= p.x && clickPos.x < p.x + plotWidth) || null;
}

function tryPurchasePlot(plot, groundLevel) {
    if (!plot || plot.owner) return 'none';

    if (money >= plot.price) {
        money -= plot.price;
        plot.owner = 'player';
        playSound('build');
        startGameLoop();
        lastBoughtPlotId = plot.id;
        lastBoughtHighlightTimer = 30;
        updatePlotSignHitboxes(groundLevel);
        updateUI();
        return 'bought';
    }

    plotBlinkTimers[plot.id] = 20;
    return 'too_expensive';
}

function drawPlots(groundLevel) {
    ctx.strokeStyle = '#D2B48C';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    for (let i = 1; i < PLOT_COUNT; i++) {
        const x = plots[i].x;
        ctx.beginPath();
        ctx.moveTo(x, groundLevel);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    ctx.setLineDash([]);

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

            ctx.fillStyle = '#6B3A1F';
            ctx.fillRect(Math.round(plot.x + (plotWidth / 2) - 3), groundLevel - postHeight, 6, postHeight);

            ctx.save();
            if (isHovered) {
                ctx.shadowColor = canAfford ? 'rgba(255, 215, 0, 0.6)' : 'rgba(255, 80, 80, 0.5)';
                ctx.shadowBlur = 10;
            }
            ctx.fillStyle = '#FDF5E6';
            ctx.fillRect(signX, signY, signWidth, signHeight);
            ctx.strokeStyle = isHovered ? (canAfford ? '#FFD700' : '#E74C3C') : '#3D2B1F';
            ctx.lineWidth = isHovered ? 3 : 2;
            ctx.strokeRect(signX + 0.5, signY + 0.5, signWidth - 1, signHeight - 1);
            ctx.restore();

            ctx.font = PLOT_SIGN_FONT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = canAfford ? '#2E5C1F' : '#8B2500';
            ctx.fillText(`$${plot.price}`, plot.x + plotWidth / 2, signY + signHeight / 2 + 1);

            if (plotBlinkTimers[plot.id] && plotBlinkTimers[plot.id] % 4 < 2) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.35)';
                ctx.fillRect(signX, signY, signWidth, signHeight);
            }
        } else if (plot.id === lastBoughtPlotId && lastBoughtHighlightTimer > 0) {
            // Zvýraznění právě koupeného pozemku - pouze žlutý pruh, NE vrt!
            ctx.save();
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 5;
            ctx.strokeRect(plot.x, groundLevel, plotWidth, 10);
            ctx.restore();
        }
        // Nově: pokud je aktivní build mód vrtu a myš je nad vlastněným pozemkem bez vrtu
        if (currentBuildMode === 'vrt' && plot.owner === 'player' && !plot.hasVrt) {
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

function drawOilPockets(groundLevel) {
    oilPockets.forEach(pocket => {
        // Zobrazit obrys jen pokud je aktivní scanner
        if (scannerEffect.active) {
            const alpha = scannerEffect.duration / scannerEffect.totalDuration;
            const fillRatio = pocket.maxOil > 0 ? pocket.oil / pocket.maxOil : 0;
            ctx.beginPath();
            ctx.moveTo(pocket.vertices[0].x, pocket.vertices[0].y);
            for (let i = 1; i < pocket.vertices.length; i++) {
                ctx.lineTo(pocket.vertices[i].x, pocket.vertices[i].y);
            }
            ctx.closePath();
            ctx.fillStyle = `rgba(0, 180, 0, ${alpha * 0.25 * fillRatio})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Zobrazit plné ložisko jen pokud bylo zasaženo vrtem nebo odhaleno krtkem
        if (DEV || pocket.tapped || pocket.revealed) {
            ctx.beginPath();
            const fillRatio = pocket.maxOil > 0 ? pocket.oil / pocket.maxOil : 0;
            ctx.fillStyle = `rgba(0, 0, 0, ${0.5 + fillRatio * 0.4})`;
            ctx.moveTo(pocket.vertices[0].x, pocket.vertices[0].y);

            for (let i = 1; i < pocket.vertices.length; i++) {
                ctx.lineTo(pocket.vertices[i].x, pocket.vertices[i].y);
            }
            ctx.lineTo(pocket.vertices[0].x, pocket.vertices[0].y);
            ctx.fill();
            ctx.closePath();
        }
    });
}

function drawDerrick(x, y, plotId, isPumping, network) {
    const derrickWidth = 80, derrickHeight = 100;
    ctx.save();
    ctx.translate(x, y);
    if (selectedDerrickPlotId === plotId) {
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 15;
    }
    if (derrickImage && derrickImage.complete && derrickImage.naturalWidth > 0) {
        drawSprite(derrickImage, 0, 0, 100, derrickHeight);
    } else {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(-derrickWidth / 2, -derrickHeight, derrickWidth, derrickHeight);
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(-10, -derrickHeight, 20, derrickHeight / 2);
    }
    if (isPumping) {
        const pumpAngle = Math.sin(Date.now() / 300) * 0.2;
        ctx.save();
        ctx.translate(0, -derrickHeight * 0.75);
        ctx.rotate(pumpAngle);
        ctx.fillStyle = "#696969";
        ctx.fillRect(-5, -5, 30, 10);
        ctx.restore();
    }

    if (network && network.oilCapacity > 0) {
        const fillRatio = Math.min(1, network.oilStored / network.oilCapacity);
        const barW = 50, barH = 8;
        const barX = -barW / 2, barY = 8;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = fillRatio > 0.8 ? '#e74c3c' : '#2ecc71';
        ctx.fillRect(barX, barY, barW * fillRatio, barH);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.floor(network.oilStored)}/${network.oilCapacity}`, 0, barY + barH + 10);

        if (isPumping && fillRatio >= 0.98) {
            // Plný zásobník: vrt stojí a čeká na auto, ať je to vidět
            const blink = Math.sin(Date.now() / 200) > 0;
            ctx.strokeStyle = blink ? '#ff3b30' : '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
            ctx.fillStyle = blink ? '#ff6b60' : '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('PLNO – čeká na auto', 0, barY + barH + 23);
        }
    }
    ctx.restore();
}

// Ikony jsou čtverce 512×512 s průhledným okrajem. Oříznout na obsah a zachovat poměr stran,
// jinak se do nečtvercového boxu natáhnou (zploštěná auta, protažená sila).
const spriteBoundsCache = new WeakMap();

function getSpriteBounds(img) {
    if (spriteBoundsCache.has(img)) return spriteBoundsCache.get(img);
    let bounds = { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
    try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cctx = c.getContext('2d');
        cctx.drawImage(img, 0, 0);
        const data = cctx.getImageData(0, 0, c.width, c.height).data;
        let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
        for (let py = 0; py < c.height; py++) {
            for (let px = 0; px < c.width; px++) {
                if (data[(py * c.width + px) * 4 + 3] > 16) {
                    if (px < minX) minX = px;
                    if (px > maxX) maxX = px;
                    if (py < minY) minY = py;
                    if (py > maxY) maxY = py;
                }
            }
        }
        if (maxX >= 0) bounds = { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
    } catch (e) {
        // Canvas nelze přečíst (jiný origin): použije se celý obrázek
    }
    spriteBoundsCache.set(img, bounds);
    return bounds;
}

// Vykreslí obsah ikony do boxu maxW×maxH, vystředěný na centerX, spodní hranou na bottomY
function drawSprite(img, centerX, bottomY, maxW, maxH) {
    const b = getSpriteBounds(img);
    const scale = Math.min(maxW / b.sw, maxH / b.sh);
    const w = b.sw * scale, h = b.sh * scale;
    ctx.drawImage(img, b.sx, b.sy, b.sw, b.sh, centerX - w / 2, bottomY - h, w, h);
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

    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'; // stín
    ctx.beginPath();
    ctx.ellipse(0, 1, w / 2 + 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    const steel = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    steel.addColorStop(0, '#8E9AA3');
    steel.addColorStop(0.35, '#D5DCE0');
    steel.addColorStop(1, '#7C8790');
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

function drawPipeNetworks() {
    pipeNetworks.forEach(network => {
        if (network.path.length < 2) return;

        const isMole = network.isMoleTunnel;
        ctx.strokeStyle = isMole ? '#5D3A1A' : '#333333';
        ctx.lineWidth = isMole ? 4 : 6;
        ctx.setLineDash(isMole ? [8, 6] : []);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(network.path[0].x, network.path[0].y);
        for (let i = 1; i < network.path.length; i++) {
            ctx.lineTo(network.path[i].x, network.path[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (network.isPumping) {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = isMole ? 2 : 4;
            ctx.stroke();
        }
    });
}

function drawCompanyBuildings(groundLevel) {
    const bWidth = 100, bHeight = 100;

    // Levá firma
    const leftBaseY = groundLevel - bHeight;
    ctx.fillStyle = '#A9C7D9';
    ctx.fillRect(0, leftBaseY, bWidth, bHeight);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = 'bold 16px sans-serif'; // "RIGHT INC" se ve 100 px široké budově při 20 px nevejde
    ctx.textAlign = 'center';
    ctx.fillText('LEFT INC', bWidth / 2, leftBaseY + 20);

    // Pravá firma
    const rightBaseX = canvas.width - bWidth;
    ctx.fillStyle = '#D2A679';
    ctx.fillRect(rightBaseX, groundLevel - bHeight, bWidth, bHeight);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('RIGHT INC', rightBaseX + bWidth / 2, leftBaseY + 20);

    // Kolik aut právě jezdí k dané firmě
    const driving = { left: 0, right: 0 };
    trucks.forEach(t => {
        if (t.state !== 'idle' && driving[t.targetCompany] !== undefined) driving[t.targetCompany]++;
    });
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#1F2D3A';
    ctx.fillText(`${driving.left}`, bWidth / 2, leftBaseY + 56);
    ctx.fillText(`${driving.right}`, rightBaseX + bWidth / 2, leftBaseY + 56);
    ctx.font = '12px sans-serif';
    ctx.fillText('aut jezdí', bWidth / 2, leftBaseY + 74);
    ctx.fillText('aut jezdí', rightBaseX + bWidth / 2, leftBaseY + 74);

    // Vývoj ceny: graf posledních změn
    drawPriceChart(leftPriceHistory, 10, leftBaseY + 81, bWidth - 20, 16);
    drawPriceChart(rightPriceHistory, rightBaseX + 10, leftBaseY + 81, bWidth - 20, 16);

    // Ceny
    ctx.fillStyle = '#5C4033';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`$${leftIncPrice.toFixed(2)}`, bWidth / 2, leftBaseY - 15);
    ctx.fillText(`$${rightIncPrice.toFixed(2)}`, rightBaseX + bWidth / 2, leftBaseY - 15);

    ctx.font = '16px sans-serif';
    ctx.fillStyle = leftPriceTrend >= 0 ? '#2ecc71' : '#e74c3c';
    ctx.fillText(leftPriceTrend >= 0 ? '▲' : '▼', bWidth / 2, leftBaseY - 35);
    ctx.fillStyle = rightPriceTrend >= 0 ? '#2ecc71' : '#e74c3c';
    ctx.fillText(rightPriceTrend >= 0 ? '▲' : '▼', rightBaseX + bWidth / 2, leftBaseY - 35);

    // Výpočet pro centrování šipek a čísla
    const arrowSize = 25;
    const spacing = 70; // vzdálenost mezi horní a dolní šipkou
    const centerY = groundLevel - bHeight - 60 - 50; // posun šipek přesně o 50px výše

    // Horní šipka
    companyControls.leftUp = { x: 37, y: centerY - spacing / 2, width: arrowSize, height: arrowSize };
    // Dolní šipka
    companyControls.leftDown = { x: 37, y: centerY + spacing / 2, width: arrowSize, height: arrowSize };
    // Číslo (nula) přesně mezi šipkami
    companyControls.leftTrucks = { x: 37, y: centerY - arrowSize / 2, width: arrowSize, height: 35 };

    companyControls.rightUp = { x: canvas.width - 37 - arrowSize, y: centerY - spacing / 2, width: arrowSize, height: arrowSize };
    companyControls.rightDown = { x: canvas.width - 37 - arrowSize, y: centerY + spacing / 2, width: arrowSize, height: arrowSize };
    companyControls.rightTrucks = { x: canvas.width - 37 - arrowSize, y: centerY - arrowSize / 2, width: arrowSize, height: 35 };

    drawArrowButton(companyControls.leftUp, true);
    drawArrowButton(companyControls.leftDown, false);
    drawArrowButton(companyControls.rightUp, true);
    drawArrowButton(companyControls.rightDown, false);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#1F2D3A';
    ctx.textAlign = 'center';
    // Y-pozice čísla bude přesně mezi šipkami
    ctx.fillText(trucksAssignedLeft, companyControls.leftTrucks.x + arrowSize / 2, centerY + 8);
    ctx.fillText(trucksAssignedRight, companyControls.rightTrucks.x + arrowSize / 2, centerY + 8);

    // Popisek: číslo mezi šipkami je počet aut přidělených firmě (nejdřív plní tyto sloty)
    ctx.font = '11px sans-serif';
    ctx.fillText('přiděleno', companyControls.leftUp.x + arrowSize / 2, companyControls.leftUp.y - 6);
    ctx.fillText('přiděleno', companyControls.rightUp.x + arrowSize / 2, companyControls.rightUp.y - 6);
}

// Malý čárový graf cen. Osa Y se přizpůsobí, minimální rozsah 0,30 $, ať drobné změny nevypadají dramaticky.
function drawPriceChart(history, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(x, y, w, h);
    if (history.length >= 2) {
        let min = Math.min(...history);
        let max = Math.max(...history);
        const pad = Math.max(0, (0.3 - (max - min)) / 2);
        min -= pad;
        max += pad;
        const px = i => x + (i / (history.length - 1)) * w;
        const py = v => y + h - 2 - ((v - min) / (max - min)) * (h - 4);
        const rising = history[history.length - 1] >= history[0];
        ctx.strokeStyle = rising ? '#1E8449' : '#C0392B';
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

function drawArrowButton(rect, isUp) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.beginPath();
    const halfW = rect.width / 2;
    if (isUp) {
        ctx.moveTo(rect.x + 7, rect.y + 15);
        ctx.lineTo(rect.x + halfW, rect.y + 10);
        ctx.lineTo(rect.x + rect.width - 7, rect.y + 15);
    } else {
        ctx.moveTo(rect.x + 7, rect.y + 10);
        ctx.lineTo(rect.x + halfW, rect.y + 15);
        ctx.lineTo(rect.x + rect.width - 7, rect.y + 10);
    }
    ctx.fill();
    ctx.restore();
}

// --- Silnice a auta ---
const ROAD_HEIGHT = 16;
const TRUCK_LENGTH = 76;
const TRUCK_GAP_PAD = 6; // minimální mezera mezi auty jedoucími za sebou
const TRUCK_COLORS = { left: '#4F86B5', right: '#C77D2E' }; // laditěné k budovám firem

function drawRoad(groundLevel) {
    ctx.fillStyle = '#4A4A4A';
    ctx.fillRect(0, groundLevel, canvas.width, ROAD_HEIGHT);
    ctx.fillStyle = '#8B4513'; // hrana mezi zemí a silnicí
    ctx.fillRect(0, groundLevel, canvas.width, 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, groundLevel + ROAD_HEIGHT - 3, canvas.width, 3);
}

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
        const color = TRUCK_COLORS[truck.targetCompany] || '#777777';
        drawTankerTruck(renderX, getTruckBaseY(truck, groundLevel), facing, color, truck.oil / TRUCK_CAPACITY);
    });
}

// Spodní hrana kol: pruh podle směru jízdy (doprava dole, doleva nahoře)
function getTruckBaseY(truck, groundLevel) {
    if (truck.state === 'waiting_at_rig') return groundLevel + 1; // zaparkované u vrtu, projíždějící auta ho překryjí
    return groundLevel + 7 + ((truck.facing || 1) > 0 ? 1 : 0) * 7;
}

// --- Částice ---
function spawnParticle(particle) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(particle);
}

function updateParticles(dt) {
    particles.forEach(p => {
        p.age += dt;
        p.x += p.vx * dt / 1000;
        p.y += p.vy * dt / 1000;
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
        } else if (p.type === 'text') {
            ctx.globalAlpha = 1 - t * t;
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(20, 40, 20, 0.85)';
            ctx.strokeText(p.text, p.x, p.y);
            ctx.fillStyle = '#7CFC8A';
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
    const groundLevel = Math.floor(canvas.height / 3);
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

// --- Zvuk (WebAudio, žádné soubory) ---
const SOUND_PATTERNS = {
    sale: [[880, 0], [1320, 0.09]],
    build: [[196, 0], [147, 0.08]],
    strike: [[330, 0], [415, 0.1], [494, 0.2], [659, 0.3]]
};

function playSound(kind) {
    if (soundMuted) return;
    try {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            audioCtx = new AudioContextClass();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });
        const start = audioCtx.currentTime;
        (SOUND_PATTERNS[kind] || []).forEach(([freq, delay]) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, start + delay);
            gain.gain.exponentialRampToValueAtTime(0.06, start + delay + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.16);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(start + delay);
            osc.stop(start + delay + 0.18);
        });
    } catch (e) {
        // Zvuk je jen bonus: bez AudioContextu hra funguje dál
    }
}

function getSoundButtonRect() {
    return { x: canvas.width - 150, y: canvas.height - 44, width: 130, height: 30 };
}

function toggleSound() {
    soundMuted = !soundMuted;
}

function drawSoundButton() {
    const r = getSoundButtonRect();
    const hovered = isPointInRect(mousePos, r);
    ctx.save();
    pathRoundRect(r.x, r.y, r.width, r.height, 8);
    ctx.fillStyle = hovered ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
    ctx.fillStyle = soundMuted ? '#ff8a80' : '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(soundMuted ? 'ZVUK: VYP (M)' : 'ZVUK: ZAP (M)', r.x + r.width / 2, r.y + r.height / 2 + 1);
    ctx.restore();
    if (hovered) canvas.style.cursor = 'pointer';
}

function drawEffectsAndPreviews(groundLevel) {
    let newCursor = plotsHoverPointer ? 'pointer' : 'default';

    // Náhled stavby
    if (currentBuildMode === 'vrt') {
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === 'player' && !hoveredPlot.hasVrt) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawDerrick(hoveredPlot.x + plotWidth / 2, groundLevel, -1, false);
            ctx.restore();
            newCursor = 'pointer';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (currentBuildMode === 'silo') {
        const hoveredPlot = getPlotAtX(mousePos.x);
        if (hoveredPlot && hoveredPlot.owner === 'player' && hoveredPlot.hasVrt) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            drawSilo(hoveredPlot.x + plotWidth / 2 + SILO_OFFSET_X + hoveredPlot.siloCount * SILO_STEP, groundLevel, 0);
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
                ctx.strokeStyle = money >= cost ? 'rgba(80, 80, 80, 0.7)' : 'rgba(255, 80, 80, 0.7)';
                ctx.lineWidth = 4;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(lastPoint.x, lastPoint.y);
                ctx.lineTo(mousePos.x, mousePos.y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = money >= cost ? '#ffffff' : '#ff6666';
                ctx.font = 'bold 14px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(`$${cost}`, mousePos.x + 8, mousePos.y - 8);
                ctx.restore();
            }
        }
    } else if (currentBuildMode === 'mole' && moleState.startPoint) {
        ctx.strokeStyle = 'rgba(139, 69, 19, 0.7)';
        ctx.lineWidth = 6;
        ctx.setLineDash([15, 10]);
        ctx.beginPath();
        ctx.moveTo(moleState.startPoint.x, moleState.startPoint.y);
        ctx.lineTo(mousePos.x, moleState.startPoint.y); // Ukazujeme jen horizontální náhled
        ctx.stroke();
        ctx.setLineDash([]);
        newCursor = 'crosshair';
    }

    if (canvas.style.cursor !== newCursor) {
        canvas.style.cursor = newCursor;
    }

    // Kreslení dočasných efektů (šipky, atd.)
    temporaryEffects.forEach(effect => {
        if (effect.type === 'arrow' || effect.type === 'dowser') {
            const alpha = effect.duration / (effect.totalDuration || 8000);
            ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
            ctx.font = '40px sans-serif';
            ctx.textAlign = 'center';
            const arrowChar = effect.direction === 0 ? '▼' : (effect.direction > 0 ? '▶' : '◀');
            ctx.fillText(arrowChar, effect.x, effect.y);
            if (effect.label) {
                ctx.font = '14px sans-serif';
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fillText(effect.label, effect.x, effect.y + 22);
            }
            if (effect.type === 'dowser' && effect.targetX != null) {
                ctx.strokeStyle = `rgba(255, 215, 0, ${alpha * 0.5})`;
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 8]);
                ctx.beginPath();
                ctx.moveTo(effect.x, effect.y + 10);
                ctx.lineTo(effect.targetX, effect.targetY);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        } else if (effect.type === 'moleMarker') {
            ctx.fillStyle = `rgba(139, 69, 19, ${effect.duration / 15000})`;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 10, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

function drawPauseScreen() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 70px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUZA', canvas.width / 2, canvas.height / 2);
}

function drawGameOver() {
    draw();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    const title = gameOverReason === 'bankrupt' ? 'BANKROT!' : 'KONEC ROKU';
    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 120);

    ctx.font = '32px sans-serif';
    ctx.fillText(`Finální kapitál: $${Math.floor(money)}`, canvas.width / 2, canvas.height / 2 - 40);
    ctx.fillText(`Celkové tržby: $${Math.floor(totalRevenue)}`, canvas.width / 2, canvas.height / 2 + 10);
    ctx.fillText(`Prodáno ropy: ${Math.floor(totalOilSold)} barelů`, canvas.width / 2, canvas.height / 2 + 55);

    const ownedPlots = plots.filter(p => p.owner === 'player').length;
    const activeRigs = plots.filter(p => p.hasVrt).length;
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
    if (network.derrickId >= 0) {
        const plot = plots.find(p => p.id === network.derrickId);
        if (plot) return plot.x + plotWidth / 2;
    }
    if (network.path.length > 0) {
        const mid = network.path[Math.floor(network.path.length / 2)];
        return mid.x;
    }
    return canvas.width / 2;
}

function pickBestCompany() {
    if (leftIncPrice > rightIncPrice + 0.05) return 'left';
    if (rightIncPrice > leftIncPrice + 0.05) return 'right';
    if (trucksAssignedLeft > trucksAssignedRight) return 'left';
    if (trucksAssignedRight > trucksAssignedLeft) return 'right';
    return Math.random() < 0.5 ? 'left' : 'right';
}

function pickCompanyForTruck(activeLeft, activeRight) {
    if (activeLeft < trucksAssignedLeft) return 'left';
    if (activeRight < trucksAssignedRight) return 'right';
    return pickBestCompany();
}

// Vybere vrt pro další jízdu kamionu. Preferuje vrt s nejvíc ropou, penalizuje vrty, kam už
// jiná auta jedou (rozloží se mezi doly) a vzdálenost od kamionu. Volá se před každou jízdou,
// takže nový vrt začnou obsluhovat i auta, která už jezdí.
function findNetworkForTruck(truck) {
    let best = null;
    let bestScore = -Infinity;
    pipeNetworks.forEach(network => {
        if (network.derrickId < 0 || !network.isPumping) return;
        const claimed = trucks.filter(t => t !== truck && t.homeNetworkId === network.id &&
            (t.state === 'to_rig' || t.state === 'waiting_at_rig')).length;
        const distance = Math.abs(getNetworkPickupX(network) - truck.x);
        const score = network.oilStored - claimed * TRUCK_CAPACITY - distance * 0.01;
        if (score > bestScore) {
            bestScore = score;
            best = network;
        }
    });
    return best;
}

function tryLoadTruckAtRig(truck, network) {
    const loadAmount = Math.min(TRUCK_CAPACITY, Math.floor(network.oilStored));
    if (loadAmount < MIN_LOAD_AMOUNT) return false;
    network.oilStored -= loadAmount;
    truck.oil = loadAmount;
    return true;
}

function getTruckHomeNetwork(truck) {
    return pipeNetworks.find(n => n.id === truck.homeNetworkId) || null;
}

// Firma pro kamion: nejdřív naplní přiřazené sloty (šipky), zbytek jede k lepší ceně.
// Počítá ostatní kamiony, takže volba je platná i pro kamion, který už nějakou firmu měl.
function chooseCompanyFor(truck) {
    const others = trucks.filter(t => t !== truck && t.state !== 'idle');
    const activeLeft = others.filter(t => t.targetCompany === 'left').length;
    const activeRight = others.filter(t => t.targetCompany === 'right').length;
    return pickCompanyForTruck(activeLeft, activeRight);
}

function dispatchIdleTruck(truck) {
    const network = findNetworkForTruck(truck);
    if (!network) return false;

    truck.homeNetworkId = network.id;
    truck.targetCompany = chooseCompanyFor(truck);
    truck.state = 'to_rig';

    // Vjezd z okraje mapy; když tam už jiné auto je, postaví se za něj
    const edgeDir = truck.targetCompany === 'left' ? -1 : 1;
    const minGap = TRUCK_LENGTH + TRUCK_GAP_PAD;
    let spawnX = truck.targetCompany === 'left' ? -50 : canvas.width + 50;
    for (let guard = 0; guard < 20 &&
        trucks.some(o => o !== truck && o.state !== 'idle' && Math.abs(o.x - spawnX) < minGap); guard++) {
        spawnX += edgeDir * minGap;
    }
    truck.x = spawnX;
    truck.facing = -edgeDir; // jede dovnitř mapy
    return true;
}

// Omezí krok kamionu tak, aby nenajel na auto před sebou. Pruhy se podle směru nepotkávají,
// auto čekající u vrtu stojí bokem a brzdí jen ta, která jedou ke stejnému vrtu.
function trafficLimitedStep(truck, targetX, step) {
    const dir = Math.sign(targetX - truck.x);
    if (dir === 0) return step;
    const minGap = TRUCK_LENGTH + TRUCK_GAP_PAD;
    let allowed = step;
    trucks.forEach(other => {
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

// Posune kamion k cíli o nejvýš `step` pixelů. Vrací true, když dorazil (bez přeskoku cíle).
function moveTruckToward(truck, targetX, step) {
    const distance = targetX - truck.x;
    if (distance !== 0) truck.facing = Math.sign(distance); // kreslení otáčí auto podle směru jízdy
    if (Math.abs(distance) <= step) {
        truck.x = targetX;
        return true;
    }
    truck.x += Math.sign(distance) * step;
    return false;
}

function updateTrucks(dt) {
    const speed = TRUCK_SPEED * (dt / 1000);

    trucks.filter(t => t.state === 'idle').forEach(truck => dispatchIdleTruck(truck));

    trucks.forEach(truck => {
        if (truck.state === 'idle') return;

        const network = getTruckHomeNetwork(truck);

        if (truck.state === 'to_rig' || truck.state === 'to_company') emitTruckSmoke(truck, dt);

        switch (truck.state) {
            case 'waiting_at_rig': {
                if (!network || !network.isPumping) {
                    truck.state = 'idle';
                    truck.homeNetworkId = null;
                    break;
                }
                truck.x = getNetworkPickupX(network);
                if (tryLoadTruckAtRig(truck, network)) {
                    truck.targetCompany = chooseCompanyFor(truck);
                    truck.state = 'to_company';
                } else {
                    // Tento vrt nemá co naložit: přejeď k jinému, který ropu má
                    const other = findNetworkForTruck(truck);
                    if (other && other.id !== network.id && other.oilStored >= MIN_LOAD_AMOUNT) {
                        truck.homeNetworkId = other.id;
                        truck.state = 'to_rig';
                    }
                }
                break;
            }
            case 'to_rig': {
                if (!network || !network.isPumping) {
                    truck.state = 'idle';
                    truck.homeNetworkId = null;
                    break;
                }
                const targetX = getNetworkPickupX(network);

                if (moveTruckToward(truck, targetX, trafficLimitedStep(truck, targetX, speed))) {
                    if (tryLoadTruckAtRig(truck, network)) {
                        truck.targetCompany = chooseCompanyFor(truck);
                        truck.state = 'to_company';
                    } else {
                        truck.state = 'waiting_at_rig';
                    }
                }
                break;
            }
            case 'to_company': {
                const targetX = truck.targetCompany === 'left' ? 50 : canvas.width - 50;
                if (moveTruckToward(truck, targetX, trafficLimitedStep(truck, targetX, speed))) {
                    const price = truck.targetCompany === 'left' ? leftIncPrice : rightIncPrice;
                    const sale = truck.oil * price;
                    money += sale;
                    totalRevenue += sale;
                    totalOilSold += truck.oil;
                    truck.oil = 0;
                    spawnParticle({
                        type: 'text',
                        text: `+$${Math.round(sale)}`,
                        x: targetX,
                        y: Math.floor(canvas.height / 3) - 50,
                        vx: 0,
                        vy: -42,
                        age: 0,
                        life: 1400
                    });
                    playSound('sale');
                    // Další jízda: vrt se vybírá znovu (nový nebo plnější vrt)
                    const nextNetwork = findNetworkForTruck(truck);
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

// Úsečka p1-p2 zasahuje polygon, když některý konec leží uvnitř nebo protíná jeho hranu
function isSegmentIntersectingPolygon(p1, p2, vertices) {
    if (isPointInPolygon(p1, vertices) || isPointInPolygon(p2, vertices)) return true;
    for (let i = 0; i < vertices.length; i++) {
        if (lineIntersectsLine(p1, p2, vertices[i], vertices[(i + 1) % vertices.length])) return true;
    }
    return false;
}

function lineIntersectsLine(l1p1, l1p2, l2p1, l2p2) {
    let q = (l1p1.y - l2p1.y) * (l2p2.x - l2p1.x) - (l1p1.x - l2p1.x) * (l2p2.y - l2p1.y);
    let d = (l1p2.x - l1p1.x) * (l2p2.y - l2p1.y) - (l1p2.y - l1p1.y) * (l2p2.x - l2p1.x);
    if (d === 0) return false;
    let r = q / d;
    q = (l1p1.y - l2p1.y) * (l1p2.x - l1p1.x) - (l1p1.x - l2p1.x) * (l1p2.y - l1p1.y);
    let s = q / d;
    // Včetně krajů: trubka procházející přesně vrcholem polygonu (např. kosočtverec) se počítá jako zásah
    return r >= 0 && r <= 1 && s >= 0 && s <= 1;
}

function assignTruck(company, change) {
    if (change > 0) {
        if (trucksAssignedLeft + trucksAssignedRight < trucksOwned) {
            if (company === 'left') trucksAssignedLeft++;
            else trucksAssignedRight++;
        }
    } else {
        if (company === 'left' && trucksAssignedLeft > 0) trucksAssignedLeft--;
        if (company === 'right' && trucksAssignedRight > 0) trucksAssignedRight--;
    }
}

function cancelBuildMode(clearDerrick = true) {
    currentBuildMode = null;
    if (clearDerrick) selectedDerrickPlotId = null;
    if (moleState.active) {
        moleState.active = false;
        moleState.startPoint = null;
        temporaryEffects = temporaryEffects.filter(e => e.type !== 'moleMarker');
    }
    updateUI();
}

// --- Posluchače událostí ---
function addEventListeners() {
    // Pohyb myši
    canvas.addEventListener('pointermove', (event) => {
        const pos = getCanvasPosition(event);
        mousePos.x = pos.x;
        mousePos.y = pos.y;
    });

    canvas.addEventListener('mousemove', (event) => {
        const pos = getCanvasPosition(event);
        mousePos.x = pos.x;
        mousePos.y = pos.y;
    });

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
        if (money >= TRUCK_COST && trucksOwned < MAX_TRUCKS) {
            money -= TRUCK_COST;
            trucksOwned++;
            trucks.push({ x: -50, y: 0, state: 'idle', homeNetworkId: null, targetCompany: null, oil: 0, facing: 1 });
            updateUI();
        }
    });

    document.getElementById('dowser-btn').addEventListener('click', () => {
        const ownedPlot = getOwnedPlotForTool(mousePos.x);
        if (money >= DOWSER_COST && ownedPlot) {
            money -= DOWSER_COST;
            showDowserHint(ownedPlot);
            updateUI();
        }
    });

    document.getElementById('scanner-btn').addEventListener('click', () => {
        if (money >= SCANNER_COST && !scannerEffect.active) {
            money -= SCANNER_COST;
            scannerEffect.active = true;
            scannerEffect.duration = scannerEffect.totalDuration;
            updateUI();
        }
    });

    document.getElementById('mole-btn').addEventListener('click', () => {
        if (money >= MOLE_COST) {
            currentBuildMode = (currentBuildMode === 'mole') ? null : 'mole';
            if (currentBuildMode === 'mole') {
                moleState.active = true;
                moleState.startPoint = null;
            } else {
                cancelBuildMode();
            }
            updateUI();
        }
    });

    // Ovládání času
    document.getElementById('pause-btn').addEventListener('click', () => isPaused = !isPaused);
    document.getElementById('speed-btn').addEventListener('click', () => {
        gameSpeed = (gameSpeed === 1) ? 2 : (gameSpeed === 2) ? 4 : 1;
        updateUI();
    });

    window.addEventListener('resize', () => {
        if (canvas && ctx) draw();
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'm' || event.key === 'M') toggleSound();
    });
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
    const clickPos = getCanvasPosition(event);

    if (clickPos.inBounds && isPointInRect(clickPos, getSoundButtonRect())) {
        toggleSound();
        return;
    }

    if (isGameOver) {
        if (clickPos.inBounds && isPointInRect(clickPos, getRestartButtonRect())) restartGame();
        return;
    }

    if (!clickPos.inBounds) return;
    mousePos.x = clickPos.x;
    mousePos.y = clickPos.y;
    const groundLevel = Math.floor(canvas.height / 3);

    updatePlotSignHitboxes(groundLevel);

    if (isPointNearRect(clickPos, companyControls.leftUp)) { assignTruck('left', 1); return; }
    if (isPointNearRect(clickPos, companyControls.leftDown)) { assignTruck('left', -1); return; }
    if (isPointNearRect(clickPos, companyControls.rightUp)) { assignTruck('right', 1); return; }
    if (isPointNearRect(clickPos, companyControls.rightDown)) { assignTruck('right', -1); return; }

    // Nákup pozemku — cedule i celý sloupec nad zemí (mimo aktivní režim krtka)
    if (currentBuildMode !== 'mole') {
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
            if (plot && plot.owner === 'player' && !plot.hasVrt && money >= VRT_COST) {
                money -= VRT_COST;
                plot.hasVrt = true;
                playSound('build');
                selectedDerrickPlotId = plot.id;
                cancelBuildMode(false);
                draw();
            }
            break;
        case 'silo':
            if (plot && plot.owner === 'player' && plot.hasVrt && plot.siloCount < MAX_SILOS_PER_PLOT && money >= SILO_COST) {
                money -= SILO_COST;
                plot.siloCount++;
                playSound('build');
                const network = pipeNetworks.find(n => n.derrickId === plot.id);
                if (network) {
                    network.oilCapacity += SILO_CAPACITY_BONUS;
                }
                cancelBuildMode();
            }
            break;
        case 'mole':
            if (clickPos.y > groundLevel) {
                handleMoleClick(clickPos.x, clickPos.y);
            }
            break;
    }
}

function handlePipePlacementClick(clickPos, groundLevel) {
    if (clickPos.y <= groundLevel) return;

    let network = pipeNetworks.find(n => n.derrickId === selectedDerrickPlotId);
    if (network && network.isPumping) return;

    if (!network) {
        const startPlot = plots.find(p => p.id === selectedDerrickPlotId);
        network = createPipeNetwork(selectedDerrickPlotId, startPlot);
        pipeNetworks.push(network);
    }

    const lastPoint = network.path[network.path.length - 1];
    const distance = Math.hypot(clickPos.x - lastPoint.x, clickPos.y - lastPoint.y);
    const cost = Math.ceil(distance * PIPE_COST_PER_PIXEL);

    if (money < cost) return;

    money -= cost;
    network.path.push(clickPos);
    const hitPocket = checkPipeCollision({ start: lastPoint, end: clickPos });
    if (hitPocket) {
        hitPocket.tapped = true;
        playSound('strike');
        network.connectedPocket = hitPocket;
        network.isPumping = true;
        selectedDerrickPlotId = null;
    }
}

function handleDefaultClick(plot) {
    if (plot && plot.owner === 'player' && plot.hasVrt) {
        const network = pipeNetworks.find(n => n.derrickId === plot.id);
        if (!network || !network.isPumping) {
            selectedDerrickPlotId = plot.id;
            updateUI();
        }
    }
}

function showDowserHint(plot) {
    if (!plot || plot.owner !== 'player') return;

    const plotCenterX = plot.x + plotWidth / 2;
    const groundLevel = Math.floor(canvas.height / 3);
    let bestPocket = null;
    let bestScore = Infinity;

    oilPockets.forEach(pocket => {
        if (pocket.tapped) return;
        const pocketCenterX = pocket.x + pocket.width / 2;
        const pocketCenterY = pocket.y + pocket.height / 2;
        const underPlot = pocketCenterX >= plot.x && pocketCenterX < plot.x + plotWidth;
        const dx = Math.abs(pocketCenterX - plotCenterX);
        const dy = Math.max(0, pocketCenterY - groundLevel);
        const score = dx + dy * 0.4 + (underPlot ? 0 : 400);
        if (score < bestScore) {
            bestScore = score;
            bestPocket = pocket;
        }
    });

    if (!bestPocket) {
        temporaryEffects.push({
            type: 'dowser',
            x: plotCenterX,
            y: groundLevel - 55,
            direction: 0,
            duration: 4000,
            totalDuration: 4000,
            label: 'nic'
        });
        return;
    }

    const pocketCenterX = bestPocket.x + bestPocket.width / 2;
    const pocketCenterY = bestPocket.y + bestPocket.height / 2;
    const dx = pocketCenterX - plotCenterX;
    const dy = pocketCenterY - groundLevel;
    let direction;
    if (Math.abs(dx) < plotWidth * 0.35 && dy > 40) {
        direction = 0;
    } else if (dx > 15) {
        direction = 1;
    } else {
        direction = -1;
    }

    // maxOil je 5000–15000, prahy dělí rozsah zhruba na třetiny
    const richness = bestPocket.maxOil > DOWSER_LARGE_OIL ? 'velké' : (bestPocket.maxOil > DOWSER_MEDIUM_OIL ? 'střední' : 'malé');
    temporaryEffects.push({
        type: 'dowser',
        x: plotCenterX,
        y: groundLevel - 55,
        targetX: pocketCenterX,
        targetY: pocketCenterY,
        direction,
        duration: 8000,
        totalDuration: 8000,
        label: richness
    });
}

function handleMoleClick(x, y) {
    if (!moleState.startPoint) {
        moleState.startPoint = { x, y };
        temporaryEffects.push({ type: 'moleMarker', x, y, duration: 15000 });
    } else {
        if (money < MOLE_COST) return;
        money -= MOLE_COST;

        const start = moleState.startPoint;
        const end = { x, y: start.y };

        pipeNetworks.push({
            id: nextNetworkId++,
            derrickId: -1,
            path: [start, end],
            isPumping: false,
            oilStored: 0,
            oilCapacity: 0,
            connectedPocket: null,
            isMoleTunnel: true
        });

        oilPockets.forEach(pocket => {
            if (checkPipeCollision({ start, end }, pocket)) {
                pocket.revealed = true; // jen odhalí, ložisko zůstává vrtatelné
            }
        });

        cancelBuildMode();
    }
}

function checkPipeCollision(pipeSegment, specificPocket) {
    const pocketsToCheck = specificPocket ? [specificPocket] : oilPockets;
    for (const pocket of pocketsToCheck) {
        if (pocket.tapped && !specificPocket) continue;

        // Kolize proti skutečnému polygonu, ne proti obdélníku kolem něj
        if (isSegmentIntersectingPolygon(pipeSegment.start, pipeSegment.end, pocket.vertices)) {
            return pocket;
        }
    }
    return null;
}

// --- Spuštění při načtení stránky ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("script.js: DOMContentLoaded event nastal.");

    // Rozlišení mezi lokálním vývojem a produkcí (Discord)
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocal) {
        console.log("Běží v lokálním režimu. SDK se neaktivuje.");
        loadImages(); // V lokálním režimu rovnou načítáme
    } else {
        try {
            sdk = new Discord.EmbeddedAppSDK(window.location.search);
            setupDiscordSdk().then(() => {
                loadImages(); // Načítáme až po setupu SDK
            }).catch(e => {
                console.error("Chyba při spuštění setupDiscordSdk:", e);
                loadImages(); // I při chybě zkusíme hru načíst
            });
        } catch (e) {
            console.error("Nepodařilo se inicializovat Discord SDK", e);
            loadImages(); // Zkusíme pokračovat i bez SDK
        }
    }
}); 