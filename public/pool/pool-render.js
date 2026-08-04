/** High-quality pool table / ball canvas rendering. */

const tableLayerCache = new Map();
const TABLE_STYLE_VER = "v8-balls";
export const TABLE_BG_URL = "/pool/table-arena.png";
export const TABLE_BG_VER = "15";
/** Felt region on mockup (normalized 0–1). */
export const TABLE_ART_INSET = { x: 0.091, y: 0.13, w: 0.818, h: 0.738 };
/** Play line inset inside felt (fraction per side) — visual only. */
export const TABLE_PLAY_MARGIN = { x: 0.012, y: 0.04 };
/** Extra canvas inset (× ball radius) — visual only, not physics guards. */
export const TABLE_BALL_EDGE_PAD = { x: 0.34, y: 0.56 };

let tableBgImg = null;
let tableBgPromise = null;

/**
 * Map table coords → canvas. Scale is fixed to the bed (CUSHION+BALL_R), not FELT_GUARD,
 * so tuning play bounds does not zoom the table art.
 */
export function tableCanvasTransform(w, h, TABLE_W, TABLE_H, CUSHION = 30, BALL_R = 14) {
  const ins = TABLE_ART_INSET;
  const margin = TABLE_PLAY_MARGIN;
  const bedMin = CUSHION + BALL_R;
  const bedW = TABLE_W - 2 * bedMin;
  const bedH = TABLE_H - 2 * bedMin;
  const fwFull = ins.w * w;
  const fhFull = ins.h * h;
  const mx = margin.x * fwFull;
  const my = margin.y * fhFull;
  let ox = ins.x * w + mx;
  let oy = ins.y * h + my;
  let fw = fwFull - 2 * mx;
  let fh = fhFull - 2 * my;
  let sx = fw / bedW;
  let sy = fh / bedH;
  const rPx = BALL_R * ((sx + sy) / 2);
  const padPx = rPx * TABLE_BALL_EDGE_PAD.x;
  const padPy = rPx * TABLE_BALL_EDGE_PAD.y;
  ox += padPx;
  oy += padPy;
  fw -= 2 * padPx;
  fh -= 2 * padPy;
  sx = fw / bedW;
  sy = fh / bedH;
  return {
    ox,
    oy,
    fw,
    fh,
    sx,
    sy,
    innerMinX: bedMin,
    innerMinY: bedMin,
  };
}

export function tableCoordToCanvas(x, y, t) {
  return { x: t.ox + (x - t.innerMinX) * t.sx, y: t.oy + (y - t.innerMinY) * t.sy };
}

export function canvasCoordToTable(px, py, t) {
  return { x: t.innerMinX + (px - t.ox) / t.sx, y: t.innerMinY + (py - t.oy) / t.sy };
}

function tableBgReady() {
  return tableBgImg?.complete && tableBgImg.naturalWidth > 0;
}

