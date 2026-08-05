/** Victory fireworks — canvas particles, no deps. */

/** @param {HTMLCanvasElement} canvas */
export function startVictoryFireworks(canvas, ms = 5200) {
  if (canvas._skFxStop) canvas._skFxStop();
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  const colors = ["#ffc940", "#ff6b4a", "#1d4fff", "#5a39ff", "#7cf5ff", "#ff9de2"];
  /** @type {{ x: number, y: number, vx: number, vy: number, life: number, max: number, color: string, r: number }[]} */
  let particles = [];
  let running = true;
  const start = performance.now();
  let nextBurst = 0;

  function burst(cx, cy) {
    const n = 36 + Math.floor(Math.random() * 20);
    const col = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.35;
      const sp = 2.2 + Math.random() * 4.5;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 55 + Math.random() * 35,
        color: col,
        r: 2 + Math.random() * 2.5,
      });
    }
  }

  function tick(now) {
    if (!running) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (now - start < ms && now >= nextBurst) {
      burst(w * (0.2 + Math.random() * 0.6), h * (0.15 + Math.random() * 0.45));
      nextBurst = now + 380 + Math.random() * 420;
    }

    particles = particles.filter((p) => {
      p.life += 1;
      p.vy += 0.06;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.985;
      const t = p.life / p.max;
      if (t >= 1) return false;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - t * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      return true;
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (now - start < ms || particles.length) requestAnimationFrame(tick);
    else stop();
  }

  function stop() {
    running = false;
    ro.disconnect();
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    canvas._skFxStop = null;
  }

  canvas._skFxStop = stop;
  burst(canvas.clientWidth * 0.5, canvas.clientHeight * 0.35);
  requestAnimationFrame(tick);
  return stop;
}
