/** 2D pool physics — table units. */

export const TABLE_W = 900;
export const TABLE_H = 450;
export const BALL_R = 11;
export const POCKET_R = 22;
export const CUSHION = 28;

const FRICTION = 0.985;
const MIN_SPEED = 0.035;
const RESTITUTION = 0.96;
const CUSHION_REST = 0.88;

export const BALL_COLORS = {
  0: "#f5f5f5",
  1: "#eab308",
  2: "#2563eb",
  3: "#dc2626",
  4: "#7c3aed",
  5: "#ea580c",
  6: "#16a34a",
  7: "#7f1d1d",
  8: "#111111",
  9: "#eab308",
  10: "#2563eb",
  11: "#dc2626",
  12: "#7c3aed",
  13: "#ea580c",
  14: "#16a34a",
  15: "#7f1d1d",
};

export function isStripe(n) {
  return n >= 9 && n <= 15;
}
export function isSolid(n) {
  return n >= 1 && n <= 7;
}
export function isEight(n) {
  return n === 8;
}
export function isCue(n) {
  return n === 0;
}

export function pockets() {
  const m = CUSHION * 0.35;
  return [
    { x: m, y: m },
    { x: TABLE_W / 2, y: m * 0.55 },
    { x: TABLE_W - m, y: m },
    { x: m, y: TABLE_H - m },
    { x: TABLE_W / 2, y: TABLE_H - m * 0.55 },
    { x: TABLE_W - m, y: TABLE_H - m },
  ];
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function createRack() {
  const balls = [];
  // Cue in kitchen (left third)
  balls.push({ id: 0, x: TABLE_W * 0.25, y: TABLE_H / 2, vx: 0, vy: 0, pocketed: false });

  const apexX = TABLE_W * 0.72;
  const apexY = TABLE_H / 2;
  const gap = BALL_R * 2.05;
  // Standard-ish rack order: 8 in center, corners random solids/stripes
  const order = [1, 9, 2, 10, 8, 11, 3, 12, 4, 13, 5, 14, 6, 15, 7];
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const id = order[idx++];
      const x = apexX + row * gap * Math.cos(Math.PI / 6);
      const y = apexY + (col - row / 2) * gap;
      balls.push({ id, x, y, vx: 0, vy: 0, pocketed: false });
    }
  }
  return balls;
}

export function cloneBalls(balls) {
  return balls.map((b) => ({ ...b }));
}

export function anyMoving(balls) {
  return balls.some((b) => !b.pocketed && (Math.abs(b.vx) > MIN_SPEED || Math.abs(b.vy) > MIN_SPEED));
}

export function applyCueShot(balls, angle, power, spin = { x: 0, y: 0 }) {
  const cue = balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return null;
  const p = Math.max(0.05, Math.min(1, power));
  const speed = 2.2 + p * 14;
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;
  // English: slight lateral bias
  cue.vx += -Math.sin(angle) * spin.x * 1.2;
  cue.vy += Math.cos(angle) * spin.x * 1.2;
  cue.spinY = spin.y;
  return { cueX: cue.x, cueY: cue.y, angle, power: p, spin: { ...spin } };
}

function pocketCheck(ball, pocks) {
  for (const p of pocks) {
    if (dist(ball, p) < POCKET_R - BALL_R * 0.15) return true;
  }
  return false;
}

function resolveBallBall(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d === 0) {
    d = 0.01;
  }
  if (d >= BALL_R * 2) return false;
  const nx = dx / d;
  const ny = dy / d;
  const overlap = BALL_R * 2 - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const vn = dvx * nx + dvy * ny;
  if (vn > 0) return true;
  const impulse = (-(1 + RESTITUTION) * vn) / 2;
  a.vx += impulse * nx;
  a.vy += impulse * ny;
  b.vx -= impulse * nx;
  b.vy -= impulse * ny;
  return true;
}

function cushion(ball) {
  const minX = CUSHION + BALL_R;
  const maxX = TABLE_W - CUSHION - BALL_R;
  const minY = CUSHION + BALL_R;
  const maxY = TABLE_H - CUSHION - BALL_R;
  let hit = false;
  if (ball.x < minX) {
    ball.x = minX;
    ball.vx = Math.abs(ball.vx) * CUSHION_REST;
    hit = true;
  } else if (ball.x > maxX) {
    ball.x = maxX;
    ball.vx = -Math.abs(ball.vx) * CUSHION_REST;
    hit = true;
  }
  if (ball.y < minY) {
    ball.y = minY;
    ball.vy = Math.abs(ball.vy) * CUSHION_REST;
    hit = true;
  } else if (ball.y > maxY) {
    ball.y = maxY;
    ball.vy = -Math.abs(ball.vy) * CUSHION_REST;
    hit = true;
  }
  return hit;
}