/** Preload mockup table — call before first paint. */
export function loadTableBackground() {
  if (tableBgPromise) return tableBgPromise;
  if (typeof Image === "undefined") {
    tableBgPromise = Promise.resolve(null);
    return tableBgPromise;
  }
  tableBgPromise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      tableBgImg = img;
      tableLayerCache.clear();
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = `${TABLE_BG_URL}?v=${TABLE_BG_VER}`;
  });
  return tableBgPromise;
}

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
  const { w, h } = opt;
  const cacheKey = `${TABLE_STYLE_VER}:${TABLE_BG_VER}:${w}x${h}`;
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
export async function warmTablePaint(opt) {
  await loadTableBackground();
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

function clipRailCorner(ctx, w, h, fx, fy, fw, fh, corner) {
  ctx.beginPath();
  if (corner === "tl") {
    ctx.rect(0, 0, fx, h);
    ctx.rect(0, 0, w, fy);
  } else if (corner === "tr") {
    ctx.rect(fx + fw, 0, w - fx - fw, h);
    ctx.rect(0, 0, w, fy);
  } else if (corner === "bl") {
    ctx.rect(0, 0, fx, h);
    ctx.rect(0, fy + fh, w, h - fy - fh);
  } else if (corner === "br") {
    ctx.rect(fx + fw, 0, w - fx - fw, h);
    ctx.rect(0, fy + fh, w, h - fy - fh);
  } else if (corner === "top") {
    ctx.rect(fx, 0, fw, fy);
  } else if (corner === "bottom") {
    ctx.rect(fx, fy + fh, fw, h - fy - fh);
  }
  ctx.clip();
}

function drawPocketInRail(ctx, w, h, fx, fy, fw, fh, rw, corner) {
  const hr = rw * 0.44;
  ctx.save();
  clipRailCorner(ctx, w, h, fx, fy, fw, fh, corner);
  const pg = ctx.createRadialGradient(0, 0, hr * 0.1, 0, 0, hr);
  pg.addColorStop(0, "#252525");
  pg.addColorStop(0.6, "#080808");
  pg.addColorStop(1, "#000");
  ctx.fillStyle = pg;
  ctx.beginPath();
  if (corner === "tl") {
    const cx = fx - hr * 0.22;
    const cy = fy - hr * 0.22;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hr, 0, Math.PI / 2);
  } else if (corner === "tr") {
    const cx = fx + fw + hr * 0.22;
    const cy = fy - hr * 0.22;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hr, Math.PI / 2, Math.PI);
  } else if (corner === "bl") {
    const cx = fx - hr * 0.22;
    const cy = fy + fh + hr * 0.22;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hr, -Math.PI / 2, 0);
  } else if (corner === "br") {
    const cx = fx + fw + hr * 0.22;
    const cy = fy + fh + hr * 0.22;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hr, Math.PI, Math.PI * 1.5);
  } else if (corner === "top") {
    const cx = fx + fw * 0.5;
    const cy = fy - hr * 0.2;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hr, Math.PI * 0.15, Math.PI * 0.85);
  } else if (corner === "bottom") {
    const cx = fx + fw * 0.5;
    const cy = fy + fh + hr * 0.2;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hr, -Math.PI * 0.85, -Math.PI * 0.15);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  clipRailCorner(ctx, w, h, fx, fy, fw, fh, corner);
  ctx.strokeStyle = "rgba(195,205,220,0.85)";
  ctx.lineWidth = Math.max(1.5, hr * 0.11);
  ctx.beginPath();
  if (corner === "tl") ctx.arc(fx - hr * 0.22, fy - hr * 0.22, hr + 0.5, 0.05, Math.PI / 2 - 0.05);
  if (corner === "tr") ctx.arc(fx + fw + hr * 0.22, fy - hr * 0.22, hr + 0.5, Math.PI / 2 + 0.05, Math.PI - 0.05);
  if (corner === "bl") ctx.arc(fx - hr * 0.22, fy + fh + hr * 0.22, hr + 0.5, -Math.PI / 2 + 0.05, -0.05);
  if (corner === "br") ctx.arc(fx + fw + hr * 0.22, fy + fh + hr * 0.22, hr + 0.5, Math.PI + 0.05, Math.PI * 1.5 - 0.05);
  if (corner === "top") ctx.arc(fx + fw * 0.5, fy - hr * 0.2, hr + 0.5, Math.PI * 0.2, Math.PI * 0.8);
  if (corner === "bottom") ctx.arc(fx + fw * 0.5, fy + fh + hr * 0.2, hr + 0.5, -Math.PI * 0.8, -Math.PI * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawCushionRails(ctx, w, h, fx, fy, fw, fh, cushionPx) {
  const rw = cushionPx;
  const rail = ctx.createLinearGradient(0, 0, w, h);
  rail.addColorStop(0, "#5c3820");
  rail.addColorStop(0.45, "#3d2412");
  rail.addColorStop(1, "#2a160c");
  ctx.fillStyle = rail;
  ctx.fillRect(0, 0, w, rw);
  ctx.fillRect(0, h - rw, w, rw);
  ctx.fillRect(0, 0, rw, h);
  ctx.fillRect(w - rw, 0, rw, h);
  ctx.strokeStyle = "rgba(120,80,45,0.55)";
  ctx.lineWidth = Math.max(2, rw * 0.08);
  ctx.strokeRect(fx - 1, fy - 1, fw + 2, fh + 2);
}

function drawCornerChrome(ctx, cx, cy, pr, corner) {
  ctx.save();
  ctx.strokeStyle = "rgba(210,220,235,0.95)";
  ctx.lineWidth = Math.max(2.5, pr * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  const r = pr * 1.05;
  if (corner === "tl") ctx.arc(cx, cy, r, 0, Math.PI / 2);
  if (corner === "tr") ctx.arc(cx, cy, r, Math.PI / 2, Math.PI);
  if (corner === "bl") ctx.arc(cx, cy, r, -Math.PI / 2, 0);
  if (corner === "br") ctx.arc(cx, cy, r, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

function paintTableLayer(ctx, opt) {
  const { w, h } = opt;
  ctx.clearRect(0, 0, w, h);
  if (tableBgReady()) {
    ctx.drawImage(tableBgImg, 0, 0, w, h);
    return;
  }
  paintTableVectorLayer(ctx, opt);
}

/** Redraw rail/frame from mockup on top of balls — blocks “xuyên khung”. */
export function paintRailFrameOverlay(ctx, w, h) {
  if (!tableBgReady()) return;
  const ins = TABLE_ART_INSET;
  const fx = ins.x * w;
  const fy = ins.y * h;
  const fw = ins.w * w;
  const fh = ins.h * h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(fx, fy, fw, fh);
  ctx.clip("evenodd");
  ctx.drawImage(tableBgImg, 0, 0, w, h);
  ctx.restore();
}

function paintTableVectorLayer(ctx, opt) {
  const { w, h, TABLE_W, TABLE_H, CUSHION, POCKET_R, felt, pockets } = opt;
  const sx = w / TABLE_W;
  const sy = h / TABLE_H;
  const pal = feltPalette(felt);

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

  drawCushionRails(ctx, w, h, fx, fy, fw, fh, fx);

  drawPocketInRail(ctx, w, h, fx, fy, fw, fh, fx, "tl");
  drawPocketInRail(ctx, w, h, fx, fy, fw, fh, fx, "tr");
  drawPocketInRail(ctx, w, h, fx, fy, fw, fh, fx, "bl");
  drawPocketInRail(ctx, w, h, fx, fy, fw, fh, fx, "br");
  drawPocketInRail(ctx, w, h, fx, fy, fw, fh, fx, "top");
  drawPocketInRail(ctx, w, h, fx, fy, fw, fh, fx, "bottom");

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

  ctx.save();
  ctx.strokeStyle = "rgba(255,220,170,0.12)";
  ctx.lineWidth = Math.max(3, w * 0.004);
  ctx.strokeRect(6, 6, w - 12, h - 12);
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
    CUSHION,
    BALL_R,
    guide,
    aimAngle,
    power,
    cueX,
    cueY,
    showGhost = true,
  } = opt;
  if (!guide || cueX == null) return;
  const t = tableCanvasTransform(w, h, TABLE_W, TABLE_H, CUSHION ?? 30, BALL_R);
  const rPx = BALL_R * ((t.sx + t.sy) / 2);
  const map = (x, y) => tableCoordToCanvas(x, y, t);

  const p0 = map(guide.x0, guide.y0);
  const p1 = map(guide.x1, guide.y1);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();

  if (showGhost && guide.ghost) {
    const g = guide.ghost;
    const gc = map(g.x, g.y);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gc.x, gc.y, rPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(gc.x, gc.y);
    if (g.objX != null) {
      const o = map(g.objX, g.objY);
      ctx.lineTo(o.x, o.y);
    }
    ctx.stroke();

    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(gc.x, gc.y);
    if (g.cueX != null) {
      const c = map(g.cueX, g.cueY);
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const pull = 95 + power * 180;
  const tipGap = BALL_R + 5;
  const cos = Math.cos(aimAngle);
  const sin = Math.sin(aimAngle);
  const cueC = map(cueX, cueY);
  const tipX = cueC.x - cos * tipGap * t.sx;
  const tipY = cueC.y - sin * tipGap * t.sy;
  const buttX = cueC.x - cos * pull * t.sx;
  const buttY = cueC.y - sin * pull * t.sy;
  const midX = cueC.x - cos * pull * 0.38 * t.sx;
  const midY = cueC.y - sin * pull * 0.38 * t.sy;

  const shOffX = sin * 6;
  const shOffY = -cos * 6;
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = Math.max(9, 12 * t.sx);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tipX + shOffX, tipY + shOffY);
  ctx.lineTo(buttX + shOffX, buttY + shOffY);
  ctx.stroke();

  const cueGrad = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  cueGrad.addColorStop(0, "#faf3e4");
  cueGrad.addColorStop(0.08, "#e8c896");
  cueGrad.addColorStop(0.22, "#c9a066");
  cueGrad.addColorStop(0.38, "#8b5a2b");
  cueGrad.addColorStop(0.55, "#4a3020");
  cueGrad.addColorStop(0.72, "#2a1810");
  cueGrad.addColorStop(1, "#120a06");
  ctx.strokeStyle = cueGrad;
  ctx.lineWidth = Math.max(6.5, 8.5 * t.sx);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(buttX, buttY);
  ctx.stroke();

  const ringX = tipX + (buttX - tipX) * 0.28;
  const ringY = tipY + (buttY - tipY) * 0.28;
  ctx.strokeStyle = "rgba(220,220,230,0.75)";
  ctx.lineWidth = Math.max(2.2, 2.8 * t.sx);
  ctx.beginPath();
  ctx.arc(ringX, ringY, Math.max(4, 5.5 * t.sx), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(2, 2.5 * t.sx);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(midX, midY);
  ctx.stroke();

  ctx.fillStyle = "#fafafa";
  ctx.beginPath();
  ctx.arc(tipX, tipY, Math.max(2.8, 4 * t.sx), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(180,180,180,0.6)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function ballGlossGradient(ctx, x, y, r, base, { light = true } = {}) {
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.02, x + r * 0.08, y + r * 0.1, r * 1.08);
  if (light) {
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.22, shadeColor(base, 55));
    g.addColorStop(0.55, base);
    g.addColorStop(0.88, shadeColor(base, -42));
    g.addColorStop(1, shadeColor(base, -72));
  } else {
    g.addColorStop(0, "#4a4a4a");
    g.addColorStop(0.35, "#222");
    g.addColorStop(0.7, "#0a0a0a");
    g.addColorStop(1, "#000");
  }
  return g;
}

function drawBallNumber(ctx, x, y, r, id) {
  const nr = r * (id >= 9 ? 0.44 : 0.4);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, nr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = Math.max(0.5, r * 0.035);
  ctx.stroke();
  ctx.fillStyle = id === 8 ? "#111" : "#0a0a0a";
  ctx.font = `800 ${Math.max(9, r * 0.58)}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(id), x, y + 0.5);
}

function drawOneBall(ctx, x, y, r, b, colors) {
  const base = colors[b.id] || "#ccc";
  const id = b.id;

  ctx.fillStyle = "rgba(28, 72, 160, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x + r * 0.06, y + r * 0.62, r * 1.02, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(x + r * 0.04, y + r * 0.58, r * 0.88, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);

  if (id === 0) {
    ctx.fillStyle = ballGlossGradient(ctx, x, y, r, "#f4f4f4");
    ctx.fill();
  } else if (id >= 9 && id <= 15) {
    ctx.fillStyle = ballGlossGradient(ctx, x, y, r, "#f0f0f0");
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
    ctx.clip();
    const bandH = r * 0.52;
    const stripe = ctx.createLinearGradient(x - r, y, x + r, y);
    stripe.addColorStop(0, shadeColor(base, -28));
    stripe.addColorStop(0.5, base);
    stripe.addColorStop(1, shadeColor(base, -28));
    ctx.fillStyle = stripe;
    ctx.fillRect(x - r, y - bandH * 0.5, r * 2, bandH);
    ctx.restore();
  } else if (id === 8) {
    ctx.fillStyle = ballGlossGradient(ctx, x, y, r, "#222", { light: false });
    ctx.fill();
  } else {
    ctx.fillStyle = ballGlossGradient(ctx, x, y, r, base);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(0,0,0,0.14)";
  ctx.lineWidth = Math.max(0.45, r * 0.028);
  ctx.beginPath();
  ctx.arc(x, y, r - 0.3, 0, Math.PI * 2);
  ctx.stroke();

  if (id !== 0) drawBallNumber(ctx, x, y, r, id);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(x - r * 0.34, y - r * 0.38, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(x - r * 0.2, y - r * 0.24, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function paintBalls(ctx, opt) {
  const { w, h, TABLE_W, TABLE_H, CUSHION, BALL_R, balls, colors } = opt;
  const t = tableCanvasTransform(w, h, TABLE_W, TABLE_H, CUSHION ?? 30, BALL_R);
  const rPx = BALL_R * ((t.sx + t.sy) / 2);

  for (const b of balls) {
    if (b.pocketed) continue;
    const p = tableCoordToCanvas(b.x, b.y, t);
    drawOneBall(ctx, p.x, p.y, rPx, b, colors);
  }
}
