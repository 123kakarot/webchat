import { ALL_LEVELS, validateLevelRows } from "../public/sokoban/sokoban-levels.js";
import { createGameFromLevel } from "../public/sokoban/sokoban-engine.js";
import { solveLevel } from "../public/sokoban/sokoban-solver.js";

let failed = 0;
for (const lv of ALL_LEVELS) {
  const v = validateLevelRows(lv.rows);
  if (!v.ok) {
    console.error(`FAIL ${lv.id}: ${v.reason}`);
    failed++;
    continue;
  }
  const g = createGameFromLevel(lv);
  const sol = solveLevel(g, 500000);
  if (!sol) {
    console.error(`FAIL ${lv.id}: no solution (${g.boxes.length} boxes)`);
    failed++;
  }
}
if (failed) {
  console.error(`${failed} level(s) invalid`);
  process.exit(1);
}
console.log(`OK: ${ALL_LEVELS.length} Sokoban levels`);
