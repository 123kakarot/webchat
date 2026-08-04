/** Level packs — Classic Easy → Expert + pool for Daily / Random. */

/** @type {import("./sokoban-engine.js").SokobanLevel[]} */
const EASY = [
  {
    id: "easy-1",
    pack: "easy",
    num: 1,
    name: "Kho bãi 1",
    parMoves: 12,
    star3: 10,
    star2: 14,
    star1: 20,
    rows: ["#####", "#...#", "#.$@#", "#...#", "#####"],
  },
  {
    id: "easy-2",
    pack: "easy",
    num: 2,
    name: "Hành lang",
    parMoves: 18,
    star3: 16,
    star2: 22,
    star1: 30,
    rows: ["######", "#....#", "#.$@.#", "#..$..#", "#....#", "######"],
  },
  {
    id: "easy-3",
    pack: "easy",
    num: 3,
    name: "Góc kho",
    parMoves: 24,
    star3: 20,
    star2: 28,
    star1: 36,
    rows: ["#######", "#.....#", "#.$$@.#", "#..#..#", "#..#..#", "#.....#", "#######"],
  },
  {
    id: "easy-4",
    pack: "easy",
    num: 4,
    name: "Hai thùng",
    parMoves: 28,
    star3: 24,
    star2: 32,
    star1: 42,
    rows: ["  #####", "###   #", "#  $  #", "# #@$ #", "#  .  #", "# . . #", "#######"],
  },
  {
    id: "easy-5",
    pack: "easy",
    num: 5,
    name: "Warehouse A",
    parMoves: 32,
    star3: 28,
    star2: 38,
    star1: 50,
    rows: ["  #####", "  #   #", "  #$  #", "###  $##", "#  $  #", "# .#  #", "# . . #", "#  @  #", "#####"],
  },
];

/** @type {import("./sokoban-engine.js").SokobanLevel[]} */
const MEDIUM = [
  {
    id: "medium-1",
    pack: "medium",
    num: 1,
    name: "Corridor",
    parMoves: 35,
    star3: 30,
    star2: 42,
    star1: 55,
    rows: ["    #####", "    #   #", "    #$  #", "  ###  $##", "###  $   #", "#   $ #  #", "# # # ##@#", "#   . .  #", "#####  ###", "    ####"],
  },
  {
    id: "medium-2",
    pack: "medium",
    num: 2,
    name: "Split",
    parMoves: 45,
    star3: 38,
    star2: 52,
    star1: 68,
    rows: ["########", "#..  ..#", "#.$$$.@#", "#..  ..#", "########"],
  },
  {
    id: "medium-3",
    pack: "medium",
    num: 3,
    name: "Island",
    parMoves: 52,
    star3: 44,
    star2: 60,
    star1: 78,
    rows: ["  #######", "  #     #", "  # .$. #", "###.$.$###", "#   $   #", "#   @   #", "#########"],
  },
  {
    id: "medium-4",
    pack: "medium",
    num: 4,
    name: "Labyrinth",
    parMoves: 58,
    star3: 48,
    star2: 65,
    star1: 85,
    rows: ["########", "# .  . #", "# $$ # #", "# .  $ #", "# # ## #", "#  $@  #", "########"],
  },
];

/** @type {import("./sokoban-engine.js").SokobanLevel[]} */
const HARD = [
  {
    id: "hard-1",
    pack: "hard",
    num: 1,
    name: "Đống thùng",
    parMoves: 65,
    star3: 55,
    star2: 72,
    star1: 95,
    rows: ["  #####", "###   #", "#  $  #", "# # #$#", "#  @  #", "#  .  #", "#######"],
  },
  {
    id: "hard-2",
    pack: "hard",
    num: 2,
    name: "Snake",
    parMoves: 78,
    star3: 65,
    star2: 88,
    star1: 110,
    rows: ["########", "#......#", "#.$$$$.#", "#.$@...#", "#......#", "########"],
  },
  {
    id: "hard-3",
    pack: "hard",
    num: 3,
    name: "Cross",
    parMoves: 90,
    star3: 75,
    star2: 100,
    star1: 130,
    rows: ["  #####", "  #.@.#", "### $ ###", "#   $   #", "# . # . #", "#   $   #", "### $ ###", "  #####"],
  },
];

/** @type {import("./sokoban-engine.js").SokobanLevel[]} */
const EXPERT = [
  {
    id: "expert-1",
    pack: "expert",
    num: 1,
    name: "Master 1",
    parMoves: 95,
    star3: 80,
    star2: 105,
    star1: 140,
    rows: ["    #####", "    #   #", "    #$  #", "  ###  $##", "  #  $ $ #", "### # ## #", "#   $ ## #", "# #  $ @ #", "# # ##   #", "#   ......#", "##########"],
  },
  {
    id: "expert-2",
    pack: "expert",
    num: 2,
    name: "Master 2",
    parMoves: 110,
    star3: 92,
    star2: 120,
    star1: 155,
    rows: ["  #######", "  #     #", "  # .$. #", "###.$.$###", "#   $   #", "# # # # #", "#  $@$  #", "# . . . #", "#########"],
  },
];

export const PACK_ORDER = ["easy", "medium", "hard", "expert"];

export const PACK_LABELS = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
};

export const LEVEL_PACKS = {
  easy: EASY,
  medium: MEDIUM,
  hard: HARD,
  expert: EXPERT,
};

export const ALL_LEVELS = [...EASY, ...MEDIUM, ...HARD, ...EXPERT];

export function levelsInPack(pack) {
  return LEVEL_PACKS[pack] || [];
}

export function getLevel(pack, num) {
  const list = levelsInPack(pack);
  return list.find((l) => l.num === num) || null;
}

export function totalLevels() {
  return ALL_LEVELS.length;
}

export function getDailyLevel(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  let seed = y * 10000 + m * 100 + d;
  seed = (seed * 1103515245 + 12345) >>> 0;
  const idx = seed % ALL_LEVELS.length;
  return { ...ALL_LEVELS[idx], dailyKey: `${y}-${m}-${d}` };
}

export function getRandomLevel() {
  const idx = Math.floor(Math.random() * ALL_LEVELS.length);
  return ALL_LEVELS[idx];
}

export function parseCustomMap(text) {
  const rows = text
    .split("\n")
    .map((r) => r.replace(/\r/g, ""))
    .filter((r) => r.length > 0);
  if (!rows.length) return null;
  const hasPlayer = rows.some((r) => r.includes("@") || r.includes("+"));
  const hasBox = rows.some((r) => r.includes("$") || r.includes("*"));
  const hasGoal = rows.some((r) => r.includes(".") || r.includes("+") || r.includes("*"));
  if (!hasPlayer || !hasBox || !hasGoal) return null;
  return {
    id: "custom",
    pack: "custom",
    num: 1,
    name: "Custom Map",
    parMoves: 80,
    star3: 60,
    star2: 90,
    star1: 120,
    rows,
  };
}
