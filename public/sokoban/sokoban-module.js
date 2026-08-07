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
  CAMPAIGN_MAX,
  CAMPAIGN_TIERS,
  getCampaignLevel,
  getCampaignTier,
  PACK_LABELS,
  PACK_ORDER,
  getLevel,
  getRandomLevel,
  levelsInPack,
  parseCustomMap,
  validateLevelRows,
  totalLevels,
} from "./sokoban-levels.js";
import { hintMove, replayMoves, solveLevel } from "./sokoban-solver.js";
import { boardCanvasHtml, metalFrameHtml, renderBoardToCanvas } from "./sokoban-render.js";
import { startVictoryFireworks } from "./sokoban-victory-fx.js";

const STORAGE_PROGRESS = "sokoban-progress-v1";
const STORAGE_PROFILE = "sokoban-profile-v1";
const TIME_ATTACK_MS = 3 * 60 * 1000;

const NAV = [
  { id: "home", label: "Trang chủ", ico: "🏠", act: "sokoban-nav", sub: "home" },
  { id: "quick", label: "Quick Play", ico: "⚡", act: "sokoban-continue" },
  { id: "classic", label: "Level Pack", ico: "📚", act: "sokoban-nav", sub: "classic" },
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
  let topMode = "campaign";
  let clockTimer = null;
  let solveTimer = null;
  let replayIdx = 0;
  let replayPlaying = false;
  let replaySpeed = 1;
  let hintDir = null;
  let customMapText = "";
  let pickCampaignLevel = 1;
  let pickCampaignTier = "easy";
  /** @type {{ key: ((e: KeyboardEvent) => void) | null, abort: AbortController | null }} */
  let playInput = { key: null, abort: null };
  let moveLockUntil = 0;
  const MOVE_COOLDOWN_MS = 130;

  function detachPlayInput() {
    if (playInput.key) {
      window.removeEventListener("keydown", playInput.key);
      playInput.key = null;
    }
    if (playInput.abort) {
      playInput.abort.abort();
      playInput.abort = null;
    }
  }

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

  function getCampaignUnlocked() {
    const p = loadProgress();
    let unlocked = 1;
    for (let i = 1; i <= CAMPAIGN_MAX; i++) {
      if (p[`campaign-${i}`]?.cleared) unlocked = i + 1;
    }
    return Math.min(CAMPAIGN_MAX, unlocked);
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
    detachPlayInput();
    session = null;
    hintDir = null;
    moveLockUntil = 0;
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
    if (!session?.game || session.game.status !== "won") return;
    if (session.win) return;
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
    beep?.(660, 120, "sine", 0.05);
    setTimeout(() => beep?.(990, 100, "sine", 0.04), 140);

    if (session.mode === "time_attack") {
      session.timeAttackScore += 1;
      toast?.(`+1 map · còn ${formatTime(Math.max(0, session.timeAttackDeadline - Date.now()))}`);
      setTimeout(() => {
        if (!session || session.mode !== "time_attack") return;
        if (Date.now() >= session.timeAttackDeadline) return;
        session.win = null;
        const next = getRandomLevel();
        startSession(next, "time_attack", { timeAttackScore: session.timeAttackScore });
        deps.onUpdate?.();
      }, 3200);
    }
  }

  function doMove(dir, opt = {}) {
    if (!session?.game || session.game.status !== "playing") return false;
    if (session.mode === "replay" && !opt.ignoreCooldown) return false;
    if (session.timeAttackDeadline && Date.now() >= session.timeAttackDeadline) {
      toast?.("Hết giờ Time Attack!");
      session.game.status = "timeout";
      return false;
    }
    const now = Date.now();
    if (!opt.ignoreCooldown && now < moveLockUntil) return false;
    const { ok, game } = tryMove(session.game, dir);
    if (!ok) return false;
    if (!opt.ignoreCooldown) moveLockUntil = now + MOVE_COOLDOWN_MS;
    session.game = game;
    session.playerFacing = dir;
    session.walkFrame = (session.walkFrame ?? 0) ^ 1;
    hintDir = null;
    if (game.status === "won") {
      onWin();
      deps.onUpdate?.();
      return true;
    }
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
        (n.act === "sokoban-start-time" && session.mode === "time_attack" ||
          n.act === "sokoban-start-random" && session.mode === "random" ||
          n.act === "sokoban-continue" && session.mode === "campaign");
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
    const modes = ["campaign", "time", "random"]
      .map((m) => {
        const labels = { campaign: "Level Pack", time: "Time Attack", random: "Random" };
        const on = playCtx
          ? playCtx.topMode === m || (m === "campaign" && playCtx.topMode === "classic")
          : topMode === m || topMode === "classic";
        return `<button type="button" class="sk-tab${on ? " is-on" : ""}" data-act="sokoban-top-mode" data-mode="${m}">${labels[m]}</button>`;
      })
      .join("");
    const levelLine = playCtx
      ? `<span class="sk-level-pack">${escapeHtml(playCtx.modeLabel)}</span>
         <span class="sk-level-name">${escapeHtml(playCtx.lv.name || `Level ${playCtx.lv.num}`)}</span>
         <span class="sk-diff">${escapeHtml(playCtx.lv.pack === "campaign" ? getCampaignTier(playCtx.lv.num).label : PACK_LABELS[playCtx.lv.pack] || playCtx.lv.pack)}</span>`
      : `<span class="sk-level-pack">Level Pack</span><span class="sk-level-name">Level ${pickCampaignLevel}/${CAMPAIGN_MAX}</span><span class="sk-diff">${getCampaignTier(pickCampaignLevel).label}</span>`;
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

  function getCampaignStats() {
    const p = loadProgress();
    let cleared = 0;
    let stars = 0;
    for (let i = 1; i <= CAMPAIGN_MAX; i++) {
      const r = p[`campaign-${i}`];
      if (r?.cleared) cleared++;
      stars += r?.stars || 0;
    }
    return {
      cleared,
      stars,
      maxStars: CAMPAIGN_MAX * 3,
      pct: Math.round((cleared / CAMPAIGN_MAX) * 100),
    };
  }

  function renderMapPreview(rows) {
    const clean = rows.map((r) => r.replace(/\r/g, ""));
    const maxW = Math.max(...clean.map((r) => r.length), 1);
    let cells = "";
    for (const row of clean) {
      for (let c = 0; c < maxW; c++) {
        const ch = row[c] || " ";
        let cls = "sk-mp-floor";
        if (ch === "#") cls = "sk-mp-wall";
        else if (ch === "$" || ch === "*") cls = "sk-mp-box";
        else if (ch === "." || ch === "+") cls = "sk-mp-goal";
        else if (ch === "@") cls = "sk-mp-player";
        cells += `<span class="${cls}"></span>`;
      }
    }
    return `<div class="sk-map-preview" aria-hidden="true"><div class="sk-map-preview-grid" style="grid-template-columns: repeat(${maxW}, 8px)">${cells}</div></div>`;
  }

  function renderLevelPickPanel(num) {
    const lv = getCampaignLevel(num);
    const tier = getCampaignTier(num);
    const rec = getLevelRecord(lv);
    const unlocked = getCampaignUnlocked();
    const locked = num > unlocked;
    const stats = getCampaignStats();
    const th = starThresholds(lv);
    return `<div class="sk-rpanel-card sk-pick-preview-card">
      <div class="sk-pick-preview-head">
        <span class="sk-pick-tier">${tier.label}</span>
        <h4>Level ${num}</h4>
      </div>
      ${renderMapPreview(lv.rows)}
      <p class="sk-muted-sm">${escapeHtml(lv.name || `Warehouse ${num}`)}</p>
      <p class="sk-pick-stars">${locked ? "🔒 Chưa mở" : renderStars(rec?.stars || 0)}</p>
    </div>
    <div class="sk-rpanel-card">
      <div class="sk-rpanel-head"><span class="sk-rpanel-ico">🎯</span><h4>Mục tiêu</h4></div>
      <ul class="sk-objective-list">
        <li>Đẩy hết thùng vào ô đích (X vàng)</li>
        <li>★★★ ≤ ${th.star3} moves</li>
      </ul>
    </div>
    <div class="sk-rpanel-card">
      <div class="sk-rpanel-head"><span class="sk-rpanel-ico">📊</span><h4>Thống kê</h4></div>
      <div class="sk-pick-stat-row"><span>Đã chơi</span><em>${stats.cleared}/${CAMPAIGN_MAX}</em></div>
      <div class="sk-pick-stat-row"><span>Sao</span><em>${stats.stars}/${stats.maxStars}</em></div>
      <div class="sk-pick-stat-row"><span>Hoàn thành</span><em>${stats.pct}%</em></div>
      ${rec?.bestMoves ? `<div class="sk-pick-stat-row"><span>Best</span><em>${rec.bestMoves} moves</em></div>` : ""}
    </div>
    <button type="button" class="sk-game-btn sk-game-btn-gold sk-pick-play-btn" data-act="sokoban-play-picked" ${locked ? "disabled" : ""}>▶ Chơi ngay</button>`;
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

  function buildGameFrame(centerHtml, topPlayCtx, winOverlay = "", rightHtml = null) {
    const right =
      rightHtml ??
      (homeTab === "classic" && !playCtx ? renderLevelPickPanel(pickCampaignLevel) : renderRightPanel(playCtx));
    return `<div class="sokoban-shell">
      <div class="sk-game-grid">
        <aside class="sk-sidebar sk-glass-panel">${renderSidebar()}</aside>
        <section class="sk-center-col">
          ${renderTopBar(renderPlayTopCtxForHome(playCtx))}
          <div class="sk-center-body">${centerHtml}</div>
        </section>
        <aside class="sk-right-col">${right}</aside>
      </div>
      ${winOverlay}
    </div>`;
  }

  function renderPlayTopCtxForHome(playCtx) {
    if (playCtx) return playCtx;
    if (homeTab === "classic") {
      return { modeLabel: "Level Pack", lv: getCampaignLevel(pickCampaignLevel), homePick: true };
    }
    return null;
  }

  function renderCampaignPicker() {
    const unlocked = getCampaignUnlocked();
    const tierTabs = CAMPAIGN_TIERS.map((t) => {
      const on = pickCampaignTier === t.id;
      return `<button type="button" class="sk-tier-tab${on ? " is-on" : ""}" data-act="sokoban-pick-tier" data-tier="${t.id}">${t.label}</button>`;
    }).join("");

    const packs = CAMPAIGN_TIERS.map((tier) => {
      const packLocked = tier.start > unlocked;
      let doneInTier = 0;
      for (let i = tier.start; i <= tier.end; i++) {
        if (getLevelRecord(getCampaignLevel(i))?.cleared) doneInTier++;
      }
      const cards = [];
      for (let i = tier.start; i <= tier.end; i++) {
        const rec = getLevelRecord(getCampaignLevel(i));
        const locked = i > unlocked;
        const selected = i === pickCampaignLevel;
        cards.push(`<button type="button" class="sk-level-card${selected ? " is-selected" : ""}${locked ? " is-locked" : ""}" data-act="sokoban-pick-campaign" data-num="${i}" ${locked ? "disabled" : ""}>
          <span class="sk-level-card-num">${i}</span>
          <span class="sk-level-card-stars">${locked ? "🔒" : renderStars(rec?.stars || 0)}</span>
        </button>`);
      }
      const visible = pickCampaignTier === tier.id;
      return `<section class="sk-pack-section${packLocked ? " is-pack-locked" : ""}${visible ? " is-visible" : ""}" data-tier="${tier.id}">
        <header class="sk-pack-head">
          <h5>${tier.label} Pack</h5>
          <span class="sk-muted-sm">${tier.end - tier.start + 1} Levels · ${doneInTier}/${tier.end - tier.start + 1}</span>
        </header>
        <div class="sk-level-card-grid">${cards.join("")}</div>
      </section>`;
    }).join("");

    return `<div class="sk-level-pack-hub">
      <header class="sk-level-pack-head">
        <h2>Level Pack</h2>
        <p class="sk-muted-sm">Chinh phục ${CAMPAIGN_MAX} màn Warehouse · khó dần theo level</p>
      </header>
      <div class="sk-tier-tabs">${tierTabs}</div>
      <div class="sk-pack-list">${packs}</div>
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
      return renderCampaignPicker();
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
        <li><strong>Campaign</strong> — ${CAMPAIGN_MAX} màn Warehouse, khó dần</li>
        <li><strong>Time Attack</strong> — 3 phút, giải càng nhiều càng tốt</li>
      </ul>
      <p class="sokoban-stat">Campaign: <strong>${getCampaignUnlocked() - 1}</strong>/${CAMPAIGN_MAX} · TB moves: <strong>${prof.games ? Math.round(prof.totalMoves / prof.games) : 0}</strong></p>
    </div>
    <div class="sokoban-card"><h4>Bắt đầu nhanh</h4>
      <div class="sokoban-level-list">
        <button type="button" class="sk-game-btn sk-game-btn-gold" data-act="sokoban-continue">▶ Tiếp tục Level ${getCampaignUnlocked()}</button>
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
    let modeLabel = "Campaign";
    if (session.mode === "time_attack") modeLabel = "Time Attack";
    if (session.mode === "random") modeLabel = "Random Map";
    if (session.mode === "custom") modeLabel = "Custom Map";
    if (session.mode === "replay") modeLabel = "Replay";
    if (session.mode === "campaign") modeLabel = `Warehouse Level ${lv.num}/${CAMPAIGN_MAX}`;

    let timeLeft = "";
    if (session.timeAttackDeadline) {
      timeLeft = formatTime(Math.max(0, session.timeAttackDeadline - Date.now()));
    }

    const starDisplay = g.status === "won" ? renderStars(stars) : `≤${th.star3}/${th.star2}/${th.star1}`;
    const playCtx = {
      modeLabel,
      lv,
      th,
      topMode:
        session.mode === "campaign"
          ? "campaign"
          : session.mode === "time_attack"
            ? "time"
            : session.mode === "random"
              ? "random"
              : "campaign",
    };

    let winOverlay = "";
    if (g.status === "won" && session.win) {
      winOverlay = `<div class="sokoban-win" data-act="sokoban-dismiss-win" role="dialog" aria-labelledby="sk-victory-title">
        <canvas class="sk-victory-fx" data-sk-fireworks aria-hidden="true"></canvas>
        <div class="sokoban-win-card sk-glass-panel sk-victory-card">
          <p class="sk-victory-badge">★ VICTORY ★</p>
          <h3 id="sk-victory-title">Hoàn thành!</h3>
          <p class="sk-win-stars">${renderStars(session.win.stars)}</p>
          <p class="sk-victory-stats">Moves <strong>${g.moves}</strong> · Pushes <strong>${g.pushes}</strong></p>
          <p class="sk-victory-stats">Time <strong>${formatTime(session.win.elapsed)}</strong></p>
          ${session.win.isNewMoves ? "<p class='sk-gold-txt'>🏆 Kỷ lục moves mới!</p>" : ""}
          ${session.win.isNewTime ? "<p class='sk-gold-txt'>⏱ Kỷ lục thời gian!</p>" : ""}
          <div class="sk-victory-actions">
            <button type="button" class="sk-game-btn sk-game-btn-gold" data-act="sokoban-next">▶ Màn tiếp</button>
            <button type="button" class="sk-game-btn" data-act="sokoban-home">Menu</button>
          </div>
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
        ${g.status === "won" ? "" : `<button type="button" class="sk-game-btn sk-game-btn-gold sk-game-btn-next" data-act="sokoban-next"><span class="sk-btn-ico">▶</span>Next Level</button>`}
      </div>
      <p class="sk-key-hint sokoban-hint-desktop">WASD / Mũi tên · Z R H A</p>
      <p class="sk-key-hint sokoban-hint-touch">Vuốt trên bàn để di chuyển</p>
    </div>`;

    return buildGameFrame(center, playCtx, winOverlay);
  }

  function patchBoardIn(root) {
    if (!session?.game || !root) return false;
    if (session.game.status === "won" || session.win) return false;
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
    detachPlayInput();
    syncBoardCanvas(root);
    const board = root.querySelector("[data-sk-touch]");
    if (!board) return;

    const shellRoot = root.querySelector(".sokoban-shell")?.parentElement || root;

    const onKey = (e) => {
      if (!session?.game || session.game.status !== "playing") return;
      if (e.repeat) return;
      const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
      const k = map[e.key];
      if (k) {
        e.preventDefault();
        if (doMove(k)) {
          if (session?.game?.status === "won") deps.onUpdate?.();
          else patchBoardIn(shellRoot) || deps.onUpdate?.();
        }
        return;
      }
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        session.game = undoMove(session.game);
        session.undoUsed = true;
        patchBoardIn(shellRoot) || deps.onUpdate?.();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        session.game = restartGame(session.game);
        session.win = null;
        moveLockUntil = 0;
        patchBoardIn(shellRoot) || deps.onUpdate?.();
      }
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        hintDir = hintMove(session.game);
        patchBoardIn(shellRoot) || deps.onUpdate?.();
      }
    };
    playInput.key = onKey;
    window.addEventListener("keydown", onKey);

    const ac = new AbortController();
    playInput.abort = ac;
    let x0 = 0;
    let y0 = 0;
    let ptrId = null;
    board.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        ptrId = e.pointerId;
        x0 = e.clientX;
        y0 = e.clientY;
      },
      { passive: true, signal: ac.signal }
    );
    board.addEventListener(
      "pointerup",
      (e) => {
        if (ptrId != null && e.pointerId !== ptrId) return;
        ptrId = null;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < 22) return;
        let dir = null;
        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
        else dir = dy > 0 ? "down" : "up";
        if (dir && doMove(dir)) {
          if (session?.game?.status === "won") deps.onUpdate?.();
          else patchBoardIn(shellRoot) || deps.onUpdate?.();
        }
      },
      { passive: true, signal: ac.signal }
    );
    board.addEventListener(
      "pointercancel",
      () => {
        ptrId = null;
      },
      { passive: true, signal: ac.signal }
    );

    if (!clockTimer) {
      clockTimer = setInterval(() => {
        if (!session?.game) return;
        if (session.game.status === "won") return;
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

    mountVictoryFx(root);
  }

  function mountVictoryFx(root) {
    if (!session?.win || session?.game?.status !== "won") return;
    const canvas = root.querySelector("[data-sk-fireworks]");
    if (!canvas || canvas.dataset.skFxOn) return;
    canvas.dataset.skFxOn = "1";
    startVictoryFireworks(canvas);
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
      doMove(path[i], { ignoreCooldown: true });
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
      pickCampaignLevel = getCampaignUnlocked();
      pickCampaignTier = getCampaignTier(pickCampaignLevel).id;
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
      topMode = el?.dataset?.mode || "campaign";
      if (topMode === "time") return handleAction("sokoban-start-time");
      if (topMode === "random") return handleAction("sokoban-start-random");
      homeTab = "classic";
      return "sokoban-home";
    }
    if (act === "sokoban-continue") {
      pickCampaignLevel = getCampaignUnlocked();
      pickCampaignTier = getCampaignTier(pickCampaignLevel).id;
      startSession(getCampaignLevel(pickCampaignLevel), "campaign");
      return "sokoban-play";
    }
    if (act === "sokoban-pick-campaign") {
      const num = Number(el?.dataset?.num);
      if (!num) return null;
      pickCampaignLevel = num;
      pickCampaignTier = getCampaignTier(num).id;
      deps.onUpdate?.();
      return null;
    }
    if (act === "sokoban-pick-tier") {
      const tierId = el?.dataset?.tier || "easy";
      pickCampaignTier = tierId;
      const t = CAMPAIGN_TIERS.find((x) => x.id === tierId);
      if (t) {
        if (pickCampaignLevel < t.start || pickCampaignLevel > t.end) pickCampaignLevel = t.start;
      }
      deps.onUpdate?.();
      return null;
    }
    if (act === "sokoban-play-picked") {
      const num = pickCampaignLevel;
      if (num > getCampaignUnlocked()) {
        toast?.("Màn chưa mở — clear màn trước trước");
        return null;
      }
      startSession(getCampaignLevel(num), "campaign");
      return "sokoban-play";
    }
    if (act === "sokoban-play-campaign") {
      const num = Number(el?.dataset?.num);
      if (!num || num < 1 || num > CAMPAIGN_MAX) return null;
      if (num > getCampaignUnlocked()) {
        toast?.("Màn chưa mở — clear màn trước trước");
        return null;
      }
      startSession(getCampaignLevel(num), "campaign");
      return "sokoban-play";
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
      startSession(getCampaignLevel(getCampaignUnlocked()), "campaign");
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
      const v = validateLevelRows(customMapText.split("\n").filter((r) => r.trim()));
      if (!v.ok) return toast?.(v.reason || "Map không hợp lệ");
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
      if (session.game.status !== "won" && !session.win) {
        toast?.("Clear hết thùng vào đích trước!");
        return null;
      }
      session.win = null;
      const cur = session.game.level.num;
      if (session.mode === "campaign" && cur < CAMPAIGN_MAX) {
        startSession(getCampaignLevel(cur + 1), "campaign");
        return "sokoban-play";
      }
      if (session.mode === "campaign" && cur >= CAMPAIGN_MAX) {
        toast?.("Chúc mừng — hoàn thành 100 màn!");
        return "sokoban-home";
      }
      if (session.mode === "random" || session.mode === "time_attack") {
        const next = session.mode === "time_attack" ? getRandomLevel() : getRandomLevel();
        startSession(next, session.mode, session.mode === "time_attack" ? { timeAttackScore: session.timeAttackScore || 0 } : {});
        return "sokoban-play";
      }
      toast?.("Hết màn!");
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
          doMove(session.solution[replayIdx], { ignoreCooldown: true });
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
    mountVictoryFx,
    clearMatch,
    getMatch,
    patchBoardIn,
  };
}
