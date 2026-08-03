import { SEARCH } from "./xq-weights.js";

/** Zobrist-lite: string key from board + side (fast enough for browser TT). */
export function positionKey(board, side) {
  let s = side === "red" ? "R|" : "B|";
  for (let r = 0; r < 10; r++) s += board[r].join("");
  return s;
}

export function createTT(size = SEARCH.ttSize) {
  const map = new Map();
  const max = size;
  return {
    get(key) {
      return map.get(key);
    },
    set(key, entry) {
      if (map.size > max) {
        // drop oldest ~25%
        let i = 0;
        const drop = (max / 4) | 0;
        for (const k of map.keys()) {
          map.delete(k);
          if (++i >= drop) break;
        }
      }
      map.set(key, entry);
    },
    clear() {
      map.clear();
    },
  };
}

export const TT_EXACT = 0;
export const TT_LOWER = 1;
export const TT_UPPER = 2;
