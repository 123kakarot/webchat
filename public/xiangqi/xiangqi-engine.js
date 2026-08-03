/** Xiangqi engine — 9×10, red (uppercase) moves first from bottom (row 9). */

export const SIDE_RED = "red";
export const SIDE_BLACK = "black";

const PALACE_RED = { rMin: 7, rMax: 9, cMin: 3, cMax: 5 };
const PALACE_BLACK = { rMin: 0, rMax: 2, cMin: 3, cMax: 5 };

export function createInitialBoard() {
  const rows = [
    "rnbakabnr",
    ".........",
    ".c.....c.",
    "p.p.p.p.p",
    ".........",
    ".........",
    "P.P.P.P.P",
    ".C.....C.",
    ".........",
    "RNBAKABNR",
  ];
  return rows.map((row) => row.split(""));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function pieceSide(p) {
  if (!p || p === ".") return null;
  return p === p.toUpperCase() ? SIDE_RED : SIDE_BLACK;
}

export function oppositeSide(side) {
  return side === SIDE_RED ? SIDE_BLACK : SIDE_RED;
}

function inPalace(r, c, side) {
  const p = side === SIDE_RED ? PALACE_RED : PALACE_BLACK;
  return r >= p.rMin && r <= p.rMax && c >= p.cMin && c <= p.cMax;
}

function onBoard(r, c) {
  return r >= 0 && r <= 9 && c >= 0 && c <= 8;
}

export function findKing(board, side) {
  const k = side === SIDE_RED ? "K" : "k";
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === k) return [r, c];
    }
  }
  return null;
}

/** Generals face with no piece between — illegal position. */
export function generalsFace(board) {
  const rk = findKing(board, SIDE_RED);
  const bk = findKing(board, SIDE_BLACK);
  if (!rk || !bk || rk[1] !== bk[1]) return false;
  const col = rk[1];
  const rLo = Math.min(rk[0], bk[0]) + 1;
  const rHi = Math.max(rk[0], bk[0]) - 1;
  for (let r = rLo; r <= rHi; r++) {
    if (board[r][col] !== ".") return false;
  }
  return true;
}

