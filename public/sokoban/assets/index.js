/**
 * Sokoban asset atlas — bake once, compose only in sokoban-render.js.
 * Swap canvases for PNG img tags later without changing the board composer.
 */

import { paintBrickWallTile, paintBrickWallCapTile } from "./brick-wall.js";
import { paintStoneFloorTile } from "./stone-floor.js";
import { paintGoalTile } from "./goal-tile.js";
import { paintWoodenCrate } from "./wooden-crate.js";
import { paintPlayerSprite } from "./player-sprite.js";
import { paintObjectShadow } from "./object-shadow.js";

export const ASSET_SIZE = 64;

/** @typedef {{ wall: HTMLCanvasElement, wallCap: HTMLCanvasElement, goal: HTMLCanvasElement, crate: HTMLCanvasElement, crateGoal: HTMLCanvasElement, shadow: HTMLCanvasElement, floors: HTMLCanvasElement[], players: Record<string, HTMLCanvasElement[]> }} SokobanAtlas */

function bake(fn, ...args) {
  const c = document.createElement("canvas");
  c.width = ASSET_SIZE;
  c.height = ASSET_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  fn(ctx, ASSET_SIZE, ...args);
  return c;
}

/** @returns {SokobanAtlas} */
export function buildSokobanAtlas() {
  const floors = [];
  for (let i = 0; i < 24; i++) {
    floors.push(bake(paintStoneFloorTile, i));
  }

  const players = {};
  for (const dir of ["down", "up", "left", "right"]) {
    players[dir] = [bake(paintPlayerSprite, dir, 0), bake(paintPlayerSprite, dir, 1)];
  }

  return {
    wall: bake(paintBrickWallTile),
    wallCap: bake(paintBrickWallCapTile),
    goal: bake(paintGoalTile),
    crate: bake(paintWoodenCrate, false),
    crateGoal: bake(paintWoodenCrate, true),
    shadow: bake(paintObjectShadow),
    floors,
    players,
  };
}

let atlasCache = null;

export function getSokobanAtlas() {
  if (!atlasCache) atlasCache = buildSokobanAtlas();
  return atlasCache;
}

export function floorVariantForCell(r, c) {
  return ((r * 17 + c * 31) >>> 0) % 24;
}

export function pickWallTile(atlas, walls, r, c) {
  const adjFloor =
    (r > 0 && !walls[r - 1]?.[c]) ||
    (r < walls.length - 1 && !walls[r + 1]?.[c]) ||
    (c > 0 && !walls[r]?.[c - 1]) ||
    (c < (walls[r]?.length ?? 0) - 1 && !walls[r]?.[c + 1]);
  return adjFloor ? atlas.wallCap : atlas.wall;
}
