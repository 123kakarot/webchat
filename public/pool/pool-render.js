/** High-quality pool table / ball canvas rendering. */

const tableLayerCache = new Map();
const TABLE_STYLE_VER = "v3";

export function shadeColor(hex, amt) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return hex;
  const n = (v) => Math.max(0, Math.min(255, v + amt));
  const r = n(parseInt(h.slice(0, 2), 16));
  const g = n(parseInt(h.slice(2, 4), 16));
  const b = n(parseInt(h.slice(4, 6), 16));
  return `rgb(${r},${g},${b})`;
}

function feltPalette(felt) {
  if (felt === "cerulean" || felt === "#15406e" || felt === "#0d6b45") {
    return { base: "#1e8fd4", mid: "#1578b8", edge: "#0c4a72", light: "#5ec4f5" };
  }
  if (felt.startsWith("#")) {
    return { base: felt, mid: shadeColor(felt, -25), edge: shadeColor(felt, -55), light: shadeColor(felt, 45) };
  }
  return { base: "#1e8fd4", mid: "#1578b8", edge: "#0c4a72", light: "#5ec4f5" };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ w:number,h:number,TABLE_W:number,TABLE_H:number,CUSHION:number,POCKET_R:number,felt:string,pockets:()=>any[] }} opt
 */
export function paintTable(ctx, opt) {
  const { w, h, felt } = opt;
  const cacheKey = `${TABLE_STYLE_VER}:${w}x${h}:${felt}`;
  let layer = tableLayerCache.get(cacheKey);
  if (!layer) {
    layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    paintTableLayer(layer.getContext("2d"), opt);
    tableLayerCache.set(cacheKey, layer);
  }
  ctx.drawImage(layer, 0, 0);
}

/** Pre-build table bitmap — call from lobby to avoid lag on first shot. */
export function warmTablePaint(opt) {
  const c = document.createElement("canvas");
  c.width = opt.w;
  c.height = opt.h;
  paintTable(c.getContext("2d"), opt);
}