function slideMoves(board, r, c, dirs, side, captureOnly = false) {
  const moves = [];
  for (const [dr, dc] of dirs) {
    let nr = r + dr;
    let nc = c + dc;
    while (onBoard(nr, nc)) {
      const target = board[nr][nc];
      if (target === ".") {
        if (!captureOnly) moves.push([nr, nc]);
      } else {
        if (pieceSide(target) !== side) moves.push([nr, nc]);
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

function cannonMoves(board, r, c, side) {
  const moves = [];
  const ortho = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of ortho) {
    let nr = r + dr;
    let nc = c + dc;
    let jumped = false;
    while (onBoard(nr, nc)) {
      const target = board[nr][nc];
      if (!jumped) {
        if (target === ".") moves.push([nr, nc]);
        else jumped = true;
      } else if (target !== ".") {
        if (pieceSide(target) !== side) moves.push([nr, nc]);
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

function knightMoves(board, r, c, side) {
  const legs = [
    [-1, 0, -2, -1],
    [-1, 0, -2, 1],
    [1, 0, 2, -1],
    [1, 0, 2, 1],
    [0, -1, -1, -2],
    [0, -1, 1, -2],
    [0, 1, -1, 2],
    [0, 1, 1, 2],
  ];
  const moves = [];
  for (const [lr, lc, dr, dc] of legs) {
    const br = r + lr;
    const bc = c + lc;
    if (!onBoard(br, bc) || board[br][bc] !== ".") continue;
    const nr = r + dr;
    const nc = c + dc;
    if (!onBoard(nr, nc)) continue;
    const target = board[nr][nc];
    if (target === "." || pieceSide(target) !== side) moves.push([nr, nc]);
  }
  return moves;
}

function pawnMoves(board, r, c, p, side) {
  const moves = [];
  const forward = side === SIDE_RED ? -1 : 1;
  const nr = r + forward;
  if (onBoard(nr, c)) {
    const t = board[nr][c];
    if (t === "." || pieceSide(t) !== side) moves.push([nr, c]);
  }
  const crossed = side === SIDE_RED ? r <= 4 : r >= 5;
  if (crossed) {
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (!onBoard(r, nc)) continue;
      const t = board[r][nc];
      if (t === "." || pieceSide(t) !== side) moves.push([r, nc]);
    }
  }
  return moves;
}

export function pieceMoves(board, r, c) {
  const p = board[r][c];
  if (p === ".") return [];
  const side = pieceSide(p);
  const type = p.toLowerCase();
  switch (type) {
    case "k": {
      const moves = [];
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inPalace(nr, nc, side)) continue;
        const t = board[nr][nc];
        if (t === "." || pieceSide(t) !== side) moves.push([nr, nc]);
      }
      return moves;
    }
    case "a": {
      const moves = [];
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inPalace(nr, nc, side)) continue;
        const t = board[nr][nc];
        if (t === "." || pieceSide(t) !== side) moves.push([nr, nc]);
      }
      return moves;
    }
    case "b": {
      const moves = [];
      for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const nr = r + dr;
        const nc = c + dc;
        const mr = r + dr / 2;
        const mc = c + dc / 2;
        if (!onBoard(nr, nc)) continue;
        if (side === SIDE_RED && nr < 5) continue;
        if (side === SIDE_BLACK && nr > 4) continue;
        if (board[mr][mc] !== ".") continue;
        const t = board[nr][nc];
        if (t === "." || pieceSide(t) !== side) moves.push([nr, nc]);
      }
      return moves;
    }
    case "n":
      return knightMoves(board, r, c, side);
    case "r":
      return slideMoves(
        board,
        r,
        c,
        [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ],
        side
      );
    case "c":
      return cannonMoves(board, r, c, side);
    case "p":
      return pawnMoves(board, r, c, p, side);
    default:
      return [];
  }
}

export function applyMove(board, fromR, fromC, toR, toC) {
  const next = cloneBoard(board);
  next[toR][toC] = next[fromR][fromC];
  next[fromR][fromC] = ".";
  return next;
}

export function attacked(board, r, c, bySide) {
  return findAttackers(board, r, c, bySide).length > 0;
}

/** Quân của `bySide` đang tấn công ô (r,c). */
export function findAttackers(board, r, c, bySide) {
  const out = [];
  const seen = new Set();
  const push = (rr, cc, piece) => {
    const k = `${rr},${cc}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ r: rr, c: cc, piece });
  };

  for (let rr = 0; rr < 10; rr++) {
    for (let cc = 0; cc < 9; cc++) {
      const p = board[rr][cc];
      if (p === "." || pieceSide(p) !== bySide) continue;
      const moves = pieceMoves(board, rr, cc);
      if (moves.some(([tr, tc]) => tr === r && tc === c)) push(rr, cc, p);
    }
  }

  // Đối mặt tướng: quân tướng đối phương "tấn công" theo cột trống
  if (generalsFace(board)) {
    const rk = findKing(board, SIDE_RED);
    const bk = findKing(board, SIDE_BLACK);
    if (rk && bk && rk[1] === c && bk[1] === c) {
      if (bySide === SIDE_RED && rk[0] !== r) push(rk[0], rk[1], "K");
      if (bySide === SIDE_BLACK && bk[0] !== r) push(bk[0], bk[1], "k");
    }
  }
  return out;
}

export function isInCheck(board, side) {
  const king = findKing(board, side);
  if (!king) return true;
  return attacked(board, king[0], king[1], oppositeSide(side));
}

export function legalMovesFrom(board, r, c, side) {
  const p = board[r][c];
  if (p === "." || pieceSide(p) !== side) return [];
  const raw = pieceMoves(board, r, c);
  return raw.filter(([tr, tc]) => {
    const next = applyMove(board, r, c, tr, tc);
    if (generalsFace(next)) return false;
    if (isInCheck(next, side)) return false;
    return true;
  });
}

export function allLegalMoves(board, side) {
  const out = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === "." || pieceSide(p) !== side) continue;
      for (const [tr, tc] of legalMovesFrom(board, r, c, side)) {
        out.push({ fromR: r, fromC: c, toR: tr, toC: tc, piece: p, capture: board[tr][tc] });
      }
    }
  }
  return out;
}

export function hasLegalMove(board, side) {
  return allLegalMoves(board, side).length > 0;
}

export function gameResult(board, sideToMove) {
  const inCheck = isInCheck(board, sideToMove);
  if (hasLegalMove(board, sideToMove)) return null;
  if (inCheck) return oppositeSide(sideToMove);
  return "draw";
}

export function pieceLabel(p) {
  const map = {
    K: "帥",
    A: "仕",
    B: "相",
    N: "傌",
    R: "俥",
    C: "炮",
    P: "兵",
    k: "將",
    a: "士",
    b: "象",
    n: "馬",
    r: "車",
    c: "砲",
    p: "卒",
  };
  return map[p] || p;
}

export function moveNotation(mv, board) {
  const p = pieceLabel(mv.piece);
  const col = String(9 - mv.toC);
  return `${p}${col}`;
}

export function createMatchState(opts = {}) {
  return {
    board: createInitialBoard(),
    turn: SIDE_RED,
    moves: [],
    status: "playing",
    winner: null,
    mode: opts.mode || "local",
    aiLevel: opts.aiLevel || "medium",
    meSide: opts.meSide || SIDE_RED,
    turnMs: opts.turnMs || 600000,
    turnDeadline: Date.now() + (opts.turnMs || 600000),
    redTimeMs: opts.redTimeMs ?? 600000,
    blackTimeMs: opts.blackTimeMs ?? 600000,
    checkSide: null,
  };
}
