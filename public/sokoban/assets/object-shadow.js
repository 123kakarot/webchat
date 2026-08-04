/** Asset: soft round object shadow — 64×64, transparent. */

export const SHADOW_SIZE = 64;

export function paintObjectShadow(ctx, size = SHADOW_SIZE) {
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.62;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.38);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.45, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * 0.36, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}
