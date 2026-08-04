import {
  createGameFromLevel,
  formatTime,
  restartGame,
  starsForMoves,
  starThresholds,
  tryMove,
  undoMove,
} from "./sokoban-engine.js";
import {
  ALL_LEVELS,
  PACK_LABELS,
  PACK_ORDER,
  getDailyLevel,
  getLevel,
  getRandomLevel,
  levelsInPack,
  parseCustomMap,
  totalLevels,
} from "./sokoban-levels.js";
import { hintMove, replayMoves, solveLevel } from "./sokoban-solver.js";
import { boardCanvasHtml, renderBoardToCanvas } from "./sokoban-render.js";

const STORAGE_PROGRESS = "sokoban-progress-v1";
const STORAGE_PROFILE = "sokoban-profile-v1";
const TIME_ATTACK_MS = 3 * 60 * 1000;

const NAV = [
  { id: "home", label: "Trang chủ", ico: "🏠", act: "sokoban-nav", sub: "home" },
  { id: "classic", label: "Level Pack", ico: "📚", act: "sokoban-nav", sub: "classic" },
  { id: "daily", label: "Daily Challenge", ico: "📅", act: "sokoban-start-daily" },
  { id: "time", label: "Time Attack", ico: "⏱", act: "sokoban-start-time" },
  { id: "random", label: "Random Map", ico: "🎲", act: "sokoban-start-random" },
  { id: "custom", label: "Custom Map", ico: "✏️", act: "sokoban-nav", sub: "custom" },
  { id: "replay", label: "Replay", ico: "🎬", act: "sokoban-nav", sub: "replay" },
];

