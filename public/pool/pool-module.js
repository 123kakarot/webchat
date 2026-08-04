/**
 * 8 Ball Pool — UI module (Phase 1: AI + Local).
 */
import {
  TABLE_W,
  TABLE_H,
  BALL_R,
  POCKET_R,
  CUSHION,
  BALL_COLORS,
  pockets,
  aimGuide,
  anyMoving,
  stepPhysics,
} from "./pool-physics.js";
import { createMatch, shoot, tryPlaceCue, legalTargets } from "./pool-rules.js";
import { pickPoolShot, aiThinkDelay } from "./pool-ai.js";

const CUES = [
  { id: "starter", name: "Starter Cue", power: 1, spin: 0.6, aim: 0.7, accuracy: 0.65 },
  { id: "classic", name: "Classic Cue", power: 1.05, spin: 0.75, aim: 0.8, accuracy: 0.75 },
  { id: "carbon", name: "Carbon Cue", power: 1.1, spin: 0.85, aim: 0.88, accuracy: 0.85 },
  { id: "galaxy", name: "Galaxy Cue", power: 1.15, spin: 1, aim: 0.95, accuracy: 0.92 },
];

const TABLES = [
  { id: "classic", name: "Classic", felt: "#0b5e3b" },
  { id: "neon", name: "Neon", felt: "#12305a" },
  { id: "royal", name: "Royal", felt: "#3b1d5c" },
  { id: "cyber", name: "Cyber", felt: "#0a3d4d" },
];

const STORAGE_STATS = "pool8-stats";
const STORAGE_COIN = "pool8-coins";

