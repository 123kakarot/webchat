/** High-quality pool table / ball canvas rendering. */

export function shadeColor(hex, amt) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return hex;
  const n = (v) => Math.max(0, Math.min(255, v + amt));
  const r = n(parseInt(h.slice(0, 2), 16));
  const g = n(parseInt(h.slice(2, 4), 16));
  const b = n(parseInt(h.slice(4, 6), 16));
  return `rgb(${r},${g},${b})`;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ w:number,h:number,TABLE_W:number,TABLE_H:number,CUSHION:number,POCKET_R:number,felt:string,pockets:()=>any[] }} opt
 */
export function paintTable(ctx, opt) {
  const { w, h, TABLE_W, TABLE_H, CUSHION, POCKET_R, felt, pockets } = opt;
  const sx = w / TABLE_W;
  const sy = h / TABLE_H;
  ctx.clearRect(0, 0, w, h);

  const wood = ctx.createLinearGradient(0, 0, w, h);
  wood.addColorStop(0, "#7a4a24");
  wood.addColorStop(0.3, "#4a2a14");
  wood.addColorStop(0.65, "#5c3418");
  wood.addColorStop(1, "#1e1008");
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, w, h);

  // Chrome-ish rail edge
  ctx.strokeStyle = "rgba(255,220,160,0.28)";
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, w - 24, h - 24);

  const fx = CUSHION * sx;
  const fy = CUSHION * sy;
  const fw = (TABLE_W - CUSHION * 2) * sx;
  const fh = (TABLE_H - CUSHION * 2) * sy;

  const roundFelt = () => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(fx, fy, fw, fh, 16);
    else ctx.rect(fx, fy, fw, fh);
  };

  roundFelt();
  ctx.fillStyle = felt;
  ctx.fill();

  // Overhead soft light
  roundFelt();
  const light = ctx.createRadialGradient(
    w * 0.46,
    h * 0.34,
    Math.min(w, h) * 0.06,
    w * 0.5,
    h * 0.48,
    Math.max(w, h) * 0.68
  );
  light.addColorStop(0, "rgba(255,255,235,0.34)");
  light.addColorStop(0.28, "rgba(210,240,200,0.14)");
  light.addColorStop(0.55, "rgba(0,40,20,0.04)");
  light.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = light;
  ctx.fill();

  ctx.save();
  roundFelt();
  ctx.clip();
  // Cloth noise
  for (let i = 0; i < 120; i++) {
    const px = fx + ((i * 89) % fw);
    const py = fy + ((i * 57) % fh);
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.035)";
    ctx.fillRect(px, py, 2.5, 2.5);
  }
  // Cushion inner shade
  const topShade = ctx.createLinearGradient(fx, fy, fx, fy + 22);
  topShade.addColorStop(0, "rgba(0,0,0,0.4)");
  topShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topShade;
  ctx.fillRect(fx, fy, fw, 22);
  const botShade = ctx.createLinearGradient(fx, fy + fh, fx, fy + fh - 22);
  botShade.addColorStop(0, "rgba(0,0,0,0.4)");
  botShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = botShade;
  ctx.fillRect(fx, fy + fh - 22, fw, 22);
  const leftShade = ctx.createLinearGradient(fx, fy, fx + 22, fy);
  leftShade.addColorStop(0, "rgba(0,0,0,0.28)");
  leftShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = leftShade;
  ctx.fillRect(fx, fy, 22, fh);
  const rightShade = ctx.createLinearGradient(fx + fw, fy, fx + fw - 22, fy);
  rightShade.addColorStop(0, "rgba(0,0,0,0.28)");
  rightShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rightShade;
  ctx.fillRect(fx + fw - 22, fy, 22, fh);
  ctx.restore();

  // Kitchen
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.setLineDash([8, 7]);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo((TABLE_W / 3) * sx, CUSHION * sy);
  ctx.lineTo((TABLE_W / 3) * sx, (TABLE_H - CUSHION) * sy);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const p of pockets()) {
    const px = p.x * sx;
    const py = p.y * sy;
    const pr = POCKET_R * sx * 0.98;
    const pg = ctx.createRadialGradient(px - pr * 0.2, py - pr * 0.2, pr * 0.08, px, py, pr);
    pg.addColorStop(0, "#333");
    pg.addColorStop(0.45, "#0c0c0c");
    pg.addColorStop(1, "#000");
    ctx.beginPath();
    ctx.fillStyle = pg;
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(200,160,90,0.6)";
    ctx.lineWidth = 2.8;
    ctx.arc(px, py, pr + 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ w:number,h:number,TABLE_W:number,TABLE_H:number,BALL_R:number,balls:any[],colors:Record<number,string> }} opt
 */
