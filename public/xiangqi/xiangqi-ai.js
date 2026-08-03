import { allLegalMoves, applyMove, pieceSide, SIDE_BLACK, SIDE_RED } from "./xiangqi-engine.js";

const PIECE_VAL = { k: 10000, K: 10000, r: 450, R: 450, n: 270, N: 270, c: 285, C: 285, b: 120, B: 120, a: 120, A: 120, p: 50, P: 50 };

function evalBoard(board) {
  let score = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === ".") continue;
      const v = PIECE_VAL[p] || 0;
      score += pieceSide(p) === SIDE_RED ? v : -v;
    }
  }
  return score;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickAiMove(board, side, level = "medium") {
  const moves = allLegalMoves(board, side);
  if (!moves.length) return null;

  if (level === "easy") return pickRandom(moves);

  const captures = moves.filter((m) => m.capture && m.capture !== ".");
  if (level === "medium") {
    if (captures.length) return pickRandom(captures);
    return pickRandom(moves);
  }

  let best = [];
  let bestScore = side === SIDE_RED ? -Infinity : Infinity;
  for (const m of moves) {
    const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
    let s = evalBoard(next);
    if (level === "master") {
      const reply = allLegalMoves(next, side === SIDE_RED ? SIDE_BLACK : SIDE_RED);
      if (reply.length) {
        let worst = side === SIDE_RED ? Infinity : -Infinity;
        for (const r of reply.slice(0, 12)) {
          const n2 = applyMove(next, r.fromR, r.fromC, r.toR, r.toC);
          const s2 = evalBoard(n2);
          worst = side === SIDE_RED ? Math.min(worst, s2) : Math.max(worst, s2);
        }
        s = worst;
      }
    }
    if (side === SIDE_RED) {
      if (s > bestScore) {
        bestScore = s;
        best = [m];
      } else if (s === bestScore) best.push(m);
    } else {
      if (s < bestScore) {
        bestScore = s;
        best = [m];
      } else if (s === bestScore) best.push(m);
    }
  }
  return pickRandom(best.length ? best : moves);
}

export function aiThinkDelay(level) {
  if (level === "easy") return 160;
  if (level === "medium") return 220;
  if (level === "hard") return 320;
  return 420;
}
