import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));

function knockOut(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: W, height: H, data } = png;
  const isBg = (x, y) => {
    const i = (y * W + x) * 4;
    return data[i] < 28 && data[i + 1] < 28 && data[i + 2] < 28 && data[i + 3] > 8;
  };
  const seen = new Uint8Array(W * H);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (seen[p] || !isBg(x, y)) return;
    seen[p] = 1;
    q.push(p);
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (q.length) {
    const p = q.pop();
    const x = p % W;
    const y = (p - x) / W;
    data[p * 4 + 3] = 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] === 0) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (data[(ny * W + nx) * 4 + 3] === 0) near = true;
        }
      }
      if (!near) continue;
      const luma = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (luma < 40) data[i + 3] = 0;
      else if (luma < 70) data[i + 3] = Math.min(data[i + 3], 90);
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

for (const f of files) {
  const fp = path.join(dir, f);
  knockOut(fp);
  console.log("knockout", f);
}
