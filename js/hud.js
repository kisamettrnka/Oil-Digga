// HTML HUD: panely, vrtný protokol, mapa průzkumu, zakázky, soupeři, průvodce, noviny, ikony.
// Součást hry Oil digga: klasický skript sdílející globální rozsah s ostatními soubory v js/.
// Pořadí načítání určuje index.html; tento soubor předpokládá sim.js a net.js před sebou.

// --- HUD: cíle, oznámení a deník ---

// Cíle roku jsou zatím jen ukazatel postupu, hra je nevyhodnocuje
function getYearGoals() {
    const pumping = pipeNetworks.filter(n => isMine(n) && n.isPumping).length;
    const town = world?.town || { era: 0, delivered: 0 };
    const next = OilSim.ERAS[town.era + 1];
    const townGoal = next
        ? { name: `Město → ${next.name}`, value: town.delivered, target: OilSim.eraThreshold(world, town.era + 1), unit: ' bbl' }
        : { name: `Město: ${OilSim.ERAS[town.era].name}`, value: 1, target: 1 };
    return {
        main: [
            townGoal,
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
    const rating = world ? OilSim.yearRating(world, myId) : null;
    const lastEra = world && world.town.era >= OilSim.ERAS.length - 1 && !raceMode && !sharedMode;
    const html = '<div class="goals-title">Ropná horečka</div>' + goals.main.map(row).join('') +
        '<div class="goals-optional">Volitelné</div>' + goals.optional.map(row).join('') +
        (rating ? `<div class="goals-score">Hodnocení: ${'★'.repeat(rating.stars)}${'☆'.repeat(5 - rating.stars)} <span>${rating.label} · ${Math.round(rating.score).toLocaleString('cs-CZ')}</span></div>` : '') +
        (lastEra ? '<div class="goals-end"><span>Město je v poslední éře.</span><button id="end-year-btn" class="rig-btn">Uzavřít rok</button></div>' : '');
    if (html !== lastGoalsHtml) {
        document.getElementById('hud-goals').innerHTML = html;
        lastGoalsHtml = html;
    }
}

// --- Vrtný protokol vybraného vrtu ---
// Kostra (řádky a tlačítka) se přestaví jen při změně rozložení, hodnoty se přepisují každý snímek.
// Jinak by tlačítko zmizelo pod kurzorem uprostřed kliknutí.
let rigLayoutKey = '';

const DRILL_STATE_STAMPS = {
    drilling: ['Vrtá se', ''],
    idle: ['Čeká na trasu', ''],
    kick: ['Plynový kopanec', 'bad alarm'],
    shut: ['Preventer zavřen', 'bad'],
    swap: ['Výměna korunky', ''],
    worn: ['Tupá korunka', 'bad']
};

function getRigStamp(network) {
    if (!network) return ['Bez vrtu', ''];
    if (network.blowout > 0) return ['Erupce', 'bad alarm'];
    if (network.pocket >= 0) {
        const pocket = oilPockets[network.pocket];
        if (network.injecting) return ['Vtláčí vodu', ''];
        if (!pocket || pocket.oil <= 0) return ['Vyčerpáno', 'bad'];
        if ((network.pressure || 0) >= VENT_MIN) return ['Přetlak', 'bad alarm'];
        return ['Těží', 'good'];
    }
    if (network.stalled) return ['Došly peníze', 'bad'];
    return DRILL_STATE_STAMPS[network.drillState] || ['Vrtá se', ''];
}

function rigScale(ratio, cls = '') {
    return `<span class="rig-scale ${cls}"><i style="width:${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(0)}%"></i></span>`;
}

function renderRigPanel() {
    const box = document.getElementById('hud-rig');
    if (!box) return;
    const plot = selectedDerrickPlotId !== null ? plots.find(p => p.id === selectedDerrickPlotId) : null;
    if (!plot || !isMine(plot) || !plot.hasVrt || isGameOver) {
        if (rigLayoutKey) {
            box.classList.add('hidden');
            rigLayoutKey = '';
        }
        return;
    }
    const network = pipeNetworks.find(n => n.derrickId === plot.id) || null;
    const [stampText, stampCls] = getRigStamp(network);
    const connected = !!network && network.pocket >= 0;
    const pocket = connected ? oilPockets[network.pocket] : null;
    const rows = [];
    const actions = [];
    let hint = '';
    if (!network) {
        hint = 'Klikej do podzemí: každý klik přidá bod trasy, vrták po ní pojede.';
    } else if (!connected) {
        const head = OilSim.drillHead(network);
        const rock = OilSim.ROCKS[OilSim.rockAt(world, head.x, head.y)];
        const planLeft = OilSim.pathLength(network.path) - network.drilled;
        rows.push(['Hornina', rock.name]);
        rows.push(['Hloubka', `${Math.max(0, Math.round(head.y - getGroundLevel()))} m`]);
        rows.push(['Korunka', rigScale(network.bit, network.bit < 0.25 ? 'bad' : '') + `${Math.round(network.bit * 100)} %`]);
        rows.push(['Vyvrtáno', `$${Math.round(network.drillCost || 0).toLocaleString('cs-CZ')}`]);
        if (network.waterCut > 0) rows.push(['Voda', rigScale(network.waterCut, 'water') + `${Math.round(network.waterCut * 100)} %`]);
        if (network.drillState === 'kick') {
            actions.push({ act: 'bop', label: `Zavřít preventer · ${(network.drillTimer / 1000).toFixed(1)} s`, cls: 'urgent', key: 'bop' });
        }
        if (network.drillState === 'drilling' && planLeft > 0.5) actions.push({ act: 'drillStop', label: 'Zastavit vrták' });
        if (['drilling', 'idle', 'worn'].includes(network.drillState) && network.bit < 1) {
            actions.push({ act: 'bit', label: `Nová korunka $${BIT_COST}`, disabled: money < BIT_COST, cls: network.drillState === 'worn' ? 'bad' : '' });
        }
        hint = network.drillState === 'idle' ? 'Klikni do podzemí a veď vrták dál.' : 'Kliky do podzemí přidávají body trasy.';
    } else {
        const drive = pocket ? OilSim.pocketDrive(pocket) : 0;
        const water = OilSim.waterCutOf(world, network);
        rows.push(['Těžba', `${Math.round(OilSim.wellRate(world, network) * MS_PER_DAY / 1000)} bbl/den`]);
        rows.push(['Tlak ložiska', rigScale(drive / 1.2) + `${Math.round(drive * 100)} %`]);
        rows.push(['Voda', rigScale(water, 'water') + `${Math.round(water * 100)} %`]);
        rows.push(['Ložisko', `${Math.floor(pocket ? pocket.oil : 0).toLocaleString('cs-CZ')} bbl`]);
        if (pocket && (world.links || []).some(l => l.includes(pocket.id))) rows.push(['Pole', 'propojené se sousedním']);
        if (network.link) {
            rows.push(['Odbyt', `${network.link.kind === 'siding' ? 'vlečka' : 'ropovod'} → ${buyerName(network.link.buyer)}, ${Math.round(network.link.rate * MS_PER_DAY / 1000)} bbl/den`]);
        }
        if (canVentRig(network)) actions.push({ act: 'vent', label: 'Odpustit ventil', cls: 'bad' });
        if (pocket && pocket.oil > 0) {
            actions.push(network.injecting
                ? { act: 'inject', label: 'Zpět na těžbu' }
                : { act: 'inject', label: `Vtláčet vodu $${INJECT_COST_PER_S * MS_PER_DAY / 1000}/den`, cls: 'water' });
        }
        // Odbyt bez vozů: ropovod ke kupci (od Boomtownu), vlečka na nádraží (od Železnice)
        if (!network.link) {
            if (townEra >= OilSim.C.SIDING_ERA && world.market.right.open) {
                actions.push({ act: 'siding', label: `Vlečka na nádraží $${OilSim.C.SIDING_COST}`, disabled: money < OilSim.C.SIDING_COST, cls: 'water' });
            }
            if (townEra >= OilSim.C.PIPELINE_ERA) {
                world.market.order.map(id => world.market[id]).filter(b => b.open && b.id !== 'right').forEach(b => {
                    const cost = OilSim.linkCost(world, plot, 'pipeline', b.id);
                    actions.push({ act: 'pipeline', buyer: b.id, label: `Ropovod → ${b.name} $${cost}`, disabled: money < cost, key: 'pipe' + b.id });
                });
            }
        }
        hint = pocket && pocket.oil <= 0
            ? 'Ložisko je prázdné. Klikni do podzemí a vrtej z tohoto vrtu dál k dalšímu.'
            : network.link
            ? (network.link.kind === 'siding' ? 'Vlečka odváží ropu na nádraží sama, vozy berou jen přebytek.' : 'Ropovod teče sám, ale pomalu; vozy berou přebytek.')
            : network.injecting
                ? 'Vtláčení zvedá tlak celého ložiska pro ostatní vrty, ale zavodňuje ho.'
                : (townEra >= OilSim.C.PIPELINE_ERA ? 'Ropovod nebo vlečka odvádí ropu bez vozů a stávek.' : 'Průtok klesá s tlakem ložiska. Druhý vrt může vtláčet vodu.');
    }
    if (network && network.waterCut > 0) actions.push({ act: 'cement', label: `Zacementovat $${CEMENT_COST}`, disabled: money < CEMENT_COST, cls: 'water' });

    const layout = [plot.id, stampText, stampCls, rows.map(r => r[0]).join(), actions.map(a => `${a.act}:${a.key || a.label}:${!!a.disabled}`).join(), hint].join('|');
    if (layout !== rigLayoutKey) {
        rigLayoutKey = layout;
        box.classList.remove('hidden');
        box.innerHTML =
            `<div class="rig-head"><span class="rig-title">Vrtný protokol</span><span class="rig-plot">pozemek ${plot.id + 1}</span>` +
            `<button class="rig-close" data-act="close" title="Zavřít (Esc)">×</button></div>` +
            `<div class="rig-stamp ${stampCls}">${stampText}</div>` +
            (rows.length ? `<dl class="rig-rows">${rows.map((r, i) => `<dt>${r[0]}</dt><dd data-row="${i}"></dd>`).join('')}</dl>` : '') +
            (actions.length ? `<div class="rig-actions">${actions.map((a, i) => `<button class="rig-btn ${a.cls || ''}" data-act="${a.act}"${a.buyer ? ` data-buyer="${a.buyer}"` : ''} data-btn="${i}"${a.disabled ? ' disabled' : ''}></button>`).join('')}</div>` : '') +
            (hint ? `<div class="rig-hint">${hint}</div>` : '');
    }
    rows.forEach((r, i) => {
        const el = box.querySelector(`[data-row="${i}"]`);
        if (el && el.innerHTML !== r[1]) el.innerHTML = r[1];
    });
    actions.forEach((a, i) => {
        const el = box.querySelector(`[data-btn="${i}"]`);
        if (el && el.textContent !== a.label) el.textContent = a.label;
    });
}

function handleRigPanelClick(event) {
    const button = event.target.closest('[data-act]');
    if (!button || button.disabled || selectedDerrickPlotId === null) return;
    if (button.dataset.act === 'close') {
        selectedDerrickPlotId = null;
        updateUI();
        return;
    }
    const action = { type: button.dataset.act, plotId: selectedDerrickPlotId };
    if (button.dataset.buyer) action.buyer = button.dataset.buyer;
    doAction(action);
}

// --- Mapa geologického průzkumu ---
// List papíru přes scénu: řez podzemím inkoustem, claimy jako sloupce s terénem a cenou, známá
// ložiska a rizika hráče, jeho vrty a legenda. Kreslí se do vlastního plátna stejnými funkcemi
// (paintLayer podvrhne ctx), při otevření a pak každou chvíli, dokud je mapa vidět.
const MAP_W = 1600, MAP_H = 760;
const MAP_SURFACE_Y = 190;         // povrch na mapě
const MAP_BOTTOM_Y = 640;          // dno řezu
const MAP_INK = '26, 18, 11';
const MAP_BLUE = '#1b3a66';
let mapOpen = false;
let mapLastPaint = 0;

function mapY(worldY) {
    return MAP_SURFACE_Y + (worldY - OilSim.C.GROUND_LEVEL) * (MAP_BOTTOM_Y - MAP_SURFACE_Y) / (OilSim.C.WORLD_H - OilSim.C.GROUND_LEVEL);
}

function toggleSurveyMap(force) {
    const next = force ?? !mapOpen;
    if (next === mapOpen) return;
    mapOpen = next;
    if (mapOpen) guideMapOpened = true;
    document.getElementById('hud-map')?.classList.toggle('hidden', !mapOpen);
    document.getElementById('stage')?.classList.toggle('map-open', mapOpen);
    document.getElementById('map-btn')?.classList.toggle('active', mapOpen);
    if (mapOpen) paintSurveyMap();
}

function paintSurveyMap() {
    const mc = document.getElementById('map-canvas');
    if (!mc || !world) return;
    mapLastPaint = performance.now();
    const main = ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (mc.width !== Math.round(MAP_W * dpr)) {
        mc.width = Math.round(MAP_W * dpr);
        mc.height = Math.round(MAP_H * dpr);
    }
    ctx = mc.getContext('2d');
    try {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        drawSurveyMap();
    } finally {
        ctx = main;
    }
}

function inkText(text, x, y, font, align = 'left', color = INK) {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

function drawSurveyMap() {
    const C = OilSim.C;
    ctx.save();
    // Hlavička listu
    inkText('Geologický průzkum ropného pole', MAP_W / 2, 48, '30px "Rye", Georgia, serif', 'center');
    inkText(`List č. ${((world.seed ?? 0) >>> 0) % 9000 + 1000} · okres Oil digga · měřítko 1 : 2 000`, MAP_W / 2, 70, 'italic 13px "Courier Prime", monospace', 'center', INK_SOFT);
    inkText(`${day}. ${MONTH_FULL_NAMES[month]} · éra: ${OilSim.ERAS[townEra].name}`, MAP_W - 40, 48, '700 13px "Barlow Condensed", system-ui, sans-serif', 'right', INK_SOFT);
    ctx.strokeStyle = `rgba(${MAP_INK}, 0.6)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(40, 82);
    ctx.lineTo(MAP_W - 40, 82);
    ctx.stroke();

    drawMapStrata();
    drawMapPockets();
    drawMapHazards();
    drawMapWells();
    drawMapClaims();
    drawMapLegend();
    ctx.restore();
}

// Vrstvy hornin: tenké tinty a inkoustové šrafy, popisky vlevo
function drawMapStrata() {
    const strata = world.strata;
    const C = OilSim.C;
    const bottom = MAP_BOTTOM_Y;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, MAP_SURFACE_Y, MAP_W, bottom - MAP_SURFACE_Y);
    ctx.clip();
    const curve = (bound, fallback) => {
        const pts = [];
        for (let x = 0; x <= MAP_W; x += 10) pts.push({ x, y: bound ? mapY(OilSim.strataBoundaryY(bound, x)) : fallback });
        return pts;
    };
    strata.layers.forEach((kind, i) => {
        const upper = curve(strata.bounds[i - 1], MAP_SURFACE_Y);
        const lower = curve(strata.bounds[i], bottom);
        ctx.save();
        ctx.beginPath();
        upper.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        for (let k = lower.length - 1; k >= 0; k--) ctx.lineTo(lower[k].x, lower[k].y);
        ctx.closePath();
        const look = ROCK_LOOK[kind] || ROCK_LOOK.sand;
        ctx.fillStyle = `rgba(${look.tint}, 0.10)`;
        ctx.fill();
        ctx.clip();
        const top = Math.min(...upper.map(p => p.y)), low = Math.max(...lower.map(p => p.y));
        drawRockHatch(kind, top, low, MAP_INK, seededRandom(31 + i * 7));
        drawRockHatch(kind, top, low, MAP_INK, seededRandom(97 + i * 7));
        ctx.restore();
        const midY = (upper[4].y + lower[4].y) / 2;
        inkText(OilSim.ROCKS[kind].name, 48, midY + 4, '700 12px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
    });
    // Žulové čepice skalnatých claimů
    plots.filter(p => p.terrain === 'rock').forEach(plot => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, MAP_SURFACE_Y, plot.width, mapY(OilSim.C.GROUND_LEVEL + plot.rockDepth) - MAP_SURFACE_Y);
        ctx.clip();
        drawRockHatch('granite', MAP_SURFACE_Y, mapY(OilSim.C.GROUND_LEVEL + plot.rockDepth), MAP_INK, seededRandom(500 + plot.id));
        drawRockHatch('granite', MAP_SURFACE_Y, mapY(OilSim.C.GROUND_LEVEL + plot.rockDepth), MAP_INK, seededRandom(501 + plot.id));
        ctx.restore();
    });
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = `rgba(${MAP_INK}, 0.45)`;
    ctx.lineWidth = 1;
    strata.bounds.forEach(bound => {
        const pts = curve(bound);
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
    // Povrch a dno
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, MAP_SURFACE_Y);
    ctx.lineTo(MAP_W, MAP_SURFACE_Y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, MAP_BOTTOM_Y);
    ctx.lineTo(MAP_W, MAP_BOTTOM_Y);
    ctx.stroke();
    // Hloubková stupnice vpravo (po 100 m)
    for (let d = 0; d <= 500; d += 100) {
        const y = mapY(OilSim.C.GROUND_LEVEL + d);
        if (y > MAP_BOTTOM_Y) break;
        ctx.beginPath();
        ctx.moveTo(MAP_W - 30, y);
        ctx.lineTo(MAP_W - 18, y);
        ctx.stroke();
        inkText(`${d} m`, MAP_W - 34, y + 4, '700 10px "Barlow Condensed", system-ui, sans-serif', 'right', INK_SOFT);
    }
}

function traceMapPolygon(vertices) {
    ctx.beginPath();
    vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, mapY(v.y)) : ctx.moveTo(v.x, mapY(v.y))));
    ctx.closePath();
}

// Ložiska, která hráč zná: plná inkoustová skvrna s odhadem, ozvěna jen čárkovaný obrys
function drawMapPockets() {
    oilPockets.forEach(pocket => {
        const known = DEV || pocket.tapped || pocket.revealed;
        const echo = getPocketEcho(pocket);
        if (!known && echo <= 0) return;
        ctx.save();
        traceMapPolygon(pocket.vertices);
        if (known) {
            ctx.fillStyle = pocket.oil <= 0 ? 'rgba(26, 18, 11, 0.18)' : 'rgba(26, 18, 11, 0.82)';
            ctx.fill();
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            const cx = pocket.x + pocket.width / 2, cy = mapY(pocket.y + pocket.height / 2);
            const label = pocket.oil <= 0 ? 'vyčerpáno' : `${Math.floor(pocket.oil).toLocaleString('cs-CZ')} bbl`;
            inkText(label, cx, cy + 4, '700 11px "Barlow Condensed", system-ui, sans-serif', 'center', pocket.oil <= 0 ? INK_SOFT : PAPER_TOP);
            if (pocket.tapped) inkText(`tlak ${Math.round(OilSim.pocketDrive(pocket) * 100)} %`, cx, cy + 16, '700 9px "Barlow Condensed", system-ui, sans-serif', 'center', PAPER_TOP);
        } else {
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = `rgba(${MAP_INK}, ${0.4 + 0.5 * echo})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
            inkText(`${getPocketRichness(pocket)}?`, pocket.x + pocket.width / 2, mapY(pocket.y + pocket.height / 2) + 4, 'italic 11px "Courier Prime", monospace', 'center', INK_SOFT);
        }
        ctx.restore();
    });
    // Propojená pole, která hráč zná
    (world.links || []).forEach(([ia, ib]) => {
        const a = oilPockets[ia], b = oilPockets[ib];
        if (!a || !b || !(DEV || ((a.tapped || a.revealed) && (b.tapped || b.revealed)))) return;
        ctx.save();
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = `rgba(${MAP_INK}, 0.7)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x + a.width / 2, mapY(a.y + a.height / 2));
        ctx.lineTo(b.x + b.width / 2, mapY(b.y + b.height / 2));
        ctx.stroke();
        ctx.restore();
    });
}

function drawMapHazardGlyph(kind, x, y, r, spent) {
    ctx.save();
    ctx.strokeStyle = kind === 'gas' ? INK : MAP_BLUE;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = spent ? 0.35 : 1;
    ctx.setLineDash(kind === 'gas' ? [3, 3] : []);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (kind === 'gas') {
        for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.arc(x + (k - 1) * r * 0.45, y + (k % 2 ? -1 : 1) * r * 0.25, 1.6, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        for (let k = -1; k <= 1; k++) {
            ctx.beginPath();
            for (let dx = -r * 0.7; dx <= r * 0.7; dx += 3) {
                const yy = y + k * r * 0.4 + Math.sin(dx * 0.8) * 1.5;
                if (dx === -r * 0.7) ctx.moveTo(x + dx, yy); else ctx.lineTo(x + dx, yy);
            }
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawMapHazards() {
    hazards.forEach(h => {
        if (!h.visible && !DEV) return;
        drawMapHazardGlyph(h.kind, h.x, mapY(h.y), h.r * 0.9, h.spent);
    });
}

// Vrty: trasa inkoustem, cizí šedě; na povrchu značka vrtu v barvě hráče
function drawMapWells() {
    pipeNetworks.forEach(network => {
        if (network.derrickId < 0 || network.path.length < 1) return;
        const mine = isMine(network);
        ctx.save();
        ctx.strokeStyle = mine ? INK : `rgba(${MAP_INK}, 0.4)`;
        ctx.lineWidth = mine ? 3 : 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const { done, plan, head } = splitDrillPath(network);
        ctx.beginPath();
        done.forEach((p, i) => (i ? ctx.lineTo(p.x, mapY(p.y)) : ctx.moveTo(p.x, mapY(p.y))));
        ctx.stroke();
        if (plan.length > 1 && mine) {
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            plan.forEach((p, i) => (i ? ctx.lineTo(p.x, mapY(p.y)) : ctx.moveTo(p.x, mapY(p.y))));
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (head) { // korunka jako malý trojúhelník
            ctx.fillStyle = network.drillState === 'kick' ? INK_RED : INK;
            ctx.beginPath();
            ctx.moveTo(head.x - 4, mapY(head.y) - 4);
            ctx.lineTo(head.x + 4, mapY(head.y) - 4);
            ctx.lineTo(head.x, mapY(head.y) + 4);
            ctx.closePath();
            ctx.fill();
        }
        // Značka vrtu na povrchu: trojnožka
        const x0 = network.path[0].x;
        ctx.strokeStyle = sharedMode ? playerColor(network.owner) : INK;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x0 - 7, MAP_SURFACE_Y);
        ctx.lineTo(x0, MAP_SURFACE_Y - 16);
        ctx.lineTo(x0 + 7, MAP_SURFACE_Y);
        ctx.moveTo(x0, MAP_SURFACE_Y - 16);
        ctx.lineTo(x0, MAP_SURFACE_Y);
        ctx.stroke();
        ctx.restore();
    });
}

// Terénní značka claimu na mapě: kopec oblouk, řeka vlnka, skála trojúhelníky, rovina čárka
function drawTerrainGlyph(terrain, x, y) {
    ctx.save();
    ctx.strokeStyle = terrain === 'river' ? MAP_BLUE : INK;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    switch (terrain) {
        case 'hill':
            ctx.arc(x, y + 6, 10, Math.PI, 0);
            ctx.moveTo(x - 5, y + 2);
            ctx.arc(x, y + 6, 5, Math.PI * 1.15, Math.PI * 1.85);
            break;
        case 'river':
            for (let k = 0; k < 2; k++) {
                ctx.moveTo(x - 10, y + k * 5);
                ctx.quadraticCurveTo(x - 5, y - 4 + k * 5, x, y + k * 5);
                ctx.quadraticCurveTo(x + 5, y + 4 + k * 5, x + 10, y + k * 5);
            }
            break;
        case 'rock':
            ctx.moveTo(x - 10, y + 6); ctx.lineTo(x - 5, y - 3); ctx.lineTo(x, y + 6);
            ctx.moveTo(x - 1, y + 6); ctx.lineTo(x + 5, y - 6); ctx.lineTo(x + 11, y + 6);
            break;
        default:
            ctx.moveTo(x - 10, y + 4); ctx.lineTo(x + 10, y + 4);
            ctx.moveTo(x - 6, y); ctx.lineTo(x + 2, y);
    }
    ctx.stroke();
    ctx.restore();
}

// Claimy nad povrchem: hranice, číslo, terén, šířka a cena nebo razítko vlastníka
function drawMapClaims() {
    const top = 92, bottom = MAP_SURFACE_Y;
    plots.forEach((plot, i) => {
        const cx = plot.x + plot.width / 2;
        ctx.save();
        ctx.strokeStyle = `rgba(${MAP_INK}, 0.6)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(plot.x, top);
        ctx.lineTo(plot.x, MAP_BOTTOM_Y);
        if (i === plots.length - 1) {
            ctx.moveTo(plot.x + plot.width, top);
            ctx.lineTo(plot.x + plot.width, MAP_BOTTOM_Y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (plot.owner) { // vlastněný claim: jemný tón vlastníka
            ctx.fillStyle = plot.owner === myId ? 'rgba(138, 28, 20, 0.08)' : `${playerColor(plot.owner)}22`;
            ctx.fillRect(plot.x, top, plot.width, bottom - top);
        }
        inkText(`Claim ${i + 1}`, cx, top + 20, '15px "Rye", Georgia, serif', 'center');
        drawTerrainGlyph(plot.terrain, cx - 28, top + 40);
        inkText(`${OilSim.terrainOf(plot).name} · ${Math.round(plot.width)} m`, cx - 12, top + 46, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
        const note = plot.terrain === 'hill' ? 'stavby 1,5×' : plot.terrain === 'river' ? 'levná voda' : plot.terrain === 'rock' ? `žula do ${plot.rockDepth} m` : '';
        if (note) inkText(note, cx, top + 60, 'italic 10px "Courier Prime", monospace', 'center', INK_SOFT);
        if (!plot.owner) {
            const afford = money >= plot.price;
            inkText(`$${plot.price}`, cx, top + 84, '800 18px "Barlow Condensed", system-ui, sans-serif', 'center', afford ? INK : INK_RED);
            inkText('K PRODEJI', cx, top + 95, '700 8px "Barlow Condensed", system-ui, sans-serif', 'center', INK_SOFT);
        } else {
            // Razítko vlastníka
            const name = plot.owner === myId ? 'MŮJ CLAIM' : (world.players[plot.owner]?.name || 'cizí').toUpperCase();
            ctx.save();
            ctx.translate(cx, top + 82);
            ctx.rotate(-0.08);
            ctx.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
            const w = Math.min(plot.width - 10, ctx.measureText(name).width + 14);
            ctx.strokeStyle = plot.owner === myId ? INK_RED : playerColor(plot.owner);
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.85;
            ctx.strokeRect(-w / 2, -9, w, 18);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, 0, 1);
            ctx.restore();
            if (plot.hasVrt) inkText('vrt postaven', cx, top + 100, 'italic 9px "Courier Prime", monospace', 'center', INK_SOFT);
        }
        ctx.restore();
    });
}

function drawMapLegend() {
    const y = MAP_BOTTOM_Y + 30;
    inkText('Legenda', 48, y, '14px "Rye", Georgia, serif');
    let x = 120;
    Object.entries(OilSim.ROCKS).forEach(([kind, rock]) => {
        ctx.save();
        ctx.strokeStyle = `rgba(${MAP_INK}, 0.8)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y - 12, 34, 16);
        ctx.beginPath();
        ctx.rect(x, y - 12, 34, 16);
        ctx.clip();
        ctx.fillStyle = `rgba(${ROCK_LOOK[kind].tint}, 0.12)`;
        ctx.fillRect(x, y - 12, 34, 16);
        drawRockHatch(kind, y - 12, y + 4, MAP_INK, seededRandom(7));
        drawRockHatch(kind, y - 12, y + 4, MAP_INK, seededRandom(8));
        ctx.restore();
        inkText(rock.name, x + 40, y, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
        x += 40 + ctx.measureText(rock.name).width + 26;
    });
    // Ložisko, ozvěna, plyn, voda
    ctx.save();
    ctx.fillStyle = 'rgba(26, 18, 11, 0.82)';
    ctx.beginPath();
    ctx.ellipse(x + 16, y - 4, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    inkText('známé ložisko', x + 36, y, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
    x += 36 + ctx.measureText('známé ložisko').width + 26;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x + 16, y - 4, 14, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    inkText('ozvěna seismiky', x + 36, y, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
    x += 36 + ctx.measureText('ozvěna seismiky').width + 26;
    drawMapHazardGlyph('gas', x + 10, y - 4, 9, false);
    inkText('plyn', x + 26, y, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
    x += 26 + ctx.measureText('plyn').width + 22;
    drawMapHazardGlyph('water', x + 10, y - 4, 9, false);
    inkText('voda', x + 26, y, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
    // Terén
    const y2 = y + 34;
    let tx = 120;
    Object.entries(OilSim.TERRAIN).forEach(([key, t]) => {
        drawTerrainGlyph(key, tx + 12, y2 - 8);
        const label = key === 'hill' ? `${t.name}: stavby ${t.buildMult}×, levnější claim`
            : key === 'river' ? `${t.name}: vtláčení vody za ${Math.round(t.injectMult * 100)} %, dražší claim`
                : key === 'rock' ? `${t.name}: žula pod povrchem, levný claim` : `${t.name}: nic zvláštního`;
        inkText(label, tx + 30, y2, '700 11px "Barlow Condensed", system-ui, sans-serif', 'left', INK_SOFT);
        tx += 30 + ctx.measureText(label).width + 30;
    });
    // Měřítko
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MAP_W - 240, y2 - 4);
    ctx.lineTo(MAP_W - 40, y2 - 4);
    ctx.stroke();
    for (let k = 0; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(MAP_W - 240 + k * 100, y2 - 9);
        ctx.lineTo(MAP_W - 240 + k * 100, y2 + 1);
        ctx.stroke();
    }
    inkText('0', MAP_W - 240, y2 + 12, '700 9px "Barlow Condensed", system-ui, sans-serif', 'center', INK_SOFT);
    inkText('100 m', MAP_W - 140, y2 + 12, '700 9px "Barlow Condensed", system-ui, sans-serif', 'center', INK_SOFT);
    inkText('200 m', MAP_W - 40, y2 + 12, '700 9px "Barlow Condensed", system-ui, sans-serif', 'center', INK_SOFT);
}

// Klik do mapy: volný claim koupí, vlastní vrt vybere a mapu zavře
function handleMapClick(event) {
    const mc = event.currentTarget;
    const rect = mc.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * MAP_W;
    const y = (event.clientY - rect.top) / rect.height * MAP_H;
    if (y < 92 || y > MAP_BOTTOM_Y) return;
    const plot = getPlotAtX(x);
    if (!plot) return;
    if (!plot.owner) {
        if (tryPurchasePlot(plot, getGroundLevel()) === 'bought') paintSurveyMap();
    } else if (isMine(plot) && plot.hasVrt) {
        selectedDerrickPlotId = plot.id;
        toggleSurveyMap(false);
        updateUI();
    }
}

// --- Konec roku (sólo): výroční vydání novin ---
// Sólo konec roku a bankrot: noviny s hvězdami, uzávěrkou a dvěma grafy kreslenými inkoustem
let yearEndShown = false;

function renderYearEnd() {
    const box = document.getElementById('year-end');
    if (!box || !world) return;
    const me = world.players[myId];
    const rating = OilSim.yearRating(world, myId);
    const bankrupt = gameOverReason === 'bankrupt';
    const title = bankrupt ? 'Podnik skončil v konkurzu' : {
        1: 'Hledač štěstí odjíždí s prázdnou', 2: 'Těžař přežil svůj první rok', 3: 'Ropný podnikatel se uchytil',
        4: 'Magnát z pouště', 5: 'Král ropy! Město mu leží u nohou'
    }[rating.stars];
    document.getElementById('yearend-date').textContent = `${day}. ${MONTH_FULL_NAMES[month]}`;
    document.getElementById('yearend-title').textContent = title;
    const stars = bankrupt ? 0 : rating.stars;
    document.getElementById('yearend-stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= stars ? '' : 'dim'}">★</span>`).join('') +
        `<span style="font-size:0.42em;align-self:center;margin-left:0.8em;color:var(--ink-soft)">${bankrupt ? 'bankrot' : rating.label}</span>`;
    const st = me.stats || {};
    const fmt = v => Math.round(v).toLocaleString('cs-CZ');
    const rows = [
        ['Kapitál na konci', `$${fmt(me.money)}`, me.money < 0], ['Tržby celkem', `$${fmt(me.revenue)}`], ['Prodáno ropy', `${fmt(me.sold)} bbl`],
        ['Navrtaná ložiska', st.strikes || 0], ['Zakázky splněné / propadlé', `${st.contractsDone || 0} / ${st.contractsFailed || 0}`, (st.contractsFailed || 0) > 0],
        ['Erupce', st.blowouts || 0, (st.blowouts || 0) > 0], ['Město došlo do éry', OilSim.ERAS[world.town.era].name],
        ['Claimy / vrty / vozy', `${plots.filter(p => isMine(p)).length} / ${plots.filter(p => isMine(p) && p.hasVrt).length} / ${me.trucksOwned}`],
        ['Vylepšení', Object.keys(me.perks || {}).length]
    ];
    document.getElementById('yearend-stats').innerHTML = rows.map(([k, v, bad]) => `<dt>${k}</dt><dd class="${bad ? 'bad' : ''}">${v}</dd>`).join('');
    const partNames = { revenue: 'Tržby', capital: 'Kapitál (½)', contracts: 'Zakázky', town: 'Růst města', oil: 'Prodaná ropa', penalties: 'Nehody a penále' };
    document.getElementById('yearend-score').innerHTML = Object.entries(rating.parts).map(([k, v]) => `<dt>${partNames[k]}</dt><dd class="${v < 0 ? 'bad' : ''}">${v < 0 ? '−' : ''}${fmt(Math.abs(v))}</dd>`).join('') +
        `<dt><b>Skóre</b></dt><dd><b>${fmt(rating.score)}</b></dd>`;
    drawInkLineChart(document.getElementById('yearend-money'), st.moneyHistory || [me.money]);
    drawInkBarChart(document.getElementById('yearend-buyers'), st.revenueBy || {});
    box.classList.remove('hidden');
    yearEndShown = true;
}

function hideYearEnd() {
    document.getElementById('year-end')?.classList.add('hidden');
    yearEndShown = false;
}

// Čárový graf inkoustem: hodnoty po dnech, nula vyznačená, červeně pod nulou
function drawInkLineChart(cv, values) {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 520, H = 190;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const pad = { l: 46, r: 10, t: 12, b: 22 };
    const data = values.length ? values : [0];
    const min = Math.min(0, ...data), max = Math.max(1, ...data);
    const px = i => pad.l + (data.length > 1 ? i / (data.length - 1) : 0.5) * (W - pad.l - pad.r);
    const py = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    c.strokeStyle = 'rgba(26, 18, 11, 0.25)';
    c.lineWidth = 1;
    c.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
    c.fillStyle = INK_SOFT;
    c.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
        const v = min + (max - min) * k / 4;
        c.beginPath(); c.moveTo(pad.l, py(v)); c.lineTo(W - pad.r, py(v)); c.stroke();
        c.fillText(`$${Math.round(v / 1000)}k`, pad.l - 6, py(v) + 3);
    }
    if (min < 0) { c.strokeStyle = INK_RED; c.beginPath(); c.moveTo(pad.l, py(0)); c.lineTo(W - pad.r, py(0)); c.stroke(); }
    c.textAlign = 'center';
    ['LED', 'DUB', 'ČVC', 'ŘÍJ', 'PRO'].forEach((m, i) => c.fillText(m, pad.l + i / 4 * (W - pad.l - pad.r), H - 6));
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.beginPath();
    data.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.stroke();
    c.fillStyle = 'rgba(26, 18, 11, 0.08)';
    c.lineTo(px(data.length - 1), py(min)); c.lineTo(px(0), py(min)); c.closePath(); c.fill();
}

// Sloupce inkoustem: tržby po kupcích
function drawInkBarChart(cv, byBuyer) {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 520, H = 190;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const entries = OilSim.BUYERS.map(b => [b.name, byBuyer[b.id] || 0]);
    const max = Math.max(1, ...entries.map(e => e[1]));
    const pad = { l: 16, r: 16, t: 24, b: 26 };
    const bw = (W - pad.l - pad.r) / entries.length;
    entries.forEach(([name, v], i) => {
        const x = pad.l + i * bw + bw * 0.2, w = bw * 0.6;
        const h = (v / max) * (H - pad.t - pad.b);
        const y = H - pad.b - h;
        c.fillStyle = 'rgba(26, 18, 11, 0.82)';
        c.fillRect(x, y, w, h);
        c.strokeStyle = INK; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, Math.max(0, h - 1));
        c.fillStyle = INK; c.textAlign = 'center';
        c.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
        c.fillText(`$${Math.round(v).toLocaleString('cs-CZ')}`, x + w / 2, y - 6);
        c.fillStyle = INK_SOFT;
        c.fillText(name.toUpperCase(), x + w / 2, H - 9);
    });
    c.strokeStyle = INK; c.beginPath(); c.moveTo(pad.l, H - pad.b + 0.5); c.lineTo(W - pad.r, H - pad.b + 0.5); c.stroke();
}

// --- Vylepšení (perky): list z kanceláře ---
let perksOpen = false;

function togglePerks(force) {
    perksOpen = force ?? !perksOpen;
    document.getElementById('perks')?.classList.toggle('hidden', !perksOpen);
    if (perksOpen) renderPerks();
}

function renderPerks() {
    const list = document.getElementById('perks-list');
    if (!list || !world) return;
    const me = world.players[myId];
    const owned = me?.perks || {};
    list.innerHTML = Object.entries(OilSim.PERKS).map(([key, p]) => `
        <div class="perk-row">
            <div class="perk-name">${p.name}</div>
            ${owned[key] ? '<span class="perk-owned">Koupeno</span>' : `<button class="perk-buy" data-perk="${key}"${money < p.cost ? ' disabled' : ''}>$${p.cost.toLocaleString('cs-CZ')}</button>`}
            <div class="perk-desc">${p.desc}</div>
        </div>`).join('');
    const count = document.getElementById('perks-count');
    if (count) count.textContent = `${Object.keys(owned).length}/${Object.keys(OilSim.PERKS).length}`;
}

function handlePerksClick(event) {
    const button = event.target.closest('[data-perk]');
    if (!button || button.disabled) return;
    doAction({ type: 'buyPerk', perk: button.dataset.perk });
    renderPerks();
}

// --- Zakázky ---
// Stejný princip jako vrtný protokol: kostra se staví jen při změně seznamu, čísla se přepisují.
let contractsLayoutKey = '';

function buyerName(id) {
    return world?.market?.[id]?.name || id;
}

function renderContracts() {
    const box = document.getElementById('hud-contracts');
    if (!box || !world?.contracts) return;
    const c = world.contracts;
    const mine = c.active.filter(a => a.owner === myId);
    const canTake = mine.length < OilSim.C.MAX_ACTIVE_CONTRACTS && !isGameOver;
    const deals = (world.deals?.offers || []).filter(d => d.to === myId);
    const cartel = world.cartel && !world.cartel.active && world.cartel.pending.includes(myId) ? world.cartel : null;
    if (!c.offers.length && !mine.length && !deals.length && !cartel) {
        if (contractsLayoutKey) {
            box.classList.add('hidden');
            contractsLayoutKey = '';
        }
        return;
    }
    const key = [c.offers.map(o => o.id).join(), mine.map(a => a.id).join(), canTake, deals.map(d => d.id).join(), cartel ? cartel.buyer + cartel.by : ''].join('|');
    if (key !== contractsLayoutKey) {
        contractsLayoutKey = key;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="ct-title">Zakázky a telegramy</div>' +
            deals.map(d => `<div class="ct-item deal" data-deal="${d.id}">` +
                `<div class="ct-wire">${playerName(d.from)} nabízí ${d.oil} bbl za $${d.price.toFixed(2)}/bbl, celkem $${Math.round(d.oil * d.price)} stop</div>` +
                `<div class="ct-meta"><span data-v="dexp"></span><span><button class="ct-decline" data-decline="${d.id}">Odmítnout</button> <button class="ct-accept" data-accept-deal="${d.id}">Přijmout</button></span></div></div>`).join('') +
            (cartel ? `<div class="ct-item cartel"><div class="ct-wire">${playerName(cartel.by)} navrhuje nevozit kupci ${buyerName(cartel.buyer)} ${daysText(cartel.days)}. Cena tam vyletí, kdo doveze, zradí stop</div>` +
                `<div class="ct-meta"><span>čeká ${cartel.pending.length} ${cartel.pending.length === 1 ? 'hráč' : 'hráči'}</span><button class="ct-accept" data-join-cartel="1">Přidat se</button></div></div>` : '') +
            mine.map(a => `<div class="ct-item mine" data-active="${a.id}">` +
                `<div class="ct-wire">${buyerName(a.buyer)}: ${a.amount} bbl za $${a.price.toFixed(2)}</div>` +
                '<div class="ct-bar"><i></i></div><div class="ct-meta"><span data-v="done"></span><span data-v="left"></span></div></div>').join('') +
            c.offers.map(o => `<div class="ct-item" data-offer="${o.id}">` +
                `<div class="ct-wire">${buyerName(o.buyer)} žádá ${o.amount} bbl za $${o.price.toFixed(2)} do ${daysUntilText(o.days)} stop</div>` +
                `<div class="ct-meta"><span data-v="exp"></span><button class="ct-accept" data-accept="${o.id}"${canTake ? '' : ' disabled'}>Přijmout</button></div></div>`).join('');
    }
    mine.forEach(a => {
        const row = box.querySelector(`[data-active="${a.id}"]`);
        if (!row) return;
        const ratio = Math.min(1, a.delivered / a.amount);
        row.classList.toggle('urgent', a.daysLeft <= 2);
        row.querySelector('.ct-bar > i').style.width = `${(ratio * 100).toFixed(1)}%`;
        const done = `${Math.floor(a.delivered)} / ${a.amount} bbl`;
        const left = `zbývá ${daysText(a.daysLeft)}`;
        const doneEl = row.querySelector('[data-v="done"]'), leftEl = row.querySelector('[data-v="left"]');
        if (doneEl.textContent !== done) doneEl.textContent = done;
        if (leftEl.textContent !== left) leftEl.textContent = left;
    });
    deals.forEach(d => {
        const el = box.querySelector(`[data-deal="${d.id}"] [data-v="dexp"]`);
        const text = `platí ${daysText(d.expiresIn)}`;
        if (el && el.textContent !== text) el.textContent = text;
    });
    c.offers.forEach(o => {
        const el = box.querySelector(`[data-offer="${o.id}"] [data-v="exp"]`);
        const text = `nabídka platí ${daysText(o.expiresIn)}`;
        if (el && el.textContent !== text) el.textContent = text;
    });
}

function handleContractsClick(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const d = button.dataset;
    if (d.accept !== undefined) doAction({ type: 'acceptContract', id: Number(d.accept) });
    else if (d.acceptDeal !== undefined) doAction({ type: 'acceptDeal', id: Number(d.acceptDeal) });
    else if (d.decline !== undefined) doAction({ type: 'declineDeal', id: Number(d.decline) });
    else if (d.joinCartel !== undefined) doAction({ type: 'joinCartel' });
}

// --- Soupeři (sdílená mapa): nabídka ropy, kartel, stávka ---
let playersLayoutKey = '';
let playersOpen = false; // panel Soupeři je okno na tlačítko, ať nezakrývá vrty

function togglePlayersPanel(force) {
    playersOpen = force ?? !playersOpen;
    renderPlayersPanel();
}

// Rychlá nabídka: 100 barelů za 85 % mé nejlepší výkupní ceny
function quickDealTerms() {
    const best = Math.max(0.3, ...world.market.order.map(id => world.market[id]).filter(b => !b.closed).map(b => b.quote));
    return { oil: 100, price: Math.round(best * 0.85 * 20) / 20 };
}

// Kartel má smysl proti kupci s největším odběrem (nejvíc mu vyschne sklad)
function cartelTarget() {
    return world.market.order.map(id => world.market[id]).filter(b => b.open).sort((a, b) => b.demand - a.demand)[0];
}

function renderPlayersPanel() {
    const box = document.getElementById('hud-players');
    if (!box) return;
    const rivals = sharedMode && world ? world.playerOrder.filter(id => id !== myId) : [];
    const btn = document.getElementById('players-btn');
    if (btn) {
        btn.classList.toggle('hidden', !rivals.length);
        btn.classList.toggle('active', playersOpen);
    }
    if (!rivals.length || isGameOver || !playersOpen) {
        if (playersLayoutKey) {
            box.classList.add('hidden');
            playersLayoutKey = '';
        }
        return;
    }
    const me = world.players[myId];
    const stored = OilSim.storedOil(world, myId);
    const terms = quickDealTerms();
    const target = cartelTarget();
    const cartel = world.cartel;
    const rows = rivals.map(id => {
        const p = world.players[id];
        const pendingDeal = world.deals.offers.some(d => d.from === myId && d.to === id);
        return {
            id, name: p.name, color: p.color, over: p.over,
            state: p.over ? 'mimo hru' : (p.strikeMs > 0 ? 'stávka' : (cartel?.members.includes(id) ? 'v kartelu' : '')),
            deal: { label: pendingDeal ? 'Nabídka visí' : `Ropa ${terms.oil} bbl · $${terms.price.toFixed(2)}`, disabled: p.over || pendingDeal || stored < terms.oil },
            strike: { label: `Stávka $${OilSim.C.STRIKE_COST}`, disabled: p.over || p.strikeMs > 0 || me.money < OilSim.C.STRIKE_COST }
        };
    });
    const cartelBtn = { label: cartel ? (cartel.active ? 'Kartel běží' : 'Kartel navržen') : (target ? `Kartel: ${target.name}` : 'Kartel'), disabled: !!cartel || !target };
    const cartelLine = cartel ? (cartel.active ? `Kartel: nevozit kupci ${buyerName(cartel.buyer)} ještě ${daysText(cartel.daysLeft)}.` : `Návrh kartelu proti kupci ${buyerName(cartel.buyer)}, čeká ${cartel.pending.length}.`) : '';
    const key = JSON.stringify([rows, cartelBtn, cartelLine]);
    if (key !== playersLayoutKey) {
        playersLayoutKey = key;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="pl-title">Soupeři <button class="rig-close" data-close="1" title="Zavřít (P)">×</button></div>' +
            rows.map(r => `<div class="pl-row">` +
                `<div class="pl-name"><span class="pl-dot" style="background:${r.color}"></span>${r.name}<span class="pl-state">${r.state}</span></div>` +
                `<div class="pl-actions"><button class="pl-btn deal" data-deal-to="${r.id}"${r.deal.disabled ? ' disabled' : ''}>${r.deal.label}</button>` +
                `<button class="pl-btn strike" data-strike="${r.id}"${r.strike.disabled ? ' disabled' : ''}>${r.strike.label}</button></div></div>`).join('') +
            `<div class="pl-actions"><button class="pl-btn cartel" data-cartel="1"${cartelBtn.disabled ? ' disabled' : ''}>${cartelBtn.label}</button></div>` +
            (cartelLine ? `<div class="pl-cartel">${cartelLine}</div>` : '');
    }
}

function handlePlayersClick(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const d = button.dataset;
    if (d.close) { togglePlayersPanel(false); return; }
    if (d.dealTo) doAction({ type: 'offerDeal', to: d.dealTo, ...quickDealTerms() });
    else if (d.strike) doAction({ type: 'sabotage', target: d.strike });
    else if (d.cartel) {
        const target = cartelTarget();
        if (target) doAction({ type: 'proposeCartel', buyer: target.id, days: 5 });
    }
}

// Nová éra města: zvláštní vydání novin
function showEraNews(e) {
    const opened = OilSim.BUYERS.filter(b => b.era === e.era).map(b => b.name);
    showBreakingNews({
        title: `Město roste: ${e.name}`,
        desc: e.desc,
        market: opened.length ? `nově kupuje ${opened.join(', ')}` : 'kupci berou víc ropy'
    });
}

// --- Průvodce první hrou ---
// Jen sólo, dokud ho hráč nedokončí nebo nepřeskočí (localStorage), nebo nevypne v předvolbách.
// Krok se posune, když je splněný; zvýrazní tlačítko, kterého se týká.
const GUIDE_KEY = 'oilDiggaGuideDone';
const GUIDE_STEPS = [
    { title: 'Kup claim', text: 'Klikni na cedulku s cenou nad volným claimem. Cedule říká terén a šířku: kopec zdražuje stavby, řeka zlevňuje vodu, pod skálou je žula.', done: () => plots.some(p => isMine(p)) },
    { title: 'Postav vrt', text: 'Zvol Vrt v objednávkovém listu dole a klikni na svůj claim.', done: () => plots.some(p => isMine(p) && p.hasVrt), hl: 'vrt-btn' },
    { title: 'Naplánuj vrt', text: 'Klikej do podzemí: každý klik je bod trasy. Cedulka u kurzoru ukazuje cenu a čas, řez ukazuje horniny. Pískovec jde rychle, žula je drahá a tupí korunku.', done: () => pipeNetworks.some(n => isMine(n) && n.path.length > 1) },
    { title: 'Trefit ložisko', text: 'Vrták jede sám a platí se za metr. Když narazí na plyn, klikni na vrt a zavři preventer. Tupou korunku vyměň ve Vrtném protokolu vlevo dole.', done: () => pipeNetworks.some(n => isMine(n) && n.pocket >= 0) },
    { title: 'Kup povoz', text: 'Ropa teče do zásobníku vrtu. Kup povoz, sám si vybere kupce, který platí nejlíp.', done: () => trucksOwned > 0, hl: 'truck-btn' },
    { title: 'První prodej', text: 'Kupci ve městě mají sklad: plný sklad platí míň, prázdný víc. Petrolejka platí nejvíc, ale málo bere, rafinerie bere pořád.', done: () => totalOilSold > 0 },
    { title: 'Hlídej tlak', text: 'Plný zásobník zvedá tlak. Odvez ropu, nebo klikni na vrt a odpusť ventil, jinak přijde erupce a pokuta. Silo zásobník zvětší.', done: () => day >= 4 || plots.some(p => isMine(p) && p.siloCount > 0), hl: 'silo-btn' },
    { title: 'Zakázky', text: 'Kupci posílají telegramy se zakázkou: pevná cena, termín, penále za nedodání. Ber jen to, co utěžíš.', done: () => world.contracts.active.some(c => c.owner === myId) || day >= 12 },
    { title: 'Mapa průzkumu', text: 'Stiskni G: list s claimy, vrstvami a vším, co znáš. Seismika a georadar odhalí ložiska i plyn.', done: () => guideMapOpened, hl: 'map-btn' },
    { title: 'Město roste', text: 'Dodaná ropa posouvá město do další éry: víc kupců, nádraží, kamiony místo povozů, ropovody. Teď už víš dost. Hodně štěstí.', done: () => false, final: true }
];
let guideStep = -1;
let guideMapOpened = false;
let guideLayoutKey = '';

function guideDone() {
    try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; }
}

