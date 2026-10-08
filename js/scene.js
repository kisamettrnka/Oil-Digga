// Scéna: život ve městě a na nebi, kamera, herní smyčka a draw(), dioráma (deska, město, vrstvy, terén claimů).
// Součást hry Oil digga: klasický skript sdílející globální rozsah s ostatními soubory v js/.
// Pořadí načítání určuje index.html; tento soubor předpokládá sim.js a net.js před sebou.

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

    if (prefs.life && ambientClock >= nextFireworkAt) { // občas někdo ve městě slaví
        const groundLevel = getGroundLevel();
        launchFirework(120 + Math.random() * (VIEW_W - 240), getSlabBackY(groundLevel) + 40);
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
    if (!prefs.life) { // úsporný život: prázdná obloha, jen ohňostroje z erupcí
        blimpHitRect = null;
        drawFireworks();
        return;
    }
    const t = ambientClock;
    const backY = getSlabBackY(groundLevel);

    // Padající hvězda
    const starCycle = Math.floor((t + 3) / 7);
    const starPhase = ((t + 3) % 7) / 0.7;
    if (starPhase < 1) {
        const sx = 200 + (starCycle * 397) % (VIEW_W - 400);
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

    // Nebe podle éry: v táboře horkovzdušný balon, vzducholoď od Železnice, dvouplošník od Automobilu
    blimpHitRect = null;
    if (townEra >= 2) {
        // Reklamní vzducholoď s vlečným transparentem a světlometem na město
        const blimp = flightProgress(90, 70, 20);
        if (blimp === null) blimpAd = undefined;
        else {
            if (blimpAd === undefined) blimpAd = pickAd(); // jedna reklama na celý přelet
            drawBlimp(-160 + blimp * (VIEW_W + 460), backY - 62 + Math.sin(t * 0.6) * 4, groundLevel);
        }
    } else {
        blimpAd = undefined;
        const balloon = flightProgress(80, 60, 12);
        if (balloon !== null) drawBalloon(-80 + balloon * (VIEW_W + 200), backY - 90 + Math.sin(t * 0.5) * 10, t);
    }

    // Netopýři
    const bats = flightProgress(34, 16, 5);
    if (bats !== null) {
        for (let i = 0; i < 7; i++) {
            const x = VIEW_W + 60 - bats * (VIEW_W + 200) + (i % 4) * 26 + Math.sin(t * 2 + i) * 8;
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

    // Dvouplošník s navigačními světly a kouřovou stopou (až v automobilové éře)
    const plane = townEra >= 3 ? flightProgress(27, 11, 0) : null;
    if (plane !== null) drawBiplane(VIEW_W + 80 - plane * (VIEW_W + 160), 58 + Math.sin(t * 1.4) * 8, -1);

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

    if (blimpAd) {
        const w = drawBlimpBanner(x - 80, y + 2, t, blimpAd);
        blimpHitRect = { x: x - 80 - w - 30, y: y - 26, width: w + 30 + 80 + 76, height: 56 };
    }
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

// Reklamy z ads.js: náhodná reklama s transparentem, jinak null (jediné místo je vzducholoď)
function adsAvailable() {
    const config = typeof OIL_ADS !== 'undefined' ? OIL_ADS : null;
    return !!config?.enabled;
}
function pickAd() {
    if (!prefs.ads || !adsAvailable()) return null;
    const ads = (OIL_ADS.ads || []).filter(ad => ad.url && ad.banner);
    return ads.length ? ads[Math.floor(Math.random() * ads.length)] : null;
}
function openAdLink(url) {
    if (typeof Net !== 'undefined' && Net.openLink) Net.openLink(url);
    else window.open(url, '_blank', 'noopener');
}
// Plátěný transparent na lanech za ocasem, vlní se ve větru a nasvěcují ho lampy na spodní hraně
// Vrací šířku plátna, ať zásah myší sedí i na delší nebo kratší text
function drawBlimpBanner(ax, ay, t, ad) {
    const parts = ad.banner;
    const text = parts.join('');
    ctx.font = '700 16px "Barlow Condensed", system-ui, sans-serif';
    const w = Math.max(120, ctx.measureText(text).width + 68), h = 26, segs = 28;
    const x0 = ax - 24; // přední (pravý) okraj plátna
    const wave = u => Math.sin(t * 3.2 - u * 7) * 4 * (0.2 + u);
    ctx.strokeStyle = 'rgba(16, 14, 22, 0.9)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(ax, ay - 2);
    ctx.lineTo(x0, ay - h / 2 + wave(0));
    ctx.moveTo(ax, ay - 2);
    ctx.lineTo(x0, ay + h / 2 + wave(0));
    ctx.stroke();

    const at = i => {
        const u = i / segs;
        return { x: x0 - u * w, dy: wave(u) };
    };
    const clothPath = () => {
        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
            const p = at(i);
            if (i) ctx.lineTo(p.x, ay - h / 2 + p.dy); else ctx.moveTo(p.x, ay - h / 2 + p.dy);
        }
        for (let i = segs; i >= 0; i--) {
            const p = at(i);
            ctx.lineTo(p.x, ay + h / 2 + p.dy);
        }
        ctx.closePath();
    };
    clothPath();
    const cloth = ctx.createLinearGradient(0, ay - h / 2, 0, ay + h / 2);
    cloth.addColorStop(0, PAPER_TOP);
    cloth.addColorStop(1, PAPER_BOTTOM);
    ctx.fillStyle = cloth;
    ctx.fill();
    // Záhyby: svah vlny ve stínu, protisvah chytá měsíc
    for (let i = 0; i < segs; i++) {
        const a = at(i), b = at(i + 1);
        const slope = b.dy - a.dy;
        ctx.fillStyle = slope > 0
            ? `rgba(20, 12, 6, ${Math.min(0.35, slope * 0.16)})`
            : `rgba(200, 215, 255, ${Math.min(0.2, -slope * 0.08)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, ay - h / 2 + a.dy);
        ctx.lineTo(b.x, ay - h / 2 + b.dy);
        ctx.lineTo(b.x, ay + h / 2 + b.dy);
        ctx.lineTo(a.x, ay + h / 2 + a.dy);
        ctx.closePath();
        ctx.fill();
    }
    // Lampy na spodní liště svítí na plátno zespodu (světlo oříznuté plátnem)
    const lamps = [0.15, 0.5, 0.85].map(u => ({ x: x0 - u * w, y: ay + h / 2 + wave(u) }));
    ctx.save();
    clothPath();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lamps) {
        const g = ctx.createRadialGradient(l.x, l.y + 2, 0, l.x, l.y + 2, 52);
        g.addColorStop(0, 'rgba(255, 205, 130, 0.5)');
        g.addColorStop(0.5, 'rgba(255, 190, 110, 0.18)');
        g.addColorStop(1, 'rgba(255, 180, 100, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(l.x - 52, l.y - 60, 104, 64);
    }
    ctx.restore();
    clothPath();
    ctx.strokeStyle = 'rgba(40, 28, 16, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Písmena po jednom, aby sledovala vlnu
    ctx.font = '700 16px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let cx = x0 - w / 2 - ctx.measureText(text).width / 2;
    for (let i = 0; i < text.length; i++) {
        const cw = ctx.measureText(text[i]).width;
        ctx.fillStyle = i < parts[0].length ? INK : INK_RED;
        ctx.fillText(text[i], cx, ay + 1 + wave((x0 - cx - cw / 2) / w));
        cx += cw;
    }
    // Šňůra s lampami kopíruje spodní okraj plátna, na kterém visí
    ctx.strokeStyle = '#15151f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
        const p = at(i);
        if (i) ctx.lineTo(p.x, ay + h / 2 + 3 + p.dy); else ctx.moveTo(p.x, ay + h / 2 + 3 + p.dy);
    }
    ctx.stroke();
    for (const l of lamps) {
        ctx.fillStyle = '#ffe2a8';
        ctx.fillRect(l.x - 1.5, l.y + 2, 3, 3);
        drawGlow(l.x, l.y + 3, 9, '255, 190, 110', 0.7);
    }
    return w;
}

// Horkovzdušný balon s hořákem, který občas šlehne a prosvítí obal
function drawBalloon(x, y, t) {
    const burn = Math.sin(t * 1.3) > 0.7;
    ctx.save();
    const r = 26;
    const skin = ctx.createRadialGradient(x - 6, y - 8, 4, x, y, r);
    skin.addColorStop(0, burn ? '#b86a3a' : '#4a3038');
    skin.addColorStop(0.6, burn ? '#6e3d33' : '#2f2230');
    skin.addColorStop(1, '#1a1420');
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'; // svislé pruhy
    ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.ellipse(x, y, Math.abs(k) * r / 2.6 + 0.1, r * 1.15, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(200, 210, 250, 0.45)'; // měsíc na boku
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.15, 0, Math.PI * 1.15, Math.PI * 1.6);
    ctx.stroke();
    ctx.strokeStyle = '#2a1c12'; // lana a koš
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 12, y + r);
    ctx.lineTo(x - 5, y + r + 22);
    ctx.moveTo(x + 12, y + r);
    ctx.lineTo(x + 5, y + r + 22);
    ctx.stroke();
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(x - 7, y + r + 22, 14, 8);
    if (burn) drawGlow(x, y + r + 10, 22, '255, 170, 70', 0.7);
    else drawGlow(x, y + r + 12, 8, '255, 170, 70', 0.5);
    ctx.restore();
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
// Malý povoz na ulici města (zmenšený cisternový povoz bez nákladu)
function drawTownCart(x, y, s, dir, phase) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * 0.42, s * 0.42);
    drawOilWagon(0, 0, dir, '#4a3a2a', 0, phase);
    ctx.restore();
}

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
    if (!prefs.life) return;
    const t = ambientClock;
    const L = getTownLayout(groundLevel);
    const s = L.streetScale;
    const span = VIEW_W + 60;

    // Provoz podle éry: v táboře jeden povoz, pak víc povozů, v automobilové éře auta
    const vehicles = [1, 2, 2, 3][townEra];
    [{ y: L.streetY - 3 * s, dir: -1, speed: 46 }, { y: L.streetY + 4 * s, dir: 1, speed: 38 }].forEach((lane, li) => {
        for (let i = 0; i < vehicles; i++) {
            const speed = townEra >= 3 ? lane.speed : lane.speed * 0.45;
            const x = wrapX(i * span / vehicles + li * 170 + lane.dir * t * speed * s, span);
            if (townEra >= 3) drawTownCar(x, lane.y, s, lane.dir, TOWN_CAR_COLORS[(i * 2 + li) % TOWN_CAR_COLORS.length]);
            else drawTownCart(x, lane.y, s, lane.dir, t * speed * 4 + i);
        }
    });

    const walkers = [4, 6, 9, 11][townEra];
    [{ y: L.sidewalkNorth, dir: -1, count: walkers }, { y: L.sidewalkSouth, dir: 1, count: walkers }].forEach((walk, wi) => {
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
    ctx.drawImage(getTownFrontCache(), 0, 0, VIEW_W, VIEW_H);
    if (!prefs.life) return;
    const t = ambientClock;
    const L = getTownLayout(groundLevel);
    const s = slabScaleAt(L.promenadeY, groundLevel);
    const span = VIEW_W + 60;
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
    const maxX = VIEW_W - VIEW_W / camera.tzoom;
    const maxY = VIEW_H - VIEW_H / camera.tzoom;
    camera.tx = Math.max(0, Math.min(maxX, camera.tx));
    camera.ty = Math.max(0, Math.min(maxY, camera.ty));
    if (alsoCurrent) {
        camera.x = Math.max(0, Math.min(VIEW_W - VIEW_W / camera.zoom, camera.x));
        camera.y = Math.max(0, Math.min(VIEW_H - VIEW_H / camera.zoom, camera.y));
    }
}

// Přiblíží kolem bodu (px, py) v pixelech plátna, bod pod kurzorem zůstane na místě
function zoomCameraAt(px, py, factor) {
    cameraTouched();
    const worldX = camera.tx + px / camera.tzoom;
    const worldY = camera.ty + py / camera.tzoom;
    camera.tzoom = Math.max(1, Math.min(CAMERA_MAX_ZOOM, camera.tzoom * factor));
    camera.tx = worldX - px / camera.tzoom;
    camera.ty = worldY - py / camera.tzoom;
    clampCamera();
}

function resetCamera(instant = false) {
    cameraFocus = null;
    camera.tx = camera.ty = 0;
    camera.tzoom = 1;
    if (instant) {
        camera.x = camera.y = 0;
        camera.zoom = 1;
        camera.shake = 0;
    }
}

// Nouze na vrtu: kamera na něj najede a po chvíli se vrátí, pokud hráč mezitím kamerou nehnul
const FOCUS_ZOOM = 1.7;
const FOCUS_HOLD_MS = 7000;
let cameraFocus = null; // { until, back: { tx, ty, tzoom } }

function focusCameraOn(x, y) {
    if (!prefs.focus || mapOpen || dragState) return;
    if (!cameraFocus) cameraFocus = { back: { tx: camera.tx, ty: camera.ty, tzoom: camera.tzoom } };
    cameraFocus.until = performance.now() + FOCUS_HOLD_MS;
    camera.tzoom = Math.max(camera.tzoom, FOCUS_ZOOM);
    camera.tx = x - VIEW_W / (2 * camera.tzoom);
    camera.ty = y - VIEW_H / (2 * camera.tzoom);
    clampCamera();
}

function focusCameraOnPlot(plotId) {
    const plot = plots.find(p => p.id === plotId);
    if (plot) focusCameraOn(plot.x + plot.width / 2, getGroundLevel() - STRUCTURE_BASE_OFFSET - DERRICK_HEIGHT / 2);
}

// Hráč sáhl na kameru: nouzový nájezd se už nevrací sám
function cameraTouched() {
    cameraFocus = null;
}

function shakeCamera(strength) {
    if (!prefs.shake) return;
    camera.shake = Math.max(camera.shake, strength);
}

function updateCamera(frameMs) {
    const k = 1 - Math.exp(-frameMs / 90);
    camera.zoom += (camera.tzoom - camera.zoom) * k;
    camera.x += (camera.tx - camera.x) * k;
    camera.y += (camera.ty - camera.y) * k;
    if (Math.abs(camera.tzoom - camera.zoom) < 0.001) camera.zoom = camera.tzoom;
    if (cameraFocus && performance.now() > cameraFocus.until) { // nouze pominula: zpátky, odkud kamera přijela
        Object.assign(camera, cameraFocus.back);
        cameraFocus = null;
        clampCamera();
    }
    clampCamera(true);
    camera.shake *= Math.exp(-frameMs / 120);
    if (camera.shake < 0.2) camera.shake = 0;
}

function applyCameraTransform() {
    const sx = camera.shake ? (Math.random() - 0.5) * camera.shake : 0;
    const sy = camera.shake ? (Math.random() - 0.5) * camera.shake : 0;
    const z = camera.zoom;
    ctx.setTransform(z * viewScale, 0, 0, z * viewScale, (-camera.x * z + sx) * viewScale, (-camera.y * z + sy) * viewScale);
}

function handleCameraKey(event) {
    const step = CAMERA_KEY_STEP / camera.tzoom;
    switch (event.key) {
        case 'ArrowLeft': case 'a': case 'A': camera.tx -= step; break;
        case 'ArrowRight': case 'd': case 'D': camera.tx += step; break;
        case 'ArrowUp': case 'w': case 'W': camera.ty -= step; break;
        case 'ArrowDown': case 's': case 'S': camera.ty += step; break;
        case '+': case '=': zoomCameraAt(VIEW_W / 2, VIEW_H / 2, 1.25); return;
        case '-': case '_': zoomCameraAt(VIEW_W / 2, VIEW_H / 2, 1 / 1.25); return;
        case '0': resetCamera(); return;
        default: return;
    }
    cameraTouched();
    event.preventDefault();
    clampCamera();
}

// --- Herní smyčka a kreslení ---

let lastFrameTime = 0;

// Výkon: při pauze a otevřené mapě se kreslí jen 10× za sekundu; čas snímku se měří a když
// kreslení dlouhodobě nestíhá, sníží se rozlišení plátna (perfCap), při rezervě zase zvedne
const IDLE_DRAW_MS = 100;
const FRAME_SLOW_MS = 24;       // pod ~40 fps
const FRAME_FAST_MS = 9;
let lastDrawAt = 0;
const UI_INTERVAL_MS = 250;
let lastUiAt = 0;
let uiDirty = true;
let frameAvg = 8;               // klouzavý průměr času kreslení
let frameJudgeAt = 0;
let perfCap = 2;

function judgePerformance(timestamp, drawMs) {
    frameAvg += (drawMs - frameAvg) * 0.05;
    if (timestamp - frameJudgeAt < 3000) return;
    frameJudgeAt = timestamp;
    if (frameAvg > FRAME_SLOW_MS && perfCap > 0.75) {
        perfCap = perfCap > 1.5 ? 1.5 : perfCap > 1 ? 1 : 0.75;
        resizeCanvasBacking(true);
    } else if (frameAvg < FRAME_FAST_MS && perfCap < 2) {
        perfCap = perfCap < 1 ? 1 : perfCap < 1.5 ? 1.5 : 2;
        resizeCanvasBacking(true);
    }
}

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

    const idle = isPaused || mapOpen;
    if (!idle || timestamp - lastDrawAt >= IDLE_DRAW_MS) {
        lastDrawAt = timestamp;
        const t0 = performance.now();
        if (isGameOver) drawGameOver();
        else draw();
        if (!idle) judgePerformance(timestamp, performance.now() - t0);
    }
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
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    applyCameraTransform();
    drawFarLayer(groundLevel);
    drawSkyAndGround(groundLevel);
    drawSkyLife(groundLevel);
    drawTownLife(groundLevel);
    drawTownFront(groundLevel);

    // Kreslení herních prvků (podzemí, pak deska odzadu dopředu)
    drawOilPockets(groundLevel);
    drawHazards();
    drawToolEffects(groundLevel);
    drawPipeNetworks();
    drawPlots(groundLevel);

    const structureY = groundLevel - STRUCTURE_BASE_OFFSET;
    drawTransportLinks(groundLevel);
    plots.forEach(plot => {
        const centerX = plot.x + plot.width / 2;
        const network = pipeNetworks.find(n => n.derrickId === plot.id);
        drawSpill(plot, groundLevel);
        if (plot.hasVrt) {
            // Zavřený preventer: plyn se pálí na fléře vedle věže
            if (network && network.drillState === 'shut') drawFlare(centerX - 34, structureY, 46);
            const working = network ? network.isPumping || (network.pocket < 0 && network.drillState === 'drilling' && !network.stalled) : false;
            drawDerrick(centerX, structureY, plot.id, working, network);
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
        if (plot.hasVrt && network && isMine(plot)) drawStorageChip(plot.x + plot.width / 2, structureY - DERRICK_HEIGHT - 26, network);
    });

    // Kreslení dočasných efektů a náhledů
    drawEffectsAndPreviews(groundLevel);
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.drawImage(getVignette(), 0, 0, VIEW_W, VIEW_H);

    // Mapa průzkumu se překresluje, dokud je otevřená (ceny, vrták, nové nálezy)
    if (mapOpen && performance.now() - mapLastPaint > 400) paintSurveyMap();

    // HTML HUD stačí 4× za sekundu, nebo hned po akci či události (uiDirty)
    const now = performance.now();
    if (uiDirty || now - lastUiAt >= UI_INTERVAL_MS) {
        lastUiAt = now;
        uiDirty = false;
        updateUI();
    }

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
    const oilPerSecond = pumpingRigs.reduce((sum, n) => sum + OilSim.wellRate(world, n), 0);
    setText('stat-oil-rate', formatRate(oilPerSecond * MS_PER_DAY / 1000));
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
    renderRigPanel();
    renderContracts();
    renderPlayersPanel();
    renderGuide();
    const perkCount = document.getElementById('perks-count');
    if (perkCount && world) perkCount.textContent = `${Object.keys(world.players[myId]?.perks || {}).length}/${Object.keys(OilSim.PERKS).length}`;
    if (perksOpen) renderPerks();

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
            const labelEl = item.el.querySelector('.label');
            if (labelEl) labelEl.textContent = townEra < 2 ? 'Povoz' : 'Kamion';
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
    return VIEW_W / 2 + (x - VIEW_W / 2) * slabScaleAt(y, groundLevel);
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

// Pixely plátna podle velikosti na obrazovce a hustoty displeje (nejvýš 2×); při změně se
// vrstvy překreslí, aby byly stejně ostré
function resizeCanvasBacking(force = false) {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.min(rect.width, rect.height * VIEW_W / VIEW_H) || VIEW_W;
    const scale = Math.max(0.4, Math.min(perfCap, cssW * dpr / VIEW_W));
    if (!force && canvas.width && Math.abs(scale - viewScale) < 0.02) return;
    viewScale = scale;
    canvas.width = Math.round(VIEW_W * scale);
    canvas.height = Math.round(VIEW_H * scale);
    sceneCache = farCache = vignetteCache = strataCache = claimsCache = townFrontCache = null;
}

function createLayer() {
    const layer = document.createElement('canvas');
    layer.width = Math.round(VIEW_W * viewScale);
    layer.height = Math.round(VIEW_H * viewScale);
    return layer;
}

// Kreslí do vrstvy stejnými funkcemi jako do plátna (dočasně podvrhne globální ctx)
function paintLayer(layer, painter) {
    const mainCtx = ctx;
    ctx = layer.getContext('2d');
    try {
        ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
        painter();
    } finally {
        ctx = mainCtx;
    }
    return layer;
}

let sceneCacheEra = -1;

function getSceneCache() {
    // Město se s érou přestavuje: nová éra = nové pozadí (jednou, pak zase z cache)
    if (sceneCache && sceneCacheEra !== townEra) sceneCache = null;
    if (!sceneCache) {
        sceneCacheEra = townEra;
        const groundLevel = getGroundLevel();
        sceneChimneys = [];
        sceneCache = paintLayer(createLayer(), () => {
            const rand = seededRandom(1859); // rok prvního ropného vrtu
            drawSlab(groundLevel, rand);
            drawTown(groundLevel, rand, townEra);
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
        farCache.width = Math.round((VIEW_W + FAR_PAD * 2) * viewScale);
        farCache.height = Math.round((getSlabBackY(groundLevel) + 20) * viewScale);
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
    const tiltX = (pointerScreen.x / VIEW_W - 0.5) * -24;
    const tiltY = (pointerScreen.y / VIEW_H) * -8;
    const far = getFarCache();
    ctx.drawImage(far, -FAR_PAD + camera.x * 0.45 + tiltX, camera.y * 0.35 + tiltY, far.width / viewScale, far.height / viewScale);
}

function getVignette() {
    if (!vignetteCache) {
        vignetteCache = paintLayer(createLayer(), () => {
            const w = VIEW_W, h = VIEW_H;
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
    ctx.drawImage(getSceneCache(), 0, 0, VIEW_W, VIEW_H);
    const claims = getClaimsCache();
    if (claims) ctx.drawImage(claims, 0, 0, VIEW_W, VIEW_H);
    const strata = getStrataCache();
    if (strata) ctx.drawImage(strata, 0, 0, VIEW_W, VIEW_H);
}

// --- Terén claimů na desce: kopec, řeka s mostkem, balvany (statické, vlastní vrstva) ---
let claimsCache = null;
let claimsKey = '';

function claimsStateKey() {
    return plots.map(p => `${p.id}:${p.terrain}:${Math.round(p.x)}:${Math.round(p.width)}`).join();
}

function getClaimsCache() {
    if (!plots.length) return null;
    const key = claimsStateKey();
    if (key !== claimsKey || !claimsCache) {
        claimsKey = key;
        claimsCache = paintLayer(claimsCache || createLayer(), () => {
            ctx.clearRect(0, 0, VIEW_W, VIEW_H);
            const groundLevel = getGroundLevel();
            plots.forEach(plot => drawClaimTerrain(plot, groundLevel, seededRandom(977 + plot.id * 31)));
        });
    }
    return claimsCache;
}

function drawClaimTerrain(plot, groundLevel, rand) {
    const frontY = groundLevel - ROAD_DEPTH - 4;
    const backY = getTownLayout(groundLevel).promenadeY + 10;
    const cx = plot.x + plot.width / 2;
    switch (plot.terrain) {
        case 'hill': drawHill(cx, frontY, backY, plot.width, groundLevel, rand); break;
        case 'river': drawRiver(cx + (rand() - 0.5) * plot.width * 0.3, frontY, backY, groundLevel, rand); break;
        case 'rock': drawOutcrop(plot, frontY, backY, groundLevel, rand); break;
    }
}

// Kopec: měkký pahorek s vrstevnicemi, měsíc osvětluje jednu stranu
function drawHill(cx, frontY, backY, width, groundLevel, rand) {
    const y = backY + (frontY - backY) * (0.45 + rand() * 0.2);
    const s = slabScaleAt(y, groundLevel);
    const rx = Math.min(width * 0.44, 96) * s, ry = 34 * s;
    const lit = Math.sign(MOON_X - cx) || 1;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 10, 0.28)'; // stín na odvrácené straně
    ctx.beginPath();
    ctx.ellipse(cx - lit * 8 * s, y + 6 * s, rx * 1.05, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    const mound = ctx.createRadialGradient(cx + lit * rx * 0.35, y - ry * 0.5, 2, cx, y, rx);
    mound.addColorStop(0, '#8d7d82');
    mound.addColorStop(0.55, '#5c5064');
    mound.addColorStop(1, '#3a3346');
    ctx.fillStyle = mound;
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 210, 245, 0.26)'; // vrstevnice
    ctx.lineWidth = 1;
    [0.78, 0.52, 0.26].forEach((f, i) => {
        ctx.beginPath();
        ctx.ellipse(cx + lit * (1 - f) * 6 * s, y - (1 - f) * ry * 0.5, rx * f, ry * f, 0, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(210, 220, 255, 0.7)'; // měsíční hrana
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, lit > 0 ? -Math.PI * 0.95 : -Math.PI * 0.55, lit > 0 ? -Math.PI * 0.55 : -Math.PI * 0.05);
    ctx.stroke();
    for (let i = 0; i < 6; i++) { // keře
        const a = rand() * Math.PI * 2, r = rand() * 0.8;
        ctx.fillStyle = 'rgba(20, 30, 22, 0.75)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r, (2 + rand() * 2) * s, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Řeka: tmavá stuha odzadu k silnici, pod silnicí propustek a dřevěný mostek
function drawRiver(x, frontY, backY, groundLevel, rand) {
    const pts = [];
    for (let y = backY; y <= groundLevel + 1; y += 10) {
        const s = slabScaleAt(y, groundLevel);
        pts.push({ y, x: slabXAt(x + Math.sin(y * 0.05 + rand() * 0.2) * 14, y, groundLevel), half: 7 * s });
    }
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x - p.half, p.y) : ctx.moveTo(p.x - p.half, p.y)));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x + pts[i].half, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 10, 24, 0.9)'; // koryto
    ctx.fill();
    ctx.clip();
    const water = ctx.createLinearGradient(0, backY, 0, groundLevel);
    water.addColorStop(0, 'rgba(60, 90, 140, 0.55)');
    water.addColorStop(1, 'rgba(90, 130, 190, 0.7)');
    ctx.fillStyle = water;
    ctx.fillRect(0, backY, VIEW_W, groundLevel - backY + 2);
    ctx.strokeStyle = 'rgba(200, 220, 255, 0.35)'; // odlesky měsíce
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
        const p = pts[Math.floor(rand() * pts.length)];
        ctx.beginPath();
        ctx.moveTo(p.x - p.half * 0.6 + rand() * p.half, p.y);
        ctx.lineTo(p.x - p.half * 0.6 + rand() * p.half + 4, p.y);
        ctx.stroke();
    }
    ctx.restore();
    // Břehy
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x - p.half - 1, p.y) : ctx.moveTo(p.x - p.half - 1, p.y)));
    ctx.stroke();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x + p.half + 1, p.y) : ctx.moveTo(p.x + p.half + 1, p.y)));
    ctx.stroke();
    // Mostek přes silnici: prkna přes celý pás silnice, zábradlí
    const roadTop = groundLevel - ROAD_DEPTH;
    const bx = slabXAt(x, roadTop + ROAD_DEPTH / 2, groundLevel);
    ctx.fillStyle = '#3b2a1c';
    ctx.fillRect(bx - 16, roadTop - 1, 32, ROAD_DEPTH + 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let y = roadTop + 2; y < groundLevel; y += 4) ctx.fillRect(bx - 16, y, 32, 1);
    ctx.fillStyle = '#2a1c12';
    ctx.fillRect(bx - 17, roadTop - 6, 2, ROAD_DEPTH + 6);
    ctx.fillRect(bx + 15, roadTop - 6, 2, ROAD_DEPTH + 6);
    ctx.fillStyle = 'rgba(200, 210, 250, 0.4)';
    ctx.fillRect(bx - 17, roadTop - 6, 34, 1);
    // Řeka pokračuje pod hranou řezu jako pramínek do skály
    ctx.fillStyle = 'rgba(90, 130, 190, 0.5)';
    ctx.fillRect(slabXAt(x, groundLevel, groundLevel) - 3, groundLevel, 6, LIP_HEIGHT * 0.8);
}

// Skalnatý claim: balvany na povrchu, pod ním je žula (kreslí drawStrata)
function drawOutcrop(plot, frontY, backY, groundLevel, rand) {
    for (let i = 0; i < 6 + Math.floor(rand() * 4); i++) {
        const y = backY + rand() * (frontY - backY);
        const s = slabScaleAt(y, groundLevel);
        const x = slabXAt(plot.x + 14 + rand() * (plot.width - 28), y, groundLevel);
        const r = (6 + rand() * 9) * s;
        const lit = Math.sign(MOON_X - x) || 1;
        ctx.fillStyle = 'rgba(0, 0, 10, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x - lit * 3, y + 2, r * 1.1, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        const n = 5 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
            const a = Math.PI + (k / n) * Math.PI * 2;
            const rr = r * (0.75 + rand() * 0.3);
            const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.65 - r * 0.2;
            if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
        const rock = ctx.createLinearGradient(x - lit * r, 0, x + lit * r, 0);
        rock.addColorStop(0, '#2f2730');
        rock.addColorStop(1, '#7a7488');
        ctx.fillStyle = rock;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// --- Vrstvy hornin jako geologický řez: šrafy podle horniny (mění se s mapou, proto vlastní vrstva) ---
const ROCK_LOOK = {
    clay: { tint: '122, 74, 50', ink: '235, 190, 160' },
    sand: { tint: '160, 128, 80', ink: '240, 215, 165' },
    shale: { tint: '62, 68, 80', ink: '190, 200, 220' },
    lime: { tint: '138, 138, 120', ink: '230, 228, 205' },
    granite: { tint: '90, 58, 72', ink: '235, 200, 215' }
};
let strataCache = null;
let strataKey = '';

function getStrataCache() {
    const strata = world?.strata;
    if (!strata) return null;
    // Na sdílené mapě přichází svět znovu s každou zprávou: klíč z obsahu, ne z reference
    const key = strata.layers.join() + strata.bounds.map(b => b.y.toFixed(1) + b.phase.toFixed(2)).join() + '|' + claimsStateKey();
    if (key !== strataKey || !strataCache) {
        strataKey = key;
        strataCache = paintLayer(strataCache || createLayer(), () => {
            ctx.clearRect(0, 0, VIEW_W, VIEW_H);
            drawStrata(strata, getGroundLevel());
        });
    }
    return strataCache;
}

// Hranice vrstvy jako lomená čára (po 10 px)
function strataCurve(bound, fallbackY) {
    const pts = [];
    for (let x = 0; x <= VIEW_W; x += 10) pts.push({ x, y: bound ? OilSim.strataBoundaryY(bound, x) : fallbackY });
    return pts;
}

function drawStrata(strata, groundLevel) {
    const topY = groundLevel + LIP_HEIGHT * 1.5; // skalní hrana pod deskou zůstává vidět
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topY, VIEW_W, VIEW_H - topY);
    ctx.clip();
    strata.layers.forEach((kind, i) => {
        const upper = strataCurve(strata.bounds[i - 1], groundLevel);
        const lower = strataCurve(strata.bounds[i], VIEW_H);
        ctx.save();
        ctx.beginPath();
        upper.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        for (let k = lower.length - 1; k >= 0; k--) ctx.lineTo(lower[k].x, lower[k].y);
        ctx.closePath();
        const look = ROCK_LOOK[kind] || ROCK_LOOK.sand;
        ctx.fillStyle = `rgba(${look.tint}, 0.16)`;
        ctx.fill();
        ctx.clip();
        const top = Math.min(...upper.map(p => p.y));
        const bottom = Math.max(...lower.map(p => p.y));
        drawRockHatch(kind, top, bottom, look.ink, seededRandom(31 + i * 7));
        ctx.restore();
        // Název vrstvy u levého okraje, jako popisek v geologickém řezu
        const midY = (upper[2].y + lower[2].y) / 2;
        if (midY > topY + 8 && midY < VIEW_H - 150) {
            ctx.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgba(${look.ink}, 0.42)`;
            ctx.fillText(OilSim.ROCKS[kind].name.toUpperCase(), 12, midY);
        }
    });
    // Žulové čepice skalnatých claimů hned pod povrchem
    plots.filter(p => p.terrain === 'rock').forEach(plot => {
        const bottom = groundLevel + plot.rockDepth;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(plot.x, topY - 10);
        ctx.lineTo(plot.x + plot.width, topY - 10);
        for (let x = plot.x + plot.width; x >= plot.x; x -= 12) ctx.lineTo(x, bottom + Math.sin(x * 0.07 + plot.id) * 5);
        ctx.closePath();
        const look = ROCK_LOOK.granite;
        ctx.fillStyle = `rgba(${look.tint}, 0.34)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${look.ink}, 0.35)`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.clip();
        drawRockHatch('granite', topY, bottom + 6, look.ink, seededRandom(500 + plot.id));
        ctx.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(${look.ink}, 0.5)`;
        ctx.fillText('ŽULA', plot.x + plot.width / 2, topY + (bottom - topY) / 2);
        ctx.restore();
    });

    // Hranice vrstev: tenká čárkovaná linka
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(235, 215, 175, 0.22)';
    strata.bounds.forEach(bound => {
        const pts = strataCurve(bound);
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
}

// Šrafa horniny: jíl čárky, pískovec tečky, břidlice linky, vápenec cihly, žula křížky
function drawRockHatch(kind, top, bottom, ink, rand) {
    const w = VIEW_W;
    ctx.strokeStyle = `rgba(${ink}, 0.13)`;
    ctx.fillStyle = `rgba(${ink}, 0.16)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    switch (kind) {
        case 'clay':
            for (let y = top + 6, row = 0; y < bottom; y += 11, row++) {
                for (let x = (row % 2) * 12; x < w; x += 24) {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + 10, y);
                }
            }
            ctx.stroke();
            break;
        case 'sand':
            for (let y = top + 3; y < bottom; y += 7) {
                for (let x = rand() * 7; x < w; x += 7 + rand() * 6) ctx.rect(x, y + rand() * 3, 1.3, 1.3);
            }
            ctx.fill();
            break;
        case 'shale':
            for (let y = top + 4; y < bottom; y += 6) {
                ctx.moveTo(0, y);
                for (let x = 0; x <= w; x += 80) ctx.lineTo(x, y + Math.sin(x * 0.02 + y) * 1.2);
            }
            ctx.stroke();
            break;
        case 'lime':
            for (let y = top, row = 0; y < bottom; y += 14, row++) {
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                for (let x = (row % 2) * 18; x < w; x += 36) {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, y + 14);
                }
            }
            ctx.stroke();
            break;
        case 'granite':
            ctx.strokeStyle = `rgba(${ink}, 0.2)`;
            for (let y = top + 6; y < bottom; y += 15) {
                for (let x = rand() * 15; x < w; x += 15 + rand() * 10) {
                    const yy = y + (rand() - 0.5) * 6;
                    const r = 2.5;
                    if (rand() < 0.5) {
                        ctx.moveTo(x - r, yy); ctx.lineTo(x + r, yy);
                        ctx.moveTo(x, yy - r); ctx.lineTo(x, yy + r);
                    } else {
                        ctx.moveTo(x - r, yy - r); ctx.lineTo(x + r, yy + r);
                        ctx.moveTo(x + r, yy - r); ctx.lineTo(x - r, yy + r);
                    }
                }
            }
            ctx.stroke();
            break;
    }
}

// Rizika v hornině, která hráč zná: plyn (žlutozelený) a voda (modrá), vyhořelý plyn jen jizva
function drawHazards() {
    const t = performance.now() / 1000;
    hazards.forEach(h => {
        if (!h.visible && !DEV) return;
        ctx.save();
        const gas = h.kind === 'gas';
        const color = gas ? '205, 225, 120' : '120, 180, 255';
        const alpha = h.spent ? 0.3 : 0.85;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${h.spent ? 0.04 : 0.12})`;
        ctx.fill();
        ctx.setLineDash(gas ? [3, 4] : [8, 4]);
        ctx.lineDashOffset = gas && !h.spent ? -t * 8 : 0;
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.clip();
        if (gas && !h.spent) { // bublinky plynu
            for (let b = 0; b < 5; b++) {
                const life = (t * 0.5 + b / 5) % 1;
                ctx.beginPath();
                ctx.arc(h.x + Math.sin(b * 2.1) * h.r * 0.5, h.y + h.r * 0.6 - life * h.r * 1.2, 1.5 + (b % 2), 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${color}, ${0.7 * (1 - life)})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        } else if (!gas) { // vlnky vody
            ctx.strokeStyle = `rgba(${color}, 0.5)`;
            ctx.lineWidth = 1.2;
            for (let k = -1; k <= 1; k++) {
                ctx.beginPath();
                for (let x = -h.r; x <= h.r; x += 4) {
                    const y = h.y + k * h.r * 0.4 + Math.sin(x * 0.4 + t * 2 + k) * 1.6;
                    if (x === -h.r) ctx.moveTo(h.x + x, y); else ctx.lineTo(h.x + x, y);
                }
                ctx.stroke();
            }
        }
        ctx.restore();
        ctx.save();
        ctx.font = '700 10px "Barlow Condensed", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fillText(gas ? (h.spent ? 'VYHOŘELÝ PLYN' : 'PLYN') : 'VODA', h.x, h.y - h.r - 4);
        ctx.restore();
    });
}

function drawSky(groundLevel, rand) {
    const backY = getSlabBackY(groundLevel);
    const sky = ctx.createLinearGradient(0, 0, 0, backY);
    sky.addColorStop(0, '#070912');
    sky.addColorStop(0.6, '#141a2e');
    sky.addColorStop(1, '#2a2a40');
    ctx.fillStyle = sky;
    ctx.fillRect(-FAR_PAD, 0, VIEW_W + FAR_PAD * 2, backY + 20);

    for (let i = 0; i < 90; i++) {
        const y = rand() * backY * 0.8;
        ctx.fillStyle = `rgba(220, 230, 255, ${0.15 + rand() * 0.55})`;
        ctx.fillRect(rand() * (VIEW_W + FAR_PAD * 2) - FAR_PAD, y, 1.4, 1.4);
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
    ctx.fillRect(-FAR_PAD, backY - 60, VIEW_W + FAR_PAD * 2, 80);
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
        while (x < VIEW_W + FAR_PAD) {
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
        ctx.lineTo(VIEW_W + FAR_PAD * 2, backY + 20);
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
    ctx.fillRect(0, backY, VIEW_W, SLAB_DEPTH);

    // Měsíční lesk na písku
    drawGlow(MOON_X, backY + 40, 520, '140, 160, 220', 0.10);

    // Zrnitost, vepředu větší (perspektiva)
    for (let i = 0; i < 2600; i++) {
        const depth = rand();
        const y = backY + depth * SLAB_DEPTH;
        const size = 0.6 + depth * 1.8;
        ctx.fillStyle = rand() < 0.55 ? 'rgba(10, 8, 20, 0.22)' : 'rgba(200, 200, 230, 0.07)';
        ctx.fillRect(rand() * VIEW_W, y, size, size * 0.6);
    }
    // Duny: měkké světlé a tmavé vlny
    for (let i = 0; i < 14; i++) {
        const y = backY + 20 + rand() * (SLAB_DEPTH - 60);
        const s = slabScaleAt(y, groundLevel);
        ctx.strokeStyle = 'rgba(170, 180, 220, 0.06)';
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        const x0 = rand() * VIEW_W;
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

// Ulice podle éry: prašná cesta, s promenádou, dlažba, asfalt se středovou čárou
function drawTownStreet(L, groundLevel, era) {
    const surface = ['rgba(92, 72, 58, 0.55)', 'rgba(88, 70, 60, 0.65)', 'rgba(72, 66, 72, 0.75)', 'rgba(50, 50, 60, 0.85)'][era];
    ctx.fillStyle = surface;
    ctx.fillRect(0, L.streetY - L.streetHalf, VIEW_W, L.streetHalf * 2);
    if (era === 0) { // vyjeté koleje v prachu
        ctx.fillStyle = 'rgba(30, 22, 18, 0.35)';
        ctx.fillRect(0, L.streetY - 4 * L.streetScale, VIEW_W, 1.5);
        ctx.fillRect(0, L.streetY + 4 * L.streetScale, VIEW_W, 1.5);
    }
    if (era >= 2) { // obrubníky
        ctx.fillStyle = 'rgba(150, 140, 160, 0.22)';
        ctx.fillRect(0, L.streetY - L.streetHalf - 1.5, VIEW_W, 1.5);
        ctx.fillRect(0, L.streetY + L.streetHalf, VIEW_W, 1.5);
    }
    if (era === 2) { // dlažební kostky
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        for (let x = 0; x < VIEW_W; x += 6) ctx.fillRect(x, L.streetY - L.streetHalf, 1, L.streetHalf * 2);
    }
    if (era === 3) {
        ctx.fillStyle = 'rgba(255, 240, 200, 0.22)'; // středová čára
        for (let x = 0; x < VIEW_W; x += 26) ctx.fillRect(x, L.streetY - 0.5, 12, 1);
    }
    if (era >= 1) { // promenáda: prkenný chodník před městem
        const ps = slabScaleAt(L.promenadeY, groundLevel);
        ctx.fillStyle = era >= 3 ? 'rgba(90, 88, 96, 0.6)' : 'rgba(95, 70, 55, 0.6)';
        ctx.fillRect(0, L.promenadeY - 4 * ps, VIEW_W, 8 * ps);
        ctx.fillStyle = 'rgba(20, 12, 10, 0.35)';
        for (let x = 0; x < VIEW_W; x += era >= 3 ? 24 : 9) ctx.fillRect(x, L.promenadeY - 4 * ps, 1, 8 * ps);
    }
}

// Typ stavby na místě slotu: čím déle místo stojí (éra − narození) a čím je "lepší", tím
// modernější dům. Tábor má jen stany a boudy, automobilová éra cihlové bloky s neony.
const TOWN_LEVEL_TYPES = ['tent', 'shack', 'house', 'brick', 'block'];
const TOWN_MAX_LEVEL = [1, 2, 3, 4];

function townSlotType(slot, era) {
    if (slot.industry) return era >= 1 ? slot.industry : 'tent';
    const level = Math.min(TOWN_MAX_LEVEL[era], Math.floor((era - slot.born) * 1.1 + slot.q * 1.7));
    return TOWN_LEVEL_TYPES[Math.max(0, level)];
}

function drawTown(groundLevel, rand, era = 0) {
    const L = getTownLayout(groundLevel);
    const backY = L.backY;

    // Cesty z města k polím (pod domy); s érou jich přibývá
    ctx.strokeStyle = 'rgba(90, 75, 70, 0.4)';
    ctx.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
        const x = 120 + i * 270 + rand() * 60;
        const bend = (rand() - 0.5) * 80;
        if (Math.abs(x - VIEW_W / 2) > 260 + era * 180) continue;
        ctx.beginPath();
        ctx.moveTo(x, L.streetY);
        ctx.quadraticCurveTo(x + bend, L.streetY + 40, slabXAt(x, L.promenadeY, groundLevel), L.promenadeY);
        ctx.stroke();
    }
    drawTownStreet(L, groundLevel, era);

    // Sloty staveb jsou pro všechny éry stejné (stejný seed): město roste od středu ven
    // a stávající domy se přestavují, místo aby se celé město vyměnilo.
    const items = [];
    const lampCount = [8, 16, 24, 32][era];
    for (let i = 0; i < lampCount; i++) {
        const north = i % 2 === 0;
        const x = (i + 0.5) * VIEW_W / lampCount;
        if (Math.abs(x - VIEW_W / 2) > 300 + era * 200) continue;
        items.push({ type: 'lamp', x, y: north ? L.streetY - L.streetHalf - 3 : L.streetY + L.streetHalf + 4, seed: 0, era });
    }
    const buyerXs = OilSim.BUYERS.filter(b => b.x > 200 && b.x < VIEW_W - 200).map(b => b.x);
    for (let i = 0; i < 240; i++) {
        const q = rand();
        const y = backY + 8 + Math.pow(rand(), 0.85) * (L.townEndY - backY - 8);
        const x = rand() * VIEW_W;
        const seed = Math.floor(rand() * 1e9);
        const jitter = rand();
        const kind = rand();
        const spread = Math.abs(x - VIEW_W / 2) / (VIEW_W / 2);
        const born = Math.max(0, Math.min(3, Math.floor(Math.max(0, spread - 0.12) * 4.2 + (jitter - 0.5))));
        if (born > era) continue;
        if (Math.abs(y - L.streetY) < L.clearance) continue; // ulice a chodníky zůstávají volné
        // Místo před kupci ve městě patří jejich budovám
        if (y > L.streetY && buyerXs.some(bx => Math.abs(x - bx) < 60)) continue;
        const industry = kind < 0.1 ? 'derrick' : kind < 0.18 ? 'tank' : kind < 0.22 ? 'water' : null;
        const type = townSlotType({ q, born, industry }, era);
        const item = fitTownItemInFront({ type, x, y, seed, era }, L, groundLevel);
        if (item) items.push(item);
    }
    // Budovy kupců ve městě (petrolejka od začátku, benzinka s automobilovou érou)
    items.push({ type: 'store', x: 800, y: L.townEndY, seed: 11, era });
    if (era >= 3) items.push({ type: 'garage', x: 972, y: L.townEndY, seed: 12, era });
    items.sort((a, b) => a.y - b.y);
    townFrontItems = items.filter(item => item.y > L.streetY);
    items.filter(item => item.y <= L.streetY).forEach(item => drawTownItem(item, groundLevel));
}

// Nejvyšší možná výška stavby daného typu (bez měřítka), viz kreslicí funkce níž
const TOWN_ITEM_MAX_HEIGHT = { house: 74, derrick: 61, water: 53, shack: 54, tank: 26, tent: 15, brick: 66, block: 92, store: 56, garage: 50 }; // vč. komína

// Stavba před ulicí nesmí střechou zasáhnout do chodníku, jinak chodci za ní vypadají,
// jako by stáli na střeše. Když se nevejde, zkusí se nižší typ (bouda, nádrž, stan).
function fitTownItemInFront(item, L, groundLevel) {
    if (item.y <= L.streetY) return item;
    const room = item.y - L.sidewalkSouth - 3;
    const s = slabScaleAt(item.y, groundLevel);
    if (item.type === 'store' || item.type === 'garage') return item; // budovy kupců mají místo vyhrazené
    const candidates = [item.type, item.type === 'block' ? 'brick' : 'shack', 'shack', 'tank', 'tent'];
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
        case 'lamp': drawTownLamp(item.x, item.y, s, item.era >= 3); break;
        case 'brick': drawTownBrick(item.x, item.y, s, rand, false); break;
        case 'block': drawTownBrick(item.x, item.y, s, rand, true); break;
        case 'store': drawTownStore(item.x, item.y, s, item.era); break;
        case 'garage': drawTownGarage(item.x, item.y, s); break;
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

// Pouliční lampa: petrolejová (teplá), v automobilové éře elektrická (studeně bílá, vyšší)
function drawTownLamp(x, y, s, electric = false) {
    const h = (electric ? 22 : 16) * s;
    const light = electric ? '210, 225, 255' : '255, 170, 80';
    ctx.fillStyle = '#121119';
    ctx.fillRect(x, y - h, 1.5, h);
    if (electric) ctx.fillRect(x, y - h, 5 * s, 1.2);
    ctx.fillStyle = electric ? '#eef4ff' : '#ffd890';
    ctx.fillRect(x - 1 + (electric ? 4 * s : 0), y - h - 2, 3.5, 3);
    drawGlow(x + (electric ? 5 * s : 0), y - h, (electric ? 30 : 22) * s, light, electric ? 0.55 : 0.45);
    // Kruh světla na zemi
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${electric ? '180, 200, 255' : '255, 150, 70'}, 0.07)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 26 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Cihlový dům s rovnou střechou a atikou; block = vícepatrový s neonovým nápisem na střeše
const NEON_SIGNS = ['HOTEL', 'BAR', 'KINO', 'OIL', 'BANK', 'SALOON', 'DINER'];

function drawTownBrick(x, y, s, rand, tall) {
    const w = (tall ? 44 : 34) * s + rand() * 18 * s;
    const h = (tall ? 62 : 36) * s + rand() * (tall ? 16 : 14) * s;
    const depth = 9 * s;
    drawGroundShadow(x + w / 2, y, w, s);
    ctx.fillStyle = '#2a1a1c'; // bok
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x - depth, y - h - depth * 0.6);
    ctx.lineTo(x - depth, y - depth * 0.6);
    ctx.closePath();
    ctx.fill();
    const wall = ctx.createLinearGradient(x, 0, x + w, 0);
    wall.addColorStop(0, '#47282a');
    wall.addColorStop(1, '#5c3434');
    ctx.fillStyle = wall;
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'; // řádky cihel
    for (let yy = y - h + 3 * s; yy < y; yy += 3 * s) ctx.fillRect(x, yy, w, 0.6);
    ctx.fillStyle = '#1e1416'; // atika
    ctx.fillRect(x - depth - 1, y - h - depth * 0.6 - 3 * s, w + depth + 2, 3 * s);
    ctx.fillRect(x - 1, y - h - 3 * s, w + 2, 4 * s);
    ctx.strokeStyle = 'rgba(170, 185, 235, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 1, y - h - 3 * s);
    ctx.lineTo(x + w + 1, y - h - 3 * s);
    ctx.stroke();
    // Okna v pravidelné mřížce, víc svítí
    const rows = Math.max(1, Math.floor((h - 8 * s) / (11 * s)));
    const cols = Math.max(1, Math.floor(w / (9 * s)));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const wx = x + 3 * s + c * (w - 6 * s) / cols + 1;
            const wy = y - h + 6 * s + r * 11 * s;
            const lit = rand() < 0.62;
            ctx.fillStyle = lit ? '#ffc878' : '#151018';
            ctx.fillRect(wx, wy, 4 * s, 6 * s);
            if (lit) drawGlow(wx + 2 * s, wy + 3 * s, 12 * s, '255, 170, 80', 0.2);
        }
    }
    if (tall && rand() < 0.75) { // neon na střeše
        const label = NEON_SIGNS[Math.floor(rand() * NEON_SIGNS.length)];
        const color = rand() < 0.5 ? '255, 90, 120' : '120, 220, 255';
        ctx.save();
        ctx.font = `700 ${Math.round(9 * s)}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const ny = y - h - 6 * s;
        ctx.fillStyle = '#121016';
        ctx.fillRect(x + w / 2 - 1, ny, 1.5, 4 * s);
        drawGlow(x + w / 2, ny - 3 * s, 26 * s, color, 0.45);
        ctx.fillStyle = `rgb(${color})`;
        ctx.fillText(label, x + w / 2, ny);
        ctx.restore();
    } else if (rand() < 0.5) { // komín
        const cx = x + w * 0.75;
        ctx.fillStyle = '#121119';
        ctx.fillRect(cx, y - h - 10 * s, 4 * s, 8 * s);
        sceneChimneys.push({ x: cx + 2 * s, y: y - h - 10 * s, s, phase: rand() * 10 });
    }
}

// Petrolejka: v táboře velký stan s lucernami, pak dřevěný obchod s falešným štítem a cedulí
function drawTownStore(x, y, s, era) {
    if (era === 0) {
        drawTownTent(x - 24 * s, y, s * 2.2, seededRandom(3));
        drawGlow(x, y - 20 * s, 34 * s, '255, 170, 80', 0.4);
    } else {
        const w = 56 * s, h = 30 * s;
        const left = x - w / 2;
        drawGroundShadow(x, y, w, s);
        ctx.fillStyle = era >= 2 ? '#3e3036' : '#3a2e2a';
        ctx.fillRect(left, y - h, w, h);
        ctx.fillStyle = '#231b18'; // falešný štít
        ctx.fillRect(left - 2 * s, y - h - 12 * s, w + 4 * s, 13 * s);
        ctx.strokeStyle = 'rgba(170, 185, 235, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left - 2 * s, y - h - 12 * s);
        ctx.lineTo(left + w + 2 * s, y - h - 12 * s);
        ctx.stroke();
        ctx.fillStyle = '#ffbe6a'; // výloha
        ctx.fillRect(left + 6 * s, y - h + 8 * s, w - 26 * s, 12 * s);
        drawGlow(x - 6 * s, y - h + 14 * s, 30 * s, '255, 160, 70', 0.4);
        ctx.fillStyle = '#151018'; // dveře
        ctx.fillRect(left + w - 15 * s, y - 18 * s, 9 * s, 18 * s);
        ctx.fillStyle = '#5a3b20'; // stříška
        ctx.fillRect(left - 3 * s, y - h + 2 * s, w + 6 * s, 3 * s);
    }
    // Lucerny na trámu před obchodem
    [-18, 0, 18].forEach(dx => {
        ctx.fillStyle = '#ffd890';
        ctx.fillRect(x + dx * s - 1.5, y - (era === 0 ? 34 : 46) * s, 3, 4);
        drawGlow(x + dx * s, y - (era === 0 ? 32 : 44) * s, 12 * s, '255, 180, 90', 0.45);
    });
    ctx.save();
    ctx.font = `${Math.round(9 * s)}px "Rye", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8c98a';
    ctx.fillText('PETROLEJ', x, y - (era === 0 ? 40 : 36) * s);
    ctx.restore();
}

// Benzinka: nízká cihlová dílna, přístřešek, stojan s koulí a svítící nápis
function drawTownGarage(x, y, s) {
    const w = 60 * s, h = 24 * s;
    const left = x - w / 2;
    drawGroundShadow(x, y, w, s);
    ctx.fillStyle = '#3c3a44';
    ctx.fillRect(left + 20 * s, y - h, w - 20 * s, h);
    ctx.fillStyle = '#1c1b22';
    ctx.fillRect(left + 26 * s, y - h + 8 * s, 16 * s, h - 8 * s); // vrata
    ctx.fillStyle = 'rgba(120, 220, 255, 0.25)';
    ctx.fillRect(left + 26 * s, y - h + 8 * s, 16 * s, 2 * s);
    ctx.fillStyle = '#18171e'; // přístřešek na sloupcích
    ctx.fillRect(left - 2 * s, y - h - 4 * s, 26 * s, 3 * s);
    ctx.fillRect(left, y - h - 1 * s, 2 * s, h + 1 * s);
    // Stojan s koulí
    ctx.fillStyle = '#b8342a';
    ctx.fillRect(left + 9 * s, y - 16 * s, 5 * s, 16 * s);
    ctx.fillStyle = '#f2ead8';
    ctx.beginPath();
    ctx.arc(left + 11.5 * s, y - 19 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
    drawGlow(left + 11.5 * s, y - 19 * s, 12 * s, '255, 240, 210', 0.5);
    ctx.save();
    ctx.font = `700 ${Math.round(10 * s)}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawGlow(left + 40 * s, y - h - 5 * s, 30 * s, '120, 220, 255', 0.45);
    ctx.fillStyle = 'rgb(150, 230, 255)';
    ctx.fillText('BENZIN', left + 40 * s, y - h - 2 * s);
    ctx.restore();
}

function drawRoad(groundLevel) {
    const top = groundLevel - ROAD_DEPTH;
    const road = ctx.createLinearGradient(0, top, 0, groundLevel);
    road.addColorStop(0, '#2f2a33');
    road.addColorStop(1, '#3a2f2e');
    ctx.fillStyle = road;
    ctx.fillRect(0, top, VIEW_W, ROAD_DEPTH);
    ctx.fillStyle = 'rgba(190, 200, 240, 0.06)'; // vyjeté koleje v měsíčním světle
    [top + 9, top + 13, top + 22, top + 27].forEach(y => ctx.fillRect(0, y, VIEW_W, 1.5));
    ctx.fillStyle = 'rgba(10, 8, 15, 0.45)';
    ctx.fillRect(0, top, VIEW_W, 2);
}

// Řez podzemím: tmavá skála z balvanů, jemné vrstvy, studené krystalky a tma ke dnu
function drawUnderground(groundLevel, rand) {
    const top = groundLevel;
    const h = VIEW_H - top;
    const base = ctx.createLinearGradient(0, top, 0, VIEW_H);
    base.addColorStop(0, '#2a1f1a');
    base.addColorStop(0.6, '#17110e');
    base.addColorStop(1, '#090706');
    ctx.fillStyle = base;
    ctx.fillRect(0, top, VIEW_W, h);

    const shades = ['#2c211b', '#251c17', '#1e1713', '#33261e', '#211915'];
    const rocks = [];
    for (let i = 0; i < 520; i++) {
        rocks.push({ x: rand() * VIEW_W, y: top + rand() * h, r: 8 + Math.pow(rand(), 2) * 46 });
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
        for (let x = 0; x <= VIEW_W; x += 40) ctx.lineTo(x, y0 + Math.sin(x * 0.006 + i) * 12 + (rand() - 0.5) * 8);
        ctx.stroke();
    }

    // Studené minerály: drobné modré body, kontrast k teplé ropě
    for (let i = 0; i < 28; i++) {
        const x = rand() * VIEW_W;
        const y = top + 60 + rand() * (h - 160);
        ctx.fillStyle = 'rgba(150, 210, 255, 0.7)';
        ctx.fillRect(x, y, 2, 2);
        drawGlow(x + 1, y + 1, 7, '110, 180, 255', 0.35);
    }

    const fade = ctx.createLinearGradient(0, VIEW_H - 180, 0, VIEW_H);
    fade.addColorStop(0, 'rgba(5, 4, 4, 0)');
    fade.addColorStop(1, 'rgba(5, 4, 4, 0.85)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, VIEW_H - 180, VIEW_W, 180);
}

// Skalní hrana pod deskou: zubatý spodní okraj, svislé žíly, světlo na lomu a stín pod ní
function drawCliff(groundLevel, rand) {
    const top = groundLevel;
    const pts = [];
    for (let x = 0; x <= VIEW_W + 14; x += 14) {
        pts.push([x, top + LIP_HEIGHT * (0.6 + rand() * 0.8)]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, top);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(VIEW_W, top);
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
        const x = rand() * VIEW_W;
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x + (rand() - 0.5) * 6, top + LIP_HEIGHT * 1.4);
        ctx.stroke();
    }
    ctx.restore();

    // Stín pod převisem
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, VIEW_H);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(VIEW_W, VIEW_H);
    ctx.closePath();
    ctx.clip();
    const ao = ctx.createLinearGradient(0, top + LIP_HEIGHT * 0.6, 0, top + LIP_HEIGHT + 60);
    ao.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    ao.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ao;
    ctx.fillRect(0, top, VIEW_W, LIP_HEIGHT + 70);
    ctx.restore();

    ctx.fillStyle = 'rgba(200, 200, 235, 0.45)'; // měsíc na hraně desky
    ctx.fillRect(0, top, VIEW_W, 1.5);
}

