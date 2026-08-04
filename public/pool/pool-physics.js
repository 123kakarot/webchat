/** 2D pool physics — table units, fixed-step friendly for smooth RAF. */

export const TABLE_W = 900;
export const TABLE_H = 450;
export const BALL_R = 14;
export const POCKET_R = 21;
export const CUSHION = 30;

/** Inset from cushion — X ok; Y extra inset (top/bottom rails on art). */
export const FELT_GUARD_X = 4;
export const FELT_GUARD_Y = 100;
/** @deprecated use FELT_GUARD_X */
export const FELT_GUARD = FELT_GUARD_X;

export function playBounds() {
  const minX = CUSHION + BALL_R + FELT_GUARD_X;
  const maxX = TABLE_W - CUSHION - BALL_R - FELT_GUARD_X;
  const minY = CUSHION + BALL_R + FELT_GUARD_Y;
  const maxY = TABLE_H - CUSHION - BALL_R - FELT_GUARD_Y;
  return { minX, maxX, minY, maxY };
}

/** Hard clamp — call before render / after network sync so balls never leave play rect. */
export function clampAllBallsToTable(balls) {
  if (!balls?.length) return;
  for (const b of balls) {
    if (b.pocketed) continue;
    enforcePlayBounds(b);
  }
}

/** Per fixed physics step (≈ 1/120s wall-clock when driven at 120 Hz). */
const FRICTION = 0.9885;
const MIN_SPEED = 0.028;
const RESTITUTION = 0.965;
const CUSHION_REST = 0.93;

export const PHYS_HZ = 120;

export const BALL_COLORS = {
  0: "#ffffff",
  1: "#f2c200",
  2: "#1e5fd4",
  3: "#e02020",
  4: "#8b3dd6",
  5: "#f06818",
  6: "#18a848",
  7: "#8b1830",
  8: "#141414",
  9: "#f2c200",
  10: "#1e5fd4",
  11: "#e02020",
  12: "#8b3dd6",
  13: "#f06818",
  14: "#18a848",
  15: "#8b1830",
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

/** Pocket mouths at play-rect corners / mid-rails (felt line on art). */
export function pockets() {
  const { minX, maxX, minY, maxY } = playBounds();
  const midX = TABLE_W / 2;
  return [
    { x: minX, y: minY, kind: "corner" },
    { x: midX, y: minY, kind: "side" },
    { x: maxX, y: minY, kind: "corner" },
    { x: minX, y: maxY, kind: "corner" },
    { x: midX, y: maxY, kind: "side" },
    { x: maxX, y: maxY, kind: "corner" },
  ];
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createRack() {
  const balls = [];
  balls.push({ id: 0, x: TABLE_W * 0.25, y: TABLE_H / 2, vx: 0, vy: 0, pocketed: false });

  const apexX = TABLE_W * 0.72;
  const apexY = TABLE_H / 2;
  const gap = BALL_R * 2.005;
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
  // Tuned for ~120Hz steps — looks like real cue speed on canvas
  const speed = 3.4 + p * 18.5;
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;
  cue.vx += -Math.sin(angle) * (spin.x || 0) * 1.35;
  cue.vy += Math.cos(angle) * (spin.x || 0) * 1.35;
  return { cueX: cue.x, cueY: cue.y, angle, power: p, spin: { x: spin.x || 0, y: spin.y || 0 } };
}

function pocketCheck(ball, pocks) {
  for (const p of pocks) {
    if (dist(ball, p) < POCKET_R + BALL_R * 0.35) return true;
  }
  return false;
}

function nearestPocketDist(ball, pocks) {
  let best = Infinity;
  for (const p of pocks) {
    best = Math.min(best, dist(ball, p));
  }
  return best;
}

/** Ball center in pocket funnel — skip rail bounce. */
function inPocketApproach(ball, pocks) {
  return nearestPocketDist(ball, pocks) < POCKET_R + BALL_R * 1.05;
}

function applyPocket(ball, pocks) {
  if (pocketCheck(ball, pocks)) {
    ball.pocketed = true;
    ball.vx = 0;
    ball.vy = 0;
    return true;
  }
  const { minX, maxX, minY, maxY } = playBounds();
  const oob = ball.x < minX || ball.x > maxX || ball.y < minY || ball.y > maxY;
  if (oob && nearestPocketDist(ball, pocks) < POCKET_R + BALL_R * 1.1) {
    ball.pocketed = true;
    ball.vx = 0;
    ball.vy = 0;
    return true;
  }
  return false;
}

const BALL_D = BALL_R * 2;
const COLLISION_PASSES = 10;
const PHYS_SUBSTEPS = 4;
const POS_CORRECTION = 0.92;

function resolveBallBall(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    d = 1e-6;
    const jitter = (a.id + b.id) * 0.017;
    b.x += Math.cos(jitter);
    b.y += Math.sin(jitter);
  }
  const nx = (b.x - a.x) / d;
  const ny = (b.y - a.y) / d;
  const overlap = BALL_D - d;
  if (overlap > 0) {
    const corr = overlap * POS_CORRECTION * 0.5;
    a.x -= nx * corr;
    a.y -= ny * corr;
    b.x += nx * corr;
    b.y += ny * corr;
  } else if (overlap <= -0.02) {
    return { hit: false, impulse: 0 };
  }

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return { hit: overlap > 0, impulse: 0 };

  const j = (-(1 + RESTITUTION) * velAlongNormal) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
  return { hit: true, impulse: Math.abs(j) };
}

function separateOverlaps(active) {
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    let any = false;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a.pocketed || b.pocketed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= BALL_D) continue;
        if (d < 1e-6) d = 1e-6;
        const nx = dx / d;
        const ny = dy / d;
        const push = (BALL_D - d) * 0.5;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        any = true;
      }
    }
    if (!any) break;
  }
}

