/**
 * Tiny opening book — keys are compact board FEN-like at start-ish positions.
 * Prefer developing 炮/馬 lines.
 */

import { createInitialBoard, SIDE_RED, SIDE_BLACK } from "../xiangqi-engine.js";

function boardKey(board) {
  return board.map((r) => r.join("")).join("/");
}

const START = boardKey(createInitialBoard());

/** @type {Map<string, Array<{ fromR:number, fromC:number, toR:number, toC:number, w:number }>>} */
const BOOK = new Map();

BOOK.set(`${START}|black`, [
  { fromR: 2, fromC: 1, toR: 2, toC: 4, w: 30 },
  { fromR: 2, fromC: 7, toR: 2, toC: 4, w: 20 },
  { fromR: 0, fromC: 1, toR: 2, toC: 2, w: 15 },
  { fromR: 0, fromC: 7, toR: 2, toC: 6, w: 15 },
  { fromR: 3, fromC: 4, toR: 4, toC: 4, w: 10 },
]);

export function probeBook(board, side) {
  const key = `${boardKey(board)}|${side === SIDE_RED ? "red" : "black"}`;
  const entries = BOOK.get(key);
  if (!entries?.length) return null;
  const total = entries.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) {
      return {
        fromR: e.fromR,
        fromC: e.fromC,
        toR: e.toR,
        toC: e.toC,
        piece: board[e.fromR][e.fromC],
        capture: board[e.toR][e.toC],
        book: true,
      };
    }
  }
  const e = entries[0];
  return {
    fromR: e.fromR,
    fromC: e.fromC,
    toR: e.toR,
    toC: e.toC,
    piece: board[e.fromR][e.fromC],
    capture: board[e.toR][e.toC],
    book: true,
  };
}

void SIDE_BLACK;