// Kouř z komínů města a prach v měsíčním světle; jen kresba, poloha je funkcí času
function drawAmbientDust() {
    if (!prefs.life) return;
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
        const x = ((i * 389.7 + t * speed) % (VIEW_W + 40)) - 20;
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
// Záře: jeden předkreslený kotouč na barvu (radiální gradient je drahý), kreslí se s globalAlpha
const GLOW_SPRITE_SIZE = 128;
const glowSprites = new Map();

function getGlowSprite(color) {
    let sprite = glowSprites.get(color);
    if (!sprite) {
        sprite = document.createElement('canvas');
        sprite.width = sprite.height = GLOW_SPRITE_SIZE;
        const sctx = sprite.getContext('2d');
        const half = GLOW_SPRITE_SIZE / 2;
        const g = sctx.createRadialGradient(half, half, 0, half, half, half);
        g.addColorStop(0, `rgba(${color}, 1)`);
        g.addColorStop(1, `rgba(${color}, 0)`);
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
        glowSprites.set(color, sprite);
    }
    return sprite;
}

function drawGlow(x, y, radius, color, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
    ctx.drawImage(getGlowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
}

// Přidám globální pole pro hitboxy cedulí
let plotSignHitboxes = [];
let blimpHitRect = null; // reklamní vzducholoď (klik otevře odkaz), jen když je na obloze a nese reklamu
let blimpAd; // reklama na transparentu; undefined = pro tento přelet ještě nevylosováno, null = bez reklamy
let plotsHoverPointer = false; // myš je nad cedulí nebo stavitelným pozemkem

const PLOT_SIGN_PAD = 10;
const PLOT_SIGN_POST = 30; // výška sloupku: cedule musí být nad střechami projíždějících aut
const PLOT_SIGN_FONT = 'bold 18px "Rye", Georgia, serif';

function getPlotSignRect(plot, groundLevel) {
    const signWidth = 92;
    const signHeight = 42;
    const postHeight = PLOT_SIGN_POST;
    const signX = Math.round(plot.x + (plot.width / 2) - (signWidth / 2));
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
        mousePos.x >= plot.x && mousePos.x < plot.x + plot.width;
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
        slabBackX(plot.x + plot.width, groundLevel) - slabBackX(plot.x, groundLevel), backY);
    traceSlabQuad(plot.x, plot.x + plot.width, groundLevel);
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
    const canvasAspect = VIEW_W / VIEW_H;
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

    const rawX = (clientX - rect.left - offsetX) * (VIEW_W / renderWidth);
    const rawY = (clientY - rect.top - offsetY) * (VIEW_H / renderHeight);
    const px = Math.max(0, Math.min(VIEW_W, rawX));
    const py = Math.max(0, Math.min(VIEW_H, rawY));

    // x/y jsou souřadnice světa (přes kameru), px/py pixely plátna
    return {
        x: camera.x + px / camera.zoom,
        y: camera.y + py / camera.zoom,
        px,
        py,
        inBounds: rawX >= 0 && rawX <= VIEW_W && rawY >= 0 && rawY <= VIEW_H
    };
}

function isPointInRect(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + rect.height;
}

function getPlotAtX(x) {
    if (x < 0 || x > VIEW_W) return null;
    for (const plot of plots) {
        if (x >= plot.x && x < plot.x + plot.width) {
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
        clickPos.x >= p.x && clickPos.x < p.x + p.width) || null;
}

// Další příhoz v dražbě: aspoň o 25, jinak o desetinu
function nextBid(auction) {
    return auction.amount + Math.max(OilSim.C.AUCTION_MIN_RAISE, Math.round(auction.amount * 0.1 / 5) * 5);
}

function tryPurchasePlot(plot, groundLevel) {
    if (!plot || plot.owner) return 'none';
    const auction = auctions.find(a => a.plotId === plot.id);
    if (auction) {
        if (auction.bidder === myId) return 'none';
        const amount = nextBid(auction);
        if (money < amount) {
            plotBlinkTimers[plot.id] = 20;
            return 'too_expensive';
        }
        doAction({ type: 'bid', plotId: plot.id, amount });
        return 'bought';
    }
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
    for (let i = 1; i < plots.length; i++) {
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
        ctx.lineTo(x, VIEW_H);
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
        traceSlabQuad(plot.x + 3, plot.x + plot.width - 3, groundLevel, groundLevel - ROAD_DEPTH, fieldBackY);
        ctx.fillStyle = mine ? 'rgba(30, 14, 8, 0.32)' : 'rgba(10, 10, 25, 0.28)';
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = color;
        ctx.fillRect(plot.x + 4, groundLevel, plot.width - 8, 2);
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
            const auction = auctions.find(a => a.plotId === plot.id);
            const canAfford = money >= (auction ? nextBid(auction) : plot.price);
            const plotHovered = isPlotSurfaceHovered(plot, groundLevel);
            const signHovered = isPlotSignHovered(sign);
            const isHovered = plotHovered || signHovered;
            if (isHovered) hoveredAny = true;

            if (isHovered) {
                drawPlotPurchaseHighlight(plot, groundLevel, canAfford);
            }

            const postBase = groundLevel - STRUCTURE_BASE_OFFSET;
            const postX = Math.round(plot.x + (plot.width / 2) - 2);
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
            if (auction) {
                // Dražba: aktuální příhoz, kdo vede a kolik sekund zbývá
                const leading = auction.bidder === myId;
                ctx.fillStyle = leading ? '#9fe3a8' : '#ffb27a';
                ctx.fillText(`$${auction.amount}`, plot.x + plot.width / 2, signY + signHeight / 2 - 4);
                ctx.font = '700 8.5px "Barlow Condensed", system-ui, sans-serif';
                ctx.fillStyle = leading ? 'rgba(160, 230, 170, 0.9)' : 'rgba(255, 190, 150, 0.9)';
                ctx.fillText(`DRAŽBA · ${leading ? 'VEDEŠ' : playerName(auction.bidder).toUpperCase()} · ${Math.ceil(auction.timer / 1000)} s`, plot.x + plot.width / 2, signY + signHeight - 8);
            } else {
                ctx.fillStyle = canAfford ? '#ffd98a' : '#ff8a70';
                ctx.fillText(`$${plot.price}`, plot.x + plot.width / 2, signY + signHeight / 2 - 4);
                // Terén a šířka claimu drobně pod cenou
                ctx.font = '700 8.5px "Barlow Condensed", system-ui, sans-serif';
                ctx.fillStyle = 'rgba(255, 225, 180, 0.7)';
                ctx.fillText(`${OilSim.terrainOf(plot).name.toUpperCase()} · ${Math.round(plot.width)} m`, plot.x + plot.width / 2, signY + signHeight - 8);
            }

            if (plotBlinkTimers[plot.id] && plotBlinkTimers[plot.id] % 4 < 2) {
                ctx.fillStyle = 'rgba(255, 60, 40, 0.4)';
                pathRoundRect(signX, signY, signWidth, signHeight, 5);
                ctx.fill();
            }
        } else if (plot.id === lastBoughtPlotId && lastBoughtHighlightTimer > 0) {
            // Zvýraznění právě koupeného pozemku: zablikne plocha desky, NE vrt!
            ctx.save();
            traceSlabQuad(plot.x, plot.x + plot.width, groundLevel);
            ctx.fillStyle = `rgba(255, 200, 90, ${0.35 * lastBoughtHighlightTimer / 30})`;
            ctx.fill();
            ctx.restore();
        }
        // Nově: pokud je aktivní build mód vrtu a myš je nad vlastněným pozemkem bez vrtu
        if (currentBuildMode === 'vrt' && plot.owner === myId && !plot.hasVrt) {
            const px = plot.x;
            const py = groundLevel;
            if (mousePos.x >= px && mousePos.x <= px + plot.width && mousePos.y >= 0 && mousePos.y <= py) {
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
            ctx.strokeStyle = pumping ? `rgba(255, 170, 70, ${0.4 + 0.5 * heat})` : 'rgba(255, 190, 120, 0.25)';
            ctx.lineWidth = pumping ? 2 : 1.2;
            ctx.stroke();
            ctx.clip();
            // Prázdná dutina: tmavá skála s kapkami ropy na stěnách
            ctx.fillStyle = 'rgba(14, 9, 7, 0.94)';
            ctx.fillRect(pocket.x - 10, pocket.y - 10, pocket.width + 20, pocket.height + 20);
            const rand = seededRandom(pocket.id * 131 + 7);
            ctx.fillStyle = 'rgba(70, 45, 30, 0.5)';
            for (let k = 0; k < 10; k++) {
                ctx.fillRect(pocket.x + rand() * pocket.width, pocket.y + rand() * pocket.height, 1.5 + rand() * 2, 3 + rand() * 6);
            }
            // Hladina ropy: s těžbou klesá ode stropu dutiny ke dnu
            const levelY = pocket.y + pocket.height * (1 - fillRatio);
            const wobble = pumping ? 1.5 : 0.6;
            if (fillRatio > 0) {
                const oil = ctx.createLinearGradient(0, levelY, 0, pocket.y + pocket.height);
                if (pumping) {
                    oil.addColorStop(0, `rgba(255, 190, 90, ${0.35 + 0.55 * heat})`);
                    oil.addColorStop(0.25, `rgba(220, 90, 25, ${0.5 + 0.4 * heat})`);
                    oil.addColorStop(1, 'rgba(30, 10, 4, 0.98)');
                } else {
                    oil.addColorStop(0, 'rgba(90, 60, 40, 0.95)');
                    oil.addColorStop(1, 'rgba(8, 5, 3, 0.98)');
                }
                ctx.fillStyle = oil;
                ctx.beginPath();
                ctx.moveTo(pocket.x - 10, levelY + wobble);
                for (let x = pocket.x - 10; x <= pocket.x + pocket.width + 10; x += 6) {
                    ctx.lineTo(x, levelY + Math.sin(x * 0.12 + t * 1.6) * wobble);
                }
                ctx.lineTo(pocket.x + pocket.width + 10, pocket.y + pocket.height + 10);
                ctx.lineTo(pocket.x - 10, pocket.y + pocket.height + 10);
                ctx.closePath();
                ctx.fill();
                // Lesk na hladině
                ctx.strokeStyle = pumping ? `rgba(255, 220, 150, ${0.35 + 0.4 * heat})` : 'rgba(255, 230, 200, 0.22)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                for (let x = pocket.x - 10; x <= pocket.x + pocket.width + 10; x += 6) {
                    const y = levelY + Math.sin(x * 0.12 + t * 1.6) * wobble;
                    if (x === pocket.x - 10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
            if (pumping && fillRatio > 0) { // bublinky stoupající k hladině
                ctx.globalCompositeOperation = 'lighter';
                for (let b = 0; b < 6; b++) {
                    const life = (t * 0.4 + b / 6 + cx * 0.01) % 1;
                    const bx = cx + Math.sin(b * 2.3 + cx) * pocket.width * 0.3;
                    const by = pocket.y + pocket.height - 4 - life * (pocket.y + pocket.height - levelY - 6);
                    if (by <= levelY) continue;
                    ctx.fillStyle = `rgba(255, 210, 120, ${0.5 * (1 - life) * heat})`;
                    ctx.beginPath();
                    ctx.arc(bx, by, 1.5 + b % 3, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            }
            // Rysky na stěně dutiny: původní hladina a čtvrtiny, ať je pokles vidět i bez štítku
            ctx.strokeStyle = 'rgba(255, 220, 180, 0.22)';
            ctx.lineWidth = 1;
            [0.25, 0.5, 0.75].forEach(f => {
                const y = pocket.y + pocket.height * (1 - f);
                ctx.beginPath();
                ctx.moveTo(pocket.x + pocket.width * 0.06, y);
                ctx.lineTo(pocket.x + pocket.width * 0.06 + 7, y);
                ctx.stroke();
            });
            ctx.restore();
        }
    });

    // Propojená pole: propustná vrstva mezi ložisky, když hráč zná obě
    (world?.links || []).forEach(([ia, ib]) => {
        const a = oilPockets[ia], b = oilPockets[ib];
        if (!a || !b || !(DEV || ((a.tapped || a.revealed) && (b.tapped || b.revealed)))) return;
        const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 150, 60, 0.5)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.setLineDash([0.1, 8]); // tečky: prosakující ropa, ne trasa vrtu
        ctx.lineDashOffset = -t * 10 * Math.sign((a.oil / a.maxOil) - (b.oil / b.maxOil) || 1);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2, Math.max(ay, by) + 24, bx, by);
        ctx.stroke();
        ctx.restore();
    });

    // Štítky až po všech ložiscích, aby je záře sousedního ložiska nepřekryla
    oilPockets.forEach(pocket => {
        if (!(DEV || pocket.tapped || pocket.revealed)) return;
        drawPocketChip(pocket, pipeNetworks.some(n => n.connectedPocket === pocket && n.isPumping));
    });
}

// Štítek ložiska vpravo od něj: zbývající ropa a stav
