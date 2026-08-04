/**
 * Xiangqi AI — tunable constants (no scattered magic numbers).
 * Scores are from Red’s perspective unless noted.
 */

export const SIDE_RED = "red";
export const SIDE_BLACK = "black";

/** Material base values */
export const MATERIAL = {
  k: 100000,
  K: 100000,
  r: 900,
  R: 900,
  c: 450,
  C: 450,
  n: 430,
  N: 430,
  b: 200,
  B: 200,
  a: 200,
  A: 200,
  p: 100,
  P: 100,
};

/** Pawn after crossing river */
export const PAWN_CROSSED = 180;

/** Evaluation term weights */
export const EVAL_WEIGHTS = {
  material: 1,
  position: 1,
  mobility: 1.2,
  attack: 0.85,
  defense: 0.9,
  kingSafety: 1.15,
  center: 0.7,
  threat: 1,
  opening: 1,
  midgame: 0.8,
  endgame: 1,
  blunder: 1,
  coordination: 1,
  initiative: 0.9,
  structure: 0.85,
  pressure: 0.9,
};

/** King safety feature weights */
export const KING_SAFETY = {
  facingOpen: -300,
  missingAdvisor: -120,
  missingElephant: -80,
  protectorBonus: 25,
  protectorCap: 100,
  enemyNearKing: -45,
};

/** Structure / tactical static features */
export const STRUCTURE = {
  cannonScreen: 120,
  rookOpenFile: 80,
  rookSemiOpen: 35,
  rookTrapped: -60,
  knightCorner: -50,
  knightCentral: 40,
  pawnNearKing: 40,
  centerControl: 8,
};

/** Mobility per piece type (per legal/pseudo square) */
export const MOBILITY_W = {
  r: 3,
  c: 2.5,
  n: 4,
  b: 1.5,
  a: 1,
  p: 2,
  k: 0.5,
};

/** Search */
export const SEARCH = {
  easy: { depth: 2, noise: 35, useBook: false, bookPlies: 0 },
  medium: { depth: 3, noise: 0, useBook: true, bookPlies: 8 },
  hard: { depth: 4, noise: 0, useBook: true, bookPlies: 12 },
  master: { depth: 5, noise: 0, useBook: true, bookPlies: 20, master: true },
  qDepth: 2,
  masterQDepth: 4,
  ttSize: 1 << 16,
  mateScore: 100000,
};

/** Move ordering bonuses */
export const ORDER = {
  check: 10_000_000,
  captureBase: 1_000_000,
  killer: 90_000,
  historyMax: 80_000,
  promotionLike: 50_000, // crossed pawn push toward king
};

/** Opening: first N plies (half-moves) */
export const OPENING_PLIES = 20;

/** Debug */
export const DEBUG_XQ_EVAL =
  typeof globalThis !== "undefined" &&
  (globalThis.localStorage?.getItem?.("xq-debug-eval") === "1" ||
    globalThis.__XQ_DEBUG_EVAL__ === true);
