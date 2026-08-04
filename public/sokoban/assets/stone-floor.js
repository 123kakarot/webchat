/** Asset: stone floor tile — 64×64, dungeon, per-seed variation. */

export const FLOOR_SIZE = 64;

function hash2(a, b) {
  return ((a * 73856093) ^ (b * 19349663)) >>> 0;
}

export function paintStoneFloorTile(ctx, size = FLOOR_SIZE, seed = 0) {
  ctx.clearRect(0, 0, size, size);
  const h = hash2(seed, 7919);
  const base = 42 + (h % 18);
  const tint = 48 + ((h >> 8) % 14);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `rgb(${base - 6},${base + 4},${tint + 8})`);
  g.addColorStop(0.55, `rgb(${base - 14},${base - 2},${tint})`);
  g.addColorStop(1, `rgb(${base - 22},${base - 10},${tint - 6})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  ctx.strokeStyle = "rgba(120,150,190,0.12)";
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);

  const spots = 3 + (h % 4);
  for (let i = 0; i < spots; i++) {
    const sx = ((h >> (i * 5)) % 47) + 8;
    const sy = ((h >> (i * 5 + 3)) % 47) + 8;
    ctx.fillStyle = `rgba(0,0,0,${0.06 + (i % 3) * 0.04})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 4 + (i % 2) * 3, 3 + (i % 2), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (h % 7 === 0) {
    ctx.strokeStyle = "rgba(20,25,35,0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const x0 = 10 + (h % 20);
    const y0 = 8 + ((h >> 4) % 20);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + 18, y0 + 22);
    ctx.lineTo(x0 + 8, y0 + 38);
    ctx.stroke();
  }

  if (h % 11 === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(4, 4, size * 0.35, size * 0.25);
  }

  const ao = ctx.createLinearGradient(0, size - 8, 0, size);
  ao.addColorStop(0, "rgba(0,0,0,0)");
  ao.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = ao;
  ctx.fillRect(0, size - 10, size, 10);
}
