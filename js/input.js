// Vstup a nástroje: náhledy, posluchače událostí, kliky na plátno, přetlak a průzkum (kresba).
// Součást hry Oil digga: klasický skript sdílející globální rozsah s ostatními soubory v js/.
// Pořadí načítání určuje index.html; tento soubor předpokládá sim.js a net.js před sebou.

// --- Herní logika a mechaniky ---

function getNetworkPickupX(network) {
    return OilSim.getNetworkPickupX(world, network);
}

function cancelBuildMode(clearDerrick = true) {
    uiDirty = true;
    currentBuildMode = null;
    if (clearDerrick) selectedDerrickPlotId = null;
    updateUI();
}

// --- Posluchače událostí ---
function addEventListeners() {
    document.getElementById('hud-rig')?.addEventListener('click', handleRigPanelClick);
    document.getElementById('hud-contracts')?.addEventListener('click', handleContractsClick);
    document.getElementById('hud-players')?.addEventListener('click', handlePlayersClick);
    document.getElementById('players-btn')?.addEventListener('click', () => togglePlayersPanel());
    document.getElementById('perks-btn')?.addEventListener('click', () => togglePerks());
    document.getElementById('perks-close')?.addEventListener('click', () => togglePerks(false));
    document.getElementById('perks-list')?.addEventListener('click', handlePerksClick);
    document.getElementById('hud-guide')?.addEventListener('click', handleGuideClick);
    document.getElementById('map-btn')?.addEventListener('click', () => toggleSurveyMap());
    document.getElementById('map-close')?.addEventListener('click', () => toggleSurveyMap(false));
    document.getElementById('map-canvas')?.addEventListener('click', handleMapClick);
    // Předvolby hráče a jejich tlačítko
    updateSoundButton();
    document.getElementById('prefs-btn')?.addEventListener('click', () => togglePrefs());
    document.getElementById('prefs-close')?.addEventListener('click', () => togglePrefs(false));
    document.getElementById('prefs-fields')?.addEventListener('click', handlePrefsClick);
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
                cameraTouched();
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
        if (event.key === 'o' || event.key === 'O') togglePrefs();
        if (event.key === 'Escape') {
            if (!document.getElementById('prefs')?.classList.contains('hidden')) togglePrefs(false);
            else if (perksOpen) togglePerks(false);
            else if (mapOpen) toggleSurveyMap(false);
            else cancelBuildMode();
        }
        if ((event.key === 'g' || event.key === 'G') && !event.repeat) toggleSurveyMap();
        if ((event.key === 'p' || event.key === 'P') && !event.repeat && sharedMode) togglePlayersPanel();
        if ((event.key === 'u' || event.key === 'U') && !event.repeat) togglePerks();
        handleCameraKey(event);
    });

    document.getElementById('zoom-in').addEventListener('click', () => zoomCameraAt(VIEW_W / 2, VIEW_H / 2, 1.35));
    document.getElementById('zoom-out').addEventListener('click', () => zoomCameraAt(VIEW_W / 2, VIEW_H / 2, 1 / 1.35));
    document.getElementById('zoom-reset').addEventListener('click', () => resetCamera());

    // Kolečko myši nad firmou přidává (nahoru) a ubírá (dolů) přidělená auta
    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
}

// Kolečko myši přibližuje kolem kurzoru
function handleCanvasWheel(event) {
    const pos = getCanvasPosition(event);
    if (!pos.inBounds) return;
    event.preventDefault(); // stránka se nesmí hýbat
    const unit = event.deltaMode === 1 ? 33 : (event.deltaMode === 2 ? 100 : 1);
    zoomCameraAt(pos.px, pos.py, Math.exp(-event.deltaY * unit * 0.0015));
}

