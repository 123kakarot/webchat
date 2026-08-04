/** Asset: warehouse worker — 64×64, top-down, 4 dirs × 2 walk frames. */

export const PLAYER_SIZE = 64;

const DIRS = ["down", "up", "left", "right"];

function drawWorker(ctx, size, dir, frame) {
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.52;
  const legOff = frame === 1 ? size * 0.04 : -size * 0.02;

  ctx.save();
  if (dir === "left") {
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.translate(-cx, -cy);
  } else if (dir === "right") {
    ctx.translate(cx, cy);
    ctx.scale(1, 1);
    ctx.translate(-cx, -cy);
  }

  const shadowY = cy + size * 0.22;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(cx, shadowY, size * 0.22, size * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  const footL = cx - size * 0.12 + (dir === "down" ? legOff : 0);
  const footR = cx + size * 0.12 - (dir === "down" ? legOff : 0);
  ctx.fillStyle = "#2a3548";
  ctx.beginPath();
  ctx.ellipse(footL, cy + size * 0.18, size * 0.07, size * 0.05, 0, 0, Math.PI * 2);
  ctx.ellipse(footR, cy + size * 0.18, size * 0.07, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyG = ctx.createLinearGradient(cx - size * 0.2, cy - size * 0.05, cx + size * 0.2, cy + size * 0.2);
  bodyG.addColorStop(0, "#3a9ae8");
  bodyG.addColorStop(1, "#1a5090");
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.02, size * 0.22, size * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffccaa";
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.14, size * 0.13, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e02828";
  ctx.beginPath();
  ctx.ellipse(cx, cy - size * 0.2, size * 0.15, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(cx - size * 0.15, cy - size * 0.2, size * 0.3, size * 0.025);

  if (dir === "up") {
    ctx.fillStyle = "#e02828";
    ctx.beginPath();
    ctx.ellipse(cx, cy - size * 0.16, size * 0.14, size * 0.1, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.arc(cx - size * 0.04, cy - size * 0.15, 2, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.04, cy - size * 0.15, 2, 0, Math.PI * 2);
  ctx.fill();

  if (dir === "down" || dir === "left" || dir === "right") {
    ctx.fillStyle = "#1a3050";
    ctx.fillRect(cx - size * 0.08, cy + size * 0.08, size * 0.16, size * 0.06);
  }

  ctx.restore();
}

export function paintPlayerSprite(ctx, size = PLAYER_SIZE, dir = "down", frame = 0) {
  const d = DIRS.includes(dir) ? dir : "down";
  drawWorker(ctx, size, d, frame % 2);
}
