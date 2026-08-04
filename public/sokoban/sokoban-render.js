/** Canvas — 3D tiles, glowing targets, cartoon player. */

const TILE = 46;

function roundRect(ctx, x, y, w, h, rad) {
  const r = Math.min(rad, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBrick3D(ctx, x, y, s) {
  const h = s * 0.22;
  ctx.fillStyle = "#3d2518";
  ctx.fillRect(x, y + s - h, s, h);
  const g = ctx.createLinearGradient(x, y, x, y + s - h);
  g.addColorStop(0, "#a66b45");
  g.addColorStop(0.4, "#7a4a2e");
  g.addColorStop(1, "#5c351f");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, s, s - h);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  const m = s * 0.48;
  ctx.beginPath();
  ctx.moveTo(x, y + (s - h) * 0.5);
  ctx.lineTo(x + s, y + (s - h) * 0.5);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,200,140,0.12)";
  ctx.fillRect(x + 2, y + 2, s - 4, (s - h) * 0.35);
}

function drawFloor(ctx, x, y, s, isGoal) {
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, "#454f5e");
  g.addColorStop(1, "#2a323f");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  if (isGoal) {
    ctx.save();
    ctx.shadowColor = "rgba(255, 201, 64, 0.75)";
    ctx.shadowBlur = 14;
    const pad = s * 0.2;
    ctx.strokeStyle = "#ffc940";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
    ctx.strokeStyle = "rgba(255, 220, 120, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.3, y + s * 0.3);
    ctx.lineTo(x + s * 0.7, y + s * 0.7);
    ctx.moveTo(x + s * 0.7, y + s * 0.3);
    ctx.lineTo(x + s * 0.3, y + s * 0.7);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCrate(ctx, cx, cy, r, onGoal) {
  const x = cx - r;
  const y = cy - r;
  const s = r * 2;
  const lift = s * 0.08;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.85, r * 0.9, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  const wg = ctx.createLinearGradient(x, y - lift, x + s, y + s);
  wg.addColorStop(0, "#e8b878");
  wg.addColorStop(0.45, "#b87333");
  wg.addColorStop(1, "#6b4018");
  ctx.fillStyle = wg;
  roundRect(ctx, x, y - lift, s, s, s * 0.1);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#4a2810";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy - lift);
  ctx.lineTo(cx + r * 0.6, cy - lift);
  ctx.moveTo(cx, cy - lift - r * 0.55);
  ctx.lineTo(cx, cy - lift + r * 0.55);
  ctx.stroke();
  if (onGoal) {
    ctx.strokeStyle = "#ffc940";
    ctx.lineWidth = 2;
    roundRect(ctx, x + 2, y - lift + 2, s - 4, s - 4, s * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.1, r * 0.85, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  const bodyR = r * 0.55;
  ctx.fillStyle = "#2a7fd4";
  ctx.beginPath();
  ctx.arc(cx, cy + bodyR * 0.15, bodyR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffccaa";
  ctx.beginPath();
  ctx.arc(cx, cy - bodyR * 0.55, bodyR * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e03030";
  roundRect(ctx, cx - bodyR * 0.5, cy - bodyR * 1.15, bodyR, bodyR * 0.35, 4);
  ctx.fill();
  ctx.restore();
}

const HINT_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function paintSokobanBoard(ctx, game, opt = {}) {
  const { walls, goals, boxes, player, width, height } = game;
  const cell = TILE;
  const pad = 8;
  const w = width * cell + pad * 2;
  const h = height * cell + pad * 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1a2230";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(pad, pad);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const x = c * cell;
      const y = r * cell;
      if (walls[r]?.[c]) drawBrick3D(ctx, x, y, cell);
      else drawFloor(ctx, x, y, cell, goals[r]?.[c]);
    }
  }
  for (const b of boxes) {
    drawCrate(ctx, b.c * cell + cell / 2, b.r * cell + cell / 2, cell * 0.36, goals[b.r]?.[b.c]);
  }
  drawPlayer(ctx, player.c * cell + cell / 2, player.r * cell + cell / 2, cell * 0.38);
  const hd = opt.hintDir && HINT_VEC[opt.hintDir];
  if (hd) {
    const pcx = player.c * cell + cell / 2;
    const pcy = player.r * cell + cell / 2;
    ctx.fillStyle = "#ffc940";
    ctx.font = `bold ${cell * 0.5}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hd[1] < 0 ? "↑" : hd[1] > 0 ? "↓" : hd[0] < 0 ? "←" : "→", pcx + hd[0] * cell * 0.6, pcy + hd[1] * cell * 0.6);
  }
  ctx.restore();
}

export function boardCanvasSize(game) {
  const cell = TILE;
  const pad = 8;
  return { width: game.width * cell + pad * 2, height: game.height * cell + pad * 2 };
}

export function renderBoardToCanvas(canvas, game, hintDir = null) {
  const { width, height } = boardCanvasSize(game);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintSokobanBoard(ctx, game, { hintDir });
}

export function boardCanvasHtml() {
  return `<canvas class="sokoban-board-canvas" data-sk-board aria-label="Bàn Sokoban"></canvas>`;
}

export function metalFrameHtml(inner) {
  return `<div class="sk-metal-outer">
    <div class="sk-metal-bevel"></div>
    <div class="sk-metal-inner">
      <span class="sk-rivet sk-rivet-tl"></span><span class="sk-rivet sk-rivet-tr"></span>
      <span class="sk-rivet sk-rivet-bl"></span><span class="sk-rivet sk-rivet-br"></span>
      <div class="sk-board-well" data-sk-touch>${inner}</div>
    </div>
  </div>`;
}
