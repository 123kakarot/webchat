/**
 * 8 Ball Pool UI — mockup-first layout (~90% visual structure).
 * Features wired to existing engine; polish graphics in canvas separately.
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
import { paintTable, paintBalls, warmTablePaint, paintCueAimOverlay } from "./pool-render.js";
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
  { id: "starter", name: "Starter Cue", power: 1, spin: 0.6, aim: 0.7, accuracy: 0.65, stars: 2 },
  { id: "classic", name: "Classic Cue", power: 1.05, spin: 0.75, aim: 0.8, accuracy: 0.75, stars: 3 },
  { id: "carbon", name: "Carbon Cue", power: 1.1, spin: 0.85, aim: 0.88, accuracy: 0.85, stars: 4 },
  { id: "galaxy", name: "Galaxy Cue", power: 1.15, spin: 1, aim: 0.95, accuracy: 0.92, stars: 5 },
];

const TABLES = [
  { id: "classic", name: "Classic Blue", felt: "cerulean" },
  { id: "neon", name: "Neon Blue", felt: "cerulean" },
  { id: "royal", name: "Royal", felt: "#2563b8" },
  { id: "cyber", name: "Cyber", felt: "#0e7490" },
];

const STORAGE_STATS = "pool8-stats";
const STORAGE_COIN = "pool8-coins";
const STORAGE_GEM = "pool8-gems";
const STORAGE_ELO = "pool8-elo";
const NAV = [
  { id: "home", label: "Trang chủ", act: "pool-nav-home", ico: "🏠" },
  { id: "quick", label: "Chơi nhanh", act: "pool-quick", ico: "⚡" },
  { id: "ai", label: "Chơi AI", act: "pool-ai-menu", ico: "🤖" },
  { id: "friends", label: "Phòng bạn bè", act: "pool-create", ico: "👥" },
  { id: "rank", label: "Xếp hạng", act: "pool-nav-rank", ico: "🏆" },
  { id: "collection", label: "Bộ sưu tập", act: "pool-nav-collection", ico: "🎒" },
  { id: "replay", label: "Replay", act: "pool-nav-replay", ico: "🎬" },
  { id: "mission", label: "Nhiệm vụ", act: "pool-nav-mission", ico: "🎯" },
  { id: "shop", label: "Cửa hàng", act: "pool-nav-shop", ico: "🛒" },
];

export function createPoolModule(deps = {}) {
  const {
    escapeHtml = (s) => String(s ?? ""),
    playerName = () => "Bạn",
    toast,
    beep,
    onUpdate,
    emitOnlineShot,
  } = deps;

  let match = null;
  let aimAngle = 0;
  let power = 0.55;
  let spinX = 0;
  let spinY = 0;
  let animId = 0;
  let aiBusy = false;
  let aiGen = 0;
  let selectedCue = "classic";
  let selectedTable = "classic";
  let selectedBet = 0;
  let canvasEl = null;
  let aimCanvasEl = null;
  let aimPrep = false;
  let prepPointerId = null;
  let prepIsTouch = false;
  let prepLockAim = 0;
  let prepDragX = 0;
  let prepDragY = 0;
  let loopRunning = false;
  let physAcc = 0;
  let lastFrame = 0;
  let uiTab = "home";
  let showAiLevels = false;
  let paintRaf = 0;
  let tablePaintOpt = null;
  let staticFrame = null;
  let staticFrameKey = "";

  function invalidateStaticFrame() {
    staticFrameKey = "";
  }

  function markStaticFrameDirty() {
    invalidateStaticFrame();
  }

  function notify(full = true) {
    if (!full) {
      requestPaint();
      return;
    }
    onUpdate?.();
  }

  function getCanvasCtx(canvas) {
    if (!canvas) return null;
    if (canvas._poolCtx) return canvas._poolCtx;
    canvas._poolCtx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    return canvas._poolCtx;
  }

  function fitCanvasResolution(canvas, aimCanvas) {
    const frame = canvas.closest(".pool-hero-table") || canvas.closest(".pool-canvas-stack");
    if (!frame) return;
    const cssW = frame.clientWidth - 8;
    if (cssW < 80) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.15 : 1.5);
    const w = Math.round(Math.min(960, cssW * dpr));
    const h = Math.round(w / 2);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas._poolCtx = null;
      tablePaintOpt = null;
      invalidateStaticFrame();
    }
    if (aimCanvas && (aimCanvas.width !== w || aimCanvas.height !== h)) {
      aimCanvas.width = w;
      aimCanvas.height = h;
    }
  }

  function ballsFrameKey() {
    if (!match?.balls) return "";
    return match.balls
      .filter((b) => !b.pocketed)
      .map((b) => `${b.id}:${b.x.toFixed(1)},${b.y.toFixed(1)}`)
      .join("|");
  }

  function ensureStaticFrame(w, h) {
    const key = `${w}x${h}:${tableTheme().felt}:${ballsFrameKey()}`;
    if (staticFrame && staticFrameKey === key) return staticFrame;
    if (!staticFrame) staticFrame = document.createElement("canvas");
    if (staticFrame.width !== w || staticFrame.height !== h) {
      staticFrame.width = w;
      staticFrame.height = h;
    }
    const sctx = staticFrame.getContext("2d");
    drawTable(sctx, w, h);
    drawBalls(sctx, w, h);
    staticFrameKey = key;
    return staticFrame;
  }

  function tablePaintOptions(w, h) {
    const felt = tableTheme().felt;
    if (tablePaintOpt && tablePaintOpt.w === w && tablePaintOpt.h === h && tablePaintOpt.felt === felt) {
      return tablePaintOpt;
    }
    tablePaintOpt = { w, h, TABLE_W, TABLE_H, CUSHION, POCKET_R, felt, pockets };
    return tablePaintOpt;
  }

  function requestPaint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => {
      paintRaf = 0;
      if (!match) return;
      if (match.moving) {
        if (canvasEl) paintCanvas(canvasEl);
        if (aimCanvasEl) {
          const ac = aimCanvasEl.getContext("2d");
          ac?.clearRect(0, 0, aimCanvasEl.width, aimCanvasEl.height);
        }
        return;
      }
      if (aimCanvasEl) paintAimOverlay();
      else if (canvasEl) paintCanvas(canvasEl);
    });
  }

  function cancelPaintRaf() {
    if (paintRaf) cancelAnimationFrame(paintRaf);
    paintRaf = 0;
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
    const v = localStorage.getItem(STORAGE_COIN);
    if (v == null) {
      localStorage.setItem(STORAGE_COIN, "5000");
      return 5000;
    }
    return Number(v) || 0;
  }
  function setCoins(n) {
    localStorage.setItem(STORAGE_COIN, String(Math.max(0, Math.floor(n))));
  }
  function gems() {
    const v = localStorage.getItem(STORAGE_GEM);
    if (v == null) {
      localStorage.setItem(STORAGE_GEM, "120");
      return 120;
    }
    return Number(v) || 0;
  }
  function elo() {
    return Number(localStorage.getItem(STORAGE_ELO) || "1432") || 1432;
  }
  function setElo(n) {
    localStorage.setItem(STORAGE_ELO, String(Math.max(400, Math.floor(n))));
  }
  function rankFromElo(e) {
    if (e >= 2200) return "Grand Master";
    if (e >= 1900) return "Master";
    if (e >= 1600) return "Diamond";
    if (e >= 1400) return "Gold II";
    if (e >= 1200) return "Silver";
    return "Bronze";
  }
  function cueStats() {
    return CUES.find((c) => c.id === selectedCue) || CUES[1];
  }
  function tableTheme() {
    return TABLES.find((t) => t.id === (match?.tableTheme || selectedTable)) || TABLES[1];
  }

  function warmPlayCanvas() {
    const felt = tableTheme().felt;
    warmTablePaint({
      w: 1200,
      h: 600,
      TABLE_W,
      TABLE_H,
      CUSHION,
      POCKET_R,
      felt,
      pockets,
    });
  }

  function resetBreakAim() {
    if (!match?.balls?.length) return;
    const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
    const apex = match.balls.find((b) => b.id === 8 && !b.pocketed);
    const target = apex || match.balls.find((b) => !b.pocketed && b.id !== 0);
    if (cue && target) aimAngle = Math.atan2(target.y - cue.y, target.x - cue.x);
    power = 0.55;
  }

  function startMatch(opts) {
    stopAnim();
    match = createMatch({
      mode: opts.mode || "ai",
      aiLevel: opts.aiLevel || "medium",
      names: opts.names || [playerName() || "Bạn", "Đối thủ"],
      tableTheme: selectedTable,
      cueId: selectedCue,
      turnMs: 30000,
    });
    match.bet = opts.bet || 0;
    match.kitchenOnly = true;
    match.shotLog = [];
    resetBreakAim();
    uiTab = "play";
    warmPlayCanvas();
    toast?.(opts.toast || "Giữ chuột / kéo cơ trên bàn — thả để bắn.");
    return match;
  }

  function startAi(level) {
    const bet = selectedBet;
    if (bet > 0 && coins() < bet) {
      toast?.("Không đủ coin — đang chơi free.");
      selectedBet = 0;
    } else if (bet > 0) setCoins(coins() - bet);
    return startMatch({
      mode: "ai",
      aiLevel: level || "medium",
      names: [playerName() || "Bạn", `AI · ${(level || "medium").toUpperCase()}`],
      bet: selectedBet,
      toast: `AI ${(level || "medium").toUpperCase()}`,
    });
  }
  function startLocal() {
    return startMatch({
      mode: "local",
      names: [playerName() || "P1", "Người 2"],
      bet: 0,
      toast: "Local 2 người",
    });
  }
  function startQuickAi() {
    selectedBet = 0;
    return startAi("medium");
  }

  function clearMatch() {
    stopAnim();
    cancelPaintRaf();
    loopRunning = false;
    aiGen++;
    aiBusy = false;
    aimPrep = false;
    prepPointerId = null;
    prepLockAim = 0;
    invalidateStaticFrame();
    aimCanvasEl = null;
    match = null;
    canvasEl = null;
    uiTab = "home";
  }
  function stopAnim() {
    cancelAnimationFrame(animId);
    animId = 0;
    physAcc = 0;
  }

  function drawTable(ctx, w, h) {
    paintTable(ctx, tablePaintOptions(w, h));
  }
  function drawBalls(ctx, w, h) {
    if (!match) return;
    paintBalls(ctx, {
      w,
      h,
      TABLE_W,
      TABLE_H,
      BALL_R,
      balls: match.balls,
      colors: BALL_COLORS,
    });
  }
  function paintAimOverlay() {
    if (!aimCanvasEl || !match) return;
    const w = aimCanvasEl.width;
    const h = aimCanvasEl.height;
    const ctx = aimCanvasEl.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (match.moving || match.status !== "playing") return;
    if (match.mode === "ai" && match.turn === 1) return;
    if (match.mode === "online" && match.turn !== match.meSide) return;
    const guide = aimGuide(match.balls, aimAngle);
    const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
    if (!guide || !cue) return;
    paintCueAimOverlay(ctx, {
      w,
      h,
      TABLE_W,
      TABLE_H,
      BALL_R,
      guide,
      aimAngle,
      power,
      cueX: cue.x,
      cueY: cue.y,
      showGhost: aimPrep || power > 0.2,
    });
  }

  function paintCanvas(canvas) {
    if (!canvas || !match) return;
    const ctx = getCanvasCtx(canvas);
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    if (match.moving) {
      invalidateStaticFrame();
      drawTable(ctx, w, h);
      drawBalls(ctx, w, h);
    } else {
      ctx.drawImage(ensureStaticFrame(w, h), 0, 0);
    }
    canvas.classList.remove("is-loading");
    canvas.classList.add("is-ready");
    if (aimCanvasEl) paintAimOverlay();
  }

  function startRenderLoop() {
    if (loopRunning) return;
    if (!match?.moving) return;
    loopRunning = true;
    lastFrame = performance.now();
    const frame = (now) => {
      if (!loopRunning || !match) {
        loopRunning = false;
        animId = 0;
        return;
      }
      if (!match.moving) {
        loopRunning = false;
        animId = 0;
        requestPaint();
        return;
      }
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      physAcc += dt * PHYS_HZ;
      let guard = 0;
        while (physAcc >= 1 && guard++ < 4) {
        const ev = stepPhysics(match.balls, 1);
        accumulateShotEvent(match, ev);
        if (ev.maxCollision > 2.8) beep?.(200 + Math.min(350, ev.maxCollision * 35), 18, "triangle", 0.012);
        if (ev.pocketed?.length) beep?.(680, 35, "sine", 0.022);
        physAcc -= 1;
      }
      if (physAcc > 2) physAcc = 0;
      if (!anyMoving(match.balls)) {
        finishShot(match);
        physAcc = 0;
        invalidateStaticFrame();
        afterShotSettled();
        notify(true);
      } else if (canvasEl) {
        paintCanvas(canvasEl, { fast: true });
      }
      animId = requestAnimationFrame(frame);
    };
    animId = requestAnimationFrame(frame);
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
    const ang = angle + (fromOnline ? 0 : (Math.random() - 0.5) * 0.015 * (1 - cue.accuracy));
    const sp = { x: (spin?.x || 0) * (fromOnline ? 1 : cue.spin), y: spin?.y || 0 };
    const res = beginShot(match, ang, powerUse, sp);
    if (!res.ok) {
      toast?.(res.reason);
      return false;
    }
    invalidateStaticFrame();
    beep?.(430, 32, "sine", 0.03);
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
    if (match.ballInHand) {
      toast?.("Chạm bàn để đặt bi cái (sau khi bi trắng vào lỗ).");
      return false;
    }
    return playShot(aimAngle, power, { x: spinX, y: spinY });
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
      if (match.mode === "ai") {
        if (match.winner === 0) {
          st.wins = (st.wins || 0) + 1;
          setCoins(coins() + Math.max(100, (match.bet || 0) * 2));
          setElo(elo() + 12);
          toast?.("Thắng!");
        } else {
          st.losses = (st.losses || 0) + 1;
          setElo(elo() - 8);
        }
      }
      saveStats(st);
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
      tryPlaceCue(match, TABLE_W * 0.28, TABLE_H / 2);
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

  function syncPowerHud(root) {
    if (!root) return;
    const heat = root.querySelector(".pool-power-heat");
    const pwr = root.querySelector("[data-pool-power]");
    const val = root.querySelector(".pool-power-val");
    const pct = Math.round(power * 100);
    if (heat) heat.style.setProperty("--p", `${pct}%`);
    if (pwr && pwr.value !== String(pct)) pwr.value = String(pct);
    if (val) val.textContent = String(pct);
  }

  function bindCanvas(canvas) {
    if (!canvas || canvas._poolBound) return;
    canvas._poolBound = true;
    canvasEl = canvas;
    const hudRoot = canvas.closest(".pool-arena") || canvas.parentElement;
    canvas._poolHudRoot = hudRoot;
    const onPointer = (e) => {
      if (e.pointerType === "mouse" && e.type === "pointerdown" && e.button !== 0) return;
      if (!canControl()) return;
      const { x, y } = canvasToTable(canvas, e.clientX, e.clientY);
      if (match.ballInHand) {
        if (e.type === "pointerdown") {
          if (tryPlaceCue(match, x, y)) {
            match.ballInHand = false;
            invalidateStaticFrame();
            toast?.("Đã đặt bi cái.");
          } else {
            toast?.("Chọn chỗ trống trên bàn.");
          }
        }
        requestPaint();
        return;
      }
      const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
      if (!cue) return;

      if (e.type === "pointermove" && !aimPrep && e.pointerType === "mouse") {
        aimAngle = Math.atan2(y - cue.y, x - cue.x);
        if (power < 0.32) power = 0.38;
        requestPaint();
        return;
      }

      if (e.type === "pointerdown") {
        e.preventDefault();
        aimPrep = true;
        prepPointerId = e.pointerId;
        prepIsTouch = e.pointerType === "touch";
        prepDragX = x;
        prepDragY = y;
        if (prepIsTouch) {
          aimAngle = Math.atan2(y - cue.y, x - cue.x);
          power = 0.12;
        } else {
          prepLockAim = aimAngle;
          power = 0.2;
        }
        canvas.classList.add("is-preparing");
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_) {}
        requestPaint();
        syncPowerHud(canvas._poolHudRoot);
        return;
      }

      if (e.pointerId !== prepPointerId) return;

      if (e.type === "pointermove" && aimPrep) {
        e.preventDefault();
        if (prepIsTouch) {
          aimAngle = Math.atan2(y - cue.y, x - cue.x);
          const dist = Math.hypot(x - cue.x, y - cue.y);
          power = Math.max(0.12, Math.min(1, dist / 165));
        } else {
          aimAngle = prepLockAim;
          const bx = -Math.cos(prepLockAim);
          const by = -Math.sin(prepLockAim);
          const pull = (x - prepDragX) * bx + (y - prepDragY) * by;
          power = Math.max(0.15, Math.min(1, 0.2 + pull / 145));
        }
        requestPaint();
        syncPowerHud(canvas._poolHudRoot);
        return;
      }

      if ((e.type === "pointerup" || e.type === "pointercancel") && aimPrep) {
        e.preventDefault();
        aimPrep = false;
        canvas.classList.remove("is-preparing");
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
        const shotPower = prepIsTouch ? Math.max(0.12, power) : Math.max(0.18, power);
        const a = prepIsTouch ? aimAngle : prepLockAim;
        prepPointerId = null;
        playShot(a, shotPower, { x: spinX, y: spinY });
      }
    };
    const opts = { passive: false };
    canvas.addEventListener("pointerdown", onPointer, opts);
    canvas.addEventListener("pointermove", onPointer, opts);
    canvas.addEventListener("pointerup", onPointer, opts);
    canvas.addEventListener("pointercancel", onPointer, opts);
  }

  function groupLabel(side) {
    const g = match?.groups?.[side];
    if (!g) return "Chưa chọn";
    return g === "solid" ? "Trơn" : g === "stripe" ? "Sọc" : "—";
  }

  function ballIconsFor(side) {
    if (!match) return "";
    const g = match.groups[side];
    const ids = g === "solid" ? [1, 2, 3, 4, 5, 6, 7] : g === "stripe" ? [9, 10, 11, 12, 13, 14, 15] : [];
    if (!ids.length) return `<span class="pool-chip-muted">Open</span>`;
    return ids
      .map((id) => {
        const gone = match.balls.find((b) => b.id === id)?.pocketed;
        return `<i class="pool-ball-ico${gone ? " is-out" : ""}${id >= 9 ? " is-stripe" : ""}" style="--c:${BALL_COLORS[id]}">${id}</i>`;
      })
      .join("");
  }

  function ballIconHtml(id, role = "") {
    const gone = match.balls.find((b) => b.id === id)?.pocketed;
    let hi = "";
    if (role === "mine") hi = " is-mine";
    if (role === "opp") hi = " is-opp";
    const stripe = id >= 9 && id <= 15 ? " is-stripe" : "";
    const eight = id === 8 ? " is-eight" : "";
    return `<i class="pool-ball-ico pool-ball-lg${gone ? " is-out" : ""}${stripe}${hi}${eight}" style="--c:${BALL_COLORS[id]}">${id}</i>`;
  }

  /** Mockup §7 — nhóm Trơn/Sọc của bạn vs đối thủ */
  function groupBoardHtml() {
    if (!match) return "";
    const solidIds = [1, 2, 3, 4, 5, 6, 7];
    const stripeIds = [9, 10, 11, 12, 13, 14, 15];
    const g0 = match.groups[0];
    const g1 = match.groups[1];
    const open = !g0 && !g1;

    function row(title, type, highlight) {
      const typeLabel =
        type === "solid" ? "Trơn · Solid" : type === "stripe" ? "Sọc · Stripe" : "Open table";
      const ids = type === "solid" ? solidIds : type === "stripe" ? stripeIds : [];
      const ballsInner = open
        ? `<span class="pool-group-open">Bi đầu tiên vào lỗ chọn phe (1–7 hoặc 9–15)</span>`
        : ids.map((id) => ballIconHtml(id, highlight)).join("");
      return `
        <div class="pool-group-row${highlight === "mine" ? " is-mine-row" : highlight === "opp" ? " is-opp-row" : ""}">
          <div class="pool-group-row-head">
            <strong>${title}</strong>
            <span class="pool-group-type">${typeLabel}</span>
          </div>
          <div class="pool-group-balls">${ballsInner}</div>
        </div>`;
    }

    if (open) {
      return `
        <div class="pool-group-board is-open">
          ${row("Nhóm của bạn", "open", "mine")}
          <div class="pool-group-eight-row"><span>Bi 8</span>${ballIconHtml(8, "")}</div>
          ${row("Nhóm đối thủ", "open", "opp")}
        </div>`;
    }

    const myType = g0;
    const oppType = g1;
    return `
      <div class="pool-group-board">
        ${row("Nhóm của bạn", myType, "mine")}
        <div class="pool-group-eight-row"><span>Bi 8</span>${ballIconHtml(8, "")}</div>
        ${row("Nhóm đối thủ", oppType, "opp")}
      </div>`;
  }

  /** Full rack track: 1–7 · 8 · 9–15 */
  function rackTrackHtml() {
    if (!match) return "";
    const g0 = match.groups[0];
    const mk = (id) => {
      const gone = match.balls.find((b) => b.id === id)?.pocketed;
      let own = "";
      if (g0 === "solid" && id >= 1 && id <= 7) own = " is-mine";
      if (g0 === "stripe" && id >= 9) own = " is-mine";
      if (g0 === "solid" && id >= 9) own = " is-opp";
      if (g0 === "stripe" && id >= 1 && id <= 7) own = " is-opp";
      if (id === 8) own = " is-eight";
      return `<i class="pool-ball-ico${gone ? " is-out" : ""}${own}${id >= 9 ? " is-stripe" : ""}" style="--c:${BALL_COLORS[id]}">${id}</i>`;
    };
    return `${[1, 2, 3, 4, 5, 6, 7].map(mk).join("")}<span class="pool-rack-gap"></span>${mk(8)}<span class="pool-rack-gap"></span>${[9, 10, 11, 12, 13, 14, 15].map(mk).join("")}`;
  }

  function renderPlay() {
    if (!match) return renderHome();
    const cue = cueStats();
    const left = Math.max(0, Math.ceil(((match.turnDeadline || Date.now() + 30000) - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    const e = elo();
    const n0 = match.names[0] || "P1";
    const n1 = match.names[1] || "P2";

    return `
    <div class="pool-arena">
      <div class="pool-rotate-gate" aria-live="polite">
        <div class="pool-rotate-card">
          <span class="pool-rotate-ico" aria-hidden="true">📱</span>
          <p>Xoay ngang điện thoại</p>
          <small>Bida chơi tốt nhất ở chế độ ngang</small>
        </div>
      </div>
      <div class="pool-arena-bg" aria-hidden="true"></div>

      <header class="pool-arena-top">
        <button type="button" class="pool-arena-exit" data-act="pool-leave" title="Sảnh">⌂</button>

        <article class="pool-fighter${match.turn === 0 ? " is-turn" : ""}">
          <span class="pool-fighter-av">${escapeHtml((n0[0] || "A").toUpperCase())}</span>
          <div class="pool-fighter-meta">
            <b>${escapeHtml(n0)}</b>
            <em><span class="pool-rank-badge">${rankFromElo(e)}</span> · ${e} ELO</em>
            <small class="pool-group-tag">${groupLabel(0)}</small>
            <div class="pool-fighter-balls">${ballIconsFor(0)}</div>
          </div>
        </article>

        <div class="pool-vs-block">
          <span class="pool-vs-label">VS</span>
          <span class="pool-vs-clock">${mm}:${ss}</span>
          <small>${escapeHtml(match.phase || "")}</small>
        </div>

        <article class="pool-fighter is-right${match.turn === 1 ? " is-turn" : ""}">
          <div class="pool-fighter-meta">
            <b>${escapeHtml(n1)}</b>
            <em>${
              match.mode === "ai"
                ? `<span class="pool-rank-badge">AI</span> · ${escapeHtml(String(match.aiLevel || "HARD").toUpperCase())}`
                : `<span class="pool-rank-badge">Rival</span>`
            }</em>
            <small class="pool-group-tag">${groupLabel(1)}</small>
            <div class="pool-fighter-balls">${ballIconsFor(1)}</div>
          </div>
          <span class="pool-fighter-av is-dark">${escapeHtml((n1[0] || "B").toUpperCase())}</span>
        </article>
      </header>

      <p class="pool-arena-status">${escapeHtml(match.message || "")}${match.moving ? " · bi đang chạy…" : ""}${
        aiBusy ? " · AI đang nghĩ…" : ""
      }</p>

      <div class="pool-arena-stage">
        <div class="pool-hero-table">
          <div class="pool-canvas-stack">
          <canvas class="pool-canvas is-loading" width="1200" height="600" data-pool-canvas aria-label="Bàn bida"></canvas>
          <canvas class="pool-aim-layer" width="1200" height="600" data-pool-aim-canvas aria-hidden="true"></canvas>
          </div>
        </div>
        <aside class="pool-power-hero" aria-label="Lực">
          <div class="pool-power-track">
            <div class="pool-power-heat" style="--p:${Math.round(power * 100)}%"></div>
            <input type="range" min="5" max="100" value="${Math.round(power * 100)}" data-pool-power class="pool-power-input" />
          </div>
          <span class="pool-power-label">POWER</span>
          <strong class="pool-power-val">${Math.round(power * 100)}</strong>
        </aside>
      </div>

      <footer class="pool-arena-hud">
        <section class="pool-hud-card pool-hud-groups">
          <h4>Bộ bóng</h4>
          ${groupBoardHtml()}
        </section>

        <section class="pool-hud-card">
          <h4>Gậy · ${escapeHtml(cue.name)}</h4>
          <div class="pool-stat"><span>Power</span><i style="--w:${Math.min(100, cue.power * 82)}%"></i></div>
          <div class="pool-stat"><span>Spin</span><i style="--w:${Math.min(100, cue.spin * 90)}%"></i></div>
          <div class="pool-stat"><span>Aim</span><i style="--w:${Math.min(100, cue.aim * 90)}%"></i></div>
          <div class="pool-stat"><span>Accuracy</span><i style="--w:${Math.min(100, cue.accuracy * 90)}%"></i></div>
        </section>

        <section class="pool-hud-card pool-hud-spin">
          <h4>Spin</h4>
          <div class="pool-spin-disc" data-pool-spin-disc title="Chạm để chọn điểm đánh">
            <span class="pool-spin-dot" style="left:${50 + spinX * 38}%;top:${50 + spinY * 38}%"></span>
          </div>
        </section>

        <section class="pool-hud-actions">
          <p class="pool-pull-hint">
            <span class="pool-hint-desktop">Chuột: <strong>Rê</strong> để ngắm · <strong>Giữ + kéo lùi</strong> chỉnh lực · <strong>Thả</strong> bắn</span>
            <span class="pool-hint-mobile">Mobile: <strong>Kéo cơ</strong> từ bi cái · <strong>Thả tay</strong> để bắn</span>
          </p>
          <div class="pool-btn-row">
            <button type="button" class="pool-btn-secondary" data-act="pool-resign">Đầu hàng</button>
            <button type="button" class="pool-btn-secondary" data-act="pool-leave">Menu</button>
          </div>
        </section>
      </footer>

      ${
        match.status === "finished"
          ? `<div class="pool-overlay"><div class="pool-overlay-card"><h2>${escapeHtml(
              match.message
            )}</h2><button type="button" class="pool-btn-strike" data-act="pool-again">Chơi lại</button><button type="button" class="pool-btn-secondary" data-act="pool-leave">Về sảnh</button></div></div>`
          : ""
      }
    </div>`;
  }

  function shellChrome(activeNav, mainHtml) {
    const name = playerName() || "Bạn";
    const e = elo();
    const st = loadStats();
    return `
    <div class="pool-app">
      <header class="pool-topbar">
        <div class="pool-logo"><span class="pool-logo-orb">8</span><strong>8 BALL POOL</strong></div>
        <div class="pool-profile-chip">
          <span class="pool-avatar">${escapeHtml((name[0] || "P").toUpperCase())}</span>
          <div>
            <b>${escapeHtml(name)}</b>
            <small>${rankFromElo(e)} · ${e} ELO</small>
          </div>
        </div>
        <div class="pool-currency">
          <span class="pool-coin">🪙 ${coins()} <button type="button" class="pool-plus" data-act="pool-nav-shop">+</button></span>
          <span class="pool-gem">💎 ${gems()} <button type="button" class="pool-plus" data-act="pool-nav-shop">+</button></span>
        </div>
        <div class="pool-top-actions">
          <button type="button" class="pool-ico-btn" data-act="pool-nav-mission" title="Thông báo">🔔</button>
          <button type="button" class="pool-ico-btn" data-act="pool-nav-shop" title="Cài đặt">⚙</button>
          <button type="button" class="pool-ico-btn" data-act="pool-back-hub" title="Thoát">✕</button>
        </div>
      </header>
      <div class="pool-body">
        <aside class="pool-sidebar">
          <nav class="pool-side-nav">
            ${NAV.map(
              (n) =>
                `<button type="button" class="pool-nav-item${activeNav === n.id ? " is-active" : ""}" data-act="${n.act}">
                  <span>${n.ico}</span><em>${n.label}</em>
                </button>`
            ).join("")}
          </nav>
          <div class="pool-promo">
            <strong>Gậy cơ huyền thoại</strong>
            <p>Galaxy Cue — tăng Aim & Spin</p>
            <button type="button" class="pool-btn-sm" data-act="pool-cue" data-id="galaxy">Trang bị</button>
          </div>
        </aside>
        <main class="pool-main">${mainHtml}</main>
        <aside class="pool-rail">
          <section class="pool-panel">
            <h3>Bạn bè</h3>
            <ul class="pool-list">
              <li><span class="dot on"></span> Anna <small>Online</small> <button type="button" data-act="pool-create">Mời</button></li>
              <li><span class="dot play"></span> Tom <small>Đang chơi</small> <button type="button" data-act="pool-create">Mời</button></li>
              <li><span class="dot on"></span> Kate <small>Online</small> <button type="button" data-act="pool-create">Mời</button></li>
            </ul>
          </section>
          <section class="pool-panel">
            <h3>Phòng công khai</h3>
            <ul class="pool-list">
              <li>Pool Masters <small>2/2</small></li>
              <li>Newbie Zone <small>1/2</small></li>
              <li>Fun Pool <small>0/2</small></li>
            </ul>
            <button type="button" class="pool-btn-sm wide" data-act="pool-create">Tạo phòng</button>
          </section>
          <section class="pool-panel pool-chat-panel">
            <h3>Chat</h3>
            <div class="pool-chat-log">
              <p><b>Anna</b> gl hf 🔥</p>
              <p><b>Tom</b> ai hard khó quá</p>
              <p><b>System</b> Win ${st.wins || 0} · WR ${st.games ? Math.round(((st.wins || 0) / st.games) * 100) : 0}%</p>
            </div>
            <div class="pool-chat-input">
              <input type="text" placeholder="Nhập tin nhắn..." disabled />
              <button type="button" disabled>➤</button>
            </div>
          </section>
        </aside>
      </div>
    </div>`;
  }

  function renderHome() {
    warmPlayCanvas();
    const cue = cueStats();
    return shellChrome(
      uiTab === "home" ? "home" : uiTab,
      `
      <div class="pool-mode-row">
        <button type="button" class="pool-mode is-quick" data-act="pool-quick"><span>⚡</span><b>Quick Match</b><small>Ghép nhanh</small></button>
        <button type="button" class="pool-mode is-ai" data-act="pool-ai-menu"><span>🤖</span><b>Chơi AI</b><small>4 cấp độ</small></button>
        <button type="button" class="pool-mode is-create" data-act="pool-create"><span>➕</span><b>Tạo phòng</b><small>Mời bạn</small></button>
        <button type="button" class="pool-mode is-join" data-act="pool-join"><span>🚪</span><b>Tham gia</b><small>Nhập mã</small></button>
      </div>
      <section class="pool-ai-panel${showAiLevels ? "" : " is-hidden"}" id="pool-ai-levels">
        <h3>Chọn cấp AI</h3>
        <div class="pool-level-row">
          ${["easy", "medium", "hard", "master"]
            .map((lv) => `<button type="button" class="pool-btn" data-act="pool-ai" data-level="${lv}">${lv}</button>`)
            .join("")}
          <button type="button" class="pool-btn ghost" data-act="pool-local">Local 2 người</button>
        </div>
      </section>
      <section class="pool-hero-card">
        <div class="pool-hero-copy">
          <h1>Thử thách kỹ năng · Khẳng định đẳng cấp</h1>
          <p>Layout chuẩn mockup · kéo bàn để nhắm · bi chạy mượt. Online / AI / Local.</p>
          <div class="pool-hero-actions">
            <button type="button" class="pool-btn primary" data-act="pool-quick">Chơi ngay</button>
            <button type="button" class="pool-btn ghost" data-act="pool-ai" data-level="medium">Practice AI</button>
          </div>
        </div>
        <div class="pool-hero-visual" aria-hidden="true">
          <div class="pool-mini-table"></div>
        </div>
      </section>
      <section class="pool-home-grid">
        <div class="pool-panel">
          <h3>Gậy đang dùng</h3>
          <div class="pool-cue-card">
            <strong>${escapeHtml(cue.name)}</strong>
            <div class="pool-stat"><span>Power</span><i style="--w:${cue.power * 80}%"></i></div>
            <div class="pool-stat"><span>Spin</span><i style="--w:${cue.spin * 80}%"></i></div>
            <div class="pool-stat"><span>Aim</span><i style="--w:${cue.aim * 80}%"></i></div>
            <div class="pool-stat"><span>Accuracy</span><i style="--w:${cue.accuracy * 80}%"></i></div>
          </div>
          <div class="pool-chip-row">
            ${CUES.map(
              (c) =>
                `<button type="button" class="pool-chip${selectedCue === c.id ? " is-on" : ""}" data-act="pool-cue" data-id="${c.id}">${escapeHtml(c.name)}</button>`
            ).join("")}
          </div>
        </div>
        <div class="pool-panel">
          <h3>Bàn đấu</h3>
          <div class="pool-chip-row">
            ${TABLES.map(
              (t) =>
                `<button type="button" class="pool-chip${selectedTable === t.id ? " is-on" : ""}" data-act="pool-table" data-id="${t.id}">${escapeHtml(t.name)}</button>`
            ).join("")}
          </div>
          <p class="pool-muted">Cosmetic — không ảnh hưởng physics.</p>
        </div>
      </section>`
    );
  }

  function handleAction(act, el) {
    if (act === "pool-back-hub") {
      clearMatch();
      return "board-hub";
    }
    if (act === "pool-nav-home" || act === "pool-leave") {
      clearMatch();
      uiTab = "home";
      showAiLevels = false;
      return "pool-home";
    }
    if (act === "pool-ai-menu") {
      showAiLevels = !showAiLevels;
      uiTab = "ai";
      return "pool-home";
    }
    if (act === "pool-quick") {
      startQuickAi();
      return match ? "pool-play" : null;
    }
    if (act === "pool-ai") {
      startAi(el?.dataset?.level || "medium");
      return match ? "pool-play" : null;
    }
    if (act === "pool-local") {
      startLocal();
      return "pool-play";
    }
    if (act === "pool-create") return "pool-cmd:create";
    if (act === "pool-join") return "pool-cmd:join";
    if (act === "pool-quick-online") return "pool-cmd:quick";
    if (act === "pool-start-online") return "pool-cmd:start";
    if (act === "pool-cue") {
      selectedCue = el?.dataset?.id || selectedCue;
      toast?.(`Đã trang bị ${selectedCue}`);
      return match ? "pool-play" : "pool-home";
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
    if (act?.startsWith("pool-nav-")) {
      toast?.("Tab này đang dựng theo mockup — chơi Quick/AI trước.");
      return "pool-home";
    }
    return null;
  }

  function mountPlay(root) {
    const scope = root.querySelector?.(".pool-arena") ? root : root;
    const canvas = scope.querySelector("[data-pool-canvas]");
    const aimCanvas = scope.querySelector("[data-pool-aim-canvas]");
    if (canvas) {
      fitCanvasResolution(canvas, aimCanvas);
      aimCanvasEl = aimCanvas || null;
      const needRebind = canvasEl !== canvas;
      canvasEl = canvas;
      if (needRebind || !canvas._poolBound) {
        canvas._poolBound = false;
        bindCanvas(canvas);
      }
      paintCanvas(canvas);
      if (match?.moving) startRenderLoop();
    }
    const powerEl = scope.querySelector("[data-pool-power]");
    if (powerEl && !powerEl.dataset.poolBound) {
      powerEl.dataset.poolBound = "1";
      powerEl.addEventListener("input", () => {
        power = Number(powerEl.value) / 100;
        const heat = scope.querySelector(".pool-power-heat");
        if (heat) heat.style.setProperty("--p", `${Math.round(power * 100)}%`);
        const val = scope.querySelector(".pool-power-val");
        if (val) val.textContent = String(Math.round(power * 100));
        if (canvasEl) requestPaint();
      });
    }
    const disc = scope.querySelector("[data-pool-spin-disc]");
    if (disc && !disc.dataset.poolBound) {
      disc.dataset.poolBound = "1";
      disc.addEventListener("pointerdown", (e) => {
        const rect = disc.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        spinX = Math.max(-1, Math.min(1, nx));
        spinY = Math.max(-1, Math.min(1, ny));
        notify(false);
      });
    }
    const frame = canvas?.closest(".pool-hero-table");
    if (frame && !frame._poolRo) {
      frame._poolRo = true;
      new ResizeObserver(() => {
        if (!canvasEl) return;
        fitCanvasResolution(canvasEl, aimCanvasEl);
        invalidateStaticFrame();
        requestPaint();
      }).observe(frame);
    }
  }

  function patchCanvas(root) {
    const canvas = root.querySelector("[data-pool-canvas]");
    if (!canvas) return false;
    const aimCanvas = root.querySelector("[data-pool-aim-canvas]");
    fitCanvasResolution(canvas, aimCanvas);
    aimCanvasEl = aimCanvas || null;
    canvasEl = canvas;
    if (!canvas._poolBound) bindCanvas(canvas);
    paintCanvas(canvas);
    if (match?.moving) startRenderLoop();
    return true;
  }

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
      status: room.status === "lobby" ? "playing" : room.status || "playing",
      winner: room.winner,
      message: room.message || (room.status === "lobby" ? "Chờ bắt đầu…" : "Online"),
      ballInHand: room.ballInHand,
      meSide: room.players?.find((p) => p.name === meName)?.side ?? 0,
      roomCode: room.code,
      bet: room.bet || 0,
      moving: false,
      shotHistory: room.shotHistory || [],
      shotLog: [],
    };
    if (room.status === "lobby") match.message = `Phòng ${room.code} — chờ đối thủ / Bắt đầu`;
    resetBreakAim();
    warmPlayCanvas();
    return match;
  }

  return {
    renderHome,
    renderPlay,
    handleAction,
    clearMatch,
    getMatch: () => match,
    mountPlay,
    warmPlayCanvas,
    patchCanvas,
    isAiBusy: () => aiBusy,
    applyRemoteShot,
    applyOnlineRoom,
    CUES,
    TABLES,
  };
}
