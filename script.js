console.log("script.js: Skript se spustil.");

// --- Discord SDK Setup ---
// Tento kód je pro novější verzi SDK, která se inicializuje přes URL parametry.
let sdk = null;

async function setupDiscordSdk() {
    console.log("script.js: Volá se setupDiscordSdk(). Čeká se na sdk.ready()...");
    await sdk.ready();
    console.log("Discord SDK je připraveno!");

    // Získání informací o uživatelích v aktivitě
    try {
        const { participants } = await sdk.commands.getInstanceParticipants();
        console.log("Načteni počáteční hráči:", participants);
    } catch(e) {
        console.error("Nepodařilo se načíst účastníky", e);
    }
}


// --- Globální proměnné a konstanty ---
let canvas = null;
let ctx = null;
let lastTime = 0;
let money = 2500;
let isGameOver = false;
let isPaused = false;
let gameSpeed = 1;

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
const PLOT_COST = 2000;
const VRT_COST = 350;
const SILO_COST = 250;
const TRUCK_COST = 150;
const DOWSER_COST = 100;
const SCANNER_COST = 500;
const MOLE_COST = 300;
const PIPE_COST_PER_PIXEL = 2;
const TRUCK_SPEED = 150; // Pixely za sekundu
const TRUCK_CAPACITY = 100;
const PRICE_UPDATE_INTERVAL = 5000; // 5 sekund reálného času
const SILO_CAPACITY_BONUS = 500;
const DERRICK_BASE_CAPACITY = 50;
const OIL_PER_SECOND = 5;
const DEV = true;

// Stav UI a ovládání
let mousePos = { x: 0, y: 0 };
let currentBuildMode = null; // 'vrt', 'silo', 'mole'
let selectedDerrickPlotId = null; // Pro pokládání potrubí
let plotWidth;

// Ceny a kamiony
let leftIncPrice = 1.00;
let rightIncPrice = 1.00;
let trucksOwned = 0;
let trucksAssignedLeft = 0;
let trucksAssignedRight = 0;
let priceUpdateTimer = 0;

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
    
    // Herní smyčka se nespouští hned, čeká se na koupi pozemku
    // lastTime = performance.now();
    // gameLoop(lastTime);
    console.log("Hra čeká na koupi pozemku.");
    draw(); // Hned vykresli pole a tabulky
}

function startGameLoop() {
    if (!isGameStarted) {
        isGameStarted = true;
        lastTime = performance.now();
        updateUI(); // Aktualizace kalendáře a UI hned po startu hry
        gameLoop(lastTime);
    }
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
            x, y, width: pocketWidth, height, oil: richness, tapped: false,
            // Pro zjednodušení kolize použijeme obdélníkový hitbox
            vertices: vertices
        });
    }
}


// --- Herní smyčka a kreslení ---

