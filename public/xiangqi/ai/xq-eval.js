import {
  pieceSide,
  pieceMoves,
  findKing,
  generalsFace,
  isInCheck,
  SIDE_RED,
  SIDE_BLACK,
  oppositeSide,
} from "../xiangqi-engine.js";
import {
  MATERIAL,
  PAWN_CROSSED,
  EVAL_WEIGHTS as W,
  KING_SAFETY as KS,
  STRUCTURE as ST,
  MOBILITY_W,
  OPENING_PLIES,
} from "./xq-weights.js";
import { pstLookup } from "./xq-pst.js";

const START_NPM = 900 * 2 + 450 * 2 + 430 * 2 + 200 * 4; // rough non-king material one side *2

function isCrossedPawn(p, r) {
  if (p === "P") return r <= 4;
  if (p === "p") return r >= 5;
  return false;
}

export function gamePhase(board) {
  let npm = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === "." || p === "k" || p === "K" || p.toLowerCase() === "p") continue;
      npm += MATERIAL[p] || 0;
    }
  }
  return Math.max(0, Math.min(1, 1 - npm / (START_NPM * 2)));
}

function materialOf(p, r) {
  if (p === "P" || p === "p") {
    return isCrossedPawn(p, r) ? PAWN_CROSSED : MATERIAL[p];
  }
  return MATERIAL[p] || 0;
}

function countType(board, ch) {
  let n = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) if (board[r][c] === ch) n++;
  }
  return n;
}

function hasScreenForCannon(board, r, c, side) {
  // Orthogonal: empty then a screen then any — “có bệ”
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dr, dc] of dirs) {
    let nr = r + dr;
    let nc = c + dc;
    let seen = 0;
    while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
      const t = board[nr][nc];
      if (t !== ".") {
        seen++;
        if (seen === 1) {
          /* screen */
        } else if (seen === 2) {
          if (pieceSide(t) !== side) return true;
          break;
        }
      }
      nr += dr;
      nc += dc;
    }
  }
  return false;
}

function fileOpenness(board, c, side) {
  let own = 0;
  let enemy = 0;
  for (let r = 0; r < 10; r++) {
    const p = board[r][c];
    if (p === ".") continue;
    if (pieceSide(p) === side) own++;
    else enemy++;
  }
  if (own <= 1 && enemy === 0) return "open";
  if (own <= 1 && enemy >= 1) return "semi";
  return "closed";
}

/**
 * Full multi-term evaluation from Red’s POV.
 * @returns {{ total: number, terms: Record<string, number> }}
 */
