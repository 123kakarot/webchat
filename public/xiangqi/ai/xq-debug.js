import { applyMove, moveNotation, oppositeSide } from "../xiangqi-engine.js";
import { evaluateBreakdown, evaluateForSide } from "./xq-eval.js";
import { DEBUG_XQ_EVAL } from "./xq-weights.js";

/**
 * Root move debug card.
 */
export function explainMove(board, move, side, ply = 0) {
  const next = applyMove(board, move.fromR, move.fromC, move.toR, move.toC);
  const before = evaluateBreakdown(board, { ply });
  const after = evaluateBreakdown(next, { ply: ply + 1 });
  // Delta from side POV
  const sign = side === "red" ? 1 : -1;
  const delta = (k) => sign * ((after.terms[k] || 0) - (before.terms[k] || 0));

  const card = {
    move: moveNotation(move, board),
    material: Math.round(delta("material")),
    position: Math.round(delta("position")),
    attack: Math.round(delta("attack")),
    defense: Math.round(delta("defense")),
    threat: Math.round(delta("threat")),
    mobility: Math.round(delta("mobility")),
    kingSafety: Math.round(delta("kingSafety")),
    center: Math.round(delta("center")),
    opening: Math.round(delta("opening")),
    finalScore: Math.round(sign * (after.total - before.total)),
    sideScore: Math.round(evaluateForSide(next, side, { ply: ply + 1 })),
  };
  return card;
}

export function logRootDebug(board, moves, side, ply = 0) {
  if (!DEBUG_XQ_EVAL) return;
  const top = moves.slice(0, 5).map((m) => explainMove(board, m, side, ply));
  console.table(top);
  return top;
}

export function formatDebugCard(card) {
  return [
    `Move ${card.move}`,
    `Material ${card.material}`,
    `Position ${card.position}`,
    `Attack ${card.attack}`,
    `Defense ${card.defense}`,
    `Threat ${card.threat}`,
    `Final Score ${card.finalScore}`,
  ].join("\n");
}

void oppositeSide;