function gameLoop(timestamp) {
    if (!isGameStarted) return; // Pokud hra neběží, nic nedělej
    if (isGameOver) {
        drawGameOver();
        return;
    }
    const dt = (timestamp - lastTime) * gameSpeed;
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

function update(dt) {
    if (!isGameStarted) return;
    if (dt <= 0) return;
    // Herní čas
    dayTimer += dt;
    if (dayTimer >= MS_PER_DAY) {
        dayTimer -= MS_PER_DAY;
        day++;
        if (day > daysInMonth[month]) {
            day = 1;
            month++;
            if (month > 12) {
                isGameOver = true; // Konec hry po roce
            }
        }
    }

    // Aktualizace cen
    priceUpdateTimer += dt;
    if (priceUpdateTimer > PRICE_UPDATE_INTERVAL) {
        priceUpdateTimer = 0;
        leftIncPrice = Math.max(0.20, Math.min(2.50, leftIncPrice + (Math.random() - 0.48) * 0.15));
        rightIncPrice = Math.max(0.20, Math.min(2.50, rightIncPrice + (Math.random() - 0.48) * 0.15));
    }
    
    // Těžba ropy
    pipeNetworks.forEach(network => {
        if (network.isPumping && network.oilStored < network.oilCapacity) {
            network.oilStored += OIL_PER_SECOND * (dt / 1000);
        }
    });

    // Aktualizace kamionů
    updateTrucks(dt);

    // Aktualizace dočasných efektů
    temporaryEffects = temporaryEffects.filter(effect => {
        effect.duration -= dt;
        return effect.duration > 0;
    });

    // Efekt scanneru
    if (scannerEffect.active) {
        scannerEffect.duration -= dt;
        if (scannerEffect.duration <= 0) {
            scannerEffect.active = false;
        }
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
            drawDerrick(centerX, plot.y, plot.id, network ? network.isPumping : false);
        }
        // Kreslení sil
        for (let i = 0; i < plot.siloCount; i++) {
            // Jednoduché posunutí pro více sil, lze vylepšit
            drawSilo(centerX + 40 + (i * 10), plot.y); 
        }
    });
    
    // Budovy a UI na plátně
    drawCompanyBuildings(groundLevel);
    drawTrucks();
    
    // Vrstva země nad ostatními prvky
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, groundLevel, canvas.width, 10);

    // Kreslení dočasných efektů a náhledů
    drawEffectsAndPreviews(groundLevel);
    
    // Aktualizace HTML UI
    updateUI();
    
    // Pauza overlay
    if (isPaused) drawPauseScreen();

    // V draw na konci dekrementuji timer zvýraznění
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
        { el: document.getElementById('dowser-btn'), cost: DOWSER_COST }
    ];

    buttons.forEach(item => {
        if (!item.el) return;
        
        let isDisabled = money < item.cost;
        if (item.isTruck) isDisabled = isDisabled || trucksOwned >= 10;
        if (item.isScanner) isDisabled = isDisabled || scannerEffect.active;
        item.el.disabled = isDisabled;

        if(item.isTruck) {
            const priceEl = item.el.querySelector('.price');
            if(priceEl) priceEl.textContent = `$${item.cost} (${trucksOwned})`;
        }
        
        if (item.mode) {
            item.el.classList.toggle('active-build-mode', currentBuildMode === item.mode);
        }
    });

    // Rychlost hry
    const speedBtn = document.getElementById('speed-btn');
    if (speedBtn) {
       speedBtn.style.filter = `hue-rotate(${gameSpeed > 1 ? '120deg' : '0deg'})`;
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

function updatePlotSignHitboxes(groundLevel) {
    plotSignHitboxes = [];
    plots.forEach(plot => {
        if (plot.owner === null) {
            const signWidth = 70, signHeight = 20, postHeight = 15;
            const signX = Math.round(plot.x + (plotWidth / 2) - (signWidth / 2));
            const signY = Math.round(groundLevel - postHeight - signHeight);
            plotSignHitboxes.push({ plotId: plot.id, x: signX, y: signY, width: signWidth, height: signHeight });
        }
    });
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
            const signWidth = 70, signHeight = 20, postHeight = 15;
            const signX = Math.round(plot.x + (plotWidth / 2) - (signWidth / 2));
            const signY = Math.round(groundLevel - postHeight - signHeight);
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(Math.round(plot.x + (plotWidth / 2) - 2.5), groundLevel - postHeight, 5, postHeight);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(signX, signY, signWidth, signHeight);
            // Zvýraznění tabulky při najetí myší
            const isHovered = mousePos.x >= signX && mousePos.x <= signX + signWidth && mousePos.y >= signY && mousePos.y <= signY + signHeight;
            if (isHovered) hoveredAny = true;
            ctx.strokeStyle = isHovered ? '#FFD700' : 'black';
            ctx.lineWidth = isHovered ? 3 : 1;
            ctx.strokeRect(signX, signY, signWidth, signHeight);
            ctx.fillStyle = 'black';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`$${plot.price}`, plot.x + plotWidth / 2, signY + signHeight / 2);
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
    // Nastav kurzor podle toho, jestli je myš nad tabulkou nebo nad stavitelným pozemkem
    if (canvas) {
        if (hoveredAny || hoveredBuildable) {
            canvas.style.cursor = 'pointer';
        } else {
            canvas.style.cursor = 'default';
        }
    }
}

