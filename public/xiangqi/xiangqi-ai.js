import {
  allLegalMoves,
  applyMove,
  pieceSide,
  SIDE_BLACK,
  SIDE_RED,
} from "./xiangqi-engine.js";

/** Material values */
const MAT = {
  k: 100000,
  K: 100000,
  r: 900,
  R: 900,
  n: 400,
  N: 400,
  c: 450,
  C: 450,
  b: 200,
  B: 200,
  a: 200,
  A: 200,
  p: 100,
  P: 100,
};

/** Piece-square tables — index [row][col], from red’s perspective (row 9 = red back rank). */
const PST_P = [
  [9, 9, 9, 11, 13, 11, 9, 9, 9],
  [19, 24, 34, 42, 44, 42, 34, 24, 19],
  [19, 24, 32, 37, 37, 37, 32, 24, 19],
  [19, 23, 27, 29, 30, 29, 27, 23, 19],
  [14, 18, 20, 27, 29, 27, 20, 18, 14],
  [7, 0, 13, 0, 16, 0, 13, 0, 7],
  [7, 0, 7, 0, 15, 0, 7, 0, 7],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const PST_N = [
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [2, 6, 8, 6, 10, 6, 8, 6, 2],
  [4, 2, 8, 8, 4, 8, 8, 2, 4],
  [0, 2, 4, 4, -2, 4, 4, 2, 0],
  [0, -4, 0, 0, 0, 0, 0, -4, 0],
];

const PST_C = [
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0],
];

const PST_R = [
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [-2, 10, 6, 14, 12, 14, 6, 10, -2],
];

const PST_B = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, -2, 0, 0, 0, -2, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-4, 0, 0, 0, 4, 0, 0, 0, -4],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 0, 0, 0, 4, 0, 0],
];

const PST_A = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 2, 0, 2, 0, 0, 0],
  [0, 0, 0, 0, 6, 0, 0, 0, 0],
  [0, 0, 0, 2, 0, 2, 0, 0, 0],
];

const PST_K = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 5, 1, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 0, 0, 0],
  [0, 0, 0, 1, 5, 1, 0, 0, 0],
];

function pstFor(type, r, c, side) {
  const rr = side === SIDE_RED ? r : 9 - r;
  const cc = side === SIDE_RED ? c : 8 - c;
  switch (type) {
    case "p":
      return PST_P[rr][cc];
    case "n":
      return PST_N[rr][cc];
    case "c":
      return PST_C[rr][cc];
    case "r":
      return PST_R[rr][cc];
    case "b":
      return PST_B[rr][cc];
    case "a":
      return PST_A[rr][cc];
    case "k":
      return PST_K[rr][cc];
    default:
      return 0;
  }
}

export function evaluateBoard(board) {
  let score = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === ".") continue;
      const side = pieceSide(p);
      const type = p.toLowerCase();
      const val = (MAT[p] || 0) + pstFor(type, r, c, side);
      score += side === SIDE_RED ? val : -val;
    }
  }
  return score;
}

function orderMoves(moves) {
  return moves.slice().sort((a, b) => {
    const ca = a.capture && a.capture !== "." ? MAT[a.capture] || 50 : 0;
    const cb = b.capture && b.capture !== "." ? MAT[b.capture] || 50 : 0;
    return cb - ca;
  });
}

function minimax(board, side, depth, alpha, beta) {
  if (depth <= 0) return evaluateBoard(board);

  const moves = orderMoves(allLegalMoves(board, side));
  if (!moves.length) {
    // No move: checkmate-ish — prefer from opponent’s view
    return side === SIDE_RED ? -50000 - depth : 50000 + depth;
  }

  if (side === SIDE_RED) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
      const s = minimax(next, SIDE_BLACK, depth - 1, alpha, beta);
      if (s > best) best = s;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const m of moves) {
    const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
    const s = minimax(next, SIDE_RED, depth - 1, alpha, beta);
    if (s < best) best = s;
    if (best < beta) beta = best;
    if (beta <= alpha) break;
  }
  return best;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickByEval(board, side, depth) {
  const moves = orderMoves(allLegalMoves(board, side));
  if (!moves.length) return null;

  let best = [];
  let bestScore = side === SIDE_RED ? -Infinity : Infinity;

  for (const m of moves) {
    const next = applyMove(board, m.fromR, m.fromC, m.toR, m.toC);
    let s;
    if (depth <= 0) s = evaluateBoard(next);
    else s = minimax(next, side === SIDE_RED ? SIDE_BLACK : SIDE_RED, depth - 1, -Infinity, Infinity);

    // Soften ties with tiny noise so AI doesn’t always pick same line
    s += (Math.random() - 0.5) * 0.2;

    if (side === SIDE_RED) {
      if (s > bestScore) {
        bestScore = s;
        best = [m];
      } else if (Math.abs(s - bestScore) < 0.01) best.push(m);
    } else if (s < bestScore) {
      bestScore = s;
      best = [m];
    } else if (Math.abs(s - bestScore) < 0.01) best.push(m);
  }
  return pickRandom(best.length ? best : moves);
}

/**
 * @param {"easy"|"medium"|"hard"|"master"} level
 */
export function pickAiMove(board, side, level = "medium") {
  const moves = allLegalMoves(board, side);
  if (!moves.length) return null;

  if (level === "easy") {
    // 70% random, 30% 1-ply matrix
    if (Math.random() < 0.7) return pickRandom(moves);
    return pickByEval(board, side, 0);
  }
  if (level === "medium") return pickByEval(board, side, 0);
  if (level === "hard") return pickByEval(board, side, 1);
  return pickByEval(board, side, 2);
}

export function aiThinkDelay(level) {
  if (level === "easy") return 120;
  if (level === "medium") return 180;
  if (level === "hard") return 260;
  return 360;
}
