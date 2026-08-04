/**
 * 8 Ball Pool — smooth RAF physics + AI/Local/Online hooks.
 */
import {
  TABLE_W,
  TABLE_H,
  BALL_R,
  POCKET_R,
  CUSHION,
  BALL_COLORS,
  PHYS_HZ,
  pockets,
  aimGuide,
  anyMoving,
  stepPhysics,
} from "./pool-physics.js";
import {
  createMatch,
  beginShot,
  accumulateShotEvent,
  finishShot,
  tryPlaceCue,
  legalTargets,
} from "./pool-rules.js";
import { pickPoolShot, aiThinkDelay } from "./pool-ai.js";

const CUES = [
  { id: "starter", name: "Starter Cue", power: 1, spin: 0.6, aim: 0.7, accuracy: 0.65 },
  { id: "classic", name: "Classic Cue", power: 1.05, spin: 0.75, aim: 0.8, accuracy: 0.75 },
  { id: "carbon", name: "Carbon Cue", power: 1.1, spin: 0.85, aim: 0.88, accuracy: 0.85 },
  { id: "galaxy", name: "Galaxy Cue", power: 1.15, spin: 1, aim: 0.95, accuracy: 0.92 },
  { id: "dragon", name: "Dragon Cue", power: 1.2, spin: 1.05, aim: 0.97, accuracy: 0.95 },
  { id: "golden", name: "Golden Cue", power: 1.22, spin: 1.1, aim: 1, accuracy: 0.98 },
];

const TABLES = [
  { id: "classic", name: "Classic", felt: "#0b5e3b" },
  { id: "neon", name: "Neon", felt: "#12305a" },
  { id: "royal", name: "Royal", felt: "#3b1d5c" },
  { id: "cyber", name: "Cyber", felt: "#0a3d4d" },
  { id: "space", name: "Space", felt: "#0b1a3a" },
  { id: "temple", name: "Temple", felt: "#3d2a14" },
  { id: "japan", name: "Japan", felt: "#5a1020" },
  { id: "frozen", name: "Frozen", felt: "#164e63" },
];

const BETS = [100, 500, 1000, 5000, 10000];
const STORAGE_STATS = "pool8-stats";
const STORAGE_COIN = "pool8-coins";
const STORAGE_ELO = "pool8-elo";
const STORAGE_REPLAY = "pool8-replays";

