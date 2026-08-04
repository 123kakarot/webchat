/** Asset: brick wall tile — 64×64, staggered bricks, bevel, AO. */

export const WALL_SIZE = 64;

function drawOneBrick(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#b87850");
  g.addColorStop(0.35, "#8f5234");
  g.addColorStop(0.85, "#5c321c");
  g.addColorStop(1, "#4a2814");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = "rgba(255,210,160,0.22)";
  ctx.fillRect(x + 1, y + 1, w - 2, Math.max(2, h * 0.22));

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(x + 1, y + h - 2, w - 2, 2);

  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function paintBrickWallTile(ctx, size = WALL_SIZE) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#2a1810";
  ctx.fillRect(0, 0, size, size);

  const mortar = 2;
  const rows = 5;
  const brickH = Math.floor((size - mortar * (rows + 1)) / rows);
  let y = mortar;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? mortar : mortar + brickH * 0.5;
    const cols = row % 2 === 0 ? 3 : 2;
    const brickW = (size - mortar * 2 - offset + (row % 2 ? brickH * 0.5 : 0)) / cols - mortar;
    let x = offset;
    for (let col = 0; col < cols; col++) {
      const w = Math.min(brickW, size - x - mortar);
      if (w > 4) drawOneBrick(ctx, x, y, w, brickH);
      x += w + mortar;
    }
    y += brickH + mortar;
  }

  const topLight = ctx.createLinearGradient(0, 0, 0, size * 0.35);
  topLight.addColorStop(0, "rgba(255,220,180,0.08)");
  topLight.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topLight;
  ctx.fillRect(0, 0, size, size * 0.35);

  const sideAo = ctx.createLinearGradient(size - 10, 0, size, 0);
  sideAo.addColorStop(0, "rgba(0,0,0,0)");
  sideAo.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sideAo;
  ctx.fillRect(size - 12, 0, 12, size);

  const bottomAo = ctx.createLinearGradient(0, size - 14, 0, size);
  bottomAo.addColorStop(0, "rgba(0,0,0,0)");
  bottomAo.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = bottomAo;
  ctx.fillRect(0, size - 14, size, 14);
}

/** Wall cap — top face extrusion hint for outer edges */
export function paintBrickWallCapTile(ctx, size = WALL_SIZE) {
  paintBrickWallTile(ctx, size);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, size - 6, size, 6);
  const lip = ctx.createLinearGradient(0, 0, 0, 8);
  lip.addColorStop(0, "#c48858");
  lip.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lip;
  ctx.fillRect(0, 0, size, 8);
}
