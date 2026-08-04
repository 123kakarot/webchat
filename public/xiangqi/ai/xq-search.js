import {
  allLegalMoves,
  applyMove,
  isInCheck,
  oppositeSide,
  gameResult,
  pieceSide,
} from "../xiangqi-engine.js";
import { evaluateForSide, gamePhase } from "./xq-eval.js";
import { orderMoves, seeScore } from "./xq-order.js";
import { createTT, positionKey, TT_EXACT, TT_LOWER, TT_UPPER } from "./xq-tt.js";
import { SEARCH, MATERIAL } from "./xq-weights.js";

/**
 * Negamax alpha-beta with TT + quiescence + iterative deepening.
 * Master adds: PVS, LMR, null-move, deeper qsearch, SEE-aware qmoves, master eval.
 */
export function searchBestMove(board, side, opts = {}) {
  const depth = opts.depth ?? 4;
  const ply = opts.ply ?? 0;
  const maxMs = opts.maxMs ?? 2500;
  const master = Boolean(opts.master);
  const qDepthMax = master ? SEARCH.masterQDepth : SEARCH.qDepth;
  const tt = opts.tt || createTT();
  const rootLegal = opts.rootMoves?.length ? opts.rootMoves : allLegalMoves(board, side);
  const killers = [[], []];
  const history = new Map();
  const evalCache = new Map();
  let nodes = 0;
  let bestMove = null;
  let bestScore = -Infinity;
  const tStart = Date.now();
  let timedOut = false;

  function timeUp() {
    return Date.now() - tStart > maxMs;
  }

  function evalMeta(pathPly) {
    return { ply: pathPly, master, masterHeavy: false };
  }

  function cachedEval(b, s, pathPly) {
    const key = positionKey(b, s);
    if (evalCache.has(key)) return evalCache.get(key);
    const v = evaluateForSide(b, s, evalMeta(pathPly));
    if (evalCache.size < 8000) evalCache.set(key, v);
    return v;
  }

  function isQuiet(m) {
    return !(m.capture && m.capture !== ".");
  }

  function givesCheck(b, s, m) {
    const next = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
    return isInCheck(next, oppositeSide(s));
  }

  function quiesce(b, s, alpha, beta, qDepth, pathPly) {
    nodes++;
    const stand = cachedEval(b, s, pathPly);
    if (qDepth <= 0) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    let moves = allLegalMoves(b, s).filter((m) => {
      if (m.capture && m.capture !== ".") {
        // SEE: skip clearly losing captures in qsearch
        const see = seeScore(b, m.fromR, m.fromC, m.toR, m.toC);
        return see >= -30;
      }
      return givesCheck(b, s, m);
    });
    moves = orderMoves(b, moves, s, { history });

    for (const m of moves) {
      if (timeUp()) break;
      const next = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
      const sc = -quiesce(next, oppositeSide(s), -beta, -alpha, qDepth - 1, pathPly + 1);
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function nullMoveOk(b, s, d) {
    if (!master || d < 3) return false;
    if (isInCheck(b, s)) return false;
    const phase = gamePhase(b);
    if (phase > 0.75) return false; // thin endgame — skip NMP
    return true;
  }

  function negamax(b, s, d, alpha, beta, pathPly, plyFromRoot, allowNull) {
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
      const mate = res === s ? SEARCH.mateScore - pathPly : -SEARCH.mateScore + pathPly;
      return mate;
    }

    if (d <= 0) return quiesce(b, s, alpha, beta, qDepthMax, pathPly);
    if (timeUp()) {
      timedOut = true;
      return cachedEval(b, s, pathPly);
    }

    // Null-move pruning (master)
    if (allowNull && nullMoveOk(b, s, d) && beta < SEARCH.mateScore - 1000) {
      const R = d >= 6 ? 3 : 2;
      const sc = -negamax(b, oppositeSide(s), d - 1 - R, -beta, -beta + 1, pathPly + 1, plyFromRoot + 1, false);
      if (sc >= beta) return beta;
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
    let moveIndex = 0;

    for (const m of moves) {
      const next = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
      const checkMv = isInCheck(next, oppositeSide(s));
      let nextDepth = d - 1;

      // Late Move Reduction
      if (
        master &&
        d >= 3 &&
        moveIndex >= 3 &&
        isQuiet(m) &&
        !checkMv &&
        !isInCheck(b, s)
      ) {
        nextDepth = d - 2;
      }

      let sc;
      if (master && moveIndex > 0) {
        // PVS: narrow window after first move
        sc = -negamax(next, oppositeSide(s), nextDepth, -alpha - 1, -alpha, pathPly + 1, plyFromRoot + 1, true);
        if (sc > alpha && sc < beta) {
          sc = -negamax(next, oppositeSide(s), d - 1, -beta, -alpha, pathPly + 1, plyFromRoot + 1, true);
        }
      } else {
        sc = -negamax(next, oppositeSide(s), nextDepth, -beta, -alpha, pathPly + 1, plyFromRoot + 1, true);
        if (master && nextDepth < d - 1 && sc > alpha) {
          sc = -negamax(next, oppositeSide(s), d - 1, -beta, -alpha, pathPly + 1, plyFromRoot + 1, true);
        }
      }

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
      moveIndex++;
      if (timeUp()) break;
    }

    tt.set(key, { depth: d, score: best, flag, best: localBest });
    return best;
  }

  // Iterative deepening (+ aspiration for master)
  for (let d = 1; d <= depth; d++) {
    if (timeUp()) break;
    let alpha = -Infinity;
    let beta = Infinity;
    if (master && d >= 3 && bestMove && Number.isFinite(bestScore)) {
      const window = 80;
      alpha = bestScore - window;
      beta = bestScore + window;
    }

    let moves = orderMoves(board, rootLegal, side, { history });
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
    let moveIndex = 0;
    for (const m of moves) {
      if (timeUp()) break;
      const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
      let sc;
      if (master && moveIndex > 0) {
        sc = -negamax(next, oppositeSide(side), d - 1, -alpha - 1, -alpha, ply + 1, 1, true);
        if (sc > alpha && sc < beta) {
          sc = -negamax(next, oppositeSide(side), d - 1, -beta, -alpha, ply + 1, 1, true);
        }
      } else {
        sc = -negamax(next, oppositeSide(side), d - 1, -beta, -alpha, ply + 1, 1, true);
      }
      // Aspiration fail — re-search full window
      if (master && (sc <= alpha || sc >= beta) && Number.isFinite(bestScore) && d >= 3) {
        sc = -negamax(next, oppositeSide(side), d - 1, -Infinity, Infinity, ply + 1, 1, true);
      }
      if (sc > iterScore) {
        iterScore = sc;
        iterBest = m;
      }
      if (sc > alpha) alpha = sc;
      moveIndex++;
    }
    if (iterBest && !timedOut) {
      bestMove = iterBest;
      bestScore = iterScore;
    } else if (iterBest && !bestMove) {
      bestMove = iterBest;
      bestScore = iterScore;
    }
  }

  void MATERIAL;
  void pieceSide;

  return {
    move: bestMove || rootLegal[0] || null,
    score: bestScore,
    nodes,
    timedOut,
  };
}
