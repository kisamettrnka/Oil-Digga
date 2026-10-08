// Herní prvky na plátně: noční papír, ložiska, vrty, potrubí, kupci, vozy, odbyt, částice a zvuk.
// Součást hry Oil digga: klasický skript sdílející globální rozsah s ostatními soubory v js/.
// Pořadí načítání určuje index.html; tento soubor předpokládá sim.js a net.js před sebou.

// --- Noční papír na plátně (stejná paleta jako --paper/--ink ve style.css) ---
const PAPER_TOP = '#b09c74';
const PAPER_BOTTOM = '#8f7b56';
const INK = '#1a120b';
const INK_SOFT = '#3a2c1d';
const INK_RED = '#8a1c14';
const INK_GREEN = '#1f5a2c';

// Papírový štítek: zaoblený obdélník s přechodem, stínem a tmavším okrajem
function fillPaper(x, y, w, h, r = 3, tilt = 0) {
    ctx.save();
    if (tilt) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(tilt);
        ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    pathRoundRect(x, y, w, h, r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, PAPER_TOP);
    g.addColorStop(1, PAPER_BOTTOM);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(40, 28, 16, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

function drawPocketChip(pocket, pumping) {
    const w = 150, h = 38;
    const x = Math.min(pocket.x + pocket.width - 6, VIEW_W - w - 8);
    const y = pocket.y + pocket.height * 0.5 - 18;
    // Papírová cedulka přišpendlená k ložisku
    fillPaper(x, y, w, h, 3, -0.02);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = pumping ? INK_RED : INK_SOFT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + 17, y + h / 2, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = pumping ? INK_RED : INK;
    ctx.beginPath();
    ctx.moveTo(x + 17, y + h / 2 - 7);
    ctx.quadraticCurveTo(x + 24, y + h / 2 + 2, x + 17, y + h / 2 + 5);
    ctx.quadraticCurveTo(x + 10, y + h / 2 + 2, x + 17, y + h / 2 - 7);
    ctx.fill();
    ctx.font = '700 9px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillStyle = INK_SOFT;
    ctx.fillText('ROPNÉ LOŽISKO', x + 34, y + 13);
    ctx.font = '700 14px "Courier Prime", monospace';
    ctx.fillStyle = INK;
    ctx.fillText(Math.floor(pocket.oil).toLocaleString('cs-CZ'), x + 34, y + 30);
    // Ukazatel zbytku ložiska podél spodní hrany štítku
    const left = pocket.maxOil > 0 ? Math.max(0, Math.min(1, pocket.oil / pocket.maxOil)) : 0;
    ctx.fillStyle = 'rgba(40, 28, 16, 0.18)';
    ctx.fillRect(x + 34, y + h - 5, w - 44, 2);
    ctx.fillStyle = left < 0.25 ? INK_RED : INK;
    ctx.fillRect(x + 34, y + h - 5, (w - 44) * left, 2);
    ctx.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = pocket.oil <= 0 ? INK_RED : (pumping ? INK_RED : '#1b3a66');
    const status = pocket.oil <= 0 ? 'Vyčerpáno'
        : (pocket.tapped ? `tlak ${Math.round(OilSim.pocketDrive(pocket) * 100)} %` : 'Odhaleno');
    ctx.fillText(status, x + w - 9, y + 29);
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
    const pressure = network ? (network.blowout > 0 ? 1.3 : (network.drillState === 'kick' ? 0.8 : network.pressure || 0)) : 0;
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
    ctx.font = '700 12px "Courier Prime", monospace';
    const w = Math.max(74, ctx.measureText(label).width + 34);
    const h = 22;
    const bx = x - w / 2;
    fillPaper(bx, y - h / 2, w, h, 2);
    if (blink || full) { // plný zásobník: červený rámeček inkoustem
        ctx.strokeStyle = blink ? INK_RED : 'rgba(138, 28, 20, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 2, y - h / 2 + 2, w - 4, h - 4);
    }
    // Ukazatel naplnění podél spodní hrany štítku
    ctx.fillStyle = fillRatio > 0.8 ? INK_RED : INK;
    ctx.fillRect(bx + 8, y + h / 2 - 4, (w - 16) * fillRatio, 2);
    // Kapka ropy
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(bx + 13, y - 6);
    ctx.quadraticCurveTo(bx + 19, y + 1, bx + 13, y + 4);
    ctx.quadraticCurveTo(bx + 7, y + 1, bx + 13, y - 6);
    ctx.fill();
    ctx.font = '700 12px "Courier Prime", monospace';
    ctx.fillStyle = INK;
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
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10, 8, 6, 0.75)';
        ctx.strokeText(message, x, y - h / 2 - 9);
        ctx.fillStyle = blink || network.blowout > 0 ? '#ff7a6a' : '#f0d6a3';
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

// Trasa vrtu rozdělená v místě korunky: done = vyvrtáno (pažnice), plan = kudy vrták teprve pojede
function splitDrillPath(network) {
    const path = network.path;
    if (network.drilled == null || network.pocket >= 0) return { done: path, plan: [], head: null };
    const head = OilSim.drillHead(network);
    const done = path.slice(0, Math.max(1, head.index));
    done.push({ x: head.x, y: head.y });
    const plan = [{ x: head.x, y: head.y }, ...path.slice(Math.max(1, head.index))];
    return { done, plan: plan.length > 1 ? plan : [], head };
}

// Kovové potrubí ve vrstvách (stín, obrys, tělo, odlesk); při těžbě jím teče svítící ropa
// směrem k vrtu a klouby žhnou. Před korunkou čárkovaná plánovaná trasa.
function drawPipeNetworks() {
    const t = performance.now();
    pipeNetworks.forEach(network => {
        if (network.path.length < 2) return;
        const { done: path, plan, head } = splitDrillPath(network);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (plan.length > 1 && isMine(network)) {
            tracePath(plan);
            ctx.strokeStyle = 'rgba(240, 220, 180, 0.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 7]);
            ctx.lineDashOffset = -t / 40;
            ctx.stroke();
            ctx.setLineDash([]);
            plan.slice(1).forEach(p => { // body trasy jako křížky zeměměřiče
                ctx.strokeStyle = 'rgba(240, 220, 180, 0.8)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x + 5, p.y + 5);
                ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(p.x - 5, p.y + 5);
                ctx.stroke();
            });
        }

        if (path.length >= 2) {
            tracePath(path, 4);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.lineWidth = 16;
            ctx.stroke();
            tracePath(path);
            ctx.strokeStyle = '#17120f';
            ctx.lineWidth = 13;
            ctx.stroke();
            ctx.strokeStyle = network.injecting ? '#4a6a8a' : '#8a6a4a'; // vtláčecí vrt: modrá ocel
            ctx.lineWidth = 9;
            ctx.stroke();
            ctx.strokeStyle = network.injecting ? '#2c3e52' : '#5e4632';
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

            if (network.isPumping || network.injecting) {
                ctx.globalCompositeOperation = 'lighter';
                tracePath(path);
                ctx.strokeStyle = network.injecting ? 'rgba(110, 180, 255, 0.8)' : 'rgba(255, 160, 60, 0.85)';
                ctx.lineWidth = 3.5;
                ctx.setLineDash([7, 13]);
                // ropa teče k vrtu, voda od vrtu do ložiska
                ctx.lineDashOffset = network.injecting ? -(t / 25) % 20 : (t / 25) % 20;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalCompositeOperation = 'source-over';
            }

            // Klouby v bodech, kde hráč klikal (konec vyvrtané části je korunka, ne kloub)
            const joints = head ? path.length - 1 : path.length;
            for (let i = 1; i < joints; i++) {
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
        }
        // Příruba na hraně řezu
        ctx.fillStyle = '#2a211b';
        ctx.fillRect(network.path[0].x - 9, network.path[0].y - 2, 18, 7);
        ctx.fillStyle = '#a08a70';
        ctx.fillRect(network.path[0].x - 9, network.path[0].y - 2, 18, 1.5);
        ctx.restore();
        if (head) drawDrillBit(head, network, path);
    });
}

// Korunka na konci vyvrtané části: točí se při vrtání, kopanec = červený puls, tupá = šedá
function drawDrillBit(head, network, donePath) {
    const t = performance.now() / 1000;
    const state = network.drillState;
    const prev = donePath[Math.max(0, donePath.length - 2)];
    const angle = Math.atan2(head.y - prev.y, head.x - prev.x) - Math.PI / 2;
    ctx.save();
    ctx.translate(head.x, head.y);
    if (state === 'kick') {
        const pulse = 0.5 + 0.5 * Math.sin(t * 14);
        drawGlow(0, 0, 46, '255, 70, 50', 0.5 + 0.3 * pulse);
        ctx.strokeStyle = `rgba(255, 90, 70, ${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 16 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
    } else if (state === 'shut') {
        drawGlow(0, 0, 30, '120, 180, 255', 0.35);
    } else if (state === 'drilling' && !network.stalled) {
        drawGlow(0, 0, 26, '255, 200, 140', 0.25);
    }
    ctx.rotate(angle);
    const worn = state === 'worn' || (network.bit ?? 1) <= 0;
    const spin = state === 'drilling' && !network.stalled ? t * 12 : 0;
    // Tělo korunky: kužel se třemi zubatými válci (trikónus)
    ctx.fillStyle = worn ? '#5a5552' : '#9a8f84';
    ctx.strokeStyle = '#1a1410';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7, -6);
    ctx.lineTo(7, -6);
    ctx.lineTo(4, 6);
    ctx.lineTo(-4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let k = 0; k < 3; k++) {
        const a = spin + k * Math.PI * 2 / 3;
        const cx = Math.cos(a) * 4;
        ctx.fillStyle = worn ? '#4a4542' : '#d8c8b0';
        ctx.beginPath();
        ctx.arc(cx, 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
    if (worn && isMine(network)) {
        ctx.save();
        ctx.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ff9a7a';
        ctx.fillText('TUPÁ KORUNKA', head.x, head.y - 16);
        ctx.restore();
    }
}

// --- Kupci ve městě ---
// Herně jsou to world.market[id] (cena podle zásoby, poptávka podle éry). Rafinerie a nádraží mají
// areály po stranách s ceníkem nahoře, petrolejka a benzinka stojí ve městě a ceník visí nad nimi.
const BUYER_CARD_TOP = 96;
const BUYER_CARD_H = 190;
const BUYER_CARD_W = 124;
const BUYER_ZONE_WIDTH = 100;
const TOWN_CHIP_W = 160;
const TOWN_CHIP_H = 98;
const BUYER_COLORS = { left: '#8a1c14', lamps: '#7a5a12', right: '#1b3a66', garage: '#1f5a2c' };

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

// Razítko vlivu zpráv (ZAVŘENO / ZPRÁVY ±x %) nebo popisek ZA BAREL; vrací, jestli je kupec zavřený
// stampOnly: bez zpráv se nic nekreslí (cedule ve městě má místo popisku ZA BAREL roli kupce)
function drawBuyerNewsStamp(buyer, x, y, stampOnly = false) {
    const closedByNews = buyer.open && buyer.closed;
    const mult = buyer.mult ?? 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (closedByNews || Math.abs(mult - 1) > 0.001) {
        const label = closedByNews ? 'ZAVŘENO' : `ZPRÁVY ${mult > 1 ? '+' : '−'}${Math.round(Math.abs(mult - 1) * 100)} %`;
        const good = !closedByNews && mult > 1;
        ctx.font = '800 9px "Barlow Condensed", system-ui, sans-serif';
        const lw = ctx.measureText(label).width + 8;
        ctx.strokeStyle = good ? INK_GREEN : INK_RED;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x, y - 10, lw, 13);
        ctx.fillStyle = good ? INK_GREEN : INK_RED;
        ctx.fillText(label, x + 4, y);
    } else if (!stampOnly) {
        ctx.fillStyle = INK_SOFT;
        ctx.font = '700 9px "Barlow Condensed", system-ui, sans-serif';
        ctx.fillText('ZA BAREL', x + 2, y - 1);
    }
    return closedByNews;
}

// Sklad kupce: dílky po půl dni zásoby, plný sklad = nižší cena
function drawStockGauge(buyer, x, y, w) {
    const days = buyer.demand > 0 ? buyer.stock / buyer.demand : 0;
    const ratio = Math.min(1, days / (OilSim.C.STOCK_DAYS * 1.5));
    ctx.fillStyle = 'rgba(40, 28, 16, 0.12)';
    ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = ratio > 0.66 ? INK_RED : INK;
    ctx.fillRect(x, y, w * ratio, 6);
    ctx.strokeStyle = 'rgba(40, 28, 16, 0.55)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 5);
    for (let k = 1; k < 6; k++) {
        ctx.beginPath();
        ctx.moveTo(x + w * k / 6, y);
        ctx.lineTo(x + w * k / 6, y + 6);
        ctx.stroke();
    }
    ctx.fillStyle = INK_SOFT;
    ctx.font = '700 9px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SKLAD ${days.toFixed(1).replace('.', ',')} DNE`, x, y + 17);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(buyer.demand)}/DEN`, x + w, y + 17);
}

function getMyContract(buyerId) {
    return world?.contracts?.active.find(c => c.owner === myId && c.buyer === buyerId) || null;
}

// Ceník kupce po straně: název, cena s trendem, graf, sklad, kolik vozů k němu jede / zakázka
function drawBuyerCard(buyer, x, y, w, h) {
    const color = BUYER_COLORS[buyer.id] || INK;
    fillPaper(x, y, w, h, 2);
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 8, 2.5, 22);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = '16px "Rye", Georgia, serif';
    ctx.fillText(buyer.name, x + 9, y + 21);
    ctx.fillStyle = INK_SOFT;
    ctx.font = 'italic 10px "Courier Prime", monospace';
    ctx.fillText(buyer.sub, x + 9, y + 34);

    if (!buyer.open) { // kupec ještě není: trať se staví
        const era = OilSim.ERAS[buyer.era];
        ctx.fillStyle = INK_SOFT;
        ctx.font = '700 14px "Barlow Condensed", system-ui, sans-serif';
        ctx.fillText('VE STAVBĚ', x + 9, y + 62);
        ctx.font = 'italic 10px "Courier Prime", monospace';
        ctx.fillText(`od éry`, x + 9, y + 82);
        ctx.font = '14px "Rye", Georgia, serif';
        ctx.fillStyle = INK;
        ctx.fillText(era.name, x + 9, y + 99);
        const need = Math.max(0, OilSim.eraThreshold(world, buyer.era) - world.town.delivered);
        ctx.fillStyle = INK_SOFT;
        ctx.font = 'italic 10px "Courier Prime", monospace';
        ctx.fillText(`chybí ${Math.ceil(need).toLocaleString('cs-CZ')} bbl`, x + 9, y + 118);
        ctx.fillText('do města', x + 9, y + 131);
        ctx.restore();
        return;
    }

    ctx.fillStyle = INK;
    ctx.font = '800 27px "Barlow Condensed", system-ui, sans-serif';
    const priceText = `$${buyer.quote.toFixed(2)}`;
    ctx.fillText(priceText, x + 8, y + 64);
    const priceWidth = ctx.measureText(priceText).width;
    const history = buyer.history || [];
    const rising = history.length < 2 || history[history.length - 1] >= history[history.length - 2];
    ctx.fillStyle = rising ? INK_GREEN : INK_RED;
    ctx.font = '12px sans-serif';
    ctx.fillText(rising ? '▲' : '▼', x + 12 + priceWidth, y + 62);
    if (drawBuyerNewsStamp(buyer, x + 7, y + 78)) { // přeškrtnutá cena
        ctx.strokeStyle = INK_RED;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 56);
        ctx.lineTo(x + 12 + priceWidth, y + 56);
        ctx.stroke();
    }
    drawPriceChart(history, x + 8, y + 86, w - 16, 18);
    drawStockGauge(buyer, x + 8, y + 112, w - 16);
    drawRouteStamp(buyer, x + 8, y + 140, w - 16);
    drawBuyerFooter(buyer, x + w / 2, y + h - 8);
    ctx.restore();
}

// Razítko Vozit sem: přepíná, jestli všechny mé vozy jezdí k tomuto kupci; hitbox pro klik
function drawRouteStamp(buyer, x, y, w) {
    const rect = { x, y, width: w, height: 20 };
    buyerControls[buyer.id] = rect;
    const active = myRoute === buyer.id;
    const hovered = isPointNearRect(mousePos, rect, 2);
    if (hovered) buyerHover = true;
    ctx.save();
    ctx.translate(x + w / 2, y + rect.height / 2);
    ctx.rotate(active ? -0.035 : 0);
    ctx.fillStyle = hovered ? 'rgba(255, 245, 220, 0.3)' : 'rgba(255, 245, 220, 0.12)';
    ctx.fillRect(-w / 2, -rect.height / 2, w, rect.height);
    ctx.strokeStyle = active ? INK_RED : (hovered ? INK : 'rgba(26, 18, 11, 0.55)');
    ctx.lineWidth = active ? 2 : 1.2;
    ctx.strokeRect(-w / 2 + 1, -rect.height / 2 + 1, w - 2, rect.height - 2);
    ctx.fillStyle = active ? INK_RED : INK_SOFT;
    ctx.font = '800 10px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(active ? 'VOZY JEZDÍ SEM' : 'VOZIT SEM', 0, 0.5);
    ctx.restore();
}

// Spodní řádek ceníku: rozjednaná zakázka, jinak kolik mých vozů k kupci jede
function drawBuyerFooter(buyer, cx, y) {
    const contract = getMyContract(buyer.id);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (contract) {
        ctx.fillStyle = INK_RED;
        ctx.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
        ctx.fillText(`ZAKÁZKA ${Math.floor(contract.delivered)}/${contract.amount}`, cx, y);
        return;
    }
    const driving = trucks.filter(t => t.state === 'to_company' && t.targetCompany === buyer.id && isMine(t)).length;
    ctx.fillStyle = INK_SOFT;
    ctx.font = 'italic 10px "Courier Prime", monospace';
    ctx.fillText(driving ? `${driving} ${driving === 1 ? 'vůz veze' : 'vozy vezou'}` : 'nikdo neveze', cx, y);
}

// Ceník kupce ve městě: menší cedule zavěšená nad budovou
function drawTownBuyerChip(buyer, groundLevel) {
    if (!buyer.open) return;
    const L = getTownLayout(groundLevel);
    const w = TOWN_CHIP_W, h = TOWN_CHIP_H;
    const x = buyer.x - w / 2, y = BUYER_CARD_TOP + 4;
    ctx.save();
    ctx.strokeStyle = 'rgba(20, 14, 10, 0.7)'; // provázky k budově
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + h);
    ctx.lineTo(buyer.x - 10, L.townEndY - 30);
    ctx.moveTo(x + w - 14, y + h);
    ctx.lineTo(buyer.x + 10, L.townEndY - 30);
    ctx.stroke();
    ctx.restore();
    fillPaper(x, y, w, h, 2, buyer.id === 'lamps' ? -0.015 : 0.015);
    ctx.save();
    const color = BUYER_COLORS[buyer.id] || INK;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 6, 2.5, 18);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = '15px "Rye", Georgia, serif';
    ctx.fillText(buyer.name, x + 8, y + 19);
    ctx.font = '800 21px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${buyer.quote.toFixed(2)}`, x + w - 7, y + 21);
    ctx.textAlign = 'left';
    // Pod názvem role kupce, při zprávách místo ní razítko
    const hasNews = (buyer.open && buyer.closed) || Math.abs((buyer.mult ?? 1) - 1) > 0.001;
    if (!hasNews) {
        ctx.fillStyle = INK_SOFT;
        ctx.font = 'italic 10px "Courier Prime", monospace';
        ctx.fillText(buyer.sub, x + 8, y + 33);
    }
    drawBuyerNewsStamp(buyer, x + 7, y + 36, true);
    drawStockGauge(buyer, x + 8, y + 42, w - 16);
    drawRouteStamp(buyer, x + 8, y + 65, w - 16);
    drawBuyerFooter(buyer, x + w / 2, y + h - 6);
    ctx.restore();
}

// Vykládka kupce ve městě u silnice: sloupek s lucernou a cedulkou, kde vozy zastavují
function drawUnloadingStand(buyer, groundLevel) {
    if (!buyer.open) return;
    const x = buyer.x;
    const base = groundLevel - STRUCTURE_BASE_OFFSET + 6;
    ctx.save();
    ctx.fillStyle = '#17120e';
    ctx.fillRect(x - 1.5, base - 34, 3, 34);
    ctx.fillRect(x - 8, base - 34, 16, 2);
    ctx.fillStyle = townEra >= 3 ? '#e8f0ff' : '#ffd890';
    ctx.fillRect(x + 5, base - 32, 3, 4);
    drawGlow(x + 6.5, base - 30, 16, townEra >= 3 ? '200, 220, 255' : '255, 180, 90', 0.5);
    ctx.restore();
    const label = buyer.name.toUpperCase();
    ctx.save();
    ctx.font = '700 9px "Barlow Condensed", system-ui, sans-serif';
    const lw = ctx.measureText(label).width + 10;
    fillPaper(x - lw / 2, base - 26, lw, 13, 1.5, -0.03);
    ctx.fillStyle = BUYER_COLORS[buyer.id] || INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, base - 19);
    ctx.restore();
}

