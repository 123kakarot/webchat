/**
 * Xiangqi AI facade — multi-module evaluation + search.
 */
import {
  allLegalMoves,
  applyMove,
  isInCheck,
  oppositeSide,
  findKing,
  pieceSide,
} from "../xiangqi-engine.js";
import { SEARCH, DEBUG_XQ_EVAL, MATERIAL } from "./xq-weights.js";
import { searchBestMove } from "./xq-search.js";
import { probeBook } from "./xq-book.js";
import { orderMoves, seeScore } from "./xq-order.js";
import { evaluateBreakdown, gamePhase, evaluateForSide } from "./xq-eval.js";
import { logRootDebug, explainMove } from "./xq-debug.js";
import { createTT } from "./xq-tt.js";

const sharedTT = createTT();

/** Persist attack wing across moves in a game (soft planning). */
let attackWing = null; // "left" | "right" | "center" | null
let attackWingHits = 0;

function levelCfg(level) {
  return SEARCH[level] || SEARCH.medium;
}

function wingOf(c) {
  if (c <= 2) return "left";
  if (c >= 6) return "right";
  return "center";
}

function countMajors(board) {
  let n = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || p === ".") continue;
      const t = p.toLowerCase();
      if (t === "r" || t === "c" || t === "n") n++;
    }
  }
  return n;
}

/** Dynamic depth for Master — browser-safe caps. */
function masterDepth(board, side, ply) {
  let d = 5;
  if (isInCheck(board, side)) d = 7;
  const phase = gamePhase(board);
  if (phase > 0.55) d = Math.max(d, 6);
  if (phase > 0.72 || countMajors(board) <= 6) d = Math.max(d, 7);
  // Near mate / late game with few pieces
  if (countMajors(board) <= 4) d = Math.max(d, 8);
  if (ply < 4) d = Math.min(d, 5);
  return Math.min(8, d);
}

function masterTimeBudget(board, side) {
  if (isInCheck(board, side)) return 4500;
  const phase = gamePhase(board);
  const moves = allLegalMoves(board, side).length;
  if (moves <= 8) return 900;
  if (phase > 0.7) return 3800;
  if (moves >= 40) return 4200;
  return 2800;
}

/**
 * Drop / deprioritize blunders before search.
 * Hard-filter only when alternatives remain.
 */
function filterBlunders(board, side, moves) {
  if (moves.length <= 1) return moves;
  const safe = [];
  const risky = [];
  const myKing = findKing(board, side);

  for (const m of moves) {
    const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
    let bad = false;

    // Losing capture by SEE
    if (m.capture && m.capture !== ".") {
      const see = seeScore(board, m.fromR, m.fromC, m.toR, m.toC);
      if (see < -280) bad = true;
    }

    // Hang a major piece for free after quiet move
    if (!bad && isQuietish(m)) {
      const piece = next[m.toR][m.toC];
      const val = MATERIAL[piece] || 0;
      if (val >= 430) {
        const opp = oppositeSide(side);
        const oppCan = canCapture(next, opp, m.toR, m.toC);
        const weDefend = canCapture(next, side, m.toR, m.toC);
        if (oppCan && !weDefend) bad = true;
      }
    }

    // Open king file carelessly (facing generals risk already illegal; extra: leave king bare)
    if (!bad && myKing && m.piece && m.piece.toLowerCase() === "a") {
      // Moving last advisor while checked-ish — soft
      void 0;
    }

    if (bad) risky.push(m);
    else safe.push(m);
  }
  return safe.length ? safe : moves;
}

function isQuietish(m) {
  return !(m.capture && m.capture !== ".");
}

function canCapture(board, side, tr, tc) {
  const moves = allLegalMoves(board, side);
  return moves.some((m) => m.toR === tr && m.toC === tc);
}

/** Soft bias toward continuing attack on same wing. */
function applyAttackPlan(board, side, moves) {
  if (!attackWing || !moves.length) return moves;
  const scored = moves.map((m) => {
    let bonus = 0;
    const wTo = wingOf(m.toC);
    const wFrom = wingOf(m.fromC);
    if (wTo === attackWing || wFrom === attackWing) bonus += 40;
    // Prefer checking / capturing on that wing
    const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
    if (isInCheck(next, oppositeSide(side)) && wTo === attackWing) bonus += 80;
    return { m, bonus };
  });
  scored.sort((a, b) => b.bonus - a.bonus);
  // Reorder: keep high-bias moves early but don't drop others
  return scored.map((x) => x.m);
}

