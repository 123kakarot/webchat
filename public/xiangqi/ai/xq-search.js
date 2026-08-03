import {
  allLegalMoves,
  applyMove,
  isInCheck,
  oppositeSide,
  gameResult,
} from "../xiangqi-engine.js";
import { evaluateForSide } from "./xq-eval.js";
import { orderMoves } from "./xq-order.js";
import { createTT, positionKey, TT_EXACT, TT_LOWER, TT_UPPER } from "./xq-tt.js";
import { SEARCH } from "./xq-weights.js";

/**
 * Negamax alpha-beta with TT + quiescence + iterative deepening.
 */
export function searchBestMove(board, side, opts = {}) {
  const depth = opts.depth ?? 4;
  const ply = opts.ply ?? 0;
  const maxMs = opts.maxMs ?? 2500;
  const tt = opts.tt || createTT();
  const killers = [[], []];
  const history = new Map();
  let nodes = 0;
  let bestMove = null;
  let bestScore = -Infinity;
  const tStart = Date.now();
  let timedOut = false;

  function timeUp() {
    return Date.now() - tStart > maxMs;
  }

  function isQuiet(m) {
    return !(m.capture && m.capture !== ".");
  }

  function quiesce(b, s, alpha, beta, qDepth, pathPly) {
    nodes++;
    const stand = evaluateForSide(b, s, { ply: pathPly });
    if (qDepth <= 0) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    let moves = allLegalMoves(b, s).filter((m) => {
      if (m.capture && m.capture !== ".") return true;
      const n = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
      return isInCheck(n, oppositeSide(s));
    });
    moves = orderMoves(b, moves, s, { history });

    for (const m of moves) {
      const next = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
      const sc = -quiesce(next, oppositeSide(s), -beta, -alpha, qDepth - 1, pathPly + 1);
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function negamax(b, s, d, alpha, beta, pathPly, plyFromRoot) {
    nodes++;
    const key = positionKey(b, s);
    const probe = tt.get(key);
    if (probe && probe.depth >= d) {
      if (probe.flag === TT_EXACT) return probe.score;
      if (probe.flag === TT_LOWER) alpha = Math.max(alpha, probe.score);
      if (probe.flag === TT_UPPER) beta = Math.min(beta, probe.score);
      if (alpha >= beta) return probe.score;
    }

    const res = gameResult(b, s);
    if (res === "draw") return 0;
    if (res) {
      // res is winner side
      const mate = res === s ? SEARCH.mateScore - pathPly : -SEARCH.mateScore + pathPly;
      return mate;
    }

    if (d <= 0) return quiesce(b, s, alpha, beta, SEARCH.qDepth, pathPly);
    if (timeUp()) {
      timedOut = true;
      return evaluateForSide(b, s, { ply: pathPly });
    }

    let moves = allLegalMoves(b, s);
    if (!moves.length) return -SEARCH.mateScore + pathPly;

    const killSlot = killers[plyFromRoot & 1] || [];
    moves = orderMoves(b, moves, s, { killers: killSlot, history });
    if (probe?.best) {
      const bi = moves.findIndex(
        (m) =>
          m.fromR === probe.best.fromR &&
          m.fromC === probe.best.fromC &&
          m.toR === probe.best.toR &&
          m.toC === probe.best.toC
      );
      if (bi > 0) {
        const [bm] = moves.splice(bi, 1);
        moves.unshift(bm);
      }
    }

    let best = -Infinity;
    let localBest = null;
    let flag = TT_UPPER;
    const alphaOrig = alpha;

    for (const m of moves) {
      const next = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
      const sc = -negamax(next, oppositeSide(s), d - 1, -beta, -alpha, pathPly + 1, plyFromRoot + 1);
      if (sc > best) {
        best = sc;
        localBest = m;
      }
      if (sc > alpha) {
        alpha = sc;
        flag = TT_EXACT;
        const hk = `${m.fromR},${m.fromC},${m.toR},${m.toC}`;
        history.set(hk, (history.get(hk) || 0) + d * d);
      }
      if (alpha >= beta) {
        flag = TT_LOWER;
        if (isQuiet(m)) {
          killers[plyFromRoot & 1] = [m, killSlot[0]].filter(Boolean).slice(0, 2);
        }
        break;
      }
    }

    tt.set(key, { depth: d, score: best, flag, best: localBest });
    void alphaOrig;
    return best;
  }

  // Iterative deepening
  for (let d = 1; d <= depth; d++) {
    if (timeUp()) break;
    let alpha = -Infinity;
    let beta = Infinity;
    let moves = orderMoves(board, allLegalMoves(board, side), side, { history });
    if (bestMove) {
      const bi = moves.findIndex(
        (m) =>
          m.fromR === bestMove.fromR &&
          m.fromC === bestMove.fromC &&
          m.toR === bestMove.toR &&
          m.toC === bestMove.toC
      );
      if (bi > 0) {
        const [bm] = moves.splice(bi, 1);
        moves.unshift(bm);
      }
    }

    let iterBest = null;
    let iterScore = -Infinity;
    for (const m of moves) {
      if (timeUp()) break;
      const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
      const sc = -negamax(next, oppositeSide(side), d - 1, -beta, -alpha, ply + 1, 1);
      if (sc > iterScore) {
        iterScore = sc;
        iterBest = m;
      }
      if (sc > alpha) alpha = sc;
    }
    if (iterBest && !timedOut) {
      bestMove = iterBest;
      bestScore = iterScore;
    } else if (iterBest && !bestMove) {
      bestMove = iterBest;
      bestScore = iterScore;
    }
  }

  return {
    move: bestMove || allLegalMoves(board, side)[0] || null,
    score: bestScore,
    nodes,
    timedOut,
  };
}
