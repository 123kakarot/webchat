import {
  STONE_EMPTY,
  STONE_X,
  STONE_O,
  opponent,
  inBounds,
  cloneBoard,
  placeStone,
  checkWinAt,
} from "./caro-engine.js";

const DIFFICULTY = {
  easy: { depth: 1, random: 0.45, thinkMin: 180, thinkMax: 450 },
  medium: { depth: 2, random: 0.18, thinkMin: 280, thinkMax: 650 },
  hard: { depth: 3, random: 0.04, thinkMin: 400, thinkMax: 900 },
  impossible: { depth: 4, random: 0, thinkMin: 550, thinkMax: 1100 },
};

export function aiThinkDelay(level = "medium") {
  const d = DIFFICULTY[level] || DIFFICULTY.medium;
  return d.thinkMin + Math.floor(Math.random() * (d.thinkMax - d.thinkMin + 1));
}

function scoreLine(count, openEnds, isMine) {
  if (count >= 5) return isMine ? 1e7 : 5e6;
  const mult = isMine ? 1 : 0.92;
  if (count === 4) {
    if (openEnds === 2) return 200000 * mult;
    if (openEnds === 1) return 45000 * mult;
  }
  if (count === 3) {
    if (openEnds === 2) return 12000 * mult;
    if (openEnds === 1) return 1800 * mult;
  }
  if (count === 2) {
    if (openEnds === 2) return 600 * mult;
    if (openEnds === 1) return 120 * mult;
  }
  if (count === 1 && openEnds === 2) return 30 * mult;
  return 0;
}

function evaluatePoint(board, r, c, stone) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  let score = 0;
  for (const [dr, dc] of dirs) {
    let count = 1;
    let open = 0;
    let rr = r + dr;
    let cc = c + dc;
    while (inBounds(board, rr, cc) && board[rr][cc] === stone) {
      count++;
      rr += dr;
      cc += dc;
    }
    if (inBounds(board, rr, cc) && board[rr][cc] === STONE_EMPTY) open++;
    rr = r - dr;
    cc = c - dc;
    while (inBounds(board, rr, cc) && board[rr][cc] === stone) {
      count++;
      rr -= dr;
      cc -= dc;
    }
    if (inBounds(board, rr, cc) && board[rr][cc] === STONE_EMPTY) open++;
    score += scoreLine(count, open, true);
  }
  return score;
}

function candidateCells(board, radius = 2) {
  const n = board.length;
  const marks = Array.from({ length: n }, () => Array(n).fill(false));
  let any = false;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === STONE_EMPTY) continue;
      any = true;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (inBounds(board, rr, cc) && board[rr][cc] === STONE_EMPTY) marks[rr][cc] = true;
        }
      }
    }
  }
  const cells = [];
  if (!any) {
    const mid = Math.floor(n / 2);
    cells.push([mid, mid]);
    return cells;
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (marks[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

function moveScore(board, r, c, me, mode) {
  const opp = opponent(me);
  const b1 = cloneBoard(board);
  placeStone(b1, r, c, me);
  if (checkWinAt(b1, r, c, mode).win) return 1e8;

  const b2 = cloneBoard(board);
  placeStone(b2, r, c, opp);
  if (checkWinAt(b2, r, c, mode).win) return 5e7;

  let s = evaluatePoint(board, r, c, me) * 1.15;
  s += evaluatePoint(board, r, c, opp) * 1.05;

  const mid = (board.length - 1) / 2;
  s += Math.max(0, 18 - (Math.abs(r - mid) + Math.abs(c - mid))) * 3;
  return s;
}

/**
 * @returns {{ r: number, c: number } | null}
 */
export function pickAiMove(board, me = STONE_O, level = "medium", mode = "freestyle") {
  const cfg = DIFFICULTY[level] || DIFFICULTY.medium;
  const cells = candidateCells(board, cfg.depth >= 3 ? 2 : 2);
  if (!cells.length) return null;

  const scored = cells.map(([r, c]) => ({
    r,
    c,
    score: moveScore(board, r, c, me, mode),
  }));
  scored.sort((a, b) => b.score - a.score);

  if (cfg.random > 0 && Math.random() < cfg.random && scored.length > 1) {
    const top = scored.slice(0, Math.min(5, scored.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  // Soft look-ahead for hard+: try top candidates + opponent reply threat
  if (cfg.depth >= 3) {
    let best = scored[0];
    const opp = opponent(me);
    for (const cand of scored.slice(0, 10)) {
      const b = cloneBoard(board);
      placeStone(b, cand.r, cand.c, me);
      if (checkWinAt(b, cand.r, cand.c, mode).win) return { r: cand.r, c: cand.c };
      const replies = candidateCells(b, 2)
        .map(([r, c]) => ({ r, c, score: moveScore(b, r, c, opp, mode) }))
        .sort((a, d) => d.score - a.score)
        .slice(0, 6);
      let worst = Infinity;
      for (const rep of replies) {
        const b2 = cloneBoard(b);
        placeStone(b2, rep.r, rep.c, opp);
        if (checkWinAt(b2, rep.r, rep.c, mode).win) {
          worst = Math.min(worst, -4e7);
          continue;
        }
        const myNext = candidateCells(b2, 2)
          .map(([r, c]) => moveScore(b2, r, c, me, mode))
          .sort((a, d) => d - a)[0] || 0;
        worst = Math.min(worst, myNext - rep.score * 0.35);
      }
      const total = cand.score * 0.2 + (Number.isFinite(worst) ? worst : 0);
      if (total > (best._total ?? -Infinity)) {
        best = { ...cand, _total: total };
      }
    }
    return { r: best.r, c: best.c };
  }

  return { r: scored[0].r, c: scored[0].c };
}

export { DIFFICULTY, STONE_X, STONE_O };
