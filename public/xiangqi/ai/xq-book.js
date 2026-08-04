/**
 * Opening book — weighted lines for diversity (Pháo đầu, Bình phong mã, …).
 */

import { createInitialBoard, applyMove, SIDE_RED, SIDE_BLACK } from "../xiangqi-engine.js";

function boardKey(board) {
  return board.map((r) => r.join("")).join("/");
}

const START = boardKey(createInitialBoard());

/** @type {Map<string, Array<{ fromR:number, fromC:number, toR:number, toC:number, w:number, name?:string }>>} */
const BOOK = new Map();

function add(key, entries) {
  BOOK.set(key, entries);
}

function after(board, side, fr, fc, tr, tc) {
  const next = applyMove(board, fr, fc, tr, tc);
  return `${boardKey(next)}|${side === SIDE_RED ? "black" : "red"}`;
}

const startBoard = createInitialBoard();

// === RED opening (first move) ===
add(`${START}|red`, [
  { fromR: 7, fromC: 1, toR: 7, toC: 4, w: 28, name: "pháo-đầu-trái" }, // 炮二平五
  { fromR: 7, fromC: 7, toR: 7, toC: 4, w: 22, name: "pháo-đầu-phải" },
  { fromR: 9, fromC: 1, toR: 7, toC: 2, w: 18, name: "bình-phong-mã-trái" },
  { fromR: 9, fromC: 7, toR: 7, toC: 6, w: 16, name: "bình-phong-mã-phải" },
  { fromR: 6, fromC: 4, toR: 5, toC: 4, w: 10, name: "tiên-nhân-chỉ-lộ" },
  { fromR: 9, fromC: 2, toR: 7, toC: 0, w: 6, name: "phi-tượng" },
]);

// After 炮二平五
{
  const b1 = applyMove(startBoard, 7, 1, 7, 4);
  add(`${boardKey(b1)}|black`, [
    { fromR: 2, fromC: 1, toR: 2, toC: 4, w: 26, name: "thuận-pháo" },
    { fromR: 2, fromC: 7, toR: 2, toC: 4, w: 22, name: "nghịch-pháo" },
    { fromR: 0, fromC: 1, toR: 2, toC: 2, w: 18, name: "bình-phong-mã" },
    { fromR: 0, fromC: 7, toR: 2, toC: 6, w: 14, name: "bình-phong-mã-p" },
    { fromR: 3, fromC: 4, toR: 4, toC: 4, w: 10, name: "đỡ-trung" },
    { fromR: 0, fromC: 2, toR: 2, toC: 4, w: 8, name: "phi-tượng" },
  ]);
}

// After black 炮8平5 (thuận) vs red 炮二平五
{
  let b = applyMove(startBoard, 7, 1, 7, 4);
  b = applyMove(b, 2, 1, 2, 4);
  add(`${boardKey(b)}|red`, [
    { fromR: 9, fromC: 1, toR: 7, toC: 2, w: 30, name: "mã-2-tiến-3" },
    { fromR: 9, fromC: 7, toR: 7, toC: 6, w: 22, name: "mã-8-tiến-7" },
    { fromR: 7, fromC: 7, toR: 7, toC: 4, w: 12, name: "quá-cung-pháo" },
    { fromR: 6, fromC: 4, toR: 5, toC: 4, w: 10 },
  ]);
}

// After black 炮2平5 (nghịch)
{
  let b = applyMove(startBoard, 7, 1, 7, 4);
  b = applyMove(b, 2, 7, 2, 4);
  add(`${boardKey(b)}|red`, [
    { fromR: 9, fromC: 1, toR: 7, toC: 2, w: 28 },
    { fromR: 9, fromC: 7, toR: 7, toC: 6, w: 24 },
    { fromR: 6, fromC: 2, toR: 5, toC: 2, w: 12 },
    { fromR: 7, fromC: 7, toR: 4, toC: 7, w: 10, name: "pháo-tuần-hà" },
  ]);
}

// Start as black replies (if red already moved elsewhere — generic)
add(`${START}|black`, [
  { fromR: 2, fromC: 1, toR: 2, toC: 4, w: 24 },
  { fromR: 2, fromC: 7, toR: 2, toC: 4, w: 20 },
  { fromR: 0, fromC: 1, toR: 2, toC: 2, w: 18 },
  { fromR: 0, fromC: 7, toR: 2, toC: 6, w: 16 },
  { fromR: 3, fromC: 4, toR: 4, toC: 4, w: 12 },
  { fromR: 0, fromC: 2, toR: 2, toC: 4, w: 8 },
]);

// Red 马二进三
{
  const b1 = applyMove(startBoard, 9, 1, 7, 2);
  add(`${boardKey(b1)}|black`, [
    { fromR: 0, fromC: 1, toR: 2, toC: 2, w: 22 },
    { fromR: 2, fromC: 1, toR: 2, toC: 4, w: 20 },
    { fromR: 2, fromC: 7, toR: 2, toC: 4, w: 16 },
    { fromR: 0, fromC: 7, toR: 2, toC: 6, w: 14 },
    { fromR: 3, fromC: 2, toR: 4, toC: 2, w: 10 },
  ]);
  const b2 = applyMove(b1, 0, 1, 2, 2);
  add(`${boardKey(b2)}|red`, [
    { fromR: 7, fromC: 1, toR: 7, toC: 4, w: 26 },
    { fromR: 9, fromC: 7, toR: 7, toC: 6, w: 20 },
    { fromR: 6, fromC: 4, toR: 5, toC: 4, w: 12 },
    { fromR: 7, fromC: 7, toR: 7, toC: 4, w: 10 },
  ]);
}

void after;

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
        name: e.name,
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
    name: e.name,
  };
}

void SIDE_BLACK;