function drawRailDiamonds(ctx, x, y, w, h) {
  const nX = Math.max(3, Math.floor(w / 90));
  const nY = Math.max(2, Math.floor(h / 70));
  ctx.fillStyle = "rgba(230,210,170,0.85)";
  for (let i = 1; i <= nX; i++) {
    const px = x + (w * i) / (nX + 1);
    ctx.save();
    ctx.translate(px, y + h * 0.5);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.restore();
  }
  for (let j = 0; j < nY; j++) {
    const py = y + (h * (j + 1)) / (nY + 1);
    for (const px of [x + 14, x + w - 14]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
  }
}

function drawCornerChrome(ctx, cx, cy, pr, corner) {
  ctx.save();
  ctx.strokeStyle = "rgba(210,220,235,0.95)";
  ctx.lineWidth = Math.max(2.5, pr * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  const r = pr * 1.15;
  if (corner === "tl") ctx.arc(cx, cy, r, 0, Math.PI / 2);
  if (corner === "tr") ctx.arc(cx, cy, r, Math.PI / 2, Math.PI);
  if (corner === "bl") ctx.arc(cx, cy, r, -Math.PI / 2, 0);
  if (corner === "br") ctx.arc(cx, cy, r, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

function drawPocketHole(ctx, px, py, pr) {
  const pg = ctx.createRadialGradient(px - pr * 0.15, py - pr * 0.15, pr * 0.05, px, py, pr);
  pg.addColorStop(0, "#2a2a2a");
  pg.addColorStop(0.5, "#0a0a0a");
  pg.addColorStop(1, "#000");
  ctx.beginPath();
  ctx.fillStyle = pg;
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = "rgba(80,70,60,0.9)";
  ctx.lineWidth = Math.max(1.5, pr * 0.08);
  ctx.arc(px, py, pr + 1.2, 0, Math.PI * 2);
  ctx.stroke();
}

function paintTableLayer(ctx, opt) {
  const { w, h, TABLE_W, TABLE_H, CUSHION, POCKET_R, felt, pockets } = opt;
  const sx = w / TABLE_W;
  const sy = h / TABLE_H;
  const pal = feltPalette(felt);
  ctx.clearRect(0, 0, w, h);

  const wood = ctx.createLinearGradient(0, 0, w, h);
  wood.addColorStop(0, "#6b3d1f");
  wood.addColorStop(0.35, "#4a2512");
  wood.addColorStop(0.7, "#3d1e0f");
  wood.addColorStop(1, "#1a0c06");
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,220,170,0.22)";
  ctx.lineWidth = Math.max(1.5, w * 0.003);
  ctx.strokeRect(4, 4, w - 8, h - 8);

  const fx = CUSHION * sx;
  const fy = CUSHION * sy;
  const fw = (TABLE_W - CUSHION * 2) * sx;
  const fh = (TABLE_H - CUSHION * 2) * sy;
  const pr = POCKET_R * sx * 0.92;

  const roundFelt = () => {
    ctx.beginPath();
    const r = Math.min(18, fw * 0.02);
    if (typeof ctx.roundRect === "function") ctx.roundRect(fx, fy, fw, fh, r);
    else ctx.rect(fx, fy, fw, fh);
  };

  roundFelt();
  const feltGrad = ctx.createRadialGradient(
    fx + fw * 0.48,
    fy + fh * 0.42,
    Math.min(fw, fh) * 0.08,
    fx + fw * 0.5,
    fy + fh * 0.52,
    Math.max(fw, fh) * 0.72
  );
  feltGrad.addColorStop(0, pal.light);
  feltGrad.addColorStop(0.35, pal.base);
  feltGrad.addColorStop(0.75, pal.mid);
  feltGrad.addColorStop(1, pal.edge);
  ctx.fillStyle = feltGrad;
  ctx.fill();

  ctx.save();
  roundFelt();
  ctx.clip();
  const vignette = ctx.createRadialGradient(
    fx + fw * 0.5,
    fy + fh * 0.5,
    Math.min(fw, fh) * 0.25,
    fx + fw * 0.5,
    fy + fh * 0.5,
    Math.max(fw, fh) * 0.85
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = vignette;
  ctx.fillRect(fx, fy, fw, fh);

  const headX = (TABLE_W / 3) * sx;
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(headX, fy + 4);
  ctx.lineTo(headX, fy + fh - 4);
  ctx.stroke();
  ctx.restore();

  const pocks = pockets();
  for (const p of pocks) {
    drawPocketHole(ctx, p.x * sx, p.y * sy, pr);
  }

  drawCornerChrome(ctx, fx, fy, pr, "tl");
  drawCornerChrome(ctx, fx + fw, fy, pr, "tr");
  drawCornerChrome(ctx, fx, fy + fh, pr, "bl");
  drawCornerChrome(ctx, fx + fw, fy + fh, pr, "br");

  drawRailDiamonds(ctx, fx - 8, fy - 10, fw + 16, 10);
  drawRailDiamonds(ctx, fx - 8, fy + fh, fw + 16, 10);
  drawRailDiamonds(ctx, fx - 10, fy, 10, fh);
  drawRailDiamonds(ctx, fx + fw, fy, 10, fh);

  ctx.save();
  roundFelt();
  ctx.clip();
  const innerShade = 14;
  const topShade = ctx.createLinearGradient(fx, fy, fx, fy + innerShade);
  topShade.addColorStop(0, "rgba(0,0,0,0.45)");
  topShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topShade;
  ctx.fillRect(fx, fy, fw, innerShade);
  const botShade = ctx.createLinearGradient(fx, fy + fh, fx, fy + fh - innerShade);
  botShade.addColorStop(0, "rgba(0,0,0,0.45)");
  botShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = botShade;
  ctx.fillRect(fx, fy + fh - innerShade, fw, innerShade);
  const leftShade = ctx.createLinearGradient(fx, fy, fx + innerShade, fy);
  leftShade.addColorStop(0, "rgba(0,0,0,0.35)");
  leftShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = leftShade;
  ctx.fillRect(fx, fy, innerShade, fh);
  const rightShade = ctx.createLinearGradient(fx + fw, fy, fx + fw - innerShade, fy);
  rightShade.addColorStop(0, "rgba(0,0,0,0.35)");
  rightShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rightShade;
  ctx.fillRect(fx + fw - innerShade, fy, innerShade, fh);
  ctx.restore();
}

/**
 * Aim line, ghost ball, cue stick + shadow (overlay layer).
 */
export function paintCueAimOverlay(ctx, opt) {
  const {
    w,
    h,
    TABLE_W,
    TABLE_H,
    BALL_R,
    guide,
    aimAngle,
    power,
    cueX,
    cueY,
    showGhost = true,
  } = opt;
  if (!guide || cueX == null) return;
  const sx = w / TABLE_W;
  const sy = h / TABLE_H;

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(guide.x0 * sx, guide.y0 * sy);
  ctx.lineTo(guide.x1 * sx, guide.y1 * sy);
  ctx.stroke();

  if (showGhost && guide.ghost) {
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(guide.ghost.x * sx, guide.ghost.y * sy, BALL_R * sx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(guide.ghost.x * sx, guide.ghost.y * sy);
    ctx.lineTo(guide.ghost.tx * sx, guide.ghost.ty * sy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const pull = 95 + power * 180;
  const tipGap = BALL_R + 5;
  const cos = Math.cos(aimAngle);
  const sin = Math.sin(aimAngle);
  const tipX = cueX * sx - cos * tipGap * sx;
  const tipY = cueY * sy - sin * tipGap * sy;
  const buttX = cueX * sx - cos * pull * sx;
  const buttY = cueY * sy - sin * pull * sy;
  const midX = cueX * sx - cos * pull * 0.38 * sx;
  const midY = cueY * sy - sin * pull * 0.38 * sy;

  const shOffX = sin * 5;
  const shOffY = -cos * 5;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(8, 11 * sx);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tipX + shOffX, tipY + shOffY);
  ctx.lineTo(buttX + shOffX, buttY + shOffY);
  ctx.stroke();

  const cueGrad = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  cueGrad.addColorStop(0, "#f5e6c8");
  cueGrad.addColorStop(0.12, "#e8c896");
  cueGrad.addColorStop(0.35, "#8b5a2b");
  cueGrad.addColorStop(0.65, "#3d2814");
  cueGrad.addColorStop(1, "#1a1008");
  ctx.strokeStyle = cueGrad;
  ctx.lineWidth = Math.max(6, 8 * sx);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(buttX, buttY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(2, 2.5 * sx);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(midX, midY);
  ctx.stroke();

  ctx.fillStyle = "#f8f8f8";
  ctx.beginPath();
  ctx.arc(tipX, tipY, Math.max(2.5, 3.5 * sx), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function paintBalls(ctx, opt) {
  const { w, h, TABLE_W, TABLE_H, BALL_R, balls, colors, fast } = opt;
  const sx = w / TABLE_W;
  const sy = h / TABLE_H;

  if (fast) {
    for (const b of balls) {
      if (b.pocketed) continue;
      const x = b.x * sx;
      const y = b.y * sy;
      const r = BALL_R * sx;
      const base = colors[b.id] || "#ccc";
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.ellipse(x + r * 0.08, y + r * 0.55, r * 0.95, r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = b.id === 0 ? "#f0f0f0" : b.id === 8 ? "#1a1a1a" : base;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.id !== 0) {
        ctx.fillStyle = b.id === 8 ? "#fff" : "#111";
        ctx.font = `bold ${Math.max(10, r * 0.65)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(b.id), x, y + 0.5);
      }
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.arc(x - r * 0.28, y - r * 0.32, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  for (const b of balls) {
    if (b.pocketed) continue;
    const x = b.x * sx;
    const y = b.y * sy;
    const r = BALL_R * sx;
    const base = colors[b.id] || "#ccc";
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x + r * 0.1, y + r * 0.58, r * 1.05, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.04, x + r * 0.05, y + r * 0.15, r * 1.08);
    if (b.id === 0) {
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.4, "#f4f4f4");
      body.addColorStop(0.78, "#c9c9c9");
      body.addColorStop(1, "#8e8e8e");
    } else if (b.id === 8) {
      body.addColorStop(0, "#666");
      body.addColorStop(0.35, "#222");
      body.addColorStop(1, "#000");
    } else {
      body.addColorStop(0, shadeColor(base, 60));
      body.addColorStop(0.38, base);
      body.addColorStop(0.78, shadeColor(base, -40));
      body.addColorStop(1, shadeColor(base, -75));
    }
    ctx.beginPath();
    ctx.fillStyle = body;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (b.id >= 9) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r - 0.2, 0, Math.PI * 2);
      ctx.clip();
      const band = ctx.createLinearGradient(x, y - r * 0.4, x, y + r * 0.4);
      band.addColorStop(0.16, "#fff");
      band.addColorStop(0.84, "#fff");
      ctx.fillStyle = band;
      ctx.fillRect(x - r, y - r * 0.4, r * 2, r * 0.8);
      ctx.restore();
    }

    if (b.id !== 0) {
      const nr = r * (b.id >= 9 ? 0.44 : 0.4);
      ctx.fillStyle = b.id === 8 ? "#151515" : "#fafafa";
      ctx.beginPath();
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.id === 8 ? "#fff" : "#111";
      ctx.font = `bold ${Math.max(11, r * 0.68)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(b.id), x, y + 0.5);
    }

    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.34, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}
