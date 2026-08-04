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
import { boardCanvasHtml, metalFrameHtml, renderBoardToCanvas } from "./sokoban-render.js";

const STORAGE_PROGRESS = "sokoban-progress-v1";
const STORAGE_PROFILE = "sokoban-profile-v1";
const TIME_ATTACK_MS = 3 * 60 * 1000;

const NAV = [
  { id: "home", label: "Trang chủ", ico: "🏠", act: "sokoban-nav", sub: "home" },
  { id: "quick", label: "Quick Play", ico: "⚡", act: "sokoban-start-random" },
  { id: "classic", label: "Level Pack", ico: "📚", act: "sokoban-nav", sub: "classic" },
  { id: "daily", label: "Daily", ico: "📅", act: "sokoban-start-daily" },
  { id: "time", label: "Time Attack", ico: "⏱", act: "sokoban-start-time" },
  { id: "random", label: "Random", ico: "🎲", act: "sokoban-start-random" },
  { id: "custom", label: "Custom Map", ico: "✏️", act: "sokoban-nav", sub: "custom" },
  { id: "replay", label: "Replay", ico: "🎬", act: "sokoban-nav", sub: "replay" },
  { id: "rank", label: "Ranking", ico: "🏆", act: "sokoban-nav", sub: "rank" },
  { id: "achieve", label: "Achievement", ico: "🎖", act: "sokoban-nav", sub: "achieve" },
  { id: "settings", label: "Settings", ico: "⚙", act: "sokoban-nav", sub: "settings" },
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
    session.playerFacing = dir;
    session.walkFrame = (session.walkFrame ?? 0) ^ 1;
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
    renderBoardToCanvas(canvas, session.game, {
      hintDir,
      facing: session.playerFacing || "down",
      walkFrame: session.walkFrame ?? 0,
    });
    return true;
  }

  function renderBoard() {
    return metalFrameHtml(boardCanvasHtml());
  }

  function renderSidebar() {
    const nav = NAV.map((n) => {
      const isOn =
        session?.game &&
        (n.act === "sokoban-start-daily" && session.mode === "daily" ||
          n.act === "sokoban-start-time" && session.mode === "time_attack" ||
          n.act === "sokoban-start-random" && session.mode === "random" && homeTab !== "classic");
      const homeOn =
        !session?.game &&
        ((n.sub && homeTab === n.sub) ||
          (!n.sub && n.id === "home" && homeTab === "home" && !["classic", "custom", "replay", "rank", "achieve", "settings"].includes(homeTab)));
      const act = n.sub ? `${n.act}:${n.sub}` : n.act;
      return `<button type="button" class="sk-nav-btn${isOn || homeOn ? " is-on" : ""}" data-act="${act}"><span class="sk-nav-ico">${n.ico}</span><span>${n.label}</span></button>`;
    }).join("");
    return `<div class="sk-logo">
        <span class="sk-logo-crate">📦</span>
        <div><strong>SOKOBAN</strong><small>Push · Think · Solve</small></div>
      </div>
      <nav class="sk-nav-list">${nav}</nav>
      ${renderProfileFoot()}`;
  }

  function renderTopBar(playCtx) {
    const prof = loadProfile();
    const coins = 12450 + prof.solved * 50;
    const gems = 320 + prof.solved * 2;
    const modes = ["classic", "daily", "time", "random"]
      .map((m) => {
        const labels = { classic: "Classic", daily: "Daily", time: "Time Attack", random: "Random" };
        const on = playCtx ? playCtx.topMode === m : topMode === m;
        return `<button type="button" class="sk-tab${on ? " is-on" : ""}" data-act="sokoban-top-mode" data-mode="${m}">${labels[m]}</button>`;
      })
      .join("");
    const levelLine = playCtx
      ? `<span class="sk-level-pack">${escapeHtml(playCtx.modeLabel)}</span>
         <span class="sk-level-name">${escapeHtml(playCtx.lv.name || `Level ${playCtx.lv.num}`)}</span>
         <span class="sk-diff">${escapeHtml(PACK_LABELS[playCtx.lv.pack] || playCtx.lv.pack)}</span>`
      : `<span class="sk-level-pack">Level Pack</span><span class="sk-diff">Warehouse</span>`;
    return `<header class="sk-topbar">
      <div class="sk-top-left">${levelLine}</div>
      <div class="sk-top-tabs">${modes}</div>
      <div class="sk-top-right">
        <span class="sk-pill sk-coin-pill">🪙 ${coins.toLocaleString()}</span>
        <span class="sk-pill sk-gem-pill">💎 ${gems}</span>
        <button type="button" class="sk-icon-btn" title="Thông báo">🔔</button>
        <button type="button" class="sk-icon-btn" title="Cài đặt" data-act="sokoban-nav:settings">⚙</button>
        <button type="button" class="sk-hub-btn" data-act="${playCtx ? "sokoban-home" : "board-portal"}">${playCtx ? "Menu" : "Hub"}</button>
      </div>
    </header>`;
  }

  function renderRightPanel(playCtx) {
    const prof = loadProfile();
    const name = escapeHtml(playerName?.() || "Người chơi");
    const th = playCtx?.th;
    return `<div class="sk-rpanel-card">
      <div class="sk-rpanel-head"><span class="sk-rpanel-ico">🎯</span><h4>Mục tiêu</h4></div>
      <ul class="sk-objective-list">
        <li>✓ Đẩy hết thùng vào đích</li>
        <li>✓ Ít bước nhất có thể</li>
        <li>✓ Hoàn thành nhanh</li>
      </ul>
      ${th ? `<p class="sk-muted-sm">★★★ &lt; ${th.star3} moves</p>` : ""}
    </div>
    <div class="sk-rpanel-card">
      <div class="sk-rpanel-head"><span class="sk-rpanel-ico">🏆</span><h4>Ranking</h4></div>
      <ol class="sk-rank-list">
        <li><span class="sk-rank-av">🥇</span><span>Player_A</span><em>2410</em></li>
        <li><span class="sk-rank-av">🥈</span><span>Player_B</span><em>2280</em></li>
        <li class="is-me"><span class="sk-rank-av">🥉</span><span>${name}</span><em>${prof.solved * 120 + 880}</em></li>
      </ol>
    </div>
    <div class="sk-rpanel-card">
      <div class="sk-rpanel-head"><span class="sk-rpanel-ico">🎖</span><h4>Achievement</h4></div>
      <div class="sk-achieve-block">
        <span>100 Levels</span>
        <div class="sk-prog"><i style="--w:${Math.min(100, prof.solved)}%"></i></div>
        <em>${Math.min(100, prof.solved)}/100</em>
      </div>
      <div class="sk-achieve-block">
        <span>No Undo</span>
        <div class="sk-prog"><i style="--w:${Math.min(100, prof.noUndoClears * 10)}%"></i></div>
        <em>${prof.noUndoClears}/10</em>
      </div>
      <div class="sk-achieve-block">
        <span>Quick solve</span>
        <div class="sk-prog"><i style="--w:${Math.min(100, prof.solved * 3)}%"></i></div>
        <em>${Math.min(50, prof.solved)}/50</em>
      </div>
    </div>`;
  }

  function buildGameFrame(centerHtml, topPlayCtx, winOverlay = "") {
    return `<div class="sokoban-shell">
      <div class="sk-game-grid">
        <aside class="sk-sidebar sk-glass-panel">${renderSidebar()}</aside>
        <section class="sk-center-col">
          ${renderTopBar(topPlayCtx)}
          <div class="sk-center-body">${centerHtml}</div>
        </section>
        <aside class="sk-right-col">${renderRightPanel(topPlayCtx)}</aside>
      </div>
      ${winOverlay}
    </div>`;
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
      return `<div class="sk-hub-card sk-glass-panel"><h3>Level Pack · Warehouse</h3><div class="sokoban-pack-grid">${renderLevelPicker()}</div></div>`;
    }
    if (homeTab === "custom") {
      return `<div class="sk-hub-card sk-glass-panel"><h3>Custom Map</h3>
        <p class="sk-muted-sm"># tường · @ người · $ thùng · . đích</p>
        <textarea class="sk-custom-ta" data-sk-custom-map placeholder="#####">${escapeHtml(customMapText)}</textarea>
        <button type="button" class="sk-game-btn sk-game-btn-gold" data-act="sokoban-custom-play">▶ Chơi map</button>
      </div>`;
    }
    if (homeTab === "rank" || homeTab === "achieve" || homeTab === "settings") {
      const titles = { rank: "Ranking", achieve: "Achievement", settings: "Settings" };
      return `<div class="sk-hub-card sk-glass-panel"><h3>${titles[homeTab]}</h3><p class="sk-muted-sm">Đang mở rộng — xem panel bên phải.</p></div>`;
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
    const center = `<div class="sk-hub-center">${renderHomeMain()}</div>`;
    return buildGameFrame(center, null);
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
    if (session.mode === "time_attack") modeLabel = "Time Attack";
    if (session.mode === "random") modeLabel = "Random Map";
    if (session.mode === "custom") modeLabel = "Custom Map";
    if (session.mode === "replay") modeLabel = "Replay";

    let timeLeft = "";
    if (session.timeAttackDeadline) {
      timeLeft = formatTime(Math.max(0, session.timeAttackDeadline - Date.now()));
    }

    const starDisplay = g.status === "won" ? renderStars(stars) : `≤${th.star3}/${th.star2}/${th.star1}`;
    const playCtx = { modeLabel, lv, th, topMode: session.mode === "daily" ? "daily" : session.mode === "time_attack" ? "time" : session.mode === "random" ? "random" : "classic" };

    let winOverlay = "";
    if (session.win && g.status === "won") {
      winOverlay = `<div class="sokoban-win" data-act="sokoban-dismiss-win">
        <div class="sokoban-win-card sk-glass-panel">
          <h3>Completed!</h3>
          <p class="sk-win-stars">${renderStars(session.win.stars)}</p>
          <p>Moves <strong>${g.moves}</strong> · Pushes <strong>${g.pushes}</strong></p>
          <p>Time <strong>${formatTime(session.win.elapsed)}</strong></p>
          ${session.win.isNewMoves ? "<p class='sk-gold-txt'>New record!</p>" : ""}
          <button type="button" class="sk-game-btn sk-game-btn-gold" data-act="sokoban-next">Màn tiếp</button>
          <button type="button" class="sk-game-btn" data-act="sokoban-home">Menu</button>
        </div>
      </div>`;
    }

    const replayBtns =
      session.mode === "replay"
        ? `<button type="button" class="sk-game-btn" data-act="sokoban-replay-play">▶ Play</button>
           <button type="button" class="sk-game-btn" data-act="sokoban-replay-step" data-d="-1">◀</button>
           <button type="button" class="sk-game-btn" data-act="sokoban-replay-step" data-d="1">▶</button>`
        : "";

    const center = `<div class="sk-play-center">
      <div class="sk-stat-grid">
        <div class="sk-stat-card"><span class="sk-stat-lbl">★ Rating</span><strong class="sk-stars-lg">${starDisplay}</strong></div>
        <div class="sk-stat-card"><span class="sk-stat-lbl">Moves</span><strong data-sk-moves>${g.moves}</strong></div>
        <div class="sk-stat-card"><span class="sk-stat-lbl">Pushes</span><strong data-sk-pushes>${g.pushes}</strong></div>
        <div class="sk-stat-card"><span class="sk-stat-lbl">Time</span><strong data-sk-time>${timeLeft || formatTime(elapsed)}</strong></div>
        <div class="sk-stat-card sk-stat-best"><span class="sk-stat-lbl">👑 Best</span><strong>${rec?.bestMoves ?? "—"}</strong></div>
        <div class="sk-stat-card sk-stat-best"><span class="sk-stat-lbl">👑 Best Time</span><strong>${rec?.bestTimeMs ? formatTime(rec.bestTimeMs) : "—"}</strong></div>
      </div>
      <div class="sk-board-stage">${renderBoard()}</div>
      <div class="sk-action-bar">
        <button type="button" class="sk-game-btn" data-act="sokoban-undo"><span class="sk-btn-ico">↩</span>Undo</button>
        <button type="button" class="sk-game-btn" data-act="sokoban-restart"><span class="sk-btn-ico">⟲</span>Restart</button>
        <button type="button" class="sk-game-btn" data-act="sokoban-hint"><span class="sk-btn-ico">💡</span>Hint</button>
        <button type="button" class="sk-game-btn" data-act="sokoban-solve"><span class="sk-btn-ico">🤖</span>Auto</button>
        ${replayBtns}
        <button type="button" class="sk-game-btn sk-game-btn-gold sk-game-btn-next" data-act="sokoban-next"><span class="sk-btn-ico">▶</span>Next Level</button>
      </div>
      <p class="sk-key-hint sokoban-hint-desktop">WASD / Mũi tên · Z R H A</p>
      <p class="sk-key-hint sokoban-hint-touch">Vuốt trên bàn để di chuyển</p>
    </div>`;

    return buildGameFrame(center, playCtx, winOverlay);
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
    if (act === "sokoban-nav:rank") {
      homeTab = "rank";
      return "sokoban-home";
    }
    if (act === "sokoban-nav:achieve") {
      homeTab = "achieve";
      return "sokoban-home";
    }
    if (act === "sokoban-nav:settings") {
      homeTab = "settings";
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
