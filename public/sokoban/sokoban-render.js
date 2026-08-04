/** Canvas renderer — warehouse bricks, wood crates, glossy player. */

const TILE = 44;

function drawBrick(ctx, x, y, s) {
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, "#8b5a3c");
  g.addColorStop(0.45, "#6b3f28");
  g.addColorStop(1, "#4a2818");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  const m = s * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y + m);
  ctx.lineTo(x + s, y + m);
  ctx.moveTo(x + m * 0.5, y);
  ctx.lineTo(x + m * 0.5, y + m);
  ctx.moveTo(x + m * 1.2, y + m);
  ctx.lineTo(x + m * 1.2, y + s);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,220,180,0.06)";
  ctx.fillRect(x + 2, y + 2, s - 4, s * 0.22);
}

function drawFloor(ctx, x, y, s, isGoal) {
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, "#3a4658");
  g.addColorStop(1, "#252f3d");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, s, s);
  if (isGoal) {
    const pad = s * 0.22;
    ctx.strokeStyle = "rgba(245, 197, 66, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(245, 197, 66, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.32, y + s * 0.32);
    ctx.lineTo(x + s * 0.68, y + s * 0.68);
    ctx.moveTo(x + s * 0.68, y + s * 0.32);
    ctx.lineTo(x + s * 0.32, y + s * 0.68);
    ctx.stroke();
  }
}

function drawCrate(ctx, cx, cy, r, onGoal) {
  const x = cx - r;
  const y = cy - r;
  const s = r * 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  const wg = ctx.createLinearGradient(x, y, x + s, y + s);
  wg.addColorStop(0, "#d4a066");
  wg.addColorStop(0.5, "#a66b32");
  wg.addColorStop(1, "#6b4018");
  ctx.fillStyle = wg;
  roundRect(ctx, x, y, s, s, s * 0.12);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(40,20,8,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy);
  ctx.lineTo(cx + r * 0.55, cy);
  ctx.moveTo(cx, cy - r * 0.55);
  ctx.lineTo(cx, cy + r * 0.55);
  ctx.stroke();
  if (onGoal) {
    ctx.strokeStyle = "rgba(245, 197, 66, 0.9)";
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1, y + 1, s - 2, s - 2, s * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer(ctx, cx, cy, r) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#b8f0ff");
  g.addColorStop(0.35, "#5ec8ff");
  g.addColorStop(0.85, "#1a7ec8");
  g.addColorStop(1, "#0d4a78");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.beginPath();
  ctx.arc(cx - r * 0.28, cy - r * 0.32, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

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

const HINT_VEC = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export function paintSokobanBoard(ctx, game, opt = {}) {
  const { walls, goals, boxes, player, width, height } = game;
  const cell = TILE;
  const pad = 14;
  const w = width * cell + pad * 2;
  const h = height * cell + pad * 2;

  ctx.clearRect(0, 0, w, h);

  const frameG = ctx.createLinearGradient(0, 0, w, h);
  frameG.addColorStop(0, "#2a3544");
  frameG.addColorStop(1, "#151c26");
  ctx.fillStyle = frameG;
  roundRect(ctx, 4, 4, w - 8, h - 8, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(120, 160, 220, 0.35)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  ctx.translate(pad, pad);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const x = c * cell;
      const y = r * cell;
      if (walls[r]?.[c]) drawBrick(ctx, x, y, cell);
      else drawFloor(ctx, x, y, cell, goals[r]?.[c]);
    }
  }

  for (const b of boxes) {
    const onGoal = goals[b.r]?.[b.c];
    const cx = b.c * cell + cell / 2;
    const cy = b.r * cell + cell / 2;
    drawCrate(ctx, cx, cy, cell * 0.38, onGoal);
  }

  const pcx = player.c * cell + cell / 2;
  const pcy = player.r * cell + cell / 2;
  drawPlayer(ctx, pcx, pcy, cell * 0.34);

  const hd = opt.hintDir && HINT_VEC[opt.hintDir];
  if (hd) {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `bold ${cell * 0.45}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hd[1] < 0 ? "↑" : hd[1] > 0 ? "↓" : hd[0] < 0 ? "←" : "→", pcx + hd[0] * cell * 0.55, pcy + hd[1] * cell * 0.55);
  }

  ctx.restore();
}

export function boardCanvasSize(game) {
  const cell = TILE;
  const pad = 14;
  return {
    width: game.width * cell + pad * 2,
    height: game.height * cell + pad * 2,
  };
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
  return `<div class="sokoban-arena-frame"><canvas class="sokoban-board-canvas" data-sk-board aria-label="Bàn Sokoban"></canvas></div>`;
}