function enforcePlayBounds(ball, { bounce = false } = {}) {
  if (ball.pocketed) return { hit: false, strength: 0 };
  const pocks = pockets();
  if (inPocketApproach(ball, pocks)) return { hit: false, strength: 0 };

  const { minX, maxX, minY, maxY } = playBounds();
  let hit = false;
  let strength = 0;

  if (ball.x < minX) {
    ball.x = minX;
    if (bounce && ball.vx < 0) {
      strength = Math.abs(ball.vx);
      ball.vx = -ball.vx * CUSHION_REST;
      hit = true;
    }
  } else if (ball.x > maxX) {
    ball.x = maxX;
    if (bounce && ball.vx > 0) {
      strength = Math.abs(ball.vx);
      ball.vx = -ball.vx * CUSHION_REST;
      hit = true;
    }
  }
  if (ball.y < minY) {
    ball.y = minY;
    if (bounce && ball.vy < 0) {
      strength = Math.max(strength, Math.abs(ball.vy));
      ball.vy = -ball.vy * CUSHION_REST;
      hit = true;
    }
  } else if (ball.y > maxY) {
    ball.y = maxY;
    if (bounce && ball.vy > 0) {
      strength = Math.max(strength, Math.abs(ball.vy));
      ball.vy = -ball.vy * CUSHION_REST;
      hit = true;
    }
  }

  return { hit, strength };
}

function cushion(ball) {
  return enforcePlayBounds(ball, { bounce: true });
}

/**
 * One fixed physics step.
 * @returns {{ pocketed: number[], firstContact: number|null, cushionHits: number, maxCollision: number }}
 */