/**
 * Step simulation. Returns events for rules.
 * @returns {{ pocketed: number[], firstContact: number|null, cushionHits: number }}
 */
export function stepPhysics(balls, dt = 1) {
  const pocks = pockets();
  const active = balls.filter((b) => !b.pocketed);
  const pocketed = [];
  let firstContact = null;
  let cushionHits = 0;

  for (const b of active) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= FRICTION;
    b.vy *= FRICTION;
    if (Math.hypot(b.vx, b.vy) < MIN_SPEED) {
      b.vx = 0;
      b.vy = 0;
    }
    if (cushion(b)) cushionHits++;
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (resolveBallBall(a, b)) {
        if (firstContact == null) {
          if (a.id === 0) firstContact = b.id;
          else if (b.id === 0) firstContact = a.id;
        }
      }
    }
  }

  for (const b of active) {
    if (pocketCheck(b, pocks)) {
      b.pocketed = true;
      b.vx = 0;
      b.vy = 0;
      pocketed.push(b.id);
    }
  }

  return { pocketed, firstContact, cushionHits };
}

/** Run until rest; accumulate events. */
export function simulateUntilStop(balls, maxSteps = 4000) {
  const allPocketed = [];
  let firstContact = null;
  let cushionHits = 0;
  let steps = 0;
  while (anyMoving(balls) && steps < maxSteps) {
    const ev = stepPhysics(balls, 1);
    for (const id of ev.pocketed) allPocketed.push(id);
    if (firstContact == null && ev.firstContact != null) firstContact = ev.firstContact;
    cushionHits += ev.cushionHits;
    steps++;
  }
  // freeze leftovers
  for (const b of balls) {
    if (!b.pocketed) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  return { pocketed: allPocketed, firstContact, cushionHits, steps };
}

/** Aim guide: ray from cue along angle until hit. */
export function aimGuide(balls, angle, maxLen = 420) {
  const cue = balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return null;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let hit = null;
  let hitT = maxLen;
  for (const b of balls) {
    if (b.pocketed || b.id === 0) continue;
    // ray-circle
    const fx = cue.x - b.x;
    const fy = cue.y - b.y;
    const a = dx * dx + dy * dy;
    const bb = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - (BALL_R * 2) ** 2;
    const disc = bb * bb - 4 * a * c;
    if (disc < 0) continue;
    const t = (-bb - Math.sqrt(disc)) / (2 * a);
    if (t > BALL_R * 0.2 && t < hitT) {
      hitT = t;
      hit = b;
    }
  }
  const endX = cue.x + dx * hitT;
  const endY = cue.y + dy * hitT;
  let ghost = null;
  if (hit) {
    const hx = endX - hit.x;
    const hy = endY - hit.y;
    const hn = Math.hypot(hx, hy) || 1;
    ghost = {
      x: hit.x,
      y: hit.y,
      tx: hit.x - (hx / hn) * 55,
      ty: hit.y - (hy / hn) * 55,
      ballId: hit.id,
    };
  }
  return { x0: cue.x, y0: cue.y, x1: endX, y1: endY, hit, ghost };
}

export function placeCueBall(balls, x, y) {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) return false;
  const minX = CUSHION + BALL_R + 2;
  const maxX = TABLE_W - CUSHION - BALL_R - 2;
  const minY = CUSHION + BALL_R + 2;
  const maxY = TABLE_H - CUSHION - BALL_R - 2;
  let nx = Math.max(minX, Math.min(maxX, x));
  let ny = Math.max(minY, Math.min(maxY, y));
  // kitchen on ball-in-hand after foul can be anywhere; break restricted separately
  for (const b of balls) {
    if (b.pocketed || b.id === 0) continue;
    if (Math.hypot(nx - b.x, ny - b.y) < BALL_R * 2.05) return false;
  }
  cue.x = nx;
  cue.y = ny;
  cue.vx = 0;
  cue.vy = 0;
  cue.pocketed = false;
  return true;
}

export function placeCueInKitchen(balls, x, y) {
  const maxX = TABLE_W / 3;
  const nx = Math.min(x, maxX - BALL_R);
  return placeCueBall(balls, nx, y);
}
