/** Asset: wooden crate — 64×64 top-down 3D cartoon. */

export const CRATE_SIZE = 64;

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function paintWoodenCrate(ctx, size = CRATE_SIZE, onGoal = false) {
  ctx.clearRect(0, 0, size, size);
  const m = size * 0.1;
  const topH = size * 0.52;
  const frontH = size * 0.38;
  const x = m;
  const y = m * 0.6;

  const frontG = ctx.createLinearGradient(x, y + topH, x, y + topH + frontH);
  frontG.addColorStop(0, "#7a4518");
  frontG.addColorStop(1, "#3d220c");
  ctx.fillStyle = frontG;
  roundRect(ctx, x, y + topH - 2, size - m * 2, frontH + 4, 4);
  ctx.fill();

  const topG = ctx.createLinearGradient(x, y, x + size, y + topH);
  topG.addColorStop(0, "#f0c888");
  topG.addColorStop(0.4, "#d89850");
  topG.addColorStop(1, "#9a5a28");
  ctx.fillStyle = topG;
  roundRect(ctx, x, y, size - m * 2, topH, 6);
  ctx.fill();

  ctx.strokeStyle = "rgba(60,30,10,0.55)";
  ctx.lineWidth = 2;
  const cx = size * 0.5;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + topH * 0.35);
  ctx.lineTo(size - m * 2 - 4, y + topH * 0.35);
  ctx.moveTo(x + 4, y + topH * 0.68);
  ctx.lineTo(size - m * 2 - 4, y + topH * 0.68);
  ctx.moveTo(cx, y + 4);
  ctx.lineTo(cx, y + topH - 4);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,230,180,0.35)";
  ctx.fillRect(x + 3, y + 3, (size - m * 2) * 0.45, topH * 0.25);

  const nails = [
    [x + 8, y + 8],
    [size - m * 2 - 8, y + 8],
    [x + 8, y + topH - 8],
    [size - m * 2 - 8, y + topH - 8],
  ];
  ctx.fillStyle = "#6a7080";
  for (const [nx, ny] of nails) {
    ctx.beginPath();
    ctx.arc(nx, ny, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a4048";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  ctx.strokeStyle = "#4a2810";
  ctx.lineWidth = 2.5;
  roundRect(ctx, x, y, size - m * 2, topH + frontH * 0.15, 6);
  ctx.stroke();

  if (onGoal) {
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255, 201, 64, 0.18)";
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    ctx.strokeStyle = "rgba(255, 201, 64, 0.75)";
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1, y + 1, size - m * 2 - 2, topH - 2, 5);
    ctx.stroke();
  }
}