export function createPoolModule(deps = {}) {
  const {
    escapeHtml = (s) => String(s ?? ""),
    playerName = () => "Bạn",
    toast,
    beep,
    onUpdate,
    emitOnlineShot,
    onNeedLogin,
  } = deps;

  let match = null;
  let aimAngle = 0;
  let power = 0.55;
  let spinX = 0;
  let animId = 0;
  let aiBusy = false;
  let aiGen = 0;
  let selectedCue = "starter";
  let selectedTable = "classic";
  let selectedBet = 100;
  let canvasEl = null;
  let pulling = false;
  let pullStart = null;
  let loopRunning = false;
  let physAcc = 0;
  let lastFrame = 0;

  function notify(full = true) {
    if (!full && canvasEl) {
      paintCanvas(canvasEl);
      return;
    }
    onUpdate?.();
  }

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_STATS) || "{}");
    } catch {
      return {};
    }
  }
  function saveStats(s) {
    localStorage.setItem(STORAGE_STATS, JSON.stringify(s));
  }
  function coins() {
    return Number(localStorage.getItem(STORAGE_COIN) || "2000") || 2000;
  }
  function setCoins(n) {
    localStorage.setItem(STORAGE_COIN, String(Math.max(0, Math.floor(n))));
  }
  function elo() {
    return Number(localStorage.getItem(STORAGE_ELO) || "1000") || 1000;
  }
  function setElo(n) {
    localStorage.setItem(STORAGE_ELO, String(Math.max(400, Math.floor(n))));
  }
  function rankFromElo(e) {
    if (e >= 2200) return "Grand Master";
    if (e >= 1900) return "Master";
    if (e >= 1600) return "Diamond";
    if (e >= 1400) return "Gold";
    if (e >= 1200) return "Silver";
    return "Bronze";
  }

  function cueStats() {
    return CUES.find((c) => c.id === selectedCue) || CUES[0];
  }
  function tableTheme() {
    return TABLES.find((t) => t.id === (match?.tableTheme || selectedTable)) || TABLES[0];
  }

  function startMatch(opts) {
    stopAnim();
    const name = playerName() || "Bạn";
    match = createMatch({
      mode: opts.mode || "ai",
      aiLevel: opts.aiLevel || "medium",
      names: opts.names || [name, "Đối thủ"],
      tableTheme: selectedTable,
      cueId: selectedCue,
      turnMs: 30000,
    });
    match.bet = opts.bet || 0;
    match.kitchenOnly = true;
    match.shotLog = [];
    aimAngle = 0;
    power = 0.55;
    spinX = 0;
    toast?.(opts.toast || "Trận bắt đầu — phát bóng trong khu vực nhà.");
    notify(true);
    startRenderLoop();
    return match;
  }

  function startAi(level) {
    const bet = selectedBet;
    if (coins() < bet) {
      toast?.("Không đủ coin để cược.");
      return null;
    }
    setCoins(coins() - bet);
    return startMatch({
      mode: "ai",
      aiLevel: level || "medium",
      names: [playerName() || "Bạn", `AI · ${(level || "medium").toUpperCase()}`],
      bet,
      toast: `Cược ${bet} coin · AI ${(level || "medium").toUpperCase()}`,
    });
  }

  function startLocal() {
    return startMatch({
      mode: "local",
      names: [`${playerName() || "P1"}`, "Người 2"],
      bet: 0,
      toast: "Local 2 người — luân phiên một máy.",
    });
  }

  function startQuickAi() {
    return startAi("hard");
  }

  function clearMatch() {
    stopAnim();
    loopRunning = false;
    aiGen++;
    aiBusy = false;
    match = null;
    canvasEl = null;
  }

  function stopAnim() {
    cancelAnimationFrame(animId);
    animId = 0;
    physAcc = 0;
  }

  function drawTable(ctx, w, h) {
    const sx = w / TABLE_W;
    const sy = h / TABLE_H;
    const theme = tableTheme();
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#4a2c14");
    g.addColorStop(1, "#1c1008");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = theme.felt;
    const fx = CUSHION * sx;
    const fy = CUSHION * sy;
    const fw = (TABLE_W - CUSHION * 2) * sx;
    const fh = (TABLE_H - CUSHION * 2) * sy;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(fx, fy, fw, fh, 14);
    else ctx.rect(fx, fy, fw, fh);
    ctx.fill();
    // felt grain
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(((i * 97) % w), ((i * 53) % h), 2, 2);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo((TABLE_W / 3) * sx, CUSHION * sy);
    ctx.lineTo((TABLE_W / 3) * sx, (TABLE_H - CUSHION) * sy);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pockets()) {
      ctx.beginPath();
      ctx.fillStyle = "#050505";
      ctx.arc(p.x * sx, p.y * sy, POCKET_R * sx * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawBalls(ctx, w, h) {
    if (!match) return;
    const sx = w / TABLE_W;
    const sy = h / TABLE_H;
    for (const b of match.balls) {
      if (b.pocketed) continue;
      const x = b.x * sx;
      const y = b.y * sy;
      const r = BALL_R * sx;
      ctx.beginPath();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.ellipse(x + r * 0.15, y + r * 0.25, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      const grd = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.08, x, y, r);
      grd.addColorStop(0, "#ffffffcc");
      grd.addColorStop(0.32, BALL_COLORS[b.id] || "#ccc");
      grd.addColorStop(1, "#00000099");
      ctx.beginPath();
      ctx.fillStyle = grd;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.id >= 9) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = Math.max(1.5, r * 0.18);
        ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (b.id !== 0) {
        ctx.fillStyle = b.id === 8 ? "#fff" : "#0a0a0a";
        ctx.font = `bold ${Math.max(10, r * 0.95)}px Be Vietnam Pro, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(b.id), x, y + 0.5);
      }
    }
  }

  function drawAim(ctx, w, h) {
    if (!match || match.moving || match.status !== "playing") return;
    if (match.mode === "ai" && match.turn === 1) return;
    if (match.mode === "online" && match.turn !== match.meSide) return;
    const guide = aimGuide(match.balls, aimAngle);
    if (!guide) return;
    const sx = w / TABLE_W;
    const sy = h / TABLE_H;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(guide.x0 * sx, guide.y0 * sy);
    ctx.lineTo(guide.x1 * sx, guide.y1 * sy);
    ctx.stroke();
    if (guide.ghost) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(255,220,120,0.8)";
      ctx.beginPath();
      ctx.moveTo(guide.ghost.x * sx, guide.ghost.y * sy);
      ctx.lineTo(guide.ghost.tx * sx, guide.ghost.ty * sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
    if (cue) {
      const back = 36 + power * 70 + (pulling ? power * 20 : 0);
      const tip = 14;
      ctx.strokeStyle = "#e7c29a";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cue.x * sx - Math.cos(aimAngle) * tip * sx, cue.y * sy - Math.sin(aimAngle) * tip * sy);
      ctx.lineTo(cue.x * sx - Math.cos(aimAngle) * back * sx, cue.y * sy - Math.sin(aimAngle) * back * sy);
      ctx.stroke();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cue.x * sx - Math.cos(aimAngle) * tip * sx, cue.y * sy - Math.sin(aimAngle) * tip * sy);
      ctx.lineTo(
        cue.x * sx - Math.cos(aimAngle) * (tip + 10) * sx,
        cue.y * sy - Math.sin(aimAngle) * (tip + 10) * sy
      );
      ctx.stroke();
    }
  }

  function paintCanvas(canvas) {
    if (!canvas || !match) return;
    const ctx = canvas.getContext("2d");
    drawTable(ctx, canvas.width, canvas.height);
    drawBalls(ctx, canvas.width, canvas.height);
    drawAim(ctx, canvas.width, canvas.height);
  }

  function startRenderLoop() {
    if (loopRunning) return;
    loopRunning = true;
    lastFrame = performance.now();
    const frame = (now) => {
      if (!loopRunning || !match) {
        loopRunning = false;
        return;
      }
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      if (match.moving) {
        physAcc += dt * PHYS_HZ;
        // Cap catch-up so tab-switch doesn't explode
        let guard = 0;
        while (physAcc >= 1 && guard++ < 8) {
          const ev = stepPhysics(match.balls, 1);
          accumulateShotEvent(match, ev);
          if (ev.maxCollision > 2.2) beep?.(180 + Math.min(400, ev.maxCollision * 40), 25, "triangle", 0.02);
          if (ev.pocketed?.length) beep?.(660, 45, "sine", 0.03);
          physAcc -= 1;
        }
        if (physAcc > 2) physAcc = 0;

        if (!anyMoving(match.balls)) {
          finishShot(match);
          physAcc = 0;
          saveReplayShot();
          patchHud();
          afterShotSettled();
          notify(true);
        } else if (canvasEl) {
          paintCanvas(canvasEl);
          patchHud(false);
        }
      } else if (canvasEl) {
        paintCanvas(canvasEl);
      }

      animId = requestAnimationFrame(frame);
    };
    animId = requestAnimationFrame(frame);
  }

  function patchHud(forceMsg = true) {
    if (!canvasEl) return;
    const root = canvasEl.closest(".pool-shell") || canvasEl.parentElement?.parentElement;
    if (!root) return;
    const msg = root.querySelector?.(".pool-msg") || document.querySelector(".pool-msg");
    if (msg && match && forceMsg) {
      msg.textContent = `${match.message || ""}${match.moving ? " · bi đang chạy…" : ""}${
        aiBusy ? " · AI đang nghĩ…" : ""
      }`;
    }
    const powerEl = root.querySelector?.("[data-pool-power]");
    if (powerEl && document.activeElement !== powerEl) powerEl.value = String(Math.round(power * 100));
  }

  function saveReplayShot() {
    if (!match?.lastShot) return;
    match.shotLog = match.shotLog || [];
    match.shotLog.push({
      ...match.lastShot,
      balls: match.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed })),
    });
  }

  function persistReplay() {
    if (!match?.shotLog?.length) return;
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_REPLAY) || "[]");
      list.unshift({
        id: `p${Date.now()}`,
        at: Date.now(),
        mode: match.mode,
        names: match.names,
        winner: match.winner,
        shots: match.shotLog.length,
        log: match.shotLog.slice(-80),
      });
      localStorage.setItem(STORAGE_REPLAY, JSON.stringify(list.slice(0, 12)));
    } catch (_) {}
  }

  function canControl() {
    if (!match || match.status !== "playing" || match.moving || aiBusy) return false;
    if (match.mode === "ai") return match.turn === 0;
    if (match.mode === "online") return match.turn === match.meSide;
    return true;
  }

  function playShot(angle, pwr, spin, { fromOnline = false } = {}) {
    if (!match || match.moving) return false;
    const cue = cueStats();
    const powerUse = Math.min(1, pwr * (fromOnline ? 1 : cue.power));
    const ang =
      angle + (fromOnline ? 0 : (Math.random() - 0.5) * 0.018 * (1 - cue.accuracy));
    const sp = {
      x: (spin?.x || 0) * (fromOnline ? 1 : cue.spin),
      y: 0,
    };
    const res = beginShot(match, ang, powerUse, sp);
    if (!res.ok) {
      toast?.(res.reason);
      return false;
    }
    beep?.(420, 35, "sine", 0.035);
    if (!fromOnline && match.mode === "online" && emitOnlineShot) {
      void emitOnlineShot({
        angle: ang,
        power: powerUse,
        spin: sp,
        cueX: match.balls.find((b) => b.id === 0)?.x,
        cueY: match.balls.find((b) => b.id === 0)?.y,
      });
    }
    startRenderLoop();
    return true;
  }

  function doShoot() {
    if (!canControl()) return false;
    if (match.ballInHand && match.phase !== "break") {
      toast?.("Chạm bàn để đặt bi cái (Ball in Hand).");
      return false;
    }
    return playShot(aimAngle, power, { x: spinX, y: 0 });
  }

  function afterShotSettled() {
    if (!match) return;
    if (match._pendingRoom) {
      const pending = match._pendingRoom;
      match._pendingRoom = null;
      applyOnlineRoom(pending, playerName());
      notify(true);
      return;
    }
    if (match.status === "finished") {
      const st = loadStats();
      st.games = (st.games || 0) + 1;
      const won = match.winner === (match.mode === "online" ? match.meSide : 0);
      if (match.mode === "ai" || match.mode === "online") {
        if (match.winner === 0 || (match.mode === "online" && match.winner === match.meSide)) {
          st.wins = (st.wins || 0) + 1;
          const gain = match.bet || 100;
          setCoins(coins() + gain * 2);
          setElo(elo() + (match.mode === "ai" ? 12 : 18));
          toast?.(`Thắng! +${gain * 2} coin`);
        } else {
          st.losses = (st.losses || 0) + 1;
          setElo(elo() - 10);
        }
      }
      st.breakAndRun = st.breakAndRun || 0;
      saveStats(st);
      persistReplay();
      return;
    }
    maybeAiTurn();
  }

  async function maybeAiTurn() {
    if (!match || match.mode !== "ai" || match.turn !== 1 || match.status !== "playing") return;
    if (aiBusy || match.moving) return;
    const gen = ++aiGen;
    aiBusy = true;
    notify(true);
    await new Promise((r) => setTimeout(r, aiThinkDelay(match.aiLevel)));
    if (gen !== aiGen || !match || match.turn !== 1 || match.moving) {
      aiBusy = false;
      notify(true);
      return;
    }
    if (match.ballInHand) {
      tryPlaceCue(match, TABLE_W * 0.28, TABLE_H / 2 + (Math.random() - 0.5) * 36);
      match.ballInHand = false;
    }
    const shot = pickPoolShot(match, match.aiLevel);
    aiBusy = false;
    playShot(shot.angle, shot.power, shot.spin);
    notify(true);
  }

  function canvasToTable(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * TABLE_W,
      y: ((clientY - rect.top) / rect.height) * TABLE_H,
    };
  }

  function bindCanvas(canvas) {
    if (!canvas || canvas._poolBound) return;
    canvas._poolBound = true;
    canvasEl = canvas;

    const onPointer = (e) => {
      if (!canControl()) return;
      const pt = e.touches ? e.touches[0] : e;
      const { x, y } = canvasToTable(canvas, pt.clientX, pt.clientY);
      const placing =
        match.ballInHand || (match.phase === "break" && match.kitchenOnly && !match.shotHistory.length);

      if (placing) {
        tryPlaceCue(match, x, y);
        if (e.type === "pointerup" || e.type === "touchend") {
          if (match.ballInHand) match.ballInHand = false;
          toast?.("Đã đặt bi cái — kéo ngược hướng bi để lấy lực, thả để đánh.");
        }
        paintCanvas(canvas);
        return;
      }

      const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
      if (!cue) return;

      if (e.type === "pointerdown" || e.type === "touchstart") {
        pulling = true;
        pullStart = { x, y, cueX: cue.x, cueY: cue.y };
        aimAngle = Math.atan2(y - cue.y, x - cue.x);
        try {
          canvas.setPointerCapture?.(e.pointerId);
        } catch (_) {}
      } else if ((e.type === "pointermove" || e.type === "touchmove") && pulling && pullStart) {
        // Aim toward opposite of pull (pull back = power)
        const dx = x - cue.x;
        const dy = y - cue.y;
        const dist = Math.hypot(dx, dy);
        aimAngle = Math.atan2(dy, dx);
        // Power from how far behind the aim direction we pulled relative to cue→target
        // User points at target; dragging away from target increases power
        const toTarget = aimAngle;
        const fromCue = Math.atan2(y - cue.y, x - cue.x);
        // Simpler: distance from cue sets power, angle from cue to pointer is aim
        aimAngle = fromCue;
        power = Math.max(0.08, Math.min(1, dist / 180));
        paintCanvas(canvas);
        patchHud(false);
      } else if (e.type === "pointerup" || e.type === "touchend" || e.type === "pointercancel") {
        if (pulling && power >= 0.12) {
          const shootAng = aimAngle;
          pulling = false;
          pullStart = null;
          playShot(shootAng, power, { x: spinX, y: 0 });
          return;
        }
        pulling = false;
        pullStart = null;
      }
    };

    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerup", onPointer);
    canvas.addEventListener("pointercancel", onPointer);
  }

  function groupLabel(side) {
    if (!match) return "—";
    const g = match.groups[side];
    if (!g) return "Chưa chọn";
    return g === "solid" ? "Solid 1–7" : "Stripe 9–15";
  }

  function renderHome() {
    const st = loadStats();
    const winRate = st.games ? Math.round(((st.wins || 0) / st.games) * 100) : 0;
    const e = elo();
    return `
      <div class="pool-shell">
        <header class="pool-top">
          <div class="pool-brand">🎱 8 BALL POOL</div>
          <div class="pool-top-meta">
            <span>🪙 ${coins()}</span>
            <span>◆ ${e} · ${rankFromElo(e)}</span>
            <span>${escapeHtml(playerName() || "Khách")}</span>
          </div>
        </header>
        <div class="pool-hero">
          <div class="pool-hero-copy">
            <h1>Thử thách kỹ năng · Khẳng định đẳng cấp</h1>
            <p>Kéo trên bàn để căn góc & lực — bi chạy mượt từng frame. AI · Local · Online.</p>
            <div class="pool-hero-actions">
              <button type="button" class="pool-btn gold" data-act="pool-quick">Quick Match</button>
              <button type="button" class="pool-btn cyan" data-act="pool-ai-menu">Chơi với AI</button>
            </div>
          </div>
          <div class="pool-hero-art" aria-hidden="true">🎱</div>
        </div>
        <section class="pool-modes">
          <h2>Chế độ chơi</h2>
          <div class="pool-mode-grid">
            <button type="button" class="pool-mode-card is-blue" data-act="pool-quick">
              <strong>Quick Match</strong><span>Best of 1 · 30s · có cược</span><em>Chơi ngay</em>
            </button>
            <button type="button" class="pool-mode-card is-green" data-act="pool-ai-menu">
              <strong>Chơi với AI</strong><span>Easy → Master</span><em>Chọn cấp</em>
            </button>
            <button type="button" class="pool-mode-card is-purple" data-act="pool-local">
              <strong>Local</strong><span>2 người / 1 máy</span><em>Hotseat</em>
            </button>
            <button type="button" class="pool-mode-card is-pink" data-act="pool-online">
              <strong>Online</strong><span>Tạo / vào phòng</span><em>Realtime</em>
            </button>
          </div>
        </section>
        <section class="pool-ai-levels" id="pool-online-box" hidden>
          <h3>Online realtime</h3>
          <div class="pool-level-row">
            <button type="button" class="pool-btn gold" data-act="pool-quick-online">Quick Online</button>
            <button type="button" class="pool-btn cyan" data-act="pool-create">Tạo phòng</button>
            <button type="button" class="pool-btn" data-act="pool-join">Vào phòng</button>
            <button type="button" class="pool-btn" data-act="pool-start-online">Bắt đầu (chủ)</button>
          </div>
          <p class="pool-hint">Mời bạn bằng mã phòng · có chat/reaction · bi animate mượt hai phía.</p>
        </section>
        <section class="pool-ai-levels" id="pool-ai-levels" hidden>
          <h3>Cấp AI · Cược
            <select data-pool-bet class="pool-select">
              ${BETS.map((b) => `<option value="${b}" ${b === selectedBet ? "selected" : ""}>${b} coin</option>`).join("")}
            </select>
          </h3>
          <div class="pool-level-row">
            ${["easy", "medium", "hard", "master"]
              .map((lv) => `<button type="button" class="pool-btn" data-act="pool-ai" data-level="${lv}">${lv}</button>`)
              .join("")}
          </div>
        </section>
        <section class="pool-collect">
          <div>
            <h3>Gậy cơ</h3>
            <div class="pool-chip-row">
              ${CUES.map(
                (c) =>
                  `<button type="button" class="pool-chip${selectedCue === c.id ? " is-on" : ""}" data-act="pool-cue" data-id="${c.id}">${escapeHtml(c.name)}</button>`
              ).join("")}
            </div>
          </div>
          <div>
            <h3>Bàn</h3>
            <div class="pool-chip-row">
              ${TABLES.map(
                (t) =>
                  `<button type="button" class="pool-chip${selectedTable === t.id ? " is-on" : ""}" data-act="pool-table" data-id="${t.id}">${escapeHtml(t.name)}</button>`
              ).join("")}
            </div>
          </div>
        </section>
        <section class="pool-stats-bar">
          <div><b>${st.wins || 0}</b><span>Thắng</span></div>
          <div><b>${winRate}%</b><span>Win rate</span></div>
          <div><b>${rankFromElo(e)}</b><span>Rank</span></div>
          <div><b>${coins()}</b><span>Coin</span></div>
        </section>
        <p class="pool-hint">Mẹo: chạm-kéo trên bàn theo hướng muốn đánh, kéo xa hơn = lực mạnh hơn, thả tay để đánh. Bi chạy realtime.</p>
        <button type="button" class="pool-btn ghost" data-act="pool-back-hub">← Sảnh Board Game</button>
      </div>`;
  }

  function renderPlay() {
    if (!match) return renderHome();
    const a = match.turn === 0;
    const targets = legalTargets(match);
    return `
      <div class="pool-shell pool-play">
        <header class="pool-play-head">
          <button type="button" class="pool-btn ghost sm" data-act="pool-leave">← Sảnh</button>
          <div class="pool-vs">
            <div class="pool-player${match.turn === 0 ? " is-turn" : ""}">
              <strong>${escapeHtml(match.names[0])}</strong>
              <span>${groupLabel(0)}</span>
            </div>
            <div class="pool-timer">${match.bet ? `🪙${match.bet}` : "⏱ 30s"}</div>
            <div class="pool-player${match.turn === 1 ? " is-turn" : ""}">
              <strong>${escapeHtml(match.names[1])}</strong>
              <span>${groupLabel(1)}</span>
            </div>
          </div>
          <span class="pool-phase">${escapeHtml(match.phase)}</span>
        </header>
        <p class="pool-msg">${escapeHtml(match.message || "")}${match.moving ? " · bi đang chạy…" : ""}${
          aiBusy ? " · AI đang nghĩ…" : ""
        }</p>
        <div class="pool-stage">
          <canvas class="pool-canvas" width="900" height="450" data-pool-canvas></canvas>
          <div class="pool-power">
            <label>Lực</label>
            <input type="range" min="5" max="100" value="${Math.round(power * 100)}" data-pool-power />
            <label>Spin</label>
            <input type="range" min="-100" max="100" value="${Math.round(spinX * 100)}" data-pool-spin />
          </div>
        </div>
        <div class="pool-tray">
          <div class="pool-group-balls">
            <span>Mục tiêu:</span>
            ${targets.map((id) => `<i class="pool-mini" style="--c:${BALL_COLORS[id]}">${id}</i>`).join("") || "—"}
          </div>
          <div class="pool-actions">
            <button type="button" class="pool-btn gold" data-act="pool-shoot" ${
              !canControl() ? "disabled" : ""
            }>Đánh</button>
            <button type="button" class="pool-btn danger" data-act="pool-resign">Đầu hàng</button>
          </div>
        </div>
        ${
          match.status === "finished"
            ? `<div class="pool-overlay"><div class="pool-overlay-card"><h2>${escapeHtml(
                match.message
              )}</h2><button type="button" class="pool-btn gold" data-act="pool-again">Chơi lại</button><button type="button" class="pool-btn" data-act="pool-leave">Về sảnh</button></div></div>`
            : ""
        }
      </div>`;
  }

  function handleAction(act, el) {
    if (act === "pool-back-hub") {
      clearMatch();
      return "board-hub";
    }
    if (act === "pool-leave") {
      clearMatch();
      return "pool-home";
    }
    if (act === "pool-ai-menu") return "pool-toggle-ai";
    if (act === "pool-quick") {
      startQuickAi();
      return match ? "pool-play" : null;
    }
    if (act === "pool-ai") {
      const betEl = document.querySelector("[data-pool-bet]");
      if (betEl) selectedBet = Number(betEl.value) || selectedBet;
      startAi(el?.dataset?.level || "medium");
      return match ? "pool-play" : null;
    }
    if (act === "pool-local") {
      startLocal();
      return "pool-play";
    }
    if (act === "pool-online") return "pool-online-menu";
    if (act === "pool-create") return "pool-cmd:create";
    if (act === "pool-join") return "pool-cmd:join";
    if (act === "pool-quick-online") return "pool-cmd:quick";
    if (act === "pool-start-online") return "pool-cmd:start";
    if (act === "pool-cue") {
      selectedCue = el?.dataset?.id || selectedCue;
      return "pool-home";
    }
    if (act === "pool-table") {
      selectedTable = el?.dataset?.id || selectedTable;
      return "pool-home";
    }
    if (act === "pool-shoot") {
      doShoot();
      return null;
    }
    if (act === "pool-resign") {
      if (!match || match.status !== "playing" || match.moving) return null;
      match.status = "finished";
      match.winner = match.mode === "ai" ? 1 : 1 - match.turn;
      match.message = `${match.names[match.turn]} đầu hàng.`;
      afterShotSettled();
      notify(true);
      return null;
    }
    if (act === "pool-again") {
      if (match?.mode === "local") startLocal();
      else startAi(match?.aiLevel || "medium");
      return match ? "pool-play" : null;
    }
    return null;
  }

  function mountPlay(root) {
    const canvas = root.querySelector("[data-pool-canvas]");
    if (canvas) {
      canvasEl = canvas;
      canvas._poolBound = false;
      bindCanvas(canvas);
      paintCanvas(canvas);
      loopRunning = false;
      stopAnim();
      startRenderLoop();
    }
    const powerEl = root.querySelector("[data-pool-power]");
    powerEl?.addEventListener("input", () => {
      power = Number(powerEl.value) / 100;
      if (canvas) paintCanvas(canvas);
    });
    const spinEl = root.querySelector("[data-pool-spin]");
    spinEl?.addEventListener("input", () => {
      spinX = Number(spinEl.value) / 100;
    });
  }

  function patchCanvas(root) {
    const canvas = root.querySelector("[data-pool-canvas]");
    if (!canvas) return false;
    canvasEl = canvas;
    if (!canvas._poolBound) bindCanvas(canvas);
    paintCanvas(canvas);
    startRenderLoop();
    return true;
  }

  /** Apply remote shot (online). */
  function applyRemoteShot(payload) {
    if (!match || match.moving) return false;
    const cue = match.balls.find((b) => b.id === 0);
    if (cue && payload.cueX != null) {
      cue.x = payload.cueX;
      cue.y = payload.cueY;
      cue.pocketed = false;
    }
    match.ballInHand = false;
    return playShot(payload.angle, payload.power, payload.spin || { x: 0, y: 0 }, { fromOnline: true });
  }

  function applyOnlineRoom(room, meName) {
    if (!room) return null;
    stopAnim();
    match = {
      ...createMatch({
        mode: "online",
        names: [
          room.players?.find((p) => p.side === 0)?.name || "P1",
          room.players?.find((p) => p.side === 1)?.name || "P2",
        ],
        tableTheme: room.tableTheme || selectedTable,
      }),
      balls: room.balls || createMatch().balls,
      turn: room.turn ?? 0,
      phase: room.phase || "break",
      groups: room.groups || [null, null],
      status: room.status || "playing",
      winner: room.winner,
      message: room.message || "Online",
      ballInHand: room.ballInHand,
      meSide: room.players?.find((p) => p.name === meName)?.side ?? 0,
      roomCode: room.code,
      bet: room.bet || 0,
      moving: false,
      shotHistory: room.shotHistory || [],
      shotLog: [],
    };
    startRenderLoop();
    notify(true);
    return match;
  }

  return {
    renderHome,
    renderPlay,
    handleAction,
    clearMatch,
    getMatch: () => match,
    mountPlay,
    patchCanvas,
    isAiBusy: () => aiBusy,
    applyRemoteShot,
    applyOnlineRoom,
    CUES,
    TABLES,
  };
}
