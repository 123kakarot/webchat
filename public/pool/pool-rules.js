/**
 * 8-ball rules state machine.
 */
import {
  createRack,
  cloneBalls,
  applyCueShot,
  simulateUntilStop,
  placeCueBall,
  placeCueInKitchen,
  isSolid,
  isStripe,
  isEight,
  anyMoving,
} from "./pool-physics.js";

export function createMatch(opts = {}) {
  return {
    balls: createRack(),
    turn: 0, // 0 = player A (bottom / human in AI), 1 = player B
    phase: "break", // break | open | groups | over
    groups: [null, null], // "solid" | "stripe" per player
    ballInHand: false,
    kitchenOnly: true,
    status: "playing",
    winner: null,
    endReason: null,
    mode: opts.mode || "ai", // ai | local
    aiLevel: opts.aiLevel || "medium",
    names: opts.names || ["Bạn", "Đối thủ"],
    shotHistory: [],
    lastShot: null,
    message: "Phát bóng — đặt bi cái trong khu vực nhà rồi đánh.",
    tableTheme: opts.tableTheme || "classic",
    cueId: opts.cueId || "starter",
    turnMs: opts.turnMs || 30000,
    turnDeadline: Date.now() + (opts.turnMs || 30000),
    moving: false,
    stats: {
      shots: [0, 0],
      pots: [0, 0],
      fouls: [0, 0],
    },
  };
}

function groupOfBall(id) {
  if (isSolid(id)) return "solid";
  if (isStripe(id)) return "stripe";
  return null;
}

function remainingOfGroup(balls, group) {
  return balls.filter((b) => !b.pocketed && groupOfBall(b.id) === group).length;
}

function playerCleared(match, side) {
  const g = match.groups[side];
  if (!g) return false;
  return remainingOfGroup(match.balls, g) === 0;
}

function legalObjectBalls(match, side) {
  if (match.phase === "break" || match.phase === "open") {
    return match.balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
  }
  if (playerCleared(match, side)) return [8];
  const g = match.groups[side];
  return match.balls
    .filter((b) => !b.pocketed && groupOfBall(b.id) === g)
    .map((b) => b.id);
}

/**
 * Resolve a completed shot (balls already simulated).
 */
export function resolveShot(match, shotMeta, events) {
  const side = match.turn;
  const { pocketed, firstContact, cushionHits } = events;
  const cuePocketed = pocketed.includes(0);
  const eightPocketed = pocketed.includes(8);
  const objectPotted = pocketed.filter((id) => id !== 0 && id !== 8);

  match.stats.shots[side]++;
  match.lastShot = {
    ...shotMeta,
    pocketed: [...pocketed],
    firstContact,
    side,
  };
  match.shotHistory.push(match.lastShot);

  let foul = false;
  let foulReason = "";

  // First contact rules
  if (firstContact == null) {
    foul = true;
    foulReason = "Không chạm bi nào";
  } else if (match.phase === "groups" || match.phase === "open") {
    const legal = legalObjectBalls(match, side);
    if (match.phase === "groups" && !legal.includes(firstContact) && firstContact !== 8) {
      foul = true;
      foulReason = "Chạm sai nhóm trước";
    }
    if (match.phase === "groups" && firstContact === 8 && !playerCleared(match, side)) {
      foul = true;
      foulReason = "Chạm bi 8 quá sớm";
    }
  }

  if (cuePocketed) {
    foul = true;
    foulReason = foulReason || "Bi cái vào lỗ";
  }

  // Break: need 4 cushion hits OR pot — simplified: pot or cushion ok
  if (match.phase === "break" && !foul) {
    if (objectPotted.length === 0 && cushionHits < 4 && !eightPocketed) {
      // soft: allow continue without foul for casual play — mark open
    }
    match.phase = "open";
    match.kitchenOnly = false;
  }

  // 8-ball outcomes
  if (eightPocketed) {
    if (match.phase === "break") {
      // re-spot 8 — simplify: loss only if cue also down; else re-rack message
      if (cuePocketed) {
        match.status = "finished";
        match.winner = 1 - side;
        match.endReason = "8 + cue trên break";
        match.message = `${match.names[match.winner]} thắng (phạm trên break).`;
        return match;
      }
      // put 8 back roughly
      const eight = match.balls.find((b) => b.id === 8);
      if (eight) {
        eight.pocketed = false;
        eight.x = 900 * 0.72;
        eight.y = 450 / 2;
      }
      match.message = "Bi 8 vào lỗ khi break — đặt lại bi 8.";
    } else if (!playerCleared(match, side) || foul) {
      match.status = "finished";
      match.winner = 1 - side;
      match.endReason = foul ? "Phạm khi đánh 8" : "Đánh 8 quá sớm";
      match.message = `${match.names[match.winner]} thắng — ${match.endReason}.`;
      return match;
    } else if (cuePocketed) {
      match.status = "finished";
      match.winner = 1 - side;
      match.endReason = "Cue theo bi 8";
      match.message = `${match.names[match.winner]} thắng — cue ball vào lỗ cùng bi 8.`;
      return match;
    } else {
      match.status = "finished";
      match.winner = side;
      match.endReason = "Clear + 8";
      match.message = `${match.names[side]} thắng!`;
      return match;
    }
  }

  // Assign groups on first legally potted object after break/open
  if (!foul && objectPotted.length && (match.phase === "open" || match.phase === "break")) {
    const first = objectPotted[0];
    const g = groupOfBall(first);
    if (g) {
      match.groups[side] = g;
      match.groups[1 - side] = g === "solid" ? "stripe" : "solid";
      match.phase = "groups";
      match.message = `${match.names[side]} nhận ${g === "solid" ? "Solid (1–7)" : "Stripe (9–15)"}.`;
    }
  }

  if (!foul && objectPotted.length) {
    match.stats.pots[side] += objectPotted.length;
  }

  if (foul) {
    match.stats.fouls[side]++;
    match.ballInHand = true;
    match.kitchenOnly = false;
    match.turn = 1 - side;
    match.message = `Phạm lỗi: ${foulReason}. ${match.names[match.turn]} — Ball in Hand.`;
    // restore cue if pocketed
    const cue = match.balls.find((b) => b.id === 0);
    if (cue?.pocketed) {
      cue.pocketed = false;
      placeCueBall(match.balls, 900 * 0.25, 450 / 2);
    }
  } else {
    // Continue if pot own group (or any object on open)
    let continueTurn = false;
    if (objectPotted.length) {
      if (match.phase === "groups") {
        const g = match.groups[side];
        continueTurn = objectPotted.some((id) => groupOfBall(id) === g);
      } else {
        continueTurn = true;
      }
    }
    match.ballInHand = false;
    if (!continueTurn) {
      match.turn = 1 - side;
      match.message = `Lượt ${match.names[match.turn]}.`;
    } else {
      match.message = `${match.names[side]} vào bóng — đánh tiếp!`;
    }
  }

  match.turnDeadline = Date.now() + match.turnMs;
  return match;
}