// Trať ve stavbě místo nádraží (než přijde éra železnice): pražce, kolejnice do ztracena, stany dělníků
function drawRailConstruction(x0, baseY) {
    const t = ambientClock;
    const railY = baseY - 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x0 + 56, baseY + 1, 56, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1820';
    for (let x = x0 + 40; x < x0 + 104; x += 7) ctx.fillRect(x, railY - 1, 4, 3);
    ctx.fillStyle = '#6a6f88';
    ctx.fillRect(x0 + 62, railY - 2, 42, 1); // kolejnice končí uprostřed
    ctx.fillStyle = '#2a2420'; // hromada pražců
    for (let k = 0; k < 4; k++) ctx.fillRect(x0 + 10 + k * 2, railY - 4 - k * 3, 24 - k * 4, 3);
    drawTownTent(x0 + 30, baseY - 6, 1.3, seededRandom(4));
    // Ruční drezína s lucernou
    ctx.fillStyle = '#15141d';
    ctx.fillRect(x0 + 74, railY - 9, 18, 5);
    ctx.fillRect(x0 + 82, railY - 18, 2, 9);
    ctx.fillRect(x0 + 76 + Math.sin(t * 2) * 3, railY - 19, 12, 1.5);
    drawGlow(x0 + 90, railY - 12, 14, '255, 180, 90', 0.4);
    // Cedule
    ctx.fillStyle = '#15141d';
    ctx.fillRect(x0 + 52, baseY - 46, 2, 42);
    fillPaper(x0 + 34, baseY - 58, 40, 16, 1.5, 0.04);
    ctx.save();
    ctx.fillStyle = INK;
    ctx.font = '700 7px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STAVBA TRATI', x0 + 54, baseY - 50);
    ctx.restore();
}

