/**
 * Pool AI — Easy…Master shot selection via rollout sampling.
 */
import { aimGuide, cloneBalls, applyCueShot, simulateUntilStop, BALL_R, TABLE_W, TABLE_H } from "./pool-physics.js";
import { legalTargets, createMatch } from "./pool-rules.js";

void createMatch;

const LEVEL = {
  easy: { samples: 24, noise: 0.22, powerJitter: 0.25, preferSafety: 0.1 },
  medium: { samples: 48, noise: 0.1, powerJitter: 0.12, preferSafety: 0.25 },
  hard: { samples: 90, noise: 0.04, powerJitter: 0.06, preferSafety: 0.45 },
  master: { samples: 140, noise: 0.015, powerJitter: 0.03, preferSafety: 0.7 },
};

function groupOf(id) {
  if (id >= 1 && id <= 7) return "solid";
  if (id >= 9 && id <= 15) return "stripe";
  return null;
}

function scoreOutcome(match, side, events, level) {
  const cfg = LEVEL[level] || LEVEL.medium;
  const targets = new Set(legalTargets({ ...match, turn: side }));
  let score = 0;
  const pocketed = events.pocketed || [];
  const cueDown = pocketed.includes(0);
  const eightDown = pocketed.includes(8);
  const cleared =
    match.groups[side] &&
    !match.balls.some((b) => !b.pocketed && groupOf(b.id) === match.groups[side]);

  if (cueDown) score -= 800;
  if (eightDown && !cleared) score -= 2000;
  if (eightDown && cleared && !cueDown) score += 5000;

  for (const id of pocketed) {
    if (id === 0 || id === 8) continue;
    if (match.phase === "open" || match.phase === "break") score += 120;
    else if (targets.has(id) || groupOf(id) === match.groups[side]) score += 200;
    else score -= 90;
  }

  if (events.firstContact != null && targets.has(events.firstContact)) score += 40;
  if (events.firstContact != null && !targets.has(events.firstContact) && match.phase === "groups") {
    score -= 160;
  }

  // Leave cue near center-ish for next — master/hard
  const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
  if (cue && cfg.preferSafety > 0.3) {
    const cx = TABLE_W / 2;
    const cy = TABLE_H / 2;
    const d = Math.hypot(cue.x - cx, cue.y - cy);
    score += (1 - Math.min(1, d / 400)) * 30 * cfg.preferSafety;
  }

  // Safety: opponent hard next — rough: distance from cue to nearest opponent ball
  if (pocketed.length === 0 && !cueDown && cfg.preferSafety > 0.4) {
    score += 25;
  }

  return score;
}

function candidateAngles(balls, targets) {
  const cue = balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return [];
  const angles = [];
  for (const b of balls) {
    if (b.pocketed || b.id === 0) continue;
    if (targets.length && !targets.includes(b.id) && b.id !== 8) {
      // still allow exploring on open
    }
    const ang = Math.atan2(b.y - cue.y, b.x - cue.x);
    angles.push(ang);
    // ghost cut angles ±
    angles.push(ang + 0.08, ang - 0.08, ang + 0.16, ang - 0.16);
  }
  // a few random explores
  for (let i = 0; i < 8; i++) angles.push(Math.random() * Math.PI * 2);
  return angles;
}

export function pickPoolShot(match, level = "medium") {
  const cfg = LEVEL[level] || LEVEL.medium;
  const side = match.turn;
  const targets = legalTargets(match);
  const baseAngles = candidateAngles(match.balls, targets);
  let best = null;
  let bestScore = -Infinity;

  const n = Math.min(cfg.samples, baseAngles.length * 3);
  for (let i = 0; i < n; i++) {
    const base = baseAngles[i % baseAngles.length];
    const angle = base + (Math.random() * 2 - 1) * cfg.noise;
    const power = Math.max(0.15, Math.min(0.95, 0.35 + Math.random() * 0.55 + (Math.random() * 2 - 1) * cfg.powerJitter));
    const spin = {
      x: (Math.random() * 2 - 1) * (level === "master" ? 0.35 : 0.15),
      y: 0,
    };

    const balls = cloneBalls(match.balls);
    applyCueShot(balls, angle, power, spin);
    const events = simulateUntilStop(balls);
    // score on resulting ball state + events
    const probe = {
      ...match,
      balls,
      phase: match.phase,
      groups: match.groups,
    };
    let sc = scoreOutcome(probe, side, events, level);
    // Master: bonus if aim guide hits target first
    if (level === "master" || level === "hard") {
      const guide = aimGuide(match.balls, angle);
      if (guide?.hit && targets.includes(guide.hit.id)) sc += 55;
      if (guide?.hit && guide.hit.id === 8 && targets.includes(8)) sc += 80;
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = { angle, power, spin, score: sc };
    }
  }

  if (!best) {
    const cue = match.balls.find((b) => b.id === 0);
    const t = match.balls.find((b) => !b.pocketed && b.id !== 0) || cue;
    best = {
      angle: Math.atan2(t.y - cue.y, t.x - cue.x),
      power: 0.45,
      spin: { x: 0, y: 0 },
      score: 0,
    };
  }
  return best;
}

export function aiThinkDelay(level) {
  if (level === "easy") return 400;
  if (level === "medium") return 700;
  if (level === "hard") return 1000;
  return 1400;
}

void BALL_R;