export function createPoolModule(deps = {}) {
  const { escapeHtml = (s) => String(s ?? ""), playerName = () => "Bạn", toast, beep, onUpdate } = deps;

  let match = null;
  let viewHint = "home";
  let aimAngle = 0;
  let power = 0.55;
  let spinX = 0;
  let charging = false;
  let animId = 0;
  let aiBusy = false;
  let aiGen = 0;
  let selectedCue = "starter";
  let selectedTable = "classic";
  let pointerOnTable = false;

  function notify() {
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
    return Number(localStorage.getItem(STORAGE_COIN) || "500") || 500;
  }

  function setCoins(n) {
    localStorage.setItem(STORAGE_COIN, String(Math.max(0, n)));
  }

  function startAi(level) {
    const name = playerName() || "Bạn";
    match = createMatch({
      mode: "ai",
      aiLevel: level || "medium",
      names: [name, `AI · ${(level || "medium").toUpperCase()}`],
      tableTheme: selectedTable,
      cueId: selectedCue,
      turnMs: 45000,
    });
    match.ballInHand = false;
    match.kitchenOnly = true;
    aimAngle = 0;
    power = 0.55;
    viewHint = "play";
    toast?.("Bida 8 Ball — bạn phát trước (khu vực nhà).");
    notify();
    return match;
  }

  function startLocal() {
    match = createMatch({
      mode: "local",
      names: [`${playerName() || "P1"} (Đỏ)`, "Người 2 (Xanh)"],
      tableTheme: selectedTable,
      cueId: selectedCue,
      turnMs: 45000,
    });
    match.kitchenOnly = true;
    viewHint = "play";
    toast?.("Local: 2 người / 1 máy — luân phiên.");
    notify();
    return match;
  }

  function clearMatch() {
    cancelAnimationFrame(animId);
    aiGen++;
    aiBusy = false;
    match = null;
    viewHint = "home";
  }

  function cueStats() {
    return CUES.find((c) => c.id === selectedCue) || CUES[0];
  }

  function tableTheme() {
    return TABLES.find((t) => t.id === (match?.tableTheme || selectedTable)) || TABLES[0];
  }

  function drawTable(ctx, w, h) {
    const sx = w / TABLE_W;
    const sy = h / TABLE_H;
    const theme = tableTheme();
    ctx.clearRect(0, 0, w, h);
    // rail
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#3a2412");
    g.addColorStop(1, "#1a1008");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // felt
    ctx.fillStyle = theme.felt;
    const fx = CUSHION * sx;
    const fy = CUSHION * sy;
    const fw = (TABLE_W - CUSHION * 2) * sx;
    const fh = (TABLE_H - CUSHION * 2) * sy;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(fx, fy, fw, fh, 12);
    else ctx.rect(fx, fy, fw, fh);
    ctx.fill();
    // kitchen line
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo((TABLE_W / 3) * sx, CUSHION * sy);
    ctx.lineTo((TABLE_W / 3) * sx, (TABLE_H - CUSHION) * sy);
    ctx.stroke();
    ctx.setLineDash([]);
    // pockets
    for (const p of pockets()) {
      ctx.beginPath();
      ctx.fillStyle = "#050505";
      ctx.arc(p.x * sx, p.y * sy, POCKET_R * sx * 0.95, 0, Math.PI * 2);
      ctx.fill();
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
      const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grd.addColorStop(0, "#ffffffaa");
      grd.addColorStop(0.35, BALL_COLORS[b.id] || "#ccc");
      grd.addColorStop(1, "#00000088");
      ctx.beginPath();
      ctx.fillStyle = grd;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.id >= 9) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (b.id !== 0) {
        ctx.fillStyle = b.id === 8 ? "#fff" : "#111";
        ctx.font = `bold ${Math.max(9, r * 0.95)}px Be Vietnam Pro, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(b.id), x, y + 0.5);
      }
    }
  }

  function drawAim(ctx, w, h) {
    if (!match || match.moving || match.status !== "playing") return;
    if (match.mode === "ai" && match.turn === 1) return;
    const guide = aimGuide(match.balls, aimAngle);
    if (!guide) return;
    const sx = w / TABLE_W;
    const sy = h / TABLE_H;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(guide.x0 * sx, guide.y0 * sy);
    ctx.lineTo(guide.x1 * sx, guide.y1 * sy);
    ctx.stroke();
    if (guide.ghost) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(255,220,120,0.75)";
      ctx.beginPath();
      ctx.moveTo(guide.ghost.x * sx, guide.ghost.y * sy);
      ctx.lineTo(guide.ghost.tx * sx, guide.ghost.ty * sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // cue stick
    const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
    if (cue) {
      const back = 40 + power * 50;
      ctx.strokeStyle = "#d4a574";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cue.x * sx - Math.cos(aimAngle) * 16 * sx, cue.y * sy - Math.sin(aimAngle) * 16 * sy);
      ctx.lineTo(
        cue.x * sx - Math.cos(aimAngle) * back * sx,
        cue.y * sy - Math.sin(aimAngle) * back * sy
      );
      ctx.stroke();
    }
  }

  function paintCanvas(canvas) {
    if (!canvas || !match) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    drawTable(ctx, w, h);
    drawBalls(ctx, w, h);
    drawAim(ctx, w, h);
  }

  function runShotAnim(onDone) {
    cancelAnimationFrame(animId);
    match.moving = true;
    const tick = () => {
      if (!match) return;
      stepPhysics(match.balls, 1);
      stepPhysics(match.balls, 1);
      notify();
      if (anyMoving(match.balls)) {
        animId = requestAnimationFrame(tick);
      } else {
        match.moving = false;
        onDone?.();
      }
    };
    animId = requestAnimationFrame(tick);
  }

  function doShoot() {
    if (!match || match.status !== "playing" || match.moving || aiBusy) return false;
    if (match.mode === "ai" && match.turn === 1) return false;
    if (match.ballInHand && match.phase !== "break") {
      toast?.("Chạm bàn để đặt bi cái (Ball in Hand).");
      return false;
    }
    const cue = cueStats();
    const pwr = Math.min(1, power * cue.power);
    const ang = aimAngle + (Math.random() - 0.5) * 0.02 * (1 - cue.accuracy);
    const spin = { x: spinX * cue.spin, y: 0 };

    // Visual: apply live physics then resolve via rules from clone path
    // Use rules.shoot which simulates instantly — then we just refresh.
    // For nicer UX, shoot uses simulateUntilStop internally; animate by replaying is heavy.
    // Compromise: instant resolve + short flash, OR copy velocities and animate then resolve.
    const res = shoot(match, ang, pwr, spin);
    if (!res.ok) {
      toast?.(res.reason);
      return false;
    }
    beep?.(520, 40, "sine", 0.03);
    // balls already at rest after shoot(); paint + maybe AI
    afterShotSettled();
    notify();
    return true;
  }

  function afterShotSettled() {
    if (!match) return;
    if (match.status === "finished") {
      const st = loadStats();
      st.games = (st.games || 0) + 1;
      if (match.mode === "ai") {
        if (match.winner === 0) {
          st.wins = (st.wins || 0) + 1;
          setCoins(coins() + 100);
          toast?.("Thắng AI! +100 coin");
        } else {
          st.losses = (st.losses || 0) + 1;
        }
      }
      saveStats(st);
      return;
    }
    maybeAiTurn();
  }

  async function maybeAiTurn() {
    if (!match || match.mode !== "ai" || match.turn !== 1 || match.status !== "playing") return;
    if (aiBusy) return;
    const gen = ++aiGen;
    aiBusy = true;
    notify();
    await new Promise((r) => setTimeout(r, aiThinkDelay(match.aiLevel)));
    if (gen !== aiGen || !match || match.turn !== 1) {
      aiBusy = false;
      return;
    }
    if (match.ballInHand) {
      tryPlaceCue(match, TABLE_W * 0.28, TABLE_H / 2 + (Math.random() - 0.5) * 40);
      match.ballInHand = false;
    }
    const shot = pickPoolShot(match, match.aiLevel);
    shoot(match, shot.angle, shot.power, shot.spin);
    aiBusy = false;
    beep?.(480, 35, "triangle", 0.025);
    afterShotSettled();
    notify();
  }

  function canvasToTable(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * TABLE_W;
    const y = ((clientY - rect.top) / rect.height) * TABLE_H;
    return { x, y };
  }

  function bindCanvas(canvas) {
    if (!canvas || canvas._poolBound) return;
    canvas._poolBound = true;

    const onMove = (e) => {
      if (!match || match.moving || match.status !== "playing") return;
      if (match.mode === "ai" && match.turn === 1) return;
      const pt = e.touches ? e.touches[0] : e;
      const { x, y } = canvasToTable(canvas, pt.clientX, pt.clientY);
      pointerOnTable = true;
      if (match.ballInHand || (match.phase === "break" && match.kitchenOnly && !match.shotHistory.length)) {
        // dragging cue placement preview
        tryPlaceCue(match, x, y);
        notify();
        return;
      }
      const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
      if (!cue) return;
      aimAngle = Math.atan2(y - cue.y, x - cue.x);
      notify();
    };

    const onDown = (e) => {
      if (match?.ballInHand || (match?.phase === "break" && !match.shotHistory.length)) {
        const pt = e.touches ? e.touches[0] : e;
        const { x, y } = canvasToTable(canvas, pt.clientX, pt.clientY);
        if (tryPlaceCue(match, x, y)) {
          if (match.ballInHand) match.ballInHand = false;
          toast?.("Đã đặt bi cái — căn góc rồi bấm Đánh.");
          notify();
        }
      }
      onMove(e);
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
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
    return `
      <div class="pool-shell">
        <header class="pool-top">
          <div class="pool-brand">🎱 8 BALL POOL</div>
          <div class="pool-top-meta">
            <span>🪙 ${coins()}</span>
            <span>${escapeHtml(playerName() || "Khách")}</span>
          </div>
        </header>
        <div class="pool-hero">
          <div class="pool-hero-copy">
            <h1>Thử thách kỹ năng · Khẳng định đẳng cấp</h1>
            <p>Căn góc, căn lực, chiến thuật 8 Ball. AI · Local · Online (sắp).</p>
            <div class="pool-hero-actions">
              <button type="button" class="pool-btn gold" data-act="pool-ai" data-level="medium">Quick AI</button>
              <button type="button" class="pool-btn cyan" data-act="pool-local">Local 2 người</button>
            </div>
          </div>
          <div class="pool-hero-art" aria-hidden="true">🎱</div>
        </div>
        <section class="pool-modes">
          <h2>Chế độ chơi</h2>
          <div class="pool-mode-grid">
            <button type="button" class="pool-mode-card is-blue" data-act="pool-ai" data-level="medium">
              <strong>Quick Match</strong><span>Ghép nhanh · ELO (sắp)</span><em>Chơi AI tạm</em>
            </button>
            <button type="button" class="pool-mode-card is-green" data-act="pool-ai-menu">
              <strong>Chơi với AI</strong><span>Easy → Master</span><em>Chọn cấp độ</em>
            </button>
            <button type="button" class="pool-mode-card is-purple" data-act="pool-local">
              <strong>Chơi cùng bạn</strong><span>2 người / 1 máy</span><em>Local</em>
            </button>
            <button type="button" class="pool-mode-card is-pink" data-act="pool-soon-online">
              <strong>Online</strong><span>Phòng · Spectator</span><em>Phase 2</em>
            </button>
          </div>
        </section>
        <section class="pool-ai-levels" id="pool-ai-levels" hidden>
          <h3>Chọn cấp AI</h3>
          <div class="pool-level-row">
            ${["easy", "medium", "hard", "master"]
              .map(
                (lv) =>
                  `<button type="button" class="pool-btn" data-act="pool-ai" data-level="${lv}">${lv}</button>`
              )
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
          <div><b>${st.games || 0}</b><span>Trận</span></div>
          <div><b>${coins()}</b><span>Coin</span></div>
        </section>
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
            <div class="pool-player${a ? " is-turn" : ""}">
              <strong>${escapeHtml(match.names[0])}</strong>
              <span>${groupLabel(0)}</span>
            </div>
            <div class="pool-timer">⏱</div>
            <div class="pool-player${ !a ? " is-turn" : ""}">
              <strong>${escapeHtml(match.names[1])}</strong>
              <span>${groupLabel(1)}</span>
            </div>
          </div>
          <span class="pool-phase">${escapeHtml(match.phase)}</span>
        </header>
        <p class="pool-msg">${escapeHtml(match.message || "")}${aiBusy ? " · AI đang nghĩ…" : ""}</p>
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
            <button type="button" class="pool-btn" data-act="pool-aim-reset">Reset góc</button>
            <button type="button" class="pool-btn gold" data-act="pool-shoot" ${
              match.moving || aiBusy || match.status !== "playing" ? "disabled" : ""
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
      viewHint = "home";
      return "pool-home";
    }
    if (act === "pool-ai-menu") {
      return "pool-toggle-ai";
    }
    if (act === "pool-ai") {
      startAi(el?.dataset?.level || "medium");
      return "pool-play";
    }
    if (act === "pool-local") {
      startLocal();
      return "pool-play";
    }
    if (act === "pool-soon-online") {
      toast?.("Online / phòng bạn bè — Phase 2.");
      return null;
    }
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
    if (act === "pool-aim-reset") {
      aimAngle = 0;
      notify();
      return null;
    }
    if (act === "pool-resign") {
      if (!match || match.status !== "playing") return null;
      match.status = "finished";
      match.winner = match.mode === "ai" ? 1 : 1 - match.turn;
      match.message = `${match.names[match.turn]} đầu hàng.`;
      afterShotSettled();
      notify();
      return null;
    }
    if (act === "pool-again") {
      if (match?.mode === "local") startLocal();
      else startAi(match?.aiLevel || "medium");
      return "pool-play";
    }
    return null;
  }

  function mountPlay(root) {
    const canvas = root.querySelector("[data-pool-canvas]");
    if (canvas) {
      bindCanvas(canvas);
      paintCanvas(canvas);
    }
    const powerEl = root.querySelector("[data-pool-power]");
    powerEl?.addEventListener("input", () => {
      power = Number(powerEl.value) / 100;
      paintCanvas(canvas);
    });
    const spinEl = root.querySelector("[data-pool-spin]");
    spinEl?.addEventListener("input", () => {
      spinX = Number(spinEl.value) / 100;
    });
  }

  function patchCanvas(root) {
    const canvas = root.querySelector("[data-pool-canvas]");
    if (!canvas) return false;
    paintCanvas(canvas);
    return true;
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
    CUES,
    TABLES,
  };
}