function getRestartButtonRect() {
    return { x: VIEW_W / 2 - 140, y: VIEW_H / 2 + 150, width: 280, height: 64 };
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

    // Razítko Vozit sem na ceníku kupce: přepne, kam jezdí mé vozy
    for (const [id, rect] of Object.entries(buyerControls)) {
        if (isPointNearRect(clickPos, rect, 2)) {
            doAction({ type: 'setRoute', buyer: myRoute === id ? null : id });
            return;
        }
    }

    // Reklamní vzducholoď: klik otevře inzerovaný web
    if (!currentBuildMode && blimpHitRect && blimpAd && isPointInRect(clickPos, blimpHitRect)) {
        openAdLink(blimpAd.url);
        return;
    }

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

// Cena stavby na claimu: kopec zdražuje
function plotBuildCost(plot, base) {
    return Math.round(base * OilSim.terrainOf(plot).buildMult);
}

function handleBuildModeClick(clickPos, plot, groundLevel) {
    switch (currentBuildMode) {
        case 'vrt':
            if (isMine(plot) && !plot.hasVrt && money >= plotBuildCost(plot, VRT_COST)) doAction({ type: 'buildDerrick', plotId: plot.id });
            break;
        case 'silo':
            if (isMine(plot) && plot.hasVrt && plot.siloCount < MAX_SILOS_PER_PLOT && money >= plotBuildCost(plot, SILO_COST)) {
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
    if (clickPos.y <= groundLevel) {
        // Klik nad zemí: jiný vlastní vrt vybere, jinak výběr zruší
        const plot = getPlotAtX(clickPos.x);
        if (isMine(plot) && plot.hasVrt) handleDefaultClick(plot);
        else {
            selectedDerrickPlotId = null;
            updateUI();
        }
        return;
    }
    const network = pipeNetworks.find(n => n.derrickId === selectedDerrickPlotId);
    if (!canExtendRig(network)) return;
    const result = doAction({ type: 'drill', plotId: selectedDerrickPlotId, x: clickPos.x, y: clickPos.y });
    if (result.reason === 'angle') notify('Tudy ne', 'Vrták neumí stoupat strmě vzhůru', 'bad', 'derrick');
}

// Klik na vlastní vrt: nejdřív nouze (preventer, ventil), jinak výběr vrtu (protokol a trasa)
function handleDefaultClick(plot) {
    if (isMine(plot) && plot.hasVrt) {
        const network = pipeNetworks.find(n => n.derrickId === plot.id);
        if (network && network.drillState === 'kick') {
            doAction({ type: 'bop', plotId: plot.id });
            return;
        }
        if (network && canVentRig(network)) {
            doAction({ type: 'vent', plotId: plot.id });
            return;
        }
        selectedDerrickPlotId = plot.id;
        updateUI();
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

// Vrtání: výplach u paty věže a drť u korunky v podzemí
function emitDrillDust(network, x, dt) {
    if (Math.random() < dt / 120) {
        spawnParticle({
            type: 'puff', x: x + (Math.random() - 0.5) * 16, y: getGroundLevel() - STRUCTURE_BASE_OFFSET - 4,
            vx: (Math.random() - 0.5) * 30, vy: -15 - Math.random() * 25,
            age: 0, life: 900, size: 2 + Math.random() * 2.5, shade: 95
        });
    }
    if (Math.random() < dt / 90) {
        const head = OilSim.drillHead(network);
        spawnParticle({
            type: 'puff', x: head.x + (Math.random() - 0.5) * 8, y: head.y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
            age: 0, life: 500, size: 1.5 + Math.random() * 1.5, shade: 150
        });
    }
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
    const cx = plot.x + plot.width / 2;
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
    const beam = ctx.createLinearGradient(0, y, 0, VIEW_H);
    beam.addColorStop(0, 'rgba(110, 210, 255, 0.28)');
    beam.addColorStop(0.4, 'rgba(110, 210, 255, 0.10)');
    beam.addColorStop(1, 'rgba(110, 210, 255, 0.02)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.lineTo(x + DRONE_BEAM_HALF, VIEW_H);
    ctx.lineTo(x - DRONE_BEAM_HALF, VIEW_H);
    ctx.closePath();
    ctx.fill();
    // Skenovací linka v podzemí
    const scanY = groundLevel + ((t * 260) % (VIEW_H - groundLevel));
    const half = 6 + (DRONE_BEAM_HALF - 6) * (scanY - y) / (VIEW_H - y);
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
