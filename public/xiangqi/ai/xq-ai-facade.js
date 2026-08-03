/**
 * Xiangqi AI facade — multi-module evaluation + search.
 */
import { allLegalMoves, applyMove, isInCheck, oppositeSide } from "../xiangqi-engine.js";
import { SEARCH, DEBUG_XQ_EVAL } from "./xq-weights.js";
import { searchBestMove } from "./xq-search.js";
import { probeBook } from "./xq-book.js";
import { orderMoves } from "./xq-order.js";
import { evaluateBreakdown } from "./xq-eval.js";
import { logRootDebug, explainMove } from "./xq-debug.js";
import { createTT } from "./xq-tt.js";

const sharedTT = createTT();

function levelCfg(level) {
  return SEARCH[level] || SEARCH.medium;
}

/**
 * @param {string[][]} board
 * @param {"red"|"black"} side
 * @param {"easy"|"medium"|"hard"|"master"} level
 * @param {{ ply?: number }} [meta]
 */
export function pickAiMove(board, side, level = "medium", meta = {}) {
  const cfg = levelCfg(level);
  const ply = meta.ply || 0;
  const legal = meta.legalPool?.length ? meta.legalPool : allLegalMoves(board, side);
  if (!legal.length) return null;

  if (cfg.useBook && ply < 8 && !meta.legalPool) {
    const book = probeBook(board, side);
    if (book && legal.some((m) => m.fromR === book.fromR && m.fromC === book.fromC && m.toR === book.toR && m.toC === book.toC)) {
      if (DEBUG_XQ_EVAL) console.info("[xq-book]", book);
      return book;
    }
  }

  // Prefer giving check / good captures in ordering before search
  const ordered = orderMoves(board, legal, side);
  if (DEBUG_XQ_EVAL) logRootDebug(board, ordered, side, ply);

  const { move, score, nodes } = searchBestMove(board, side, {
    depth: cfg.depth,
    ply,
    tt: sharedTT,
    rootMoves: legal,
    maxMs: level === "master" ? 3200 : level === "hard" ? 2200 : 1500,
  });

  let chosen = move;
  if (!chosen) chosen = ordered[0];

  // Easy: mix slight noise by occasionally picking 2nd best shallow
  if (level === "easy" && ordered.length > 1 && Math.random() < 0.25) {
    const alt = ordered[1];
    const next = applyMove(board, alt.fromR, alt.fromC, alt.toR, alt.toC);
    if (!isInCheck(next, side)) chosen = alt;
  }

  if (DEBUG_XQ_EVAL && chosen) {
    const card = explainMove(board, chosen, side, ply);
    console.info("[xq-ai]", level, "nodes", nodes, "score", score, "\n" + JSON.stringify(card, null, 2));
  }

  return chosen;
}

export function aiThinkDelay(level) {
  if (level === "easy") return 140;
  if (level === "medium") return 200;
  if (level === "hard") return 280;
  return 380;
}

export function evaluatePosition(board) {
  return evaluateBreakdown(board);
}

export { explainMove, DEBUG_XQ_EVAL };
void oppositeSide;