export function evaluateBreakdown(board, meta = {}) {
  const ply = meta.ply || 0;
  const phase = gamePhase(board);
  const terms = {
    material: 0,
    position: 0,
    mobility: 0,
    attack: 0,
    defense: 0,
    kingSafety: 0,
    center: 0,
    threat: 0,
    opening: 0,
    midgame: 0,
    endgame: 0,
    blunder: 0,
    coordination: 0,
    initiative: 0,
    structure: 0,
    pressure: 0,
  };

  const master = Boolean(meta.master);
  const redKing = findKing(board, SIDE_RED);
  const blackKing = findKing(board, SIDE_BLACK);

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === ".") continue;
      const side = pieceSide(p);
      const sign = side === SIDE_RED ? 1 : -1;
      const type = p.toLowerCase();
      const mat = materialOf(p, r);
      terms.material += sign * mat;
      terms.position += sign * pstLookup(type, r, c, side === SIDE_RED);

      const moves = pieceMoves(board, r, c);
      const mobW = MOBILITY_W[type] || 1;
      terms.mobility += sign * moves.length * mobW;

      // Center control (files 3-5, ranks 3-6)
      for (const [tr, tc] of moves) {
        if (tc >= 3 && tc <= 5 && tr >= 3 && tr <= 6) {
          terms.center += sign * ST.centerControl;
        }
        const target = board[tr][tc];
        if (target !== "." && pieceSide(target) !== side) {
          terms.attack += sign * Math.min(90, (MATERIAL[target] || 40) * 0.08);
        }
      }

      if (type === "c" && hasScreenForCannon(board, r, c, side)) {
        terms.position += sign * ST.cannonScreen * 0.35;
      }
      if (type === "r") {
        const fo = fileOpenness(board, c, side);
        if (fo === "open") terms.position += sign * ST.rookOpenFile * 0.5;
        else if (fo === "semi") terms.position += sign * ST.rookSemiOpen * 0.5;
        if (moves.length <= 2) terms.mobility += sign * ST.rookTrapped * 0.3;
      }
      if (type === "n") {
        if ((c === 0 || c === 8) && (r === 0 || r === 9 || r === 1 || r === 8)) {
          terms.position += sign * ST.knightCorner * 0.4;
        }
        if (c >= 2 && c <= 6 && r >= 2 && r <= 7) {
          terms.position += sign * ST.knightCentral * 0.25;
        }
      }
      if (type === "p" && isCrossedPawn(p, r)) {
        const ek = side === SIDE_RED ? blackKing : redKing;
        if (ek) {
          const dist = Math.abs(ek[0] - r) + Math.abs(ek[1] - c);
          if (dist <= 3) terms.attack += sign * ST.pawnNearKing;
        }
      }
    }
  }

  // King safety both sides
  terms.kingSafety += kingSafetySide(board, SIDE_RED, redKing);
  terms.kingSafety -= kingSafetySide(board, SIDE_BLACK, blackKing);

  if (generalsFace(board)) {
    // Illegal/unstable — huge penalty for side to move handled in search; static nudge
    terms.threat -= 50;
  }

  // Hung pieces — skip heavy O(n²) scan in hot path; light proxy via mobility already
  terms.threat += 0;

  if (master) {
    terms.coordination += coordinationTerms(board);
    terms.structure += structureTerms(board);
    terms.initiative += (terms.attack - terms.defense) * 0.12;
    // Heavy tactical scans only at root — too costly every leaf
    if (meta.masterHeavy) {
      terms.pressure += pressureTerms(board, redKing, blackKing);
      terms.threat += lightHanging(board);
    } else {
      terms.pressure += terms.attack * 0.06;
    }
  }

  // Phase bonuses
  if (ply < OPENING_PLIES) {
    terms.opening += openingTerms(board, ply);
  } else if (phase < 0.55) {
    terms.midgame += terms.center * 0.15;
    if (master) terms.midgame += terms.coordination * 0.08;
  } else {
    terms.endgame += endgameTerms(board);
    if (master) terms.endgame += masterEndgame(board, redKing, blackKing);
  }

  let total = 0;
  for (const [k, v] of Object.entries(terms)) {
    const w = W[k] ?? 1;
    total += w * v;
  }
  return { total, terms, phase };
}

function kingSafetySide(board, side, king) {
  if (!king) return -5000;
  let s = 0;
  const adv = side === SIDE_RED ? "A" : "a";
  const ele = side === SIDE_RED ? "B" : "b";
  const na = countType(board, adv);
  const ne = countType(board, ele);
  if (na < 2) s += KS.missingAdvisor * (2 - na);
  if (ne < 2) s += KS.missingElephant * (2 - ne);

  // Protectors in palace neighborhood
  let prot = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = king[0] + dr;
      const c = king[1] + dc;
      if (r < 0 || r > 9 || c < 0 || c > 8) continue;
      const p = board[r][c];
      if (p !== "." && pieceSide(p) === side && p.toLowerCase() !== "k") prot++;
    }
  }
  s += Math.min(KS.protectorCap, prot * KS.protectorBonus);

  const opp = oppositeSide(side);
  if (isInCheck(board, side)) s -= 80;

  // Coarse: count enemy pieces in king neighborhood (no full move gen)
  let near = 0;
  for (let r = Math.max(0, king[0] - 2); r <= Math.min(9, king[0] + 2); r++) {
    for (let c = Math.max(0, king[1] - 2); c <= Math.min(8, king[1] + 2); c++) {
      const p = board[r][c];
      if (p !== "." && pieceSide(p) === opp) near++;
    }
  }
  s += near * KS.enemyNearKing;

  // Facing risk: same file empty between kings
  const other = side === SIDE_RED ? findKing(board, SIDE_BLACK) : findKing(board, SIDE_RED);
  if (other && other[1] === king[1]) {
    let blocked = false;
    for (let r = Math.min(king[0], other[0]) + 1; r < Math.max(king[0], other[0]); r++) {
      if (board[r][king[1]] !== ".") {
        blocked = true;
        break;
      }
    }
    if (!blocked) s += KS.facingOpen;
  }
  return s;
}

function hungPenalty() {
  return 0;
}

function openingTerms(board, ply) {
  let s = 0;
  // Encourage developed cannons / knights off back rank early
  const redCannonDev = board[7]?.[1] !== "C" || board[7]?.[7] !== "C";
  if (redCannonDev) s += 15;
  if (board[9][1] !== "N" || board[9][7] !== "N") s += 12;
  if (board[9][0] !== "R" || board[9][8] !== "R") s += 10;
  // Penalize king leaving back ranks early
  const rk = findKing(board, SIDE_RED);
  if (rk && rk[0] < 7 && ply < OPENING_PLIES) s -= 40;
  const bk = findKing(board, SIDE_BLACK);
  if (bk && bk[0] > 2 && ply < OPENING_PLIES) s += 40; // good for red if black king advanced
  return s;
}