export function createSokobanModule(deps = {}) {
  const { escapeHtml, playerName, toast, beep } = deps;

  /** @type {any} */
  let session = null;
  let homeTab = "home";
  let topMode = "classic";
  let clockTimer = null;
  let solveTimer = null;
  let replayIdx = 0;
  let replayPlaying = false;
  let replaySpeed = 1;
  let hintDir = null;
  let customMapText = "";

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PROGRESS) || "{}") || {};
    } catch {
      return {};
    }
  }

  function saveProgress(p) {
    localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(p));
  }

  function loadProfile() {
    try {
      return (
        JSON.parse(localStorage.getItem(STORAGE_PROFILE) || "null") || {
          solved: 0,
          totalMoves: 0,
          totalPushes: 0,
          games: 0,
          noUndoClears: 0,
          fastestMs: null,
        }
      );
    } catch {
      return { solved: 0, totalMoves: 0, totalPushes: 0, games: 0, noUndoClears: 0, fastestMs: null };
    }
  }

  function saveProfile(pro) {
    localStorage.setItem(STORAGE_PROFILE, JSON.stringify(pro));
  }

  function levelKey(level) {
    return `${level.pack}-${level.num || level.id}`;
  }

  function getLevelRecord(level) {
    const p = loadProgress();
    return p[levelKey(level)] || null;
  }

  function packCompletion(pack) {
    const list = levelsInPack(pack);
    if (!list.length) return 0;
    const p = loadProgress();
    let done = 0;
    for (const l of list) {
      if (p[levelKey(l)]?.cleared) done++;
    }
    return Math.round((done / list.length) * 100);
  }

  function startSession(level, mode, extra = {}) {
    stopTimers();
    hintDir = null;
    replayIdx = 0;
    replayPlaying = false;
    const game = createGameFromLevel(level);
    session = {
      mode,
      game,
      undoUsed: false,
      solution: null,
      timeAttackDeadline: mode === "time_attack" ? Date.now() + TIME_ATTACK_MS : null,
      timeAttackScore: extra.timeAttackScore || 0,
      ...extra,
    };
    return session;
  }

  function clearMatch() {
    stopTimers();
    session = null;
    hintDir = null;
  }

  function getMatch() {
    return session;
  }

  function stopTimers() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    if (solveTimer) clearInterval(solveTimer);
    solveTimer = null;
  }

  function onWin() {
    if (!session?.game) return;
    const g = session.game;
    const stars = starsForMoves(g.moves, g.level);
    const rec = getLevelRecord(g.level);
    const elapsed = Date.now() - g.startedAt;
    const isNewMoves = !rec?.bestMoves || g.moves < rec.bestMoves;
    const isNewTime = !rec?.bestTimeMs || elapsed < rec.bestTimeMs;

    const prog = loadProgress();
    const key = levelKey(g.level);
    prog[key] = {
      cleared: true,
      stars: Math.max(stars, rec?.stars || 0),
      bestMoves: isNewMoves ? g.moves : rec?.bestMoves,
      bestTimeMs: isNewTime ? elapsed : rec?.bestTimeMs,
      bestPushes: !rec?.bestPushes || g.pushes < rec.bestPushes ? g.pushes : rec?.bestPushes,
    };
    saveProgress(prog);

    const prof = loadProfile();
    prof.games += 1;
    prof.totalMoves += g.moves;
    prof.totalPushes += g.pushes;
    if (!rec?.cleared) prof.solved += 1;
    if (!session.undoUsed) prof.noUndoClears += 1;
    if (!prof.fastestMs || elapsed < prof.fastestMs) prof.fastestMs = elapsed;
    saveProfile(prof);

    session.win = { stars, isNewMoves, isNewTime, elapsed };
    beep?.(880, 80, "sine", 0.04);

    if (session.mode === "time_attack") {
      session.timeAttackScore += 1;
      toast?.(`+1 map · còn ${formatTime(Math.max(0, session.timeAttackDeadline - Date.now()))}`);
      setTimeout(() => {
        if (!session || session.mode !== "time_attack") return;
        if (Date.now() >= session.timeAttackDeadline) return;
        const next = getRandomLevel();
        startSession(next, "time_attack", { timeAttackScore: session.timeAttackScore });
        deps.onUpdate?.();
      }, 900);
    }
  }

  function doMove(dir) {
    if (!session?.game || session.game.status !== "playing") return false;
    if (session.mode === "replay") return false;
    if (session.timeAttackDeadline && Date.now() >= session.timeAttackDeadline) {
      toast?.("Hết giờ Time Attack!");
      session.game.status = "timeout";
      return false;
    }
    const { ok, game } = tryMove(session.game, dir);
    if (!ok) return false;
    session.game = game;
    hintDir = null;
    if (game.status === "won") onWin();
    beep?.(320, 12, "square", 0.008);
    return true;
  }

  function renderStars(n, max = 3) {
    let s = "";
    for (let i = 0; i < max; i++) s += i < n ? "★" : "☆";
    return s;
  }

  function syncBoardCanvas(root) {
    if (!session?.game || !root) return false;
    const canvas = root.querySelector("[data-sk-board]");
    if (!canvas) return false;
    renderBoardToCanvas(canvas, session.game, hintDir);
    return true;
  }

  function renderBoard() {
    return boardCanvasHtml();
  }

  function renderLevelPicker() {
    return PACK_ORDER.map((pack) => {
      const levels = levelsInPack(pack);
      const pct = packCompletion(pack);
      const btns = levels
        .map((l) => {
          const rec = getLevelRecord(l);
      return `<button type="button" class="sokoban-level-btn" data-act="sokoban-play" data-pack="${pack}" data-num="${l.num}">
            <span class="sk-lv-num">${l.num}</span>
            <span class="sk-stars">${renderStars(rec?.stars || 0)}</span>
          </button>`;
        })
        .join("");
      return `<div class="sokoban-pack"><h5>${PACK_LABELS[pack]} · ${pct}%</h5><div class="sokoban-level-list">${btns}</div></div>`;
    }).join("");
  }

  function renderHomeMain() {
    if (homeTab === "classic") {
      return `<div class="sokoban-card sk-glass"><h4>Classic · Level Pack</h4><div class="sokoban-pack-grid">${renderLevelPicker()}</div></div>`;
    }
    if (homeTab === "custom") {
      return `<div class="sokoban-card sokoban-custom"><h4>Custom Map</h4>
        <p style="font-size:0.8rem;color:var(--sk-muted)"># tường · @ người · $ thùng · . đích</p>
        <textarea data-sk-custom-map placeholder="#####&#10;#.@.#&#10;# $ #&#10;#####">${escapeHtml(customMapText)}</textarea>
        <p style="margin-top:8px"><button type="button" class="sokoban-level-btn" data-act="sokoban-custom-play">Chơi map này</button></p>
      </div>`;
    }
    if (homeTab === "replay") {
      const cleared = ALL_LEVELS.filter((l) => getLevelRecord(l)?.cleared);
      if (!cleared.length) return `<div class="sokoban-card"><p>Chưa có màn hoàn thành để replay.</p></div>`;
      const opts = cleared
        .map(
          (l) =>
            `<button type="button" class="sokoban-level-btn" data-act="sokoban-replay-level" data-pack="${l.pack}" data-num="${l.num}">${PACK_LABELS[l.pack]} L${l.num}</button>`
        )
        .join("");
      return `<div class="sokoban-card"><h4>Replay lời giải</h4><div class="sokoban-level-list">${opts}</div></div>`;
    }
    const prof = loadProfile();
    return `<div class="sokoban-card">
      <h4>Sokoban · Đẩy thùng</h4>
      <p style="font-size:0.88rem;line-height:1.5;color:var(--sk-muted)">Đẩy hết thùng vào đích với ít bước nhất. Không kéo thùng — chỉ đẩy từng cái một.</p>
      <ul style="font-size:0.82rem;color:var(--sk-muted);padding-left:1.2em">
        <li><strong>Classic</strong> — ${totalLevels()} màn Easy → Expert</li>
        <li><strong>Daily</strong> — 1 màn / ngày</li>
        <li><strong>Time Attack</strong> — 3 phút, giải càng nhiều càng tốt</li>
      </ul>
      <p class="sokoban-stat">Đã clear: <strong>${prof.solved}</strong> · TB moves: <strong>${prof.games ? Math.round(prof.totalMoves / prof.games) : 0}</strong></p>
    </div>
    <div class="sokoban-card"><h4>Bắt đầu nhanh</h4>
      <div class="sokoban-level-list">
        <button type="button" class="sokoban-level-btn" data-act="sokoban-start-daily">Daily hôm nay</button>
        <button type="button" class="sokoban-level-btn" data-act="sokoban-start-random">Random</button>
        <button type="button" class="sokoban-level-btn" data-act="sokoban-start-time">Time Attack</button>
      </div>
    </div>`;
  }

  function renderAsideHome() {
    const prof = loadProfile();
    const name = escapeHtml(playerName?.() || "Người chơi");
    return `<div class="sokoban-card sk-glass"><h4>Mục tiêu</h4>
      <ul class="sk-checklist">
        <li>Đẩy hết thùng vào ô đích</li>
        <li>Ít bước · ít lần đẩy</li>
        <li>Hoàn thành nhanh nhất</li>
      </ul></div>
      <div class="sokoban-card sk-glass"><h4>Bảng xếp hạng</h4>
      <p class="sk-muted-sm">Local — Daily online sắp có.</p>
      <ol class="sk-leader-mini">
        <li><span>1.</span> ${name} · ${prof.solved * 120 + 800}</li>
        <li><span>2.</span> —</li>
        <li><span>3.</span> —</li>
      </ol></div>
      <div class="sokoban-card sk-glass"><h4>Thành tích</h4>
      <div class="sk-ach-row"><span>100 màn</span><i style="--w:${Math.min(100, prof.solved)}%"></i><em>${Math.min(100, prof.solved)}/100</em></div>
      <div class="sk-ach-row"><span>No Undo</span><i style="--w:${Math.min(100, prof.noUndoClears * 10)}%"></i><em>${prof.noUndoClears}/10</em></div>
      </div>`;
  }

  function renderProfileFoot() {
    const prof = loadProfile();
    const name = escapeHtml(playerName?.() || "Người chơi");
    const avg = prof.games ? Math.round(prof.totalMoves / prof.games) : 0;
    return `<div class="sokoban-profile">
      <span class="sokoban-profile-av" aria-hidden="true">📦</span>
      <div><strong>${name}</strong><span class="sk-muted-sm">Đã clear ${prof.solved} · TB ${avg} moves</span></div>
    </div>`;
  }

  function renderHome() {
    const modes = ["classic", "daily", "time", "random"]
      .map((m) => {
        const labels = { classic: "Classic", daily: "Daily", time: "Time Attack", random: "Random" };
        return `<button type="button" class="${topMode === m ? "is-on" : ""}" data-act="sokoban-top-mode" data-mode="${m}">${labels[m]}</button>`;
      })
      .join("");

    const nav = NAV.map((n) => {
      const isOn =
        (n.sub && homeTab === n.sub) ||
        (!n.sub && n.id === "home" && homeTab === "home" && !["classic", "custom", "replay"].includes(homeTab));
      const act = n.sub ? `${n.act}:${n.sub}` : n.act;
      return `<button type="button" class="${isOn ? "is-on" : ""}" data-act="${act}"><span class="sk-nav-ico">${n.ico || ""}</span>${n.label}</button>`;
    }).join("");

    return `<div class="sokoban-shell">
      <div class="sokoban-layout">
        <div class="sokoban-brand">
          <span class="sokoban-brand-ico">📦</span>
          <div><strong>SOKOBAN</strong><small>Push · Think · Solve</small></div>
        </div>
        <header class="sokoban-topbar">
          <div class="sokoban-mode-tabs">${modes}</div>
          <div class="sk-top-meta">
            <span class="sk-coin">🪙 ${12000 + loadProfile().solved * 50}</span>
            <button type="button" class="sk-btn-ghost" data-act="board-portal">← Hub</button>
          </div>
        </header>
        <nav class="sokoban-nav sk-glass">${nav}${renderProfileFoot()}</nav>
        <main class="sokoban-main">${renderHomeMain()}</main>
        <aside class="sokoban-aside">${renderAsideHome()}</aside>
        <footer class="sokoban-controls sk-glass">
          <span class="sokoban-hint-desktop">WASD / Mũi tên · Z Undo · R Restart · H Hint · A Auto</span>
          <span class="sokoban-hint-touch">Vuốt trên bàn · Undo · Restart</span>
        </footer>
      </div>
    </div>`;
  }

  function renderPlay() {
    if (!session?.game) return renderHome();
    const g = session.game;
    const lv = g.level;
    const elapsed = g.status === "won" ? g.elapsedMs : Date.now() - g.startedAt;
    const stars = g.status === "won" ? starsForMoves(g.moves, lv) : 0;
    const th = starThresholds(lv);
    const rec = getLevelRecord(lv);
    let modeLabel = "Classic";
    if (session.mode === "daily") modeLabel = "Daily Challenge";
    if (session.mode === "time_attack") modeLabel = `Time Attack · ${session.timeAttackScore} map`;
    if (session.mode === "random") modeLabel = "Random Map";
    if (session.mode === "custom") modeLabel = "Custom Map";
    if (session.mode === "replay") modeLabel = "Replay";

    let timeLeft = "";
    if (session.timeAttackDeadline) {
      timeLeft = formatTime(Math.max(0, session.timeAttackDeadline - Date.now()));
    }

    let winOverlay = "";
    if (session.win && g.status === "won") {
      winOverlay = `<div class="sokoban-win" data-act="sokoban-dismiss-win">
        <div class="sokoban-win-card">
          <h3>Completed!</h3>
          <p style="font-size:1.6rem;color:var(--sk-gold)">${renderStars(session.win.stars)}</p>
          <p>Moves <strong>${g.moves}</strong> · Pushes <strong>${g.pushes}</strong></p>
          <p>Time <strong>${formatTime(session.win.elapsed)}</strong></p>
          ${session.win.isNewMoves ? "<p style='color:var(--sk-gold)'>New record moves!</p>" : ""}
          ${session.mode === "classic" ? `<button type="button" data-act="sokoban-next">Màn tiếp</button>` : ""}
          <button type="button" data-act="sokoban-home">Về menu</button>
        </div>
      </div>`;
    }

    return `<div class="sokoban-shell sokoban-play-shell">
      <div class="sokoban-layout sokoban-play-layout">
        <div class="sokoban-brand">
          <span class="sokoban-brand-ico">📦</span>
          <div><strong>${escapeHtml(modeLabel)}</strong><small>${escapeHtml(lv.name || `Level ${lv.num}`)} · ${PACK_LABELS[lv.pack] || lv.pack}</small></div>
        </div>
        <header class="sokoban-topbar sk-glass">
          <div class="sk-play-title">${escapeHtml(lv.name || `Level ${lv.num}`)} <em>· ${PACK_LABELS[lv.pack] || lv.pack}</em></div>
          <button type="button" class="sk-btn-ghost" data-act="sokoban-home">Menu</button>
        </header>
        <main class="sokoban-main sokoban-play-wrap">
          <div class="sokoban-hud-row sk-glass">
            <div class="sk-stat-pill"><span>Moves</span><strong data-sk-moves>${g.moves}</strong></div>
            <div class="sk-stat-pill"><span>Pushes</span><strong data-sk-pushes>${g.pushes}</strong></div>
            <div class="sk-stat-pill"><span>Time</span><strong data-sk-time>${timeLeft || formatTime(elapsed)}</strong></div>
            <div class="sk-stat-pill sk-stat-stars"><span>★</span><strong>${g.status === "won" ? renderStars(stars) : `≤${th.star3}/${th.star2}/${th.star1}`}</strong></div>
          </div>
          <div class="sokoban-board-scroller" data-sk-touch>${renderBoard()}</div>
          ${rec?.bestMoves ? `<p class="sk-best-line">👑 Best ${rec.bestMoves} moves${rec.bestTimeMs ? ` · ${formatTime(rec.bestTimeMs)}` : ""}</p>` : ""}
        </main>
        <aside class="sokoban-aside">
          <div class="sokoban-card sk-glass"><h4>Mục tiêu</h4><p class="sk-muted-sm">Đẩy hết thùng vào ô vàng (X).</p></div>
          <div class="sokoban-card sk-glass"><h4>Chấm sao</h4>
            <p class="sk-star-line">★★★ &lt; <strong>${th.star3}</strong> moves</p>
            <p class="sk-star-line">★★ &lt; <strong>${th.star2}</strong></p>
            <p class="sk-star-line">★ &lt; <strong>${th.star1}</strong></p>
          </div>
        </aside>
        <footer class="sokoban-controls sk-glass">
          <div class="sk-ctrl-group">
            <button type="button" class="sk-tool-btn" data-act="sokoban-undo">Undo <kbd>Z</kbd></button>
            <button type="button" class="sk-tool-btn" data-act="sokoban-restart">Restart <kbd>R</kbd></button>
            <button type="button" class="sk-tool-btn" data-act="sokoban-hint">Hint <kbd>H</kbd></button>
            <button type="button" class="sk-tool-btn" data-act="sokoban-solve">Auto <kbd>A</kbd></button>
          </div>
          ${session.mode === "replay" ? `<div class="sk-ctrl-group">
            <button type="button" class="sk-tool-btn" data-act="sokoban-replay-play">Play</button>
            <button type="button" class="sk-tool-btn" data-act="sokoban-replay-step" data-d="-1">◀</button>
            <button type="button" class="sk-tool-btn" data-act="sokoban-replay-step" data-d="1">▶</button>
            <button type="button" class="sk-tool-btn" data-act="sokoban-replay-speed">x${replaySpeed}</button>
          </div>` : `<button type="button" class="sk-primary sk-cta-next" data-act="sokoban-next">Màn tiếp</button>`}
        </footer>
      </div>
      ${winOverlay}
    </div>`;
  }

  function patchBoardIn(root) {
    if (!session?.game || !root) return false;
    const g = session.game;
    syncBoardCanvas(root);
    const mv = root.querySelector("[data-sk-moves]");
    const ps = root.querySelector("[data-sk-pushes]");
    const tm = root.querySelector("[data-sk-time]");
    if (mv) mv.textContent = String(g.moves);
    if (ps) ps.textContent = String(g.pushes);
    if (tm) {
      if (session.timeAttackDeadline) tm.textContent = formatTime(Math.max(0, session.timeAttackDeadline - Date.now()));
      else tm.textContent = formatTime(Date.now() - g.startedAt);
    }
    return true;
  }

  function mountPlay(root) {
    if (!root || !session) return;
    syncBoardCanvas(root);
    const board = root.querySelector("[data-sk-touch]");
    if (!board || board._skBound) return;
    board._skBound = true;

    const onKey = (e) => {
      if (!session?.game || session.game.status !== "playing") return;
      const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
      const k = map[e.key];
      if (k) {
        e.preventDefault();
        if (doMove(k)) patchBoardIn(root) || deps.onUpdate?.();
        return;
      }
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        session.game = undoMove(session.game);
        session.undoUsed = true;
        patchBoardIn(root) || deps.onUpdate?.();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        session.game = restartGame(session.game);
        session.win = null;
        patchBoardIn(root) || deps.onUpdate?.();
      }
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        hintDir = hintMove(session.game);
        patchBoardIn(root) || deps.onUpdate?.();
      }
    };
    window.addEventListener("keydown", onKey);
    board._skKeyOff = () => window.removeEventListener("keydown", onKey);

    let x0 = 0;
    let y0 = 0;
    board.addEventListener(
      "pointerdown",
      (e) => {
        x0 = e.clientX;
        y0 = e.clientY;
      },
      { passive: true }
    );
    board.addEventListener(
      "pointerup",
      (e) => {
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < 18) return;
        let dir = null;
        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
        else dir = dy > 0 ? "down" : "up";
        if (dir && doMove(dir)) patchBoardIn(root) || deps.onUpdate?.();
      },
      { passive: true }
    );

    if (!clockTimer) {
      clockTimer = setInterval(() => {
        if (!session?.game) return;
        if (session.timeAttackDeadline && Date.now() >= session.timeAttackDeadline) {
          session.game.status = "timeout";
          toast?.("Hết giờ Time Attack!");
          stopTimers();
          deps.onUpdate?.();
          return;
        }
        patchBoardIn(root);
      }, 500);
    }
  }

  function runAutoSolve() {
    if (!session?.game) return;
    toast?.("Đang tìm lời giải…");
    const path = solveLevel(session.game, 100000);
    if (!path?.length) return toast?.("Không giải được màn này (quá phức tạp).");
    session.solution = path;
    let i = 0;
    stopTimers();
    solveTimer = setInterval(() => {
      if (!session || i >= path.length) {
        stopTimers();
        if (clockTimer) clockTimer = setInterval(() => deps.onUpdate?.(), 500);
        return;
      }
      doMove(path[i]);
      i++;
      deps.onUpdate?.();
    }, 120 / replaySpeed);
  }

  function startReplayLevel(pack, num) {
    const level = getLevel(pack, num);
    if (!level) return;
    const path = solveLevel(createGameFromLevel(level), 100000);
    if (!path) return toast?.("Chưa có lời giải lưu — thử Auto Solve khi chơi.");
    session = {
      mode: "replay",
      game: createGameFromLevel(level),
      solution: path,
      undoUsed: false,
    };
    replayIdx = 0;
    homeTab = "replay";
  }

  function handleAction(act, el) {
    if (act === "sokoban-home") {
      clearMatch();
      return "sokoban-home";
    }
    if (act === "sokoban-nav:home") {
      homeTab = "home";
      return "sokoban-home";
    }
    if (act === "sokoban-nav:classic") {
      homeTab = "classic";
      return "sokoban-home";
    }
    if (act === "sokoban-nav:custom") {
      homeTab = "custom";
      return "sokoban-home";
    }
    if (act === "sokoban-nav:replay") {
      homeTab = "replay";
      return "sokoban-home";
    }
    if (act === "sokoban-top-mode") {
      topMode = el?.dataset?.mode || "classic";
      if (topMode === "daily") return handleAction("sokoban-start-daily");
      if (topMode === "time") return handleAction("sokoban-start-time");
      if (topMode === "random") return handleAction("sokoban-start-random");
      homeTab = "classic";
      return "sokoban-home";
    }
    if (act === "sokoban-play") {
      const pack = el?.dataset?.pack;
      const num = Number(el?.dataset?.num);
      const level = getLevel(pack, num);
      if (!level) return null;
      startSession(level, "classic");
      return "sokoban-play";
    }
    if (act === "sokoban-start-daily") {
      startSession(getDailyLevel(), "daily");
      return "sokoban-play";
    }
    if (act === "sokoban-start-random") {
      startSession(getRandomLevel(), "random");
      return "sokoban-play";
    }
    if (act === "sokoban-start-time") {
      startSession(getRandomLevel(), "time_attack", { timeAttackScore: 0 });
      toast?.("Time Attack — 3 phút!");
      return "sokoban-play";
    }
    if (act === "sokoban-custom-play") {
      const ta = el?.closest?.(".sokoban-shell")?.querySelector("[data-sk-custom-map]");
      customMapText = ta?.value || customMapText;
      const level = parseCustomMap(customMapText);
      if (!level) return toast?.("Map không hợp lệ — cần @ $ .");
      startSession(level, "custom");
      return "sokoban-play";
    }
    if (act === "sokoban-replay-level") {
      startReplayLevel(el?.dataset?.pack, Number(el?.dataset?.num));
      return "sokoban-play";
    }
    if (act === "sokoban-undo" && session?.game) {
      session.game = undoMove(session.game);
      session.undoUsed = true;
      patchBoardIn(el?.closest?.(".sokoban-shell")?.parentElement);
      return null;
    }
    if (act === "sokoban-restart" && session?.game) {
      session.game = restartGame(session.game);
      session.win = null;
      deps.onUpdate?.();
      return null;
    }
    if (act === "sokoban-hint" && session?.game) {
      hintDir = hintMove(session.game);
      if (!hintDir) toast?.("Không có gợi ý.");
      deps.onUpdate?.();
      return null;
    }
    if (act === "sokoban-solve") {
      runAutoSolve();
      return null;
    }
    if (act === "sokoban-dismiss-win") {
      if (el?.target?.closest?.(".sokoban-win-card") && !el.target.closest("button")) return null;
      session.win = null;
      deps.onUpdate?.();
      return null;
    }
    if (act === "sokoban-next" && session?.game) {
      if (session.mode === "classic") {
        const next = getLevel(session.game.level.pack, session.game.level.num + 1);
        if (next) {
          startSession(next, "classic");
          return "sokoban-play";
        }
        toast?.("Hết màn pack này!");
      }
      session.win = null;
      return "sokoban-home";
    }
    if (act === "sokoban-replay-play" && session?.solution) {
      replayPlaying = !replayPlaying;
      if (replayPlaying) {
        const tick = () => {
          if (!replayPlaying || !session?.solution) return;
          if (replayIdx >= session.solution.length) {
            replayPlaying = false;
            return;
          }
          doMove(session.solution[replayIdx]);
          replayIdx++;
          session.game = replayMoves(session.game, session.solution.slice(0, replayIdx));
          deps.onUpdate?.();
          setTimeout(tick, 180 / replaySpeed);
        };
        tick();
      }
      return null;
    }
    if (act === "sokoban-replay-step" && session?.solution) {
      const d = Number(el?.dataset?.d || 1);
      replayIdx = Math.max(0, Math.min(session.solution.length, replayIdx + d));
      session.game = replayMoves(createGameFromLevel(session.game.level), session.solution.slice(0, replayIdx));
      deps.onUpdate?.();
      return null;
    }
    if (act === "sokoban-replay-speed") {
      replaySpeed = replaySpeed >= 2 ? 1 : 2;
      deps.onUpdate?.();
      return null;
    }
    return null;
  }

  return {
    renderHome,
    renderPlay,
    handleAction,
    mountPlay,
    clearMatch,
    getMatch,
    patchBoardIn,
  };
}
