import {
  applyMove,
  isInCheck,
  pieceSide,
  pieceMoves,
  oppositeSide,
} from "../xiangqi-engine.js";
import { MATERIAL, ORDER, PAWN_CROSSED } from "./xq-weights.js";

function capValue(p, r) {
  if (!p || p === ".") return 0;
  if (p === "P") return r <= 4 ? PAWN_CROSSED : MATERIAL.P;
  if (p === "p") return r >= 5 ? PAWN_CROSSED : MATERIAL.p;
  return MATERIAL[p] || 0;
}

function canSideCaptureSquare(board, side, tr, tc) {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === "." || pieceSide(p) !== side) continue;
      const ms = pieceMoves(board, r, c);
      if (ms.some(([a, b]) => a === tr && b === tc)) return true;
    }
  }
  return false;
}

/** Coarse SEE: capture value minus likely recapture of mover. */
export function seeScore(board, fromR, fromC, toR, toC) {
  const moving = board[fromR][fromC];
  const cap = board[toR][toC];
  if (!moving || moving === ".") return 0;
  let score = cap && cap !== "." ? capValue(cap, toR) : 0;
  const next = applyMove(board, fromR, fromC, toR, toC);
  const opp = oppositeSide(pieceSide(moving));
  if (canSideCaptureSquare(next, opp, toR, toC)) {
    score -= capValue(moving, fromR) * 0.85;
  }
  return score;
}

export function orderMoves(board, moves, side, ctx = {}) {
  const { killers = [], history = null } = ctx;
  const opp = oppositeSide(side);
  const scored = moves.map((m) => {
    let s = 0;
    const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
    if (isInCheck(next, opp)) s += ORDER.check;

    if (m.capture && m.capture !== ".") {
      s += ORDER.captureBase + capValue(m.capture, m.toR) * 10 - capValue(m.piece, m.fromR) * 0.5;
      s += seeScore(board, m.fromR, m.fromC, m.toR, m.toC);
    }

    for (const k of killers) {
      if (k && k.fromR === m.fromR && k.fromC === m.fromC && k.toR === m.toR && k.toC === m.toC) {
        s += ORDER.killer;
      }
    }

    if (history) {
      const key = `${m.fromR},${m.fromC},${m.toR},${m.toC}`;
      s += Math.min(ORDER.historyMax, history.get(key) || 0);
    }

    if (m.piece === "P" && m.toR < m.fromR) s += 30;
    if (m.piece === "p" && m.toR > m.fromR) s += 30;

    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}