export function stepPhysics(balls, dt = 1) {
  const pocks = pockets();
  const active = balls.filter((b) => !b.pocketed);
  const pocketed = [];
  let firstContact = null;
  let cushionHits = 0;
  let maxCollision = 0;

  const subDt = dt / PHYS_SUBSTEPS;

  for (let sub = 0; sub < PHYS_SUBSTEPS; sub++) {
    for (const b of active) {
      if (b.pocketed) continue;
      b.x += b.vx * subDt;
      b.y += b.vy * subDt;
      if (applyPocket(b, pocks)) {
        if (!pocketed.includes(b.id)) pocketed.push(b.id);
        continue;
      }
      enforcePlayBounds(b, { bounce: true });
    }

    for (let pass = 0; pass < COLLISION_PASSES; pass++) {
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i];
          const b = active[j];
          if (a.pocketed || b.pocketed) continue;
          const r = resolveBallBall(a, b);
          if (r.hit) {
            maxCollision = Math.max(maxCollision, r.impulse);
            if (firstContact == null) {
              if (a.id === 0) firstContact = b.id;
              else if (b.id === 0) firstContact = a.id;
            }
          }
        }
      }
    }
    separateOverlaps(active);
    for (const b of active) {
      if (b.pocketed) continue;
      if (applyPocket(b, pocks)) {
        if (!pocketed.includes(b.id)) pocketed.push(b.id);
        continue;
      }
      enforcePlayBounds(b, { bounce: true });
    }
  }

  for (const b of active) {
    if (b.pocketed) continue;
    const c = cushion(b);
    if (c.hit) {
      cushionHits++;
      maxCollision = Math.max(maxCollision, c.strength);
    }
    b.vx *= Math.pow(FRICTION, dt);
    b.vy *= Math.pow(FRICTION, dt);
    if (Math.hypot(b.vx, b.vy) < MIN_SPEED) {
      b.vx = 0;
      b.vy = 0;
    }
  }

  for (const b of active) {
    if (b.pocketed) continue;
    if (applyPocket(b, pocks) && !pocketed.includes(b.id)) pocketed.push(b.id);
  }

  clampAllBallsToTable(balls);

  return { pocketed, firstContact, cushionHits, maxCollision };
}

export function simulateUntilStop(balls, maxSteps = 8000) {
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
  for (const b of balls) {
    if (!b.pocketed) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  return { pocketed: allPocketed, firstContact, cushionHits, steps };
}

export function aimGuide(balls, angle, maxLen = 460) {
  const cue = balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return null;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let hit = null;
  let hitT = maxLen;
  for (const b of balls) {
    if (b.pocketed || b.id === 0) continue;
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
    const lx = hit.x - endX;
    const ly = hit.y - endY;
    const ln = Math.hypot(lx, ly) || 1;
    const nx = lx / ln;
    const ny = ly / ln;
    const objLen = 320;
    const cueLen = 220;
    const cross = dx * ny - dy * nx;
    const sign = cross >= 0 ? 1 : -1;
    const tx = -ny * sign;
    const ty = nx * sign;
    ghost = {
      x: endX,
      y: endY,
      objX: hit.x + nx * objLen,
      objY: hit.y + ny * objLen,
      cueX: endX + tx * cueLen,
      cueY: endY + ty * cueLen,
      ballId: hit.id,
    };
  }
  return { x0: cue.x, y0: cue.y, x1: endX, y1: endY, hit, ghost };
}

/** Re-spot illegally potted object ball (8-ball house rules). */
export function respotObjectBall(balls, id) {
  const ball = balls.find((b) => b.id === id);
  if (!ball || id === 0) return false;
  const { minX, maxX, minY, maxY } = playBounds();
  const candidates = [
    { x: TABLE_W * 0.68, y: TABLE_H * 0.38 },
    { x: TABLE_W * 0.68, y: TABLE_H * 0.62 },
    { x: TABLE_W * 0.62, y: TABLE_H * 0.5 },
    { x: TABLE_W * 0.58, y: TABLE_H * 0.42 },
    { x: TABLE_W * 0.58, y: TABLE_H * 0.58 },
  ];
  ball.pocketed = false;
  ball.vx = 0;
  ball.vy = 0;
  for (const s of candidates) {
    const nx = Math.max(minX, Math.min(maxX, s.x));
    const ny = Math.max(minY, Math.min(maxY, s.y));
    let ok = true;
    for (const b of balls) {
      if (b.pocketed || b.id === id) continue;
      if (Math.hypot(nx - b.x, ny - b.y) < BALL_R * 2.08) {
        ok = false;
        break;
      }
    }
    if (ok) {
      ball.x = nx;
      ball.y = ny;
      return true;
    }
  }
  ball.x = TABLE_W * 0.65;
  ball.y = TABLE_H / 2;
  return true;
}

export function placeCueBall(balls, x, y) {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) return false;
  const { minX, maxX, minY, maxY } = playBounds();
  const nx = Math.max(minX, Math.min(maxX, x));
  const ny = Math.max(minY, Math.min(maxY, y));
  for (const b of balls) {
    if (b.pocketed || b.id === 0) continue;
    if (Math.hypot(nx - b.x, ny - b.y) < BALL_R * 2.08) return false;
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
  return placeCueBall(balls, Math.min(x, maxX - BALL_R), y);
}