export function paintBalls(ctx, opt) {
  const { w, h, TABLE_W, TABLE_H, BALL_R, balls, colors } = opt;
  const sx = w / TABLE_W;
  const sy = h / TABLE_H;

  // Shadows first
  for (const b of balls) {
    if (b.pocketed) continue;
    const x = b.x * sx;
    const y = b.y * sy;
    const r = BALL_R * sx;
    const sh = ctx.createRadialGradient(x + r * 0.05, y + r * 0.62, r * 0.1, x + r * 0.05, y + r * 0.7, r * 1.4);
    sh.addColorStop(0, "rgba(0,0,0,0.5)");
    sh.addColorStop(0.5, "rgba(0,0,0,0.2)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.fillStyle = sh;
    ctx.ellipse(x + r * 0.1, y + r * 0.58, r * 1.12, r * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const b of balls) {
    if (b.pocketed) continue;
    const x = b.x * sx;
    const y = b.y * sy;
    const r = BALL_R * sx;
    const base = colors[b.id] || "#ccc";

    const body = ctx.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.04, x + r * 0.05, y + r * 0.15, r * 1.08);
    if (b.id === 0) {
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.4, "#f4f4f4");
      body.addColorStop(0.78, "#c9c9c9");
      body.addColorStop(1, "#8e8e8e");
    } else if (b.id === 8) {
      body.addColorStop(0, "#666");
      body.addColorStop(0.35, "#222");
      body.addColorStop(0.85, "#070707");
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
      band.addColorStop(0, shadeColor(base, -15));
      band.addColorStop(0.16, "#fff");
      band.addColorStop(0.84, "#fff");
      band.addColorStop(1, shadeColor(base, -15));
      ctx.fillStyle = band;
      ctx.fillRect(x - r, y - r * 0.4, r * 2, r * 0.8);
      ctx.restore();
    }

    if (b.id !== 0) {
      const nr = r * (b.id >= 9 ? 0.44 : 0.4);
      ctx.beginPath();
      ctx.fillStyle = b.id === 8 ? "#151515" : "#fafafa";
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = b.id === 8 ? "#fff" : "#111";
      ctx.font = `bold ${Math.max(12, r * 0.7)}px Be Vietnam Pro, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(b.id), x, y + 0.5);
    }

    // Gloss specular
    const spec = ctx.createRadialGradient(
      x - r * 0.38,
      y - r * 0.45,
      r * 0.01,
      x - r * 0.25,
      y - r * 0.32,
      r * 0.58
    );
    spec.addColorStop(0, "rgba(255,255,255,0.95)");
    spec.addColorStop(0.2, "rgba(255,255,255,0.5)");
    spec.addColorStop(0.55, "rgba(255,255,255,0.08)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.fillStyle = spec;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Secondary smaller glint
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.ellipse(x - r * 0.28, y - r * 0.36, r * 0.14, r * 0.09, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // Rim highlight
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.arc(x, y, r - 0.8, -Math.PI * 0.95, -Math.PI * 0.2);
    ctx.stroke();

    // Ambient occlusion at bottom of sphere
    const ao = ctx.createRadialGradient(x, y + r * 0.25, r * 0.2, x, y, r);
    ao.addColorStop(0, "rgba(0,0,0,0)");
    ao.addColorStop(0.7, "rgba(0,0,0,0)");
    ao.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.beginPath();
    ctx.fillStyle = ao;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