function finishGuide() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* bez úložiště se průvodce ukáže znovu */ }
    guideStep = -1;
    renderGuide();
}

function resetGuide() {
    guideMapOpened = false;
    guideStep = !raceMode && !sharedMode && prefs.guide && !guideDone() ? 0 : -1;
}

function renderGuide() {
    const box = document.getElementById('hud-guide');
    if (!box) return;
    if (guideStep >= 0 && (raceMode || sharedMode || !prefs.guide || isGameOver)) guideStep = -1;
    while (guideStep >= 0 && guideStep < GUIDE_STEPS.length - 1 && GUIDE_STEPS[guideStep].done()) guideStep++;
    const step = guideStep >= 0 ? GUIDE_STEPS[guideStep] : null;
    const key = step ? `${guideStep}` : '';
    if (key === guideLayoutKey) return;
    document.querySelectorAll('.guide-hl').forEach(el => el.classList.remove('guide-hl'));
    guideLayoutKey = key;
    if (!step) {
        box.classList.add('hidden');
        return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="guide-head"><span class="guide-stamp">Rada ${guideStep + 1}/${GUIDE_STEPS.length}</span><span class="guide-title">${step.title}</span></div>` +
        `<div class="guide-text">${step.text}</div>` +
        `<div class="guide-actions">${step.final ? '<button class="rig-btn" data-guide="done">Hotovo</button>' : '<button class="guide-skip" data-guide="skip">Přeskočit průvodce</button>'}</div>`;
    if (step.hl) document.getElementById(step.hl)?.classList.add('guide-hl');
}

function handleGuideClick(event) {
    const button = event.target.closest('[data-guide]');
    if (button) finishGuide();
}

// --- Mimořádné zprávy ---
const NEWS_FLASH_MS = 8000;
let newsFlashTimer = null;
let lastNewsHtml = '';

// Dopad zprávy čitelně: "Rafinerie +35 %, Nádraží zavřené, daň 0"
function describeNewsEffects(effects) {
    const parts = [];
    const pct = mult => `${mult >= 1 ? '+' : '−'}${Math.round(Math.abs(mult - 1) * 100)} %`;
    if (effects.all && effects.all !== 1) parts.push(`všichni kupci ${pct(effects.all)}`);
    OilSim.BUYERS.forEach(b => {
        if (effects[b.id + 'Closed']) parts.push(`${b.name} zavřená`);
        else if (effects[b.id] && effects[b.id] !== 1) parts.push(`${b.name} ${pct(effects[b.id])}`);
    });
    if (effects.taxMult !== undefined) parts.push(effects.taxMult === 0 ? 'daň z pozemků 0' : `daň ×${effects.taxMult}`);
    if (effects.fineMult) parts.push(`pokuty za erupce ×${effects.fineMult}`);
    if (effects.truckSpeed) parts.push(`vozy ${pct(effects.truckSpeed)}`);
    return parts;
}

// "do 1 dne", "do 4 dnů"
function daysUntilText(n) {
    return n === 1 ? '1 dne' : `${n} dnů`;
}

function daysText(n) {
    return `${n} ${n === 1 ? 'den' : (n < 5 ? 'dny' : 'dní')}`;
}

// Velký pruh "Mimořádné zprávy" se znělkou, po chvíli zmizí (zpráva zůstane v seznamu běžících)
function showBreakingNews(e) {
    const box = document.getElementById('news-flash');
    const market = e.market || `${describeNewsEffects(e.effects).join(' · ')} · ${daysText(e.days)}`;
    if (!box || !prefs.newsFlash) { // bez zvláštního vydání aspoň telegram s titulkem a dopadem na trh
        playSound('news');
        notify(`Zprávy: ${e.title}`, market, 'news', 'news');
        return;
    }
    // Zvláštní vydání novin: hlavička, datum, titulek, článek a "burza" s dopadem
    box.innerHTML = '<div class="np-masthead">Pouštní kurýr</div>' +
        '<div class="np-dateline"><span>Zvláštní vydání</span><span class="np-date"></span><span>Cena 5 centů</span></div>' +
        '<div class="np-headline"></div><div class="np-columns"><p class="np-lead"></p><div class="np-market"><b>Burza</b><span></span></div></div>';
    box.querySelector('.np-date').textContent = `${day}. ${MONTH_FULL_NAMES[month]}`;
    box.querySelector('.np-headline').textContent = e.title;
    box.querySelector('.np-lead').textContent = e.desc;
    box.querySelector('.np-market span').textContent = market;
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
const MAX_TOASTS = 2;

// Oznámení vlevo nahoře; zároveň se zapíše do deníku událostí
// --- Ikony (vlastní SVG, žádné emoji): tah currentColor, viewBox 24 ---
const ICONS = {
    prefs: '<path d="M5 4v16M12 4v16M19 4v16"/><path d="M3 15h4M10 8h4M17 13h4"/>',
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
    fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    pipe: '<path d="M3 9h5v6H3zM16 9h5v6h-5zM8 12h8"/><path d="M8 10v4M16 10v4"/>',
    rail: '<path d="M7 3v18M17 3v18M4 7h16M4 12h16M4 17h16"/>',
    drop: '<path d="M12 3s5 6 5 9.5a5 5 0 0 1-10 0C7 9 12 3 12 3Z"/><path d="M3 20c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>'
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
