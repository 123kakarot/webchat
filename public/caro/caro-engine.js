/** Pure Gomoku / Cờ Caro rules — no DOM. */

export const STONE_EMPTY = 0;
export const STONE_X = 1;
export const STONE_O = 2;

export function createBoard(size = 15) {
  const n = clampSize(size);
  return Array.from({ length: n }, () => Array(n).fill(STONE_EMPTY));
}

export function clampSize(size) {
  const n = Number(size) || 15;
  if (n === 10 || n === 15 || n === 19) return n;
  return 15;
}

export function opponent(stone) {
  return stone === STONE_X ? STONE_O : STONE_X;
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function inBounds(board, r, c) {
  const n = board.length;
  return r >= 0 && c >= 0 && r < n && c < n;
}

export function placeStone(board, r, c, stone) {
  if (!inBounds(board, r, c) || board[r][c] !== STONE_EMPTY) return false;
  board[r][c] = stone;
  return true;
}

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * @returns {{ win: boolean, line: Array<[number,number]>|null, blocked?: boolean }}
 */
export function checkWinAt(board, r, c, mode = "freestyle") {
  const stone = board[r]?.[c];
  if (!stone) return { win: false, line: null };

  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    let a = 0;
    let b = 0;
    for (let i = 1; i < 9; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      if (!inBounds(board, rr, cc) || board[rr][cc] !== stone) break;
      line.push([rr, cc]);
      a++;
    }
    for (let i = 1; i < 9; i++) {
      const rr = r - dr * i;
      const cc = c - dc * i;
      if (!inBounds(board, rr, cc) || board[rr][cc] !== stone) break;
      line.unshift([rr, cc]);
      b++;
    }
    if (line.length < 5) continue;

    if (mode === "tournament") {
      const beforeR = r - dr * (b + 1);
      const beforeC = c - dc * (b + 1);
      const afterR = r + dr * (a + 1);
      const afterC = c + dc * (a + 1);
      const blockedBefore =
        inBounds(board, beforeR, beforeC) && board[beforeR][beforeC] === opponent(stone);
      const blockedAfter =
        inBounds(board, afterR, afterC) && board[afterR][afterC] === opponent(stone);
      if (line.length === 5 && blockedBefore && blockedAfter) {
        continue;
      }
    }

    const winLine = line.slice(0, 5);
    return { win: true, line: winLine };
  }
  return { win: false, line: null };
}

export function isBoardFull(board) {
  for (const row of board) {
    for (const cell of row) {
      if (cell === STONE_EMPTY) return false;
    }
  }
  return true;
}

export function countEmpty(board) {
  let n = 0;
  for (const row of board) for (const cell of row) if (cell === STONE_EMPTY) n++;
  return n;
}

export function applyMove(state, r, c) {
  const board = cloneBoard(state.board);
  const stone = state.turn;
  if (!placeStone(board, r, c, stone)) {
    return { ok: false, reason: "Ô đã có quân hoặc ngoài bàn." };
  }
  const win = checkWinAt(board, r, c, state.mode || "freestyle");
  const full = isBoardFull(board);
  const nextTurn = opponent(stone);
  return {
    ok: true,
    board,
    move: { r, c, stone, at: Date.now() },
    win: win.win,
    line: win.line,
    draw: !win.win && full,
    nextTurn,
  };
}

export function createMatchState(opts = {}) {
  const size = clampSize(opts.size);
  return {
    size,
    board: createBoard(size),
    turn: STONE_X,
    mode: opts.mode === "tournament" ? "tournament" : "freestyle",
    moves: [],
    status: "playing", // playing | won | draw | resigned
    winner: null,
    winLine: null,
    turnMs: Number(opts.turnMs) || 60_000,
    turnDeadline: Date.now() + (Number(opts.turnMs) || 60_000),
  };
}
