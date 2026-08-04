/** Sokoban core — push-only crates, goals, undo. */

export const DIR = {
  up: { dr: -1, dc: 0, key: "up" },
  down: { dr: 1, dc: 0, key: "down" },
  left: { dr: 0, dc: -1, key: "left" },
  right: { dr: 0, dc: 1, key: "right" },
};

export const TILE = {
  WALL: "#",
  FLOOR: " ",
  GOAL: ".",
  BOX: "$",
  BOX_GOAL: "*",
  PLAYER: "@",
  PLAYER_GOAL: "+",
};

const BOX_TILES = new Set([TILE.BOX, TILE.BOX_GOAL]);
const GOAL_TILES = new Set([TILE.GOAL, TILE.BOX_GOAL, TILE.PLAYER_GOAL]);

/** @typedef {{ id: string, pack: string, num: number, name?: string, rows: string[], parMoves: number, star3?: number, star2?: number, star1?: number }} SokobanLevel */

/**
 * @param {string[]} rows
 * @returns {{ width: number, height: number, walls: boolean[][], goals: boolean[][], boxes: {r:number,c:number}[], player: {r:number,c:number} }}
 */
export function parseLevelRows(rows) {
  const clean = rows.map((r) => r.replace(/\r/g, ""));
  const height = clean.length;
  const width = Math.max(...clean.map((r) => r.length), 0);
  const walls = [];
  const goals = [];
  /** @type {{r:number,c:number}[]} */
  const boxes = [];
  let player = { r: 0, c: 0 };

  for (let r = 0; r < height; r++) {
    walls[r] = [];
    goals[r] = [];
    for (let c = 0; c < width; c++) {
      const ch = clean[r][c] ?? TILE.WALL;
      const isWall = ch === TILE.WALL;
      walls[r][c] = isWall;
      goals[r][c] = GOAL_TILES.has(ch);
      if (BOX_TILES.has(ch)) boxes.push({ r, c });
      if (ch === TILE.PLAYER || ch === TILE.PLAYER_GOAL) player = { r, c };
    }
  }
  return { width, height, walls, goals, boxes, player };
}

/**
 * @param {SokobanLevel} level
 */
export function createGameFromLevel(level) {
  const parsed = parseLevelRows(level.rows);
  return {
    level,
    ...parsed,
    moves: 0,
    pushes: 0,
    startedAt: Date.now(),
    elapsedMs: 0,
    status: "playing",
    history: [],
    moveLog: [],
  };
}

export function cloneGame(g) {
  return {
    ...g,
    walls: g.walls.map((row) => row.slice()),
    goals: g.goals.map((row) => row.slice()),
    boxes: g.boxes.map((b) => ({ ...b })),
    player: { ...g.player },
    history: g.history.slice(),
    moveLog: g.moveLog.slice(),
  };
}

function boxIndex(boxes, r, c) {
  return boxes.findIndex((b) => b.r === r && b.c === c);
}

export function isWin(g) {
  if (!g.boxes.length) return false;
  return g.boxes.every((b) => g.goals[b.r]?.[b.c]);
}

/**
 * @param {ReturnType<createGameFromLevel>} g
 * @param {keyof typeof DIR} dirKey
 */
export function tryMove(g, dirKey) {
  if (g.status !== "playing") return { ok: false, game: g, pushed: false };
  const d = DIR[dirKey];
  if (!d) return { ok: false, game: g, pushed: false };

  const { dr, dc } = d;
  const pr = g.player.r;
  const pc = g.player.c;
  const nr = pr + dr;
  const nc = pc + dc;
  if (g.walls[nr]?.[nc]) return { ok: false, game: g, pushed: false };

  const next = cloneGame(g);
  const bi = boxIndex(next.boxes, nr, nc);
  let pushed = false;

  if (bi >= 0) {
    const br = nr + dr;
    const bc = nc + dc;
    if (g.walls[br]?.[bc]) return { ok: false, game: g, pushed: false };
    if (boxIndex(next.boxes, br, bc) >= 0) return { ok: false, game: g, pushed: false };
    next.boxes[bi] = { r: br, c: bc };
    pushed = true;
  }

  next.history.push(snapshot(next));
  next.moveLog.push(dirKey);
  next.player = { r: nr, c: nc };
  next.moves += 1;
  if (pushed) next.pushes += 1;

  if (isWin(next)) {
    next.status = "won";
    next.elapsedMs = Date.now() - next.startedAt;
  }
  return { ok: true, game: next, pushed };
}

function snapshot(g) {
  return {
    player: { ...g.player },
    boxes: g.boxes.map((b) => ({ ...b })),
    moves: g.moves,
    pushes: g.pushes,
    status: g.status,
  };
}

export function undoMove(g) {
  if (!g.history.length || g.status === "won") return g;
  const prev = g.history.pop();
  g.moveLog.pop();
  g.player = prev.player;
  g.boxes = prev.boxes.map((b) => ({ ...b }));
  g.moves = prev.moves;
  g.pushes = prev.pushes;
  g.status = prev.status;
  return g;
}

export function restartGame(g) {
  const fresh = createGameFromLevel(g.level);
  fresh.startedAt = Date.now();
  return fresh;
}

/** @param {SokobanLevel} level */
export function starThresholds(level) {
  const par = level.parMoves || 60;
  return {
    star3: level.star3 ?? Math.ceil(par * 0.75),
    star2: level.star2 ?? Math.ceil(par * 1.0),
    star1: level.star1 ?? Math.ceil(par * 1.35),
  };
}

export function starsForMoves(moves, level) {
  const t = starThresholds(level);
  if (moves <= t.star3) return 3;
  if (moves <= t.star2) return 2;
  if (moves <= t.star1) return 1;
  return 0;
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${String(m).padStart(2, "0")}:${ss}`;
}

export function stateKey(g) {
  const boxes = g.boxes
    .map((b) => `${b.r},${b.c}`)
    .sort()
    .join("|");
  return `${g.player.r},${g.player.c};${boxes}`;
}