function drawCompanyBuildings(groundLevel) {
    buyerControls = {};
    buyerHover = false;
    const baseY = groundLevel - BUILDING_BASE_OFFSET;
    const rightX = VIEW_W - BUYER_ZONE_WIDTH;
    const m = world.market;
    drawRefinery(0, baseY);
    if (m.right.open) drawRailDepot(rightX, baseY);
    else drawRailConstruction(rightX, baseY);
    drawBuyerCard(m.left, 4, BUYER_CARD_TOP, BUYER_CARD_W, BUYER_CARD_H);
    drawBuyerCard(m.right, VIEW_W - 4 - BUYER_CARD_W, BUYER_CARD_TOP, BUYER_CARD_W, BUYER_CARD_H);
    ['lamps', 'garage'].forEach(id => {
        drawUnloadingStand(m[id], groundLevel);
        drawTownBuyerChip(m[id], groundLevel);
    });
}

// Malý čárový graf cen. Osa Y se přizpůsobí, minimální rozsah 0,30 $, ať drobné změny nevypadají dramaticky.
function drawPriceChart(history, x, y, w, h) {
    ctx.save();
    // Graf jako záznam zapisovače: tenká mřížka a čára inkoustem
    ctx.strokeStyle = 'rgba(40, 60, 90, 0.25)';
    ctx.lineWidth = 0.6;
    for (let gy = y; gy <= y + h; gy += h / 3) {
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
    }
    if (history.length >= 2) {
        let min = Math.min(...history);
        let max = Math.max(...history);
        const pad = Math.max(0, (0.3 - (max - min)) / 2);
        min -= pad;
        max += pad;
        const px = i => x + (i / (history.length - 1)) * w;
        const py = v => y + h - 2 - ((v - min) / (max - min)) * (h - 4);
        const rising = history[history.length - 1] >= history[0];
        ctx.strokeStyle = rising ? INK_GREEN : INK_RED;
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
const TRUCK_COLORS = { left: '#C77D2E', right: '#4F86B5', lamps: '#B59A3E', garage: '#5E9A62' }; // laděné ke kupcům

function pathRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}

// Cisterna, kabina vpravo. facing = -1 ji zrcadlí (jede doleva). loadRatio 0–1 = hladina v okénku.
// --- Odbyt vrtu na povrchu: ropovod na podpěrách za silnicí, vlečka s kolejemi a cisternou ---
function drawTransportLinks(groundLevel) {
    const t = performance.now() / 1000;
    pipeNetworks.forEach(network => {
        const link = network.link;
        if (!link || network.derrickId < 0) return;
        const plot = plots.find(p => p.id === network.derrickId);
        const buyer = world.market[link.buyer];
        if (!plot || !buyer) return;
        const x0 = plot.x + plot.width / 2;
        const flowing = network.oilStored > 0 && !buyer.closed;
        if (link.kind === 'siding') drawSiding(x0, buyer.x, groundLevel, flowing, t, network.id);
        else drawPipeline(x0, buyer.x, groundLevel, flowing, t, isMine(network));
    });
}

function drawPipeline(x0, x1, groundLevel, flowing, t, mine) {
    const y = groundLevel - STRUCTURE_BASE_OFFSET - 14; // za vrty, před městem
    const dir = Math.sign(x1 - x0) || 1;
    const from = x0 + dir * 22, to = x1 - dir * 14;
    ctx.save();
    ctx.lineCap = 'round';
    // Podpěry po 60 px
    ctx.fillStyle = '#1c1714';
    for (let x = Math.min(from, to) + 20; x < Math.max(from, to); x += 60) {
        ctx.fillRect(x - 1.5, y, 3, 11);
        ctx.fillRect(x - 5, y + 10, 10, 2);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(from, y + 3); ctx.lineTo(to, y + 3); ctx.stroke();
    ctx.strokeStyle = '#17120f';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(to, y); ctx.stroke();
    ctx.strokeStyle = '#8a6a4a';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(from, y - 1.5); ctx.lineTo(to, y - 1.5); ctx.stroke();
    // Objímky
    ctx.strokeStyle = '#2a1f17';
    ctx.lineWidth = 2;
    for (let x = Math.min(from, to) + 10; x < Math.max(from, to); x += 30) {
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
    }
    // Svislé přívody u vrtu a u kupce
    ctx.strokeStyle = '#17120f';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(from, y + STRUCTURE_BASE_OFFSET - 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(to, y); ctx.lineTo(to, y + STRUCTURE_BASE_OFFSET - 10); ctx.stroke();
    if (flowing) { // tekoucí ropa směrem ke kupci
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255, 160, 60, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 12]);
        ctx.lineDashOffset = -dir * (t * 40) % 18;
        ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(to, y); ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.restore();
}

// Vlečka: koleje za silnicí od vrtu k nádraží, po nich pendluje cisternový vagon
function drawSiding(x0, x1, groundLevel, flowing, t, seed) {
    const y = groundLevel - ROAD_DEPTH - 7;
    const from = Math.min(x0 + 30, x1), to = Math.max(x0 + 30, x1);
    ctx.save();
    ctx.fillStyle = '#1a1820'; // pražce
    for (let x = from; x < to; x += 9) ctx.fillRect(x, y - 2, 5, 4);
    ctx.fillStyle = '#6a6f88'; // kolejnice
    ctx.fillRect(from, y - 3, to - from, 1);
    ctx.fillRect(from, y + 1, to - from, 1);
    // Výhybka u vrtu: oblouk z vrtu na trať
    ctx.strokeStyle = '#6a6f88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y + 14);
    ctx.quadraticCurveTo(x0 + 10, y + 2, x0 + 30, y - 1);
    ctx.stroke();
    // Vagon: tam s nákladem, zpátky prázdný; stojí, když není co vozit
    const span = Math.max(60, to - from - 50);
    const phase = flowing ? ((t * 55 + seed * 37) % (span * 2)) : 0;
    const loaded = phase < span;
    const wx = from + 25 + (loaded ? phase : span * 2 - phase);
    const tank = ctx.createLinearGradient(0, y - 18, 0, y - 4);
    tank.addColorStop(0, '#4a4b62');
    tank.addColorStop(1, '#14141c');
    ctx.fillStyle = tank;
    pathRoundRect(wx - 20, y - 18, 40, 12, 6);
    ctx.fill();
    ctx.fillStyle = loaded ? 'rgba(255, 180, 90, 0.7)' : 'rgba(200, 200, 215, 0.4)';
    ctx.font = '700 6px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loaded ? 'CRUDE' : 'EMPTY', wx, y - 12);
    ctx.fillStyle = '#0d0d13';
    [-14, -6, 6, 14].forEach(dx => {
        ctx.beginPath();
        ctx.arc(wx + dx, y - 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

// Cedulka STÁVKA nad stojícím vozem
function drawStrikeTag(x, y) {
    ctx.save();
    ctx.font = '700 9px "Barlow Condensed", system-ui, sans-serif';
    const w = ctx.measureText('STÁVKA').width + 10;
    fillPaper(x - w / 2, y - 7, w, 14, 1.5, Math.sin(x) * 0.05);
    ctx.fillStyle = INK_RED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STÁVKA', x, y + 0.5);
    ctx.restore();
}

// Koňský povoz s cisternovým sudem; phase (ujetá vzdálenost) hýbe nohama koně a koly
function drawOilWagon(x, baseY, facing, color, loadRatio, phase) {
    const step = phase * 0.12;
    ctx.save();
    ctx.translate(x, baseY);
    ctx.scale(facing, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 40, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Kůň: trup, krk s hlavou, čtyři nohy v kroku, ocas
    ctx.strokeStyle = '#120d0a';
    ctx.fillStyle = '#2a1d16';
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
        const hx = 18 + (k % 2) * 3 + (k < 2 ? 0 : 13);
        const swing = Math.sin(step + k * Math.PI / 2) * 3;
        ctx.beginPath();
        ctx.moveTo(hx, -15);
        ctx.lineTo(hx + swing, -1);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(26, -18, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(33, -20);
    ctx.lineTo(39, -30);
    ctx.lineTo(43, -27);
    ctx.lineTo(37, -17);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(15, -19);
    ctx.quadraticCurveTo(10, -16 + Math.sin(step) * 1.5, 11, -10);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170, 190, 255, 0.35)'; // měsíc na hřbetě
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(26, -18, 11, 5, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    // Oj a vůz
    ctx.strokeStyle = '#3a2a1c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, -12);
    ctx.lineTo(20, -16);
    ctx.stroke();
    ctx.fillStyle = '#4a3322';
    ctx.fillRect(-38, -14, 48, 4);
    // Sud: dřevěné dužiny s obručemi, barva kupce v pruhu
    pathRoundRect(-36, -32, 42, 18, 8);
    ctx.fillStyle = '#5a3d26';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-30, -27, 30, 4);
    ctx.fillStyle = '#1a1410';
    [-28, -15, -2].forEach(bx => ctx.fillRect(bx, -32, 2, 18));
    ctx.fillStyle = 'rgba(255, 230, 190, 0.18)';
    ctx.fillRect(-32, -30, 34, 2);
    // Hladina: tmavý pruh na čele sudu
    if (loadRatio > 0) {
        ctx.fillStyle = 'rgba(10, 8, 6, 0.85)';
        ctx.fillRect(-35, -21, 3, 6 * Math.min(1, loadRatio));
    }
    // Kola s loukotěmi
    [-28, 0].forEach(wx => {
        ctx.strokeStyle = '#1a120c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wx, -7, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
            const a = -step * 0.6 + k * Math.PI / 3;
            ctx.beginPath();
            ctx.moveTo(wx + Math.cos(a) * 7, -7 + Math.sin(a) * 7);
            ctx.lineTo(wx - Math.cos(a) * 7, -7 - Math.sin(a) * 7);
            ctx.stroke();
        }
    });
    // Lucerna na voze
    ctx.fillStyle = '#ffd890';
    ctx.fillRect(6, -26, 3, 4);
    ctx.restore();
    drawGlow(x + facing * 7.5, baseY - 24, 14, '255, 180, 90', 0.45);
}

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
        // Na sdílené mapě má každý hráč vozy ve své barvě, jinak podle kupce
        const color = sharedMode ? playerColor(truck.owner) : (TRUCK_COLORS[truck.targetCompany] || '#777777');
        const baseY = getTruckBaseY(truck, groundLevel);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // stín na desce
        ctx.beginPath();
        ctx.ellipse(renderX - 4, baseY + 1, 44, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        const moving = truck.state !== 'waiting_at_rig';
        if ((world?.players[truck.owner]?.strikeMs || 0) > 0) drawStrikeTag(renderX, baseY - 44);
        if (townEra < 2) { // do éry železnice koňský povoz s sudem
            drawOilWagon(renderX, baseY, facing, color, truck.oil / TRUCK_CAPACITY, moving ? truck.x : 0);
        } else {
            drawTankerTruck(renderX, baseY, facing, color, truck.oil / TRUCK_CAPACITY);
            if (moving) drawTruckLights(renderX, baseY, facing);
        }
    });
}

// Spodní hrana kol: pruh na předním pásu desky podle směru jízdy (doprava blíž, doleva dál)
function getTruckBaseY(truck, groundLevel) {
    if (truck.state === 'waiting_at_rig') return groundLevel - 22; // zaparkované u vrtu, projíždějící auta ho překryjí
    return groundLevel - 12 + ((truck.facing || 1) > 0 ? 1 : 0) * 11;
}

// --- Částice ---
function spawnParticle(particle) {
    if (!prefs.life && Math.random() < 0.6) return; // úsporný život: zhruba třetina kouře a páry
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
    if (!prefs.sound || !SOUNDS[kind]) return;
    if (kind === 'sale') {
        const now = performance.now();
        if (now - lastSaleSoundAt < SALE_SOUND_GAP_MS) return;
        lastSaleSoundAt = now;
    }
    try {
        const ac = getAudioContext();
        if (!ac) return;
        const out = ac.createGain();
        out.gain.value = prefs.volume;
        out.connect(ac.destination);
        SOUNDS[kind](ac, out, ac.currentTime + 0.005);
    } catch (e) {
        // Zvuk je jen bonus: bez AudioContextu hra funguje dál
    }
}

function toggleSound() {
    setPref('sound', !prefs.sound);
}

function updateSoundButton() {
    const btn = document.getElementById('sound-btn');
    if (!btn) return;
    btn.innerHTML = iconSvg(prefs.sound ? 'soundOn' : 'soundOff');
    btn.classList.toggle('muted', !prefs.sound);
}