function drawOilPockets(groundLevel) {
    oilPockets.forEach(pocket => {
        // Zobrazit obrys jen pokud je aktivní scanner
        if (scannerEffect.active) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 255, 0, ${scannerEffect.duration / scannerEffect.totalDuration})`;
            ctx.lineWidth = 2;

            for (let i = 1; i < pocket.vertices.length; i++) {
                // draw line between current and previous vertex
                ctx.moveTo(pocket.vertices[i - 1].x, pocket.vertices[i - 1].y);
                ctx.lineTo(pocket.vertices[i].x, pocket.vertices[i].y);
                ctx.stroke();
            }

            // Draw line from last vertex to first
            ctx.moveTo(pocket.vertices[pocket.vertices.length - 1].x, pocket.vertices[pocket.vertices.length - 1].y);
            ctx.lineTo(pocket.vertices[0].x, pocket.vertices[0].y);
            ctx.stroke();




            // ctx.strokeRect(pocket.x, pocket.y, pocket.width, pocket.height);
        }
        
        // Zobrazit plné ložisko jen pokud bylo zasaženo
        if (DEV || pocket.tapped) {
            ctx.beginPath();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.moveTo(pocket.vertices[0].x, pocket.vertices[0].y);

            for (let i = 1; i < pocket.vertices.length; i++) {
                // draw line between current and previous vertex
                ctx.lineTo(pocket.vertices[i].x, pocket.vertices[i].y);
            }
            ctx.lineTo(pocket.vertices[0].x, pocket.vertices[0].y); // Close the path

            ctx.fill();
            ctx.closePath();
        }
    });
}

function drawDerrick(x, y, plotId, isPumping) {
    const derrickWidth = 80, derrickHeight = 100;
    ctx.save();
    ctx.translate(x, y);
    if (selectedDerrickPlotId === plotId) {
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 15;
    }
    if (derrickImage && derrickImage.complete && derrickImage.naturalWidth > 0) {
        ctx.drawImage(derrickImage, -derrickWidth / 2, -derrickHeight, derrickWidth, derrickHeight);
    } else {
        // fallback: hnědý obdélník
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(-derrickWidth / 2, -derrickHeight, derrickWidth, derrickHeight);
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(-10, -derrickHeight, 20, derrickHeight / 2);
    }
    // Pohyblivá část
    if (isPumping) {
        const pumpAngle = Math.sin(Date.now() / 300) * 0.2;
        ctx.save();
        ctx.translate(0, -derrickHeight * 0.75);
        ctx.rotate(pumpAngle);
        ctx.fillStyle = "#696969";
        ctx.fillRect(-5, -5, 30, 10);
        ctx.restore();
    }
    ctx.restore();
}

function drawSilo(x, y) {
    const siloWidth = 60, siloHeight = 80;
    if (siloImage && siloImage.complete && siloImage.naturalWidth > 0) {
        ctx.drawImage(siloImage, x - siloWidth / 2, y - siloHeight, siloWidth, siloHeight);
    } else {
        // fallback: šedý válec
        ctx.save();
        ctx.fillStyle = '#B0B0B0';
        ctx.beginPath();
        ctx.ellipse(x, y - siloHeight / 2, siloWidth / 2, siloHeight / 2, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }
}

function drawPipeNetworks() {
    pipeNetworks.forEach(network => {
        if (network.path.length < 2) return;
        
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(network.path[0].x, network.path[0].y);
        for (let i = 1; i < network.path.length; i++) {
            ctx.lineTo(network.path[i].x, network.path[i].y);
        }
        ctx.stroke();

        if (network.isPumping) {
             ctx.strokeStyle = '#000000';
             ctx.lineWidth = 4;
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
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LEFT INC', bWidth/2, leftBaseY + 20);
    
    // Pravá firma
    const rightBaseX = canvas.width - bWidth;
    ctx.fillStyle = '#D2A679';
    ctx.fillRect(rightBaseX, groundLevel - bHeight, bWidth, bHeight);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('RIGHT INC', rightBaseX + bWidth/2, leftBaseY + 20);

    // Ceny
    ctx.fillStyle = '#5C4033';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`$${leftIncPrice.toFixed(2)}`, bWidth/2, leftBaseY - 15);
    ctx.fillText(`$${rightIncPrice.toFixed(2)}`, rightBaseX + bWidth/2, leftBaseY - 15);

    // Výpočet pro centrování šipek a čísla
    const arrowSize = 25;
    const spacing = 70; // vzdálenost mezi horní a dolní šipkou
    const centerY = groundLevel - bHeight - 60 - 50; // posun šipek přesně o 50px výše
    
    // Horní šipka
    companyControls.leftUp = { x: 37, y: centerY - spacing/2, width: arrowSize, height: arrowSize };
    // Dolní šipka
    companyControls.leftDown = { x: 37, y: centerY + spacing/2, width: arrowSize, height: arrowSize };
    // Číslo (nula) přesně mezi šipkami
    companyControls.leftTrucks = { x: 37, y: centerY - arrowSize/2, width: arrowSize, height: 35 };

    companyControls.rightUp = { x: canvas.width - 37 - arrowSize, y: centerY - spacing/2, width: arrowSize, height: arrowSize };
    companyControls.rightDown = { x: canvas.width - 37 - arrowSize, y: centerY + spacing/2, width: arrowSize, height: arrowSize };
    companyControls.rightTrucks = { x: canvas.width - 37 - arrowSize, y: centerY - arrowSize/2, width: arrowSize, height: 35 };
    
    drawArrowButton(companyControls.leftUp, true);
    drawArrowButton(companyControls.leftDown, false);
    drawArrowButton(companyControls.rightUp, true);
    drawArrowButton(companyControls.rightDown, false);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    // Y-pozice čísla bude přesně mezi šipkami
    ctx.fillText(trucksAssignedLeft, companyControls.leftTrucks.x + arrowSize/2, centerY + 8);
    ctx.fillText(trucksAssignedRight, companyControls.rightTrucks.x + arrowSize/2, centerY + 8);
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

function drawTrucks() {
    trucks.forEach(truck => {
        if (truck.state === 'idle') return;
        const truckY = Math.floor(canvas.height / 3) - 40;
        if (truckImage && truckImage.complete && truckImage.naturalWidth > 0) {
            ctx.drawImage(truckImage, truck.x - 40, truckY, 80, 40);
        } else {
            // fallback: modrý obdélník
            ctx.save();
            ctx.fillStyle = '#1976D2';
            ctx.fillRect(truck.x - 40, truckY, 80, 40);
            ctx.restore();
        }
    });
}

function drawEffectsAndPreviews(groundLevel) {
    let newCursor = 'default';

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
            drawSilo(hoveredPlot.x + plotWidth / 2 + 40, groundLevel);
            ctx.restore();
            newCursor = 'pointer';
        } else {
            newCursor = 'not-allowed';
        }
    } else if (selectedDerrickPlotId !== null) {
        newCursor = 'crosshair';
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
        if (effect.type === 'arrow') {
            ctx.fillStyle = `rgba(255, 215, 0, ${effect.duration / 5000})`;
            ctx.font = '40px sans-serif';
            ctx.textAlign = 'center';
            const arrowChar = effect.direction === 0 ? '▼' : (effect.direction > 0 ? '▶' : '◀');
            ctx.fillText(arrowChar, effect.x, effect.y);
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.font = '80px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KONEC HRY', canvas.width / 2, canvas.height / 2 - 50);

    ctx.font = '40px sans-serif';
    ctx.fillText(`Finální skóre: $${Math.floor(money)}`, canvas.width / 2, canvas.height / 2 + 50);
}


// --- Herní logika a mechaniky ---

function updateTrucks(dt) {
    const groundLevel = Math.floor(canvas.height / 3);
    const speed = TRUCK_SPEED * (dt / 1000);

    // Najdi sítě s ropou, ke kterým ještě nejede kamion
    const dispatchedDerrickIds = trucks.filter(t => t.state === 'to_rig').map(t => t.targetPlotId);
    const networksWithOil = pipeNetworks.filter(
        n => n.isPumping && n.oilStored >= TRUCK_CAPACITY && !dispatchedDerrickIds.includes(n.derrickId)
    );

    // Přiřaď volné kamiony k sítím s ropou
    if (networksWithOil.length > 0) {
        const idleTrucks = trucks.filter(w => w.state === 'idle');
        
        // Rozdělíme idle kamiony podle toho, kam mají jet
        let assignedLeftCount = trucks.filter(t => t.targetCompany === 'left' && t.state !== 'idle').length;
        let assignedRightCount = trucks.filter(t => t.targetCompany === 'right' && t.state !== 'idle').length;
        
        for (const truck of idleTrucks) {
            if (networksWithOil.length === 0) break;
            
            const targetNetwork = networksWithOil.pop();
            
            // Logika přiřazení (jednoduchá, lze vylepšit)
            if (assignedLeftCount < trucksAssignedLeft) {
                truck.targetCompany = 'left';
                assignedLeftCount++;
            } else if (assignedRightCount < trucksAssignedRight) {
                truck.targetCompany = 'right';
                assignedRightCount++;
            } else { // Pokud není specifikováno, vyber náhodně nebo nejbližší
                truck.targetCompany = (Math.random() < 0.5) ? 'left' : 'right';
            }

            truck.state = 'to_rig';
            truck.targetPlotId = targetNetwork.derrickId;
            truck.x = truck.targetCompany === 'left' ? -50 : canvas.width + 50; // Start z "garáže"
        }
    }

    // Pohyb a logika kamionů
    trucks.forEach(truck => {
        if (truck.state === 'idle') return;

        switch (truck.state) {
            case 'to_rig': {
                const targetPlot = plots.find(p => p.id === truck.targetPlotId);
                if (!targetPlot) { truck.state = 'to_garage'; break; }
                const targetX = targetPlot.x + plotWidth / 2;
                
                if (Math.abs(truck.x - targetX) < 5) { // Cíl dosažen
                    truck.x = targetX;
                    const network = pipeNetworks.find(n => n.derrickId === truck.targetPlotId);
                    if (network && network.oilStored >= TRUCK_CAPACITY) {
                        network.oilStored -= TRUCK_CAPACITY;
                        truck.oil = TRUCK_CAPACITY;
                        truck.state = 'to_company';
                    } else { // Ropa tam už není
                        truck.state = 'to_garage';
                    }
                } else {
                    truck.x += Math.sign(targetX - truck.x) * speed;
                }
                break;
            }
            case 'to_company': {
                const targetX = truck.targetCompany === 'left' ? 50 : canvas.width - 50;
                 if (Math.abs(truck.x - targetX) < 5) {
                    truck.x = targetX;
                    const price = truck.targetCompany === 'left' ? leftIncPrice : rightIncPrice;
                    money += truck.oil * price;
                    truck.oil = 0;
                    truck.state = 'to_garage';
                } else {
                    truck.x += Math.sign(targetX - truck.x) * speed;
                }
                break;
            }
            case 'to_garage': {
                const garageX = truck.targetCompany === 'left' ? -truckImage.width : canvas.width + truckImage.width;
                if ( (truck.targetCompany === 'left' && truck.x <= garageX) || (truck.targetCompany === 'right' && truck.x >= garageX) ) {
                    truck.state = 'idle';
                } else {
                    truck.x += Math.sign(garageX - truck.x) * speed;
                }
                break;
            }
        }
    });
}

function checkPipeCollision(pipeSegment) {
    for (const pocket of oilPockets) {
        if (pocket.tapped) continue;
        
        // Jednoduchá kolize úsečky a obdélníku
        const start = pipeSegment.start;
        const end = pipeSegment.end;
        const pocketRect = { x: pocket.x, y: pocket.y, width: pocket.width, height: pocket.height };

        if (isLineIntersectingRect(start, end, pocketRect)) {
            return pocket;
        }
    }
    return null;
}

function isLineIntersectingRect(p1, p2, rect) {
    // Kontrola, zda je některý z koncových bodů uvnitř obdélníku
    if ((p1.x > rect.x && p1.x < rect.x + rect.width && p1.y > rect.y && p1.y < rect.y + rect.height) ||
        (p2.x > rect.x && p2.x < rect.x + rect.width && p2.y > rect.y && p2.y < rect.y + rect.height)) {
        return true;
    }
    // Kontrola průsečíků se všemi čtyřmi stranami obdélníku
    return lineIntersectsLine(p1, p2, {x: rect.x, y: rect.y}, {x: rect.x + rect.width, y: rect.y}) ||
           lineIntersectsLine(p1, p2, {x: rect.x + rect.width, y: rect.y}, {x: rect.x + rect.width, y: rect.y + rect.height}) ||
           lineIntersectsLine(p1, p2, {x: rect.x + rect.width, y: rect.y + rect.height}, {x: rect.x, y: rect.y + rect.height}) ||
           lineIntersectsLine(p1, p2, {x: rect.x, y: rect.y + rect.height}, {x: rect.x, y: rect.y});
}

function lineIntersectsLine(l1p1, l1p2, l2p1, l2p2) {
    let q = (l1p1.y - l2p1.y) * (l2p2.x - l2p1.x) - (l1p1.x - l2p1.x) * (l2p2.y - l2p1.y);
    let d = (l1p2.x - l1p1.x) * (l2p2.y - l2p1.y) - (l1p2.y - l1p1.y) * (l2p2.x - l2p1.x);
    if (d === 0) return false;
    let r = q / d;
    q = (l1p1.y - l2p1.y) * (l1p2.x - l1p1.x) - (l1p1.x - l2p1.x) * (l1p2.y - l1p1.y);
    let s = q / d;
    return r > 0 && r < 1 && s > 0 && s < 1;
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

function cancelBuildMode() {
    currentBuildMode = null;
    selectedDerrickPlotId = null;
    if(moleState.active){
        moleState.active = false;
        moleState.startPoint = null;
        temporaryEffects = temporaryEffects.filter(e => e.type !== 'moleMarker');
    }
    updateUI();
}

function getPlotAtX(x) {
    for (const plot of plots) {
        if (x >= plot.x && x <= plot.x + plotWidth) {
            return plot;
        }
    }
    return null;
}


// --- Posluchače událostí ---
function addEventListeners() {
    // Pohyb myši
    canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        mousePos.x = (event.clientX - rect.left) * scaleX;
        mousePos.y = (event.clientY - rect.top) * scaleY;
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
        if (money >= TRUCK_COST && trucksOwned < 10) {
            money -= TRUCK_COST;
            trucksOwned++;
            trucks.push({ x: -50, y: 0, state: 'idle', targetPlotId: null, targetCompany: null, oil: 0 });
            updateUI();
        }
    });
    
    document.getElementById('dowser-btn').addEventListener('click', () => {
        if (money >= DOWSER_COST) {
            money -= DOWSER_COST;
            const plot = getPlotAtX(mousePos.x) || plots[Math.floor(plots.length / 2)];
            showDowserHint(plot);
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
}

// Přidám proměnnou pro blokaci rychlého dvojkliku
let isBuyingPlot = false;

function handleCanvasClick(event) {
    if (isGameOver) return;
    if (isBuyingPlot) return;
    const clickPos = { x: mousePos.x, y: mousePos.y };
    const groundLevel = Math.floor(canvas.height / 3);
    
    // Vždy vygeneruj aktuální hitboxy tabulek
    updatePlotSignHitboxes(groundLevel);
    
    // Kontrola kliknutí na ovládání kamionů
    function isPointInRect(point, rect) {
        return point.x >= rect.x && point.x <= rect.x + rect.width &&
               point.y >= rect.y && point.y <= rect.y + rect.height;
    }
    if (isPointInRect(clickPos, companyControls.leftUp)) { assignTruck('left', 1); return; }
    if (isPointInRect(clickPos, companyControls.leftDown)) { assignTruck('left', -1); return; }
    if (isPointInRect(clickPos, companyControls.rightUp)) { assignTruck('right', 1); return; }
    if (isPointInRect(clickPos, companyControls.rightDown)) { assignTruck('right', -1); return; }

    // Nově: kliknutí na ceduli s cenou pozemku
    for (const sign of plotSignHitboxes) {
        if (isPointInRect(clickPos, sign)) {
            const plot = plots.find(p => p.id === sign.plotId);
            if (plot && !plot.owner && money >= plot.price) {
                money -= plot.price;
                plot.owner = 'player';
                startGameLoop();
                lastBoughtPlotId = plot.id;
                lastBoughtHighlightTimer = 30; // Počet snímků zvýraznění
                updatePlotSignHitboxes(groundLevel); // Okamžitě aktualizuj hitboxy
                draw(); // Okamžitě překresli po koupi
                updateUI(); // Nově: okamžitě aktualizuj peníze v UI
                return;
            } else if (plot && !plot.owner && money < plot.price) {
                plotBlinkTimers[plot.id] = 15; // 15 snímků blikání
                draw();
                return;
            }
        }
    }

    // Interakce se světem
    const clickedPlot = getPlotAtX(clickPos.x);
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
                selectedDerrickPlotId = plot.id; // Po stavbě rovnou vybereme
                cancelBuildMode();
                draw(); // Okamžitě překresli po stavbě vrtu
            }
            break;
        case 'silo':
            if (plot && plot.owner === 'player' && plot.hasVrt && money >= SILO_COST) {
                money -= SILO_COST;
                plot.siloCount++;
                const network = pipeNetworks.find(n => n.derrickId === plot.id);
                if (network) {
                    network.oilCapacity += SILO_CAPACITY_BONUS;
                }
                cancelBuildMode();
            }
            break;
        case 'mole':
            if (clickPos.y > groundLevel && money >= MOLE_COST) {
                money -= MOLE_COST;
                handleMoleClick(clickPos.x, clickPos.y);
            }
            break;
    }
}

function handlePipePlacementClick(clickPos, groundLevel) {
    if (clickPos.y <= groundLevel) return; // Zabráníme vrtání nad zemí
    
    let network = pipeNetworks.find(n => n.derrickId === selectedDerrickPlotId);
    if (network && network.isPumping) return; // Nelze měnit po zasažení ropy

    if (!network) {
        const startPlot = plots.find(p => p.id === selectedDerrickPlotId);
        network = {
            derrickId: selectedDerrickPlotId,
            path: [{ x: startPlot.x + plotWidth / 2, y: groundLevel }],
            isPumping: false, oilStored: 0, oilCapacity: DERRICK_BASE_CAPACITY + startPlot.siloCount * SILO_CAPACITY_BONUS
        };
        pipeNetworks.push(network);
    }

    const lastPoint = network.path[network.path.length - 1];
    const distance = Math.hypot(clickPos.x - lastPoint.x, clickPos.y - lastPoint.y);
    const cost = distance * PIPE_COST_PER_PIXEL;

    if (money >= cost) {
        money -= cost;
        network.path.push(clickPos);
        const hitPocket = checkPipeCollision({ start: lastPoint, end: clickPos });
        if (hitPocket) {
            hitPocket.tapped = true;
            network.isPumping = true;
            selectedDerrickPlotId = null; // Zrušíme výběr
        }
    }
}

function handleDefaultClick(plot) {
    if (plot) {
        if (!plot.owner && money >= PLOT_COST) {
            money -= PLOT_COST;
            plot.owner = 'player';
        } else if (plot.owner === 'player' && plot.hasVrt) {
            selectedDerrickPlotId = plot.id;
        }
    }
}

function showDowserHint(plot) {
    let closestPocket = null, minDistance = Infinity;
    const plotCenterX = plot.x + plotWidth / 2;
    oilPockets.forEach(pocket => {
        const pocketCenterX = pocket.x + pocket.width / 2;
        const dist = Math.abs(plotCenterX - pocketCenterX);
        if (dist < minDistance) {
            minDistance = dist;
            closestPocket = pocket;
        }
    });
    if (closestPocket) {
        temporaryEffects.push({
            type: 'arrow', x: plotCenterX, y: plot.y - 50,
            direction: Math.sign(closestPocket.x + closestPocket.width / 2 - plotCenterX),
            duration: 5000 
        });
    }
}

function handleMoleClick(x, y) {
    if (!moleState.startPoint) {
        moleState.startPoint = { x, y };
        temporaryEffects.push({ type: 'moleMarker', x, y, duration: 15000 });
    } else {
        const start = moleState.startPoint;
        const end = { x: x, y: start.y }; // Jen horizontální
        
        // Vytvoříme novou síť pro tunel
        const newTunnelNetwork = {
            derrickId: -1, // Speciální ID pro tunel
            path: [start, end],
            isPumping: false, oilStored: 0, oilCapacity: 0
        };
        pipeNetworks.push(newTunnelNetwork);
        
        const hitPocket = checkPipeCollision({ start, end });
        if (hitPocket) {
            hitPocket.tapped = true;
            newTunnelNetwork.isPumping = true; // Tunel může "těžit"
        }
        
        cancelBuildMode();
    }
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