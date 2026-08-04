/** Compose board from baked assets only — no inline tile drawing. */

import {
  ASSET_SIZE,
  floorVariantForCell,
  getSokobanAtlas,
  pickWallTile,
} from "./assets/index.js";

const TILE = 48;

function blit(ctx, img, dx, dy, dw = TILE, dh = TILE) {
  ctx.drawImage(img, 0, 0, ASSET_SIZE, ASSET_SIZE, dx, dy, dw, dh);
}

const HINT_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function paintSokobanBoard(ctx, game, opt = {}) {
  const atlas = getSokobanAtlas();
  const { walls, goals, boxes, player, width, height } = game;
  const cell = TILE;
  const pad = 10;
  const w = width * cell + pad * 2;
  const h = height * cell + pad * 2;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
  bg.addColorStop(0, "#1e2838");
  bg.addColorStop(1, "#0a0e14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(pad, pad);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (walls[r]?.[c]) continue;
      const fi = floorVariantForCell(r, c);
      blit(ctx, atlas.floors[fi], c * cell, r * cell);
      if (goals[r]?.[c]) blit(ctx, atlas.goal, c * cell, r * cell);
    }
  }

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!walls[r]?.[c]) continue;
      const tile = pickWallTile(atlas, walls, r, c);
      blit(ctx, tile, c * cell, r * cell);
    }
  }

  for (const b of boxes) {
    const bx = b.c * cell;
    const by = b.r * cell;
    const onGoal = goals[b.r]?.[b.c];
    ctx.drawImage(
      atlas.shadow,
      0,
      0,
      ASSET_SIZE,
      ASSET_SIZE,
      bx + cell * 0.1,
      by + cell * 0.72,
      cell * 0.8,
      cell * 0.28
    );
    blit(ctx, onGoal ? atlas.crateGoal : atlas.crate, bx + cell * 0.06, by + cell * 0.02, cell * 0.88, cell * 0.88);
  }

  const px = player.c * cell + cell / 2;
  const py = player.r * cell + cell / 2;
  const dir = opt.facing || "down";
  const frame = opt.walkFrame ?? 0;
  const pSprites = atlas.players[dir] || atlas.players.down;
  const pImg = pSprites[frame % 2];

  ctx.drawImage(
    atlas.shadow,
    0,
    0,
    ASSET_SIZE,
    ASSET_SIZE,
    px - cell * 0.4,
    py + cell * 0.28,
    cell * 0.8,
    cell * 0.28
  );
  blit(ctx, pImg, px - cell / 2, py - cell / 2, cell, cell);

  const hd = opt.hintDir && HINT_VEC[opt.hintDir];
  if (hd) {
    ctx.save();
    ctx.shadowColor = "rgba(255, 201, 64, 0.9)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ffc940";
    ctx.font = `bold ${cell * 0.45}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hd[1] < 0 ? "↑" : hd[1] > 0 ? "↓" : hd[0] < 0 ? "←" : "→", px + hd[0] * cell * 0.55, py + hd[1] * cell * 0.55);
    ctx.restore();
  }

  ctx.restore();
}

export function boardCanvasSize(game) {
  const cell = TILE;
  const pad = 10;
  return { width: game.width * cell + pad * 2, height: game.height * cell + pad * 2 };
}

export function renderBoardToCanvas(canvas, game, opt = {}) {
  const hintDir = typeof opt === "string" ? opt : opt?.hintDir;
  const facing = typeof opt === "object" && opt?.facing;
  const walkFrame = typeof opt === "object" ? opt?.walkFrame : 0;
  const { width, height } = boardCanvasSize(game);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintSokobanBoard(ctx, game, { hintDir, facing, walkFrame });
}

export function boardCanvasHtml() {
  return `<canvas class="sokoban-board-canvas" data-sk-board aria-label="Bàn Sokoban"></canvas>`;
}

export function metalFrameHtml(inner) {
  return `<div class="sk-metal-outer">
    <div class="sk-metal-bevel"></div>
    <div class="sk-metal-rim-glow" aria-hidden="true"></div>
    <div class="sk-metal-inner">
      <span class="sk-rivet sk-rivet-tl"></span><span class="sk-rivet sk-rivet-tr"></span>
      <span class="sk-rivet sk-rivet-bl"></span><span class="sk-rivet sk-rivet-br"></span>
      <span class="sk-rivet sk-rivet-tc"></span><span class="sk-rivet sk-rivet-bc"></span>
      <span class="sk-rivet sk-rivet-ml"></span><span class="sk-rivet sk-rivet-mr"></span>
      <div class="sk-board-well" data-sk-touch>${inner}</div>
    </div>
  </div>`;
}