/** Apply cue impulse only — animate with stepPhysics, then finishShot. */
export function beginShot(match, angle, power, spin) {
  if (match.status !== "playing" || match.moving) return { ok: false, reason: "Đang mô phỏng." };
  if (match.ballInHand) return { ok: false, reason: "Đặt bi cái trước." };
  const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return { ok: false, reason: "Thiếu bi cái." };
  const meta = applyCueShot(match.balls, angle, power, spin);
  if (!meta) return { ok: false, reason: "Không đánh được." };
  match.moving = true;
  match._shotMeta = meta;
  match._shotEvents = { pocketed: [], firstContact: null, cushionHits: 0 };
  return { ok: true, meta };
}

export function accumulateShotEvent(match, ev) {
  if (!match?._shotEvents) return;
  const acc = match._shotEvents;
  for (const id of ev.pocketed || []) {
    if (!acc.pocketed.includes(id)) acc.pocketed.push(id);
  }
  if (acc.firstContact == null && ev.firstContact != null) acc.firstContact = ev.firstContact;
  acc.cushionHits += ev.cushionHits || 0;
}

/** Call when balls stop after beginShot. */
export function finishShot(match) {
  if (!match?._shotMeta) return match;
  for (const b of match.balls) {
    if (!b.pocketed) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  const meta = match._shotMeta;
  const events = match._shotEvents || { pocketed: [], firstContact: null, cushionHits: 0 };
  match._shotMeta = null;
  match._shotEvents = null;
  match.moving = false;
  resolveShot(match, meta, events);
  return match;
}

/** Instant simulate (AI search / server). */
export function shoot(match, angle, power, spin) {
  const started = beginShot(match, angle, power, spin);
  if (!started.ok) return started;
  const before = null;
  const events = simulateUntilStop(match.balls);
  match._shotEvents = {
    pocketed: events.pocketed,
    firstContact: events.firstContact,
    cushionHits: events.cushionHits,
  };
  finishShot(match);
  return { ok: true, events, before };
}

export function tryPlaceCue(match, x, y) {
  if (!match.ballInHand && match.phase !== "break") return false;
  if (match.phase === "break" || match.kitchenOnly) return placeCueInKitchen(match.balls, x, y);
  return placeCueBall(match.balls, x, y);
}

export function legalTargets(match) {
  return legalObjectBalls(match, match.turn);
}

export { anyMoving, cloneBalls };