function endgameTerms(board) {
  let s = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === "P" && isCrossedPawn(p, r)) s += 25;
      if (p === "p" && isCrossedPawn(p, r)) s -= 25;
      if (p === "R") s += pieceMoves(board, r, c).length * 2;
      if (p === "r") s -= pieceMoves(board, r, c).length * 2;
    }
  }
  return s;
}

function coordinationTerms(board) {
  let s = 0;
  // Battery: two rooks / rook+cannon same file
  for (let c = 0; c < 9; c++) {
    let R = 0,
      C = 0,
      r = 0,
      cn = 0;
    for (let row = 0; row < 10; row++) {
      const p = board[row][c];
      if (p === "R") R++;
      if (p === "C") C++;
      if (p === "r") r++;
      if (p === "c") cn++;
    }
    if (R >= 2) s += 45;
    if (R && C) s += 35;
    if (r >= 2) s -= 45;
    if (r && cn) s -= 35;
  }
  // Advisors+elephants present
  const na = countType(board, "A");
  const ne = countType(board, "B");
  const naB = countType(board, "a");
  const neB = countType(board, "b");
  if (na === 2 && ne === 2) s += 40;
  if (naB === 2 && neB === 2) s -= 40;
  return s;
}

function structureTerms(board) {
  let s = 0;
  // Connected crossed pawns
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === "P" && board[r][c + 1] === "P") s += 18;
      if (board[r][c] === "p" && board[r][c + 1] === "p") s -= 18;
    }
  }
  return s;
}

function pressureTerms(board, redKing, blackKing) {
  let s = 0;
  if (!redKing || !blackKing) return 0;
  // Pieces aiming near enemy king (coarse)
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === "." || p.toLowerCase() === "k") continue;
      const side = pieceSide(p);
      const ek = side === SIDE_RED ? blackKing : redKing;
      const moves = pieceMoves(board, r, c);
      let near = 0;
      for (const [tr, tc] of moves) {
        if (Math.abs(tr - ek[0]) + Math.abs(tc - ek[1]) <= 2) near++;
      }
      const sign = side === SIDE_RED ? 1 : -1;
      s += sign * near * 6;
    }
  }
  return s;
}

function lightHanging(board) {
  let s = 0;
  // Sample major pieces only — hung if attacked and not defended (coarse)
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p !== "R" && p !== "r" && p !== "C" && p !== "c" && p !== "N" && p !== "n") continue;
      const side = pieceSide(p);
      const opp = oppositeSide(side);
      let attacked = false;
      let defended = false;
      for (let rr = 0; rr < 10; rr++) {
        for (let cc = 0; cc < 9; cc++) {
          const q = board[rr][cc];
          if (q === ".") continue;
          const qs = pieceSide(q);
          if (qs !== opp && qs !== side) continue;
          const ms = pieceMoves(board, rr, cc);
          if (!ms.some(([tr, tc]) => tr === r && tc === c)) continue;
          if (qs === opp) attacked = true;
          else defended = true;
        }
      }
      if (attacked && !defended) {
        const sign = side === SIDE_RED ? 1 : -1;
        s -= sign * Math.min(220, (MATERIAL[p] || 100) * 0.35);
      }
    }
  }
  return s;
}

function masterEndgame(board, redKing, blackKing) {
  let s = 0;
  // Push passed-ish pawns, centralize rook, cut king
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === "P" && isCrossedPawn(p, r)) {
        s += (9 - r) * 8;
        if (blackKing) s += Math.max(0, 4 - Math.abs(c - blackKing[1])) * 4;
      }
      if (p === "p" && isCrossedPawn(p, r)) {
        s -= r * 8;
        if (redKing) s -= Math.max(0, 4 - Math.abs(c - redKing[1])) * 4;
      }
      if (p === "R" && c >= 3 && c <= 5) s += 22;
      if (p === "r" && c >= 3 && c <= 5) s -= 22;
    }
  }
  return s;
}

/** Scalar score from Red’s POV */
export function evaluate(board, meta = {}) {
  return evaluateBreakdown(board, meta).total;
}

/** Score from `side`’s POV (negamax helper) */
export function evaluateForSide(board, side, meta = {}) {
  const v = evaluate(board, meta);
  return side === SIDE_RED ? v : -v;
}
