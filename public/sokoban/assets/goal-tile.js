/** Asset: golden goal marker — 64×64, glow + stone ring. */

export const GOAL_SIZE = 64;

export function paintGoalTile(ctx, size = GOAL_SIZE) {
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.5;
  const pad = size * 0.14;

  ctx.save();
  ctx.shadowColor = "rgba(255, 200, 60, 0.85)";
  ctx.shadowBlur = size * 0.22;

  const ring = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.42);
  ring.addColorStop(0, "rgba(255, 230, 140, 0.95)");
  ring.addColorStop(0.5, "rgba(255, 180, 40, 0.55)");
  ring.addColorStop(1, "rgba(255, 150, 20, 0)");
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffc940";
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);

  ctx.strokeStyle = "rgba(255, 240, 180, 0.9)";
  ctx.lineWidth = 2;
  const inset = pad + 4;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);

  const inner = ctx.createLinearGradient(pad, pad, size - pad, size - pad);
  inner.addColorStop(0, "rgba(0,0,0,0.35)");
  inner.addColorStop(0.5, "rgba(80,50,10,0.15)");
  inner.addColorStop(1, "rgba(255,220,100,0.25)");
  ctx.fillStyle = inner;
  ctx.fillRect(pad + 2, pad + 2, size - pad * 2 - 4, size - pad * 2 - 4);

  ctx.strokeStyle = "#ffe082";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.14, cy - size * 0.14);
  ctx.lineTo(cx + size * 0.14, cy + size * 0.14);
  ctx.moveTo(cx + size * 0.14, cy - size * 0.14);
  ctx.lineTo(cx - size * 0.14, cy + size * 0.14);
  ctx.stroke();
  ctx.restore();
}
