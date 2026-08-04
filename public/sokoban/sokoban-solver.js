import { cloneGame, createGameFromLevel, isWin, stateKey, tryMove } from "./sokoban-engine.js";

const ORDER = ["up", "left", "right", "down"];

export function solveLevel(game, maxNodes = 120000) {
  const root = cloneGame(game);
  root.history = [];
  root.moveLog = [];
  const q = [{ g: root, path: [] }];
  const seen = new Set([stateKey(root)]);

  while (q.length && seen.size < maxNodes) {
    const { g, path } = q.shift();
    if (isWin(g)) return path;

    for (const dir of ORDER) {
      const trial = cloneGame(g);
      trial.history = [];
      trial.moveLog = [];
      const { ok, game: next } = tryMove(trial, dir);
      if (!ok) continue;
      next.history = [];
      next.moveLog = [];
      const k = stateKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ g: next, path: path.concat(dir) });
    }
  }
  return null;
}

export function hintMove(game) {
  const sol = solveLevel(game, 80000);
  return sol?.[0] ?? null;
}

export function replayMoves(game, path) {
  let g = createGameFromLevel(game.level);
  for (const d of path) {
    const r = tryMove(g, d);
    if (!r.ok) break;
    g = r.game;
  }
  return g;
}
