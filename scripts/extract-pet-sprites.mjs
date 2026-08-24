import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const srcPath = process.argv[2];
const outDir = process.argv[3];
const png = PNG.sync.read(fs.readFileSync(srcPath));
const { width: W, height: H, data } = png;

function idx(x, y) {
  return (y * W + x) * 4;
}

function isInk(x, y) {
  const i = idx(x, y);
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return r > 18 || g > 18 || b > 18;
}

const seen = new Uint8Array(W * H);
const boxes = [];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (seen[p] || !isInk(x, y)) continue;
    const stack = [[x, y]];
    seen[p] = 1;
    let minX = x,
      maxX = x,
      minY = y,
      maxY = y,
      count = 0;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      count++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (seen[np] || !isInk(nx, ny)) continue;
          seen[np] = 1;
          stack.push([nx, ny]);
        }
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (count < 80 || w < 12 || h < 12) continue;
    boxes.push({ minX, minY, maxX, maxY, w, h, count });
  }
}

boxes.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
fs.mkdirSync(outDir, { recursive: true });

const pad = 4;
const saved = [];
for (const [i, box] of boxes.entries()) {
  const x0 = Math.max(0, box.minX - pad);
  const y0 = Math.max(0, box.minY - pad);
  const x1 = Math.min(W - 1, box.maxX + pad);
  const y1 = Math.min(H - 1, box.maxY + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = idx(x0 + x, y0 + y);
      const di = (y * cw + x) * 4;
      const r = data[si];
      const g = data[si + 1];
      const b = data[si + 2];
      const ink = r > 18 || g > 18 || b > 18;
      out.data[di] = r;
      out.data[di + 1] = g;
      out.data[di + 2] = b;
      out.data[di + 3] = ink ? 255 : 0;
    }
  }
  const name = `pet-${String(i + 1).padStart(2, "0")}.png`;
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out));
  saved.push({ name, ...box });
}

fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(saved, null, 2));
console.log(`saved ${saved.length} sprites`);
for (const s of saved) {
  console.log(`${s.name} ${s.w}x${s.h} @${s.minX},${s.minY} n=${s.count}`);
}
