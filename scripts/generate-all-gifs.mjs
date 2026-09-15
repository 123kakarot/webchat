import fs from 'fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { GifWriter } from 'omggif';

const sheetPath = 'C:\\Users\\BaoVT3\\.gemini\\antigravity\\brain\\56f823ac-3086-4c49-bb96-09a2f32ae68b\\.user_uploaded\\media_1789457223754.jpg';
const sheet = jpeg.decode(fs.readFileSync(sheetPath), { useTArray: true });

function cropFrame(x1, y1, x2, y2, targetW, targetH) {
  const fw = x2 - x1 + 1;
  const fh = y2 - y1 + 1;
  const rgba = new Uint8Array(fw * fh * 4);

  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const sIdx = ((y1 + y) * sheet.width + (x1 + x)) * 4;
      const dIdx = (y * fw + x) * 4;
      rgba[dIdx] = sheet.data[sIdx];
      rgba[dIdx + 1] = sheet.data[sIdx + 1];
      rgba[dIdx + 2] = sheet.data[sIdx + 2];
      rgba[dIdx + 3] = 255;
    }
  }

  // Flood fill background from edges
  const bgR = (sheet.data[(y1 * sheet.width + x1) * 4] + sheet.data[(y1 * sheet.width + x2) * 4]) / 2;
  const bgG = (sheet.data[(y1 * sheet.width + x1) * 4 + 1] + sheet.data[(y1 * sheet.width + x2) * 4 + 1]) / 2;
  const bgB = (sheet.data[(y1 * sheet.width + x1) * 4 + 2] + sheet.data[(y1 * sheet.width + x2) * 4 + 2]) / 2;

  const visited = new Uint8Array(fw * fh);
  const queue = [];

  function isBg(x, y) {
    const idx = (y * fw + x) * 4;
    const r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
    const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
    return diff < 45 || (r > 230 && g > 230 && b > 225);
  }

  for (let x = 0; x < fw; x++) {
    if (isBg(x, 0)) { queue.push(x, 0); visited[0 * fw + x] = 1; }
    if (isBg(x, fh - 1)) { queue.push(x, fh - 1); visited[(fh - 1) * fw + x] = 1; }
  }
  for (let y = 0; y < fh; y++) {
    if (isBg(0, y) && !visited[y * fw + 0]) { queue.push(0, y); visited[y * fw + 0] = 1; }
    if (isBg(fw - 1, y) && !visited[y * fw + (fw - 1)]) { queue.push(fw - 1, y); visited[y * fw + (fw - 1)] = 1; }
  }

  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    const n = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
    for (const [nx, ny] of n) {
      if (nx >= 0 && nx < fw && ny >= 0 && ny < fh && !visited[ny * fw + nx]) {
        if (isBg(nx, ny)) {
          visited[ny * fw + nx] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  for (let i = 0; i < fw * fh; i++) {
    if (visited[i]) rgba[i * 4 + 3] = 0;
  }

  // Center horizontally, bottom-align vertically
  const finalW = targetW || fw;
  const finalH = targetH || fh;
  const out = new Uint8Array(finalW * finalH * 4);
  const offsetX = Math.floor((finalW - fw) / 2);
  const offsetY = finalH - fh;

  for (let y = 0; y < fh; y++) {
    const dy = offsetY + y;
    if (dy < 0 || dy >= finalH) continue;
    for (let x = 0; x < fw; x++) {
      const dx = offsetX + x;
      if (dx < 0 || dx >= finalW) continue;
      const sIdx = (y * fw + x) * 4;
      const dIdx = (dy * finalW + dx) * 4;
      out[dIdx] = rgba[sIdx];
      out[dIdx + 1] = rgba[sIdx + 1];
      out[dIdx + 2] = rgba[sIdx + 2];
      out[dIdx + 3] = rgba[sIdx + 3];
    }
  }

  return { width: finalW, height: finalH, rgba: out };
}

function quantizeAndSaveGif(frames, delays, outPath) {
  const width = frames[0].width;
  const height = frames[0].height;

  // Build palette
  const colorCounts = new Map();
  for (const f of frames) {
    for (let i = 0; i < width * height; i++) {
      if (f.rgba[i * 4 + 3] < 128) continue;
      const r = f.rgba[i * 4] & 0xF8;
      const g = f.rgba[i * 4 + 1] & 0xF8;
      const b = f.rgba[i * 4 + 2] & 0xF8;
      const key = (r << 16) | (g << 8) | b;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }

  const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
  // 0 is transparent. Reserve first slots for essential dark colors (eyes, noses, outlines)
  const essentialColors = [0x080808, 0x181818, 0x282018, 0x382818, 0x483020];
  const palette = [0x000000, ...essentialColors];
  const added = new Set(essentialColors);
  
  for (let i = 0; i < sorted.length && palette.length < 255; i++) {
    const col = sorted[i][0];
    if (!added.has(col)) {
      palette.push(col);
      added.add(col);
    }
  }
  while (palette.length < 256) {
    palette.push(0x000000);
  }

  const indexedFrames = frames.map(f => {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      if (f.rgba[i * 4 + 3] < 128) {
        indices[i] = 0;
        continue;
      }
      const r = f.rgba[i * 4];
      const g = f.rgba[i * 4 + 1];
      const b = f.rgba[i * 4 + 2];

      let bestDist = Infinity;
      let bestIdx = 1;
      for (let p = 1; p < Math.min(256, sorted.length + 1); p++) {
        const pr = (palette[p] >> 16) & 0xFF;
        const pg = (palette[p] >> 8) & 0xFF;
        const pb = palette[p] & 0xFF;
        const dr = r - pr, dg = g - pg, db = b - pb;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = p;
          if (dist === 0) break;
        }
      }
      indices[i] = bestIdx;
    }
    return indices;
  });

  const buf = Buffer.alloc(width * height * frames.length + 65536);
  const gif = new GifWriter(buf, width, height, { loop: 0 });

  for (let i = 0; i < indexedFrames.length; i++) {
    gif.addFrame(0, 0, width, height, indexedFrames[i], {
      palette,
      delay: delays[i] || 25,
      transparent: 0,
      disposal: 2,
    });
  }

  const out = buf.subarray(0, gif.end());
  fs.writeFileSync(outPath, out);
  console.log(`Saved ${outPath} (${out.length} bytes, ${frames.length} frames, ${width}x${height})`);
}

// 1. Chú chó trắng (Row 1, y=260..342)
console.log('1. Generating white-dog.gif...');
const dogFrames = [
  cropFrame(110, 260, 171, 342, 85, 90), // Ngồi
  cropFrame(191, 260, 253, 342, 85, 90), // Vui vẻ
  cropFrame(371, 260, 441, 342, 85, 90), // Vẫy đuôi
  cropFrame(278, 260, 351, 342, 85, 90), // Cười mắt nhắm
  cropFrame(931, 260, 1001, 342, 85, 90), // Giơ chân
  cropFrame(466, 260, 541, 342, 85, 90), // Cúi người chơi
];
// Sit -> Happy -> Tail wag -> Tail wag -> Blink -> Wave paw -> Wave paw -> Bow -> Happy -> Sit
const dogSeq = [0, 1, 2, 1, 2, 3, 4, 3, 4, 5, 1, 0];
const dogDelays = [40, 25, 20, 20, 20, 28, 28, 20, 28, 35, 25, 45];
quantizeAndSaveGif(dogSeq.map(i => dogFrames[i]), dogDelays, 'D:\\app\\source\\public\\assets\\white-dog.gif');

// 2. Chú corgi bên hàng rào (Row 2, y=412..492)
console.log('2. Generating corgi-fence.gif...');
const corgiFenceFrames = [
  cropFrame(22, 412, 99, 492, 85, 88),   // Nhìn ra ngoài
  cropFrame(111, 412, 183, 492, 85, 88), // Nghiêng đầu
  cropFrame(195, 412, 267, 492, 85, 88), // Vui vẻ
  cropFrame(280, 412, 356, 492, 85, 88), // Cười mắt nhắm
  cropFrame(372, 412, 447, 492, 85, 88), // Giơ chân
  cropFrame(463, 412, 545, 492, 85, 88), // Dựa hàng rào
  cropFrame(654, 412, 727, 492, 85, 88), // Nhìn phải
];
// Clean frames without green eye artifacts: 2: Vui vẻ, 1: Nghiêng đầu, 3: Cười, 4: Giơ chân, 5: Dựa hàng rào, 6: Nhìn phải
const corgiFenceSeq = [2, 1, 2, 3, 4, 3, 4, 5, 6, 2];
const corgiFenceDelays = [40, 28, 25, 25, 25, 20, 28, 35, 28, 45];
quantizeAndSaveGif(corgiFenceSeq.map(i => corgiFenceFrames[i]), corgiFenceDelays, 'D:\\app\\source\\public\\assets\\corgi-fence.gif');

// 3. Chú mèo trong thùng carton (Row 3, y=562..634)
console.log('3. Generating cat-box.gif...');
const catFrames = [
  cropFrame(22, 562, 96, 634, 82, 80),   // Ngồi trong thùng
  cropFrame(115, 562, 187, 634, 82, 80), // Nhìn lên
  cropFrame(208, 562, 277, 634, 82, 80), // Nghiêng đầu
  cropFrame(298, 562, 365, 634, 82, 80), // Cười mắt nhắm
  cropFrame(387, 562, 455, 634, 82, 80), // Vươn chân
  cropFrame(478, 562, 547, 634, 82, 80), // Dựa mép thùng
  cropFrame(930, 562, 997, 634, 82, 80), // Vẫy chân
];
// In box -> Look up -> Tilt head -> Smile -> Reach paw -> Wave paw -> Reach paw -> Wave paw -> Lean rim -> In box
const catSeq = [0, 1, 2, 3, 4, 6, 4, 6, 5, 2, 0];
const catDelays = [40, 28, 25, 28, 25, 25, 25, 25, 32, 25, 45];
quantizeAndSaveGif(catSeq.map(i => catFrames[i]), catDelays, 'D:\\app\\source\\public\\assets\\cat-box.gif');

// 4. Chú corgi chạy / vui vẻ trên đường cỏ (Row 2 frames 10 & 11)
console.log('4. Generating corgi-run.gif...');
// Frame 9: Chạy nhảy (x=834..912, y=412..492)
// Frame 10: Hào hứng (x=930..996, y=412..492)
const corgiRunFrames = [
  cropFrame(834, 412, 912, 492, 85, 88), // Chạy nhảy
  cropFrame(930, 412, 996, 492, 85, 88), // Hào hứng
];
// Also read pet-02 (corgi run) & pet-05 (slide) from PNGs for smooth multi-frame run
const pet02Png = PNG.sync.read(fs.readFileSync('D:\\app\\source\\public\\assets\\pets\\pet-02.png'));
const pet01Png = PNG.sync.read(fs.readFileSync('D:\\app\\source\\public\\assets\\pets\\pet-01.png'));
const pet05Png = PNG.sync.read(fs.readFileSync('D:\\app\\source\\public\\assets\\pets\\pet-05.png'));

function resizePngToFrame(png, tw, th) {
  const out = new Uint8Array(tw * th * 4);
  const scale = Math.min((tw - 8) / png.width, (th - 8) / png.height);
  const scaledW = Math.floor(png.width * scale);
  const scaledH = Math.floor(png.height * scale);
  const ox = Math.floor((tw - scaledW) / 2);
  const oy = th - scaledH;

  for (let y = 0; y < scaledH; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < scaledW; x++) {
      const sx = Math.floor(x / scale);
      const sIdx = (sy * png.width + sx) * 4;
      const dIdx = ((oy + y) * tw + (ox + x)) * 4;
      out[dIdx] = png.data[sIdx];
      out[dIdx + 1] = png.data[sIdx + 1];
      out[dIdx + 2] = png.data[sIdx + 2];
      out[dIdx + 3] = png.data[sIdx + 3];
    }
  }
  return { width: tw, height: th, rgba: out };
}

const fRun = resizePngToFrame(pet02Png, 85, 88);
const fSit = resizePngToFrame(pet01Png, 85, 88);
const fSlide = resizePngToFrame(pet05Png, 85, 88);
const fJump = corgiRunFrames[0];
const fExcited = corgiRunFrames[1];

// Running loop: Run -> Jump -> Slide/pounce -> Excited -> Sit -> Run
const runFrames = [fRun, fJump, fSlide, fExcited, fSit];
const runDelays = [22, 22, 25, 25, 30];
quantizeAndSaveGif(runFrames, runDelays, 'D:\\app\\source\\public\\assets\\corgi-run.gif');

console.log('All 4 GIFs successfully generated!');