function updateAttackPlan(move, board, side) {
  if (!move) return;
  const next = applyMove(board, move.fromR, move.fromC, move.toR, move.toC);
  const checking = isInCheck(next, oppositeSide(side));
  const w = wingOf(move.toC);
  if (checking || (move.capture && move.capture !== ".")) {
    if (attackWing === w) attackWingHits++;
    else {
      attackWing = w;
      attackWingHits = 1;
    }
  } else if (attackWingHits < 2) {
    attackWing = null;
    attackWingHits = 0;
  }
}

/**
 * Prefer exchanging when ahead; keep pieces when behind (master root nudge).
 */
function strategicRootOrder(board, side, moves) {
  const score = evaluateForSide(board, side, { master: true, masterHeavy: false, ply: 0 });
  if (Math.abs(score) < 120) return moves;
  const ahead = score > 120;
  const scored = moves.map((m) => {
    let s = 0;
    if (m.capture && m.capture !== ".") {
      const see = seeScore(board, m.fromR, m.fromC, m.toR, m.toC);
      if (ahead && see >= 0) s += 50; // trade down when ahead
      if (!ahead && see < 80) s -= 40; // don't trade when behind unless winning capture
    }
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

/**
 * @param {string[][]} board
 * @param {"red"|"black"} side
 * @param {"easy"|"medium"|"hard"|"master"} level
 * @param {{ ply?: number, legalPool?: any[] }} [meta]
 */
export function pickAiMove(board, side, level = "medium", meta = {}) {
  const cfg = levelCfg(level);
  const ply = meta.ply || 0;
  let legal = meta.legalPool?.length ? meta.legalPool : allLegalMoves(board, side);
  if (!legal.length) return null;

  const bookPlies = cfg.bookPlies ?? (cfg.useBook ? 8 : 0);
  if (cfg.useBook && ply < bookPlies) {
    const book = probeBook(board, side);
    if (
      book &&
      legal.some(
        (m) =>
          m.fromR === book.fromR &&
          m.fromC === book.fromC &&
          m.toR === book.toR &&
          m.toC === book.toC
      )
    ) {
      if (DEBUG_XQ_EVAL) console.info("[xq-book]", book);
      updateAttackPlan(book, board, side);
      return book;
    }
  }

  const isMaster = Boolean(cfg.master) || level === "master";

  if (isMaster) {
    legal = filterBlunders(board, side, legal);
    legal = strategicRootOrder(board, side, legal);
    legal = applyAttackPlan(board, side, legal);
  }

  const ordered = orderMoves(board, legal, side);
  if (DEBUG_XQ_EVAL) logRootDebug(board, ordered, side, ply);

  const depth = isMaster ? masterDepth(board, side, ply) : cfg.depth;
  const maxMs = isMaster
    ? masterTimeBudget(board, side)
    : level === "hard"
      ? 2200
      : 1500;

  const { move, score, nodes } = searchBestMove(board, side, {
    depth,
    ply,
    tt: sharedTT,
    rootMoves: legal,
    maxMs,
    master: isMaster,
  });

  let chosen = move;
  if (!chosen) chosen = ordered[0];

  // Easy: mix slight noise
  if (level === "easy" && ordered.length > 1 && Math.random() < 0.25) {
    const alt = ordered[1];
    const next = applyMove(board, alt.fromR, alt.fromC, alt.toR, alt.toC);
    if (!isInCheck(next, side)) chosen = alt;
  }

  if (isMaster && chosen) updateAttackPlan(chosen, board, side);

  if (DEBUG_XQ_EVAL && chosen) {
    const card = explainMove(board, chosen, side, ply);
    console.info(
      "[xq-ai]",
      level,
      "depth",
      depth,
      "nodes",
      nodes,
      "score",
      score,
      "\n" + JSON.stringify(card, null, 2)
    );
  }

  return chosen;
}

export function aiThinkDelay(level) {
  if (level === "easy") return 140;
  if (level === "medium") return 200;
  if (level === "hard") return 280;
  return 520;
}

export function evaluatePosition(board) {
  return evaluateBreakdown(board, { master: true, masterHeavy: true });
}

export { explainMove, DEBUG_XQ_EVAL };
void pieceSide;
