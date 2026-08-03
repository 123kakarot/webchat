import {
  STONE_EMPTY,
  STONE_X,
  STONE_O,
  createMatchState,
  applyMove,
  cloneBoard,
} from "./caro-engine.js";
import { pickAiMove, aiThinkDelay } from "./caro-ai.js";

const STORAGE_HISTORY = "caro-local-history";
const STORAGE_STATS = "caro-local-stats";
const STORAGE_SOUND = "caro-sound";
const STORAGE_THEME = "caro-board-theme";

/** @type {{ id: string, title: string, sub: string, status: "live"|"soon", icon: string, art: string }[]} */
const BOARD_GAMES = [
  { id: "caro", title: "Cờ Caro", sub: "AI · 2 người · online realtime", status: "live", icon: "⊞", art: "/caro/games/caro.png" },
  { id: "xiangqi", title: "Cờ tướng", sub: "Xiangqi · cờ Trung Hoa", status: "soon", icon: "帥", art: "/caro/games/xiangqi.svg" },
  { id: "chess", title: "Cờ vua", sub: "Chess · cờ quốc tế", status: "soon", icon: "♔", art: "/caro/games/chess.svg" },
  { id: "go", title: "Cờ vây", sub: "Go · Baduk · Weiqi", status: "soon", icon: "⚫", art: "/caro/games/go.svg" },
  { id: "checkers", title: "Cờ đam", sub: "Checkers · damka", status: "soon", icon: "⛀", art: "/caro/games/checkers.svg" },
  { id: "shogi", title: "Shogi", sub: "Cờ Nhật Bản", status: "soon", icon: "☖", art: "/caro/games/shogi.svg" },
];

const GAME_ART = {
  uno: "/caro/games/uno.jpg",
};

function gameById(id) {
  return BOARD_GAMES.find((x) => x.id === id) || null;
}

function gameArtUrl(id) {
  return gameById(id)?.art || GAME_ART[id] || `/caro/games/${id}.png`;
}

function renderGameThumb(id, variant = "card") {
  const url = gameArtUrl(id);
  const title = gameById(id)?.title || (id === "uno" ? "UNO" : id);
  const safeTitle = String(title).replace(/"/g, "&quot;");
  return `<span class="board-game-thumb thumb-${variant}" role="img" aria-label="${safeTitle}">
    <img src="${url}" alt="" loading="lazy" decoding="async" />
  </span>`;
}

/**
 * @param {{
 *  root: HTMLElement,
 *  getPlayerName: () => string,
 *  ensureLogin: () => Promise<boolean>|boolean,
 *  socket: import("socket.io-client").Socket | null,
 *  onBackHub: () => void,
 *  onShareToChat?: (text: string) => void,
 * }} ctx
 */
export function mountCaroApp(ctx) {
  const root = ctx.root;
  /** @type {any} */
  let view = "board-hub";
  let gameSoonId = "chess";
  /** @type {any} */
  let localMatch = null;
  /** @type {any} */
  let onlineRoom = null;
  let aiLevel = "medium";
  let aiBusy = false;
  let timerId = null;
  let replay = null;
  let soundOn = localStorage.getItem(STORAGE_SOUND) !== "0";
  let boardTheme = localStorage.getItem(STORAGE_THEME) || "neon";
  let publicRooms = [];
  let leaderboard = [];
  let serverHistory = [];
  let toastTimer = null;
  let quickWaiting = false;
  let caroRoomTab = "all";
  let caroLbTab = "all";

  const audio = {
    place: null,
    win: null,
    tick: null,
  };

  function beep(freq = 520, ms = 70, type = "sine", vol = 0.04) {
    if (!soundOn) return;
    try {
      const ctxA = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctxA.createOscillator();
      const g = ctxA.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(ctxA.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctxA.close();
      }, ms);
    } catch (_) {}
  }

  function toast(msg) {
    let el = root.querySelector(".caro-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "caro-toast";
      root.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function loadLocalHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "[]");
    } catch {
      return [];
    }
  }

  function saveLocalHistory(entry) {
    const list = loadLocalHistory();
    list.unshift(entry);
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list.slice(0, 50)));
  }

  function loadStats() {
    try {
      return (
        JSON.parse(localStorage.getItem(STORAGE_STATS) || "null") || {
          played: 0,
          win: 0,
          loss: 0,
          draw: 0,
          streak: 0,
          elo: 1000,
          aiHardWins: 0,
        }
      );
    } catch {
      return { played: 0, win: 0, loss: 0, draw: 0, streak: 0, elo: 1000, aiHardWins: 0 };
    }
  }

  function saveStats(s) {
    localStorage.setItem(STORAGE_STATS, JSON.stringify(s));
  }

  function updateStats(result, meta = {}) {
    const s = loadStats();
    s.played++;
    if (result === "win") {
      s.win++;
      s.streak++;
      s.elo += 16;
      if (meta.aiLevel === "hard" || meta.aiLevel === "impossible") s.aiHardWins++;
    } else if (result === "loss") {
      s.loss++;
      s.streak = 0;
      s.elo = Math.max(100, s.elo - 12);
    } else {
      s.draw++;
      s.streak = 0;
    }
    saveStats(s);
  }

  function playerName() {
    return String(ctx.getPlayerName?.() || "").trim() || "Bạn";
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function startTimerUi() {
    stopTimer();
    timerId = setInterval(() => {
      const tEl = root.querySelector("[data-caro-timer]");
      if (!tEl) return;
      const deadline =
        localMatch?.turnDeadline || onlineRoom?.turnDeadline || 0;
      if (!deadline) {
        tEl.textContent = "--";
        return;
      }
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      tEl.textContent = String(left);
      if (left <= 5 && left > 0) beep(880, 40, "square", 0.03);
      if (localMatch && localMatch.status === "playing" && left <= 0) {
        // local timeout -> current player loses
        const loser = localMatch.turn;
        const winnerStone = loser === STONE_X ? STONE_O : STONE_X;
        endLocal(winnerStone === STONE_X ? "x" : "o", "timeout");
      }
    }, 250);
  }

  async function requireLogin() {
    const ok = await ctx.ensureLogin?.();
    return Boolean(ok);
  }

  function sockEmit(event, payload) {
    return new Promise((resolve) => {
      const s = ctx.socket;
      if (!s?.connected) {
        resolve({ ok: false, reason: "Chưa kết nối server." });
        return;
      }
      s.timeout(12000).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, reason: "Timeout server." });
        else resolve(res || { ok: false });
      });
    });
  }

  function bindSocket() {
    const s = ctx.socket;
    if (!s || s.__caroBound) return;
    s.__caroBound = true;
    s.on("caro:state", (room) => {
      onlineRoom = room;
      if (view === "lobby" || view === "online-game" || view === "create" || view === "join") {
        if (room.status === "playing" || room.status === "finished" || room.status === "draw") {
          view = "online-game";
        } else view = "lobby";
        render();
      }
    });
    s.on("caro:quick_matched", ({ room }) => {
      quickWaiting = false;
      onlineRoom = room;
      view = "online-game";
      toast("Đã ghép trận!");
      render();
    });
  }

  function endLocal(winnerSide, reason = "win") {
    if (!localMatch || localMatch.status !== "playing") return;
    localMatch.status = reason === "draw" ? "draw" : "finished";
    localMatch.winnerSide = winnerSide;
    localMatch.endReason = reason;
    const meIsX = localMatch.meStone === STONE_X;
    let result = "draw";
    if (winnerSide === "x") result = meIsX ? "win" : localMatch.modeKind === "local" ? "draw" : "loss";
    if (winnerSide === "o") result = !meIsX ? "win" : localMatch.modeKind === "local" ? "draw" : "loss";
    if (reason === "draw") result = "draw";
    // For local PVP both on same machine, don't punish stats hard
    if (localMatch.modeKind === "ai") {
      if (winnerSide === "draw" || reason === "draw") updateStats("draw");
      else if ((meIsX && winnerSide === "x") || (!meIsX && winnerSide === "o")) {
        updateStats("win", { aiLevel: localMatch.aiLevel });
      } else updateStats("loss", { aiLevel: localMatch.aiLevel });
    }
    saveLocalHistory({
      id: crypto.randomUUID(),
      mode: localMatch.modeKind,
      aiLevel: localMatch.aiLevel,
      size: localMatch.size,
      rule: localMatch.mode,
      moves: localMatch.moves.slice(),
      winnerSide,
      reason,
      at: Date.now(),
      players: localMatch.players,
    });
    beep(winnerSide ? 660 : 300, 160, "triangle", 0.05);
    const boardEl = root.querySelector(".caro-board");
    boardEl?.classList.add("shake");
    setTimeout(() => boardEl?.classList.remove("shake"), 500);
    render();
  }

  function startLocal(opts) {
    const state = createMatchState({
      size: opts.size || 15,
      mode: opts.mode || "freestyle",
      turnMs: (opts.turnSec || 60) * 1000,
    });
    localMatch = {
      ...state,
      modeKind: opts.kind, // local | ai
      aiLevel: opts.aiLevel || "medium",
      meStone: STONE_X,
      players:
        opts.kind === "ai"
          ? { x: playerName(), o: `AI (${opts.aiLevel || "medium"})` }
          : { x: "Người chơi X", o: "Người chơi O" },
      winnerSide: null,
      endReason: null,
    };
    onlineRoom = null;
    view = "local-game";
    aiBusy = false;
    startTimerUi();
    render();
  }

  async function maybeAiMove() {
    if (!localMatch || localMatch.modeKind !== "ai" || localMatch.status !== "playing") return;
    if (localMatch.turn !== STONE_O || aiBusy) return;
    aiBusy = true;
    render();
    try {
      const delay = aiThinkDelay(localMatch.aiLevel);
      await new Promise((r) => setTimeout(r, delay));
      if (!localMatch || localMatch.status !== "playing" || localMatch.turn !== STONE_O) return;
      const move = pickAiMove(localMatch.board, STONE_O, localMatch.aiLevel, localMatch.mode);
      if (move) doLocalMove(move.r, move.c, { fromAi: true });
      else render();
    } finally {
      aiBusy = false;
      render();
    }
  }

  function doLocalMove(r, c, opts = {}) {
    if (!localMatch || localMatch.status !== "playing") return;
    if (aiBusy && !opts.fromAi) return;
    if (
      localMatch.modeKind === "ai" &&
      !opts.fromAi &&
      localMatch.turn !== localMatch.meStone
    )
      return;
    const res = applyMove(localMatch, r, c);
    if (!res.ok) {
      toast(res.reason || "Không đánh được");
      return;
    }
    localMatch.board = res.board;
    localMatch.moves.push(res.move);
    localMatch.turn = res.nextTurn;
    localMatch.turnDeadline = Date.now() + localMatch.turnMs;
    beep(480, 60);
    if (res.win) {
      localMatch.winLine = res.line;
      endLocal(res.move.stone === STONE_X ? "x" : "o", "win");
      return;
    }
    if (res.draw) {
      endLocal(null, "draw");
      return;
    }
    render();
    maybeAiMove();
  }

  function cellSize(size) {
    const w = Math.min(window.innerWidth - 48, 560);
    return Math.max(18, Math.floor(w / size));
  }

  function renderBoard(board, opts = {}) {
    const size = board.length;
    const cell = opts.cell || cellSize(size);
    const winSet = new Set((opts.winLine || []).map(([r, c]) => `${r},${c}`));
    const disabled = Boolean(opts.disabled);
    let html = `<div class="caro-board theme-${boardTheme}" style="--cell:${cell}px;grid-template-columns:repeat(${size}, var(--cell))">`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = board[r][c];
        const win = winSet.has(`${r},${c}`) ? " win" : "";
        html += `<button type="button" class="caro-cell${win}" data-r="${r}" data-c="${c}" ${
          disabled || v !== STONE_EMPTY ? "disabled" : ""
        }>`;
        if (v === STONE_X) html += `<span class="caro-stone x"></span>`;
        if (v === STONE_O) html += `<span class="caro-stone o"></span>`;
        html += `</button>`;
      }
    }
    html += `</div>`;
    return html;
  }

  function renderWebchatHubNav(activeId) {
    const links = [
      { id: "home", label: "Trang chủ", ico: "⌂", act: "back-hub" },
      { id: "chat", label: "Chat", ico: "💬", act: "hub-open-chat" },
      { id: "friends", label: "Bạn bè", ico: "◎", act: "hub-stub" },
      { id: "board", label: "Board Game", ico: "🎲", act: "board-portal" },
      { id: "books", label: "Sách", ico: "📖", act: "hub-stub" },
      { id: "lib", label: "Thư viện", ico: "📚", act: "hub-stub" },
      { id: "files", label: "Tệp của tôi", ico: "📁", act: "hub-stub" },
      { id: "settings", label: "Cài đặt", ico: "⚙", act: "hub-stub" },
    ];
    return links
      .map(
        (l) =>
          `<button type="button" class="caro-dash-menu-item${activeId === l.id ? " is-active" : ""}" data-act="${l.act}">
            <span class="ico">${l.ico}</span> ${l.label}
          </button>`
      )
      .join("");
  }

  function renderBoardHub() {
    const online = dashOnlineCount();
    const lbSlice = (leaderboard || []).slice(0, 5);
    const level = Math.max(1, Math.min(99, Math.floor((loadStats().elo - 880) / 28)));
    const allGames = [
      ...BOARD_GAMES.map((g) => ({
        ...g,
        suggest: g.id === "caro",
        rating: g.id === "caro" ? "4.9" : "—",
        players: g.id === "caro" ? online : "—",
      })),
      { id: "uno", title: "UNO", sub: "Party · bài", status: "soon", icon: "🃏", suggest: false, rating: "4.7", players: "42", art: "/caro/games/uno.jpg" },
    ];

    return `
      <div class="caro-dash caro-dash-hub caro-dash-discover">
        <aside class="caro-dash-nav" aria-label="WebChat Hub">
          <div class="caro-dash-logo">
            <span class="caro-dash-logo-ico" aria-hidden="true">◈</span>
            <span>WebChat<br><small class="caro-dash-logo-sub">Board Game Hub</small></span>
          </div>
          <nav class="caro-dash-menu">${renderWebchatHubNav("board")}</nav>
          <div class="caro-nav-join-card">
            <div class="caro-avatar-stack">${renderAvatarStack(3)}</div>
            <p><strong>${online}</strong> đang online</p>
            <button type="button" class="caro-nav-join-btn" data-act="back-hub">Tham gia ngay</button>
          </div>
          <div class="caro-dash-nav-foot">
            <button type="button" class="caro-dash-link" data-act="back-hub">← Về Hub chính</button>
          </div>
        </aside>

        <div class="caro-dash-main">
          <header class="caro-dash-header">
            <div class="caro-breadcrumb">Board Game <span>/ Khám phá</span></div>
            <div class="caro-dash-header-user">
              <button type="button" class="caro-dash-bell" data-act="caro-notify" aria-label="Thông báo">
                🔔<span class="caro-bell-badge">3</span>
              </button>
              <div class="caro-dash-user-chip">
                <span class="caro-dash-avatar">${escapeHtml(playerInitial())}</span>
                <span class="caro-dash-user-meta">
                  <strong>${escapeHtml(playerName())}</strong>
                  <span class="caro-status-online">● Online</span>
                </span>
              </div>
            </div>
          </header>

          <div class="caro-dash-scroll caro-scroll-thin">
            <section class="caro-dash-hero caro-hub-hero-lite caro-reveal" style="--i:0">
              <div class="caro-dash-hero-text">
                <p class="caro-dash-kicker">Chọn game · Vào sảnh riêng · Rồi mới chơi</p>
                <h1 class="caro-hub-title">BOARD <em>GAME</em></h1>
                <p class="caro-dash-lead">Trang này chỉ <strong>giới thiệu &amp; gợi ý</strong>. Bấm vào từng game để mở sảnh (Quick Match, AI, phòng… nằm trong sảnh đó).</p>
              </div>
              <div class="caro-dash-hero-art caro-hub-hero-icons" aria-hidden="true">
                <span>⊞</span><span>♔</span><span>帥</span><span>⚫</span>
              </div>
            </section>

            <section class="caro-dash-card caro-reveal" style="--i:1">
              <div class="caro-dash-card-head">
                <h2>Gợi ý cho bạn</h2>
                <span class="caro-muted" style="font-size:0.75rem">Mới · phổ biến</span>
              </div>
              <div class="board-suggest-row">
                ${allGames
                  .filter((g) => g.suggest)
                  .map(
                    (g) => `
                  <article class="board-suggest-card is-live">
                    <span class="board-feature-hot">GỢI Ý</span>
                    ${renderGameThumb(g.id, "suggest")}
                    <h3>${escapeHtml(g.title)}</h3>
                    <p class="caro-muted">${escapeHtml(g.sub)}</p>
                    <p class="board-feature-meta">★ ${g.rating} · ${g.players} đang chơi</p>
                    <button type="button" class="caro-btn primary glow-cyan" data-pick-game="${g.id}">Vào sảnh game</button>
                  </article>`
                  )
                  .join("")}
                <div class="board-suggest-tip">
                  <p><strong>Mẹo:</strong> Cờ Caro có AI, local 2 người, Quick Match và phòng online — tất cả trong sảnh Cờ Caro, không chơi trực tiếp tại đây.</p>
                </div>
              </div>
            </section>

            <section class="caro-dash-card caro-reveal" style="--i:2">
              <div class="caro-dash-card-head"><h2>Tất cả game</h2></div>
              <div class="board-hub-grid">
                ${allGames
                  .map(
                    (g) => `
                  <button type="button" class="board-hub-game ${g.status === "live" ? "is-live" : "is-soon"}" data-pick-game="${g.id}">
                    <span class="board-game-shine"></span>
                    ${renderGameThumb(g.id, "hub")}
                    <span class="board-hub-game-body">
                    <span class="board-game-title">${escapeHtml(g.title)}</span>
                    <span class="board-game-sub">${escapeHtml(g.sub)}</span>
                    <span class="board-game-badge">${g.status === "live" ? "Vào sảnh" : "Sắp ra mắt"}</span>
                    </span>
                  </button>`
                  )
                  .join("")}
              </div>
            </section>
          </div>
        </div>

        <aside class="caro-dash-rail caro-scroll-thin caro-reveal" style="--i:1">
          <section class="caro-dash-card">
            <h2>Cộng đồng</h2>
            <p class="caro-muted" style="font-size:0.82rem;line-height:1.5">Xếp hạng &amp; phòng online cập nhật khi bạn vào sảnh từng game (ví dụ Cờ Caro).</p>
          </section>
          <section class="caro-dash-card">
            <div class="caro-dash-card-head"><h2>Bảng xếp hạng</h2></div>
            <ol class="caro-lb-list">
              ${
                lbSlice.length
                  ? lbSlice
                      .map(
                        (row, i) => `<li class="caro-lb-row rank-${i + 1}">
                          <span class="caro-lb-rank">${i + 1}</span>
                          <span class="caro-lb-name">${escapeHtml(row.name || "—")}</span>
                          <span class="caro-lb-elo">${row.elo ?? "—"}</span>
                        </li>`
                      )
                      .join("")
                  : `<li class="caro-empty">Vào Cờ Caro để xem chi tiết.</li>`
              }
            </ol>
          </section>
        </aside>
      </div>`;
  }

  function renderGameSoon() {
    const g =
      BOARD_GAMES.find((x) => x.id === gameSoonId) ||
      (gameSoonId === "uno"
        ? { title: "UNO", sub: "Party · online", icon: "🃏" }
        : { title: "Game", sub: "", icon: "🎲" });
    return `
      <div class="caro-launcher" style="max-width:520px;margin-top:2rem">
        <section class="caro-panel board-soon-panel">
          <div class="board-soon-icon" aria-hidden="true">${g.icon}</div>
          <h2>${escapeHtml(g.title)}</h2>
          <p class="caro-muted">${escapeHtml(g.sub)}</p>
          <p style="margin-top:0.75rem;line-height:1.55">Game này đang được xây dựng trong sảnh Board Game. Bạn có thể chơi <strong>Cờ Caro</strong> ngay trong lúc chờ.</p>
          <div class="caro-form-actions" style="margin-top:1.25rem">
            <button type="button" class="caro-btn primary" data-act="open-caro">Vào Cờ Caro</button>
            <button type="button" class="caro-btn ghost" data-act="board-portal">← Sảnh game</button>
          </div>
        </section>
      </div>`;
  }

  function playerInitial() {
    const n = playerName();
    return (n[0] || "B").toUpperCase();
  }

  function localMatchResult(h) {
    if (h.reason === "draw" || h.winnerSide == null) return { label: "Hòa", cls: "draw" };
    if (h.mode === "ai") {
      return h.winnerSide === "x" ? { label: "Thắng", cls: "win" } : { label: "Thua", cls: "loss" };
    }
    return { label: "Local", cls: "neutral" };
  }

  function filteredPublicRooms() {
    const list = publicRooms || [];
    if (caroRoomTab === "wait") return list.filter((r) => (r.players?.length || 0) < 2);
    if (caroRoomTab === "play") return list.filter((r) => r.status === "playing");
    return list;
  }

  function dashOnlineCount() {
    const base = 18 + (publicRooms?.length || 0) * 3 + (leaderboard?.length || 0) * 2;
    return base + (ctx.socket?.connected ? 12 : 0);
  }

  function dashOnlinePlayersPreview() {
    const activities = [
      "Đang chơi Cờ Caro",
      "Trong phòng",
      "Quick Match",
      "Chơi với AI",
      "Online",
    ];
    const fromLb = (leaderboard || []).map((r) => r.name).filter(Boolean);
    const fallbacks = ["Minh Anh", "Hoàng", "Lan", "Tuấn", "Vy"];
    return Array.from({ length: 5 }, (_, i) => {
      const name = fromLb[i] || fallbacks[i];
      return {
        name,
        act: activities[i % activities.length],
        initial: (name[0] || "?").toUpperCase(),
        hue: 200 + i * 38,
      };
    });
  }

  function renderOnlinePlayersRail() {
    return dashOnlinePlayersPreview()
      .map(
        (p) => `<li class="caro-online-player">
          <span class="caro-dash-avatar sm" style="--av-hue:${p.hue}">${escapeHtml(p.initial)}</span>
          <span class="caro-online-player-meta">
            <strong>${escapeHtml(p.name)}</strong>
            <span>${p.act}</span>
          </span>
          <span class="caro-online-dot" aria-hidden="true"></span>
        </li>`
      )
      .join("");
  }

  function renderAvatarStack(max = 3) {
    return dashOnlinePlayersPreview()
      .slice(0, max)
      .map(
        (p) =>
          `<span class="caro-stack-avatar" style="--av-hue:${p.hue}">${escapeHtml(p.initial)}</span>`
      )
      .join("");
  }

  function heroBoardSvg() {
    return `<svg class="caro-hero-board" viewBox="0 0 200 160" aria-hidden="true">
      <defs>
        <filter id="caroHeroGlow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g transform="translate(28 24)" opacity="0.4">
        <path d="M0 80 L72 20 L144 80 L72 140 Z" fill="none" stroke="#3b82f6" stroke-width="1"/>
        ${[0, 1, 2, 3, 4].map((i) => `<line x1="${i * 18}" y1="0" x2="${i * 18 + 36}" y2="120" stroke="#2563eb" stroke-width="0.5" opacity="0.6"/>`).join("")}
      </g>
      <circle cx="118" cy="72" r="14" fill="#5ee7ff" filter="url(#caroHeroGlow)" class="caro-hero-stone s1"/>
      <text x="118" y="77" text-anchor="middle" fill="#031018" font-size="14" font-weight="700">X</text>
      <circle cx="142" cy="96" r="14" fill="#ff7ab8" filter="url(#caroHeroGlow)" class="caro-hero-stone s2"/>
      <text x="142" y="101" text-anchor="middle" fill="#1a0510" font-size="14" font-weight="700">O</text>
      <circle cx="96" cy="96" r="14" fill="#5ee7ff" filter="url(#caroHeroGlow)" class="caro-hero-stone s3"/>
      <text x="96" y="101" text-anchor="middle" fill="#031018" font-size="14" font-weight="700">X</text>
    </svg>`;
  }

  function renderCaroHome() {
    const stats = loadStats();
    const hist = loadLocalHistory().slice(0, 4);
    const rooms = filteredPublicRooms().slice(0, 5);
    const winRate = stats.played ? Math.round((stats.win / stats.played) * 100) : 0;
    const level = Math.max(1, Math.min(99, Math.floor((stats.elo - 880) / 28)));
    const xpPct = Math.min(100, (stats.played * 17 + stats.win * 9) % 100);
    const lbSlice = (leaderboard || []).slice(0, 5);
    const achPlayed = Math.min(100, stats.played * 20);
    const achAi = Math.min(100, stats.aiHardWins * 25);
    const achStreak = Math.min(100, stats.streak * 20);

    const liveMatches = (publicRooms || []).filter((r) => r.status === "playing").length;
    const online = dashOnlineCount();
    const topStreak = stats.streak;

    const roomTabs = [
      { id: "all", label: "Tất cả" },
      { id: "wait", label: "Chờ vào" },
      { id: "play", label: "Đang chơi" },
    ];

    return `
      <div class="caro-dash caro-dash-play">
        <aside class="caro-dash-nav" aria-label="WebChat Hub">
          <div class="caro-dash-logo">
            <span class="caro-dash-logo-ico" aria-hidden="true">⊞</span>
            <span>Cờ Caro<br><small class="caro-dash-logo-sub">Sảnh chơi</small></span>
          </div>
          <nav class="caro-dash-menu">${renderWebchatHubNav("board")}</nav>
          <label class="caro-dash-sound">
            <input type="checkbox" data-act="sound" ${soundOn ? "checked" : ""} />
            <span>Âm thanh</span>
          </label>
          <div class="caro-nav-join-card">
            <div class="caro-avatar-stack">${renderAvatarStack(3)}</div>
            <p><strong>${dashOnlineCount()}</strong> đang online</p>
            <button type="button" class="caro-nav-join-btn" data-act="quick">Quick Match</button>
          </div>
          <div class="caro-dash-nav-foot">
            <button type="button" class="caro-dash-link" data-act="board-portal">← Sảnh Board Game</button>
            <button type="button" class="caro-dash-link" data-act="back-hub">← Hub chính</button>
          </div>
        </aside>

        <div class="caro-dash-main">
          <header class="caro-dash-header">
            <div class="caro-breadcrumb">
              <button type="button" class="caro-crumb-link" data-act="board-portal">Board Game</button>
              <span>/ Cờ Caro</span>
            </div>
            <div class="caro-dash-header-user">
              <button type="button" class="caro-dash-bell" aria-label="Thông báo" data-act="caro-notify">
                🔔<span class="caro-bell-badge">3</span>
              </button>
              <div class="caro-dash-user-chip">
                <span class="caro-dash-avatar">${escapeHtml(playerInitial())}</span>
                <span class="caro-dash-user-meta">
                  <strong>${escapeHtml(playerName())}</strong>
                  <span class="caro-status-online">● Online · LV ${level}</span>
                </span>
              </div>
            </div>
          </header>

          <div class="caro-dash-scroll caro-scroll-thin">
            <section class="caro-dash-hero caro-reveal" style="--i:0">
              <div class="caro-dash-hero-text">
                <p class="caro-dash-kicker">Trí tuệ · Chiến thuật · Thư giãn</p>
                <h1 class="caro-title-gradient">CỜ CARO</h1>
                <p class="caro-dash-lead">Chơi tại đây — AI, local, Quick Match &amp; phòng online.</p>
                <button type="button" class="caro-dash-play-now" data-act="quick">
                  <span class="caro-dash-play-glow" aria-hidden="true"></span>
                  ${quickWaiting ? "Đang ghép…" : "Chơi ngay"}
                </button>
              </div>
              <div class="caro-dash-hero-art">
                <div class="caro-hero-orbit" aria-hidden="true"></div>
                ${heroBoardSvg()}
              </div>
            </section>

            <div class="caro-hub-stats caro-reveal" style="--i:1">
              <div class="caro-hub-stat tint-cyan">
                <span class="stat-ico" aria-hidden="true">👥</span>
                <div><span>Người online</span><strong>${online}</strong></div>
              </div>
              <div class="caro-hub-stat tint-blue">
                <span class="stat-ico" aria-hidden="true">⚔</span>
                <div><span>Trận đang diễn ra</span><strong>${liveMatches}</strong></div>
              </div>
              <div class="caro-hub-stat tint-gold">
                <span class="stat-ico" aria-hidden="true">🏆</span>
                <div><span>Top hôm nay</span><strong>${escapeHtml(lbSlice[0]?.name || "—")}</strong></div>
              </div>
              <div class="caro-hub-stat tint-purple">
                <span class="stat-ico" aria-hidden="true">🔥</span>
                <div><span>Chuỗi thắng cao</span><strong>${topStreak}</strong></div>
              </div>
            </div>

            <div class="caro-mode-row caro-reveal" style="--i:1">
              <article class="caro-mode-card mode-blue">
                <span class="tile-ico">⚡</span>
                <h3>Quick Match</h3>
                <p>Tìm đối thủ ngay</p>
                <button type="button" class="caro-mode-play" data-act="quick">Chơi ngay</button>
              </article>
              <article class="caro-mode-card mode-purple">
                <span class="tile-ico">🤖</span>
                <h3>Chơi với AI</h3>
                <p>4 cấp độ khó</p>
                <button type="button" class="caro-mode-play" data-act="ai">Chơi ngay</button>
              </article>
              <article class="caro-mode-card mode-teal">
                <span class="tile-ico">👥</span>
                <h3>Chơi Local</h3>
                <p>2 người / 1 máy</p>
                <button type="button" class="caro-mode-play" data-act="local">Chơi ngay</button>
              </article>
            </div>

            <section class="caro-dash-card caro-reveal" style="--i:2">
              <div class="caro-dash-card-head"><h2>Game nổi bật</h2></div>
              <div class="board-featured-scroll caro-scroll-thin">
                <article class="board-feature-card is-live">
                  <span class="board-feature-hot">HOT</span>
                  ${renderGameThumb("caro", "featured")}
                  <span class="board-game-title">Cờ Caro</span>
                  <span class="board-feature-meta"><span class="stars">★★★★★</span> 4.9 · ${online} online</span>
                  <button type="button" class="caro-btn sm primary glow-cyan" data-act="quick">Chơi ngay</button>
                </article>
                <button type="button" class="board-feature-card is-soon tint-chess" data-pick-game="chess">
                  ${renderGameThumb("chess", "featured")}
                  <span class="board-game-title">Cờ vua</span>
                  <span class="board-feature-meta"><span class="stars">★★★★☆</span> 4.8 · 14 online</span>
                </button>
                <button type="button" class="board-feature-card is-soon tint-uno" data-pick-game="uno">
                  ${renderGameThumb("uno", "featured")}
                  <span class="board-game-title">UNO</span>
                  <span class="board-feature-meta"><span class="stars">★★★★☆</span> 4.6 · 8 online</span>
                </button>
              </div>
            </section>

            <div class="caro-dash-quick caro-dash-quick-sub caro-reveal" style="--i:2">
              <button type="button" class="caro-quick-tile tile-gold" data-act="create">
                <span class="tile-shine"></span><span class="tile-ico">＋</span>
                <span class="tile-title">Tạo phòng</span><span class="tile-sub">Tùy luật &amp; timer</span>
              </button>
              <button type="button" class="caro-quick-tile tile-blue" data-act="join">
                <span class="tile-shine"></span><span class="tile-ico">⎈</span>
                <span class="tile-title">Tham gia</span><span class="tile-sub">Nhập mã phòng</span>
              </button>
            </div>

            <div class="caro-dash-mid caro-reveal" style="--i:3">
              <section class="caro-dash-card caro-dash-rooms">
                <div class="caro-dash-card-head">
                  <h2>Phòng game công khai</h2>
                  <button type="button" class="caro-dash-link" data-act="refresh-rooms">Làm mới</button>
                </div>
                <div class="caro-dash-tabs" role="tablist">
                  ${roomTabs
                    .map(
                      (t) =>
                        `<button type="button" class="caro-dash-tab${caroRoomTab === t.id ? " is-active" : ""}" data-act="room-tab" data-tab="${t.id}">${t.label}</button>`
                    )
                    .join("")}
                </div>
                <div class="caro-dash-room-list">
                  ${
                    rooms.length
                      ? rooms
                          .map((r) => {
                            const full = (r.players?.length || 0) >= 2;
                            const status =
                              r.status === "playing"
                                ? "Đang chơi"
                                : full
                                  ? "Sẵn sàng"
                                  : "Chờ vào";
                            return `<article class="caro-room-row">
                              <div>
                                <strong>${escapeHtml(r.name || "Phòng Caro")}</strong>
                                <div class="caro-muted">${r.size}x${r.size} · ${escapeHtml(r.mode || "freestyle")} · ${status}</div>
                              </div>
                              <div class="caro-room-meta">
                                <span>${r.players?.length || 0}/2</span>
                                <button type="button" class="caro-btn sm" data-join-code="${r.code}">Tham gia</button>
                              </div>
                            </article>`;
                          })
                          .join("")
                      : `<p class="caro-empty">Chưa có phòng — tạo phòng mới hoặc Quick Match.</p>`
                  }
                </div>
                <button type="button" class="caro-btn ghost" data-act="join" style="margin-top:0.65rem">Nhập mã phòng</button>
              </section>

              <section class="caro-dash-card caro-dash-recent">
                <div class="caro-dash-card-head">
                  <h2>Trận đấu gần đây</h2>
                  <button type="button" class="caro-dash-link" data-act="history">Xem tất cả</button>
                </div>
                <div class="caro-dash-match-list">
                  ${
                    hist.length
                      ? hist
                          .map((h) => {
                            const res = localMatchResult(h);
                            return `<article class="caro-match-row">
                              <div>
                                <strong>${h.mode === "ai" ? "AI" : "Local"} · ${h.size}x${h.size}</strong>
                                <div class="caro-muted">${new Date(h.at).toLocaleString("vi")}</div>
                              </div>
                              <span class="caro-result ${res.cls}">${res.label}</span>
                              <button type="button" class="caro-btn ghost sm" data-replay="${h.id}">Replay</button>
                            </article>`;
                          })
                          .join("")
                      : `<p class="caro-empty">Chưa có trận — bắt đầu với AI hoặc Quick Match.</p>`
                  }
                </div>
              </section>
            </div>

            <div class="caro-dash-bottom caro-reveal" style="--i:3">
              <section class="caro-dash-card caro-dash-rules">
                <h2>Luật chơi nhanh</h2>
                <ul>
                  <li>X đi trước, O đi sau (AI luôn là O).</li>
                  <li>Thắng khi có 5 quân liên tiếp (ngang, dọc, chéo).</li>
                  <li>Bàn 10×10, 15×15 hoặc 19×19; freestyle / tournament.</li>
                  <li>Online: timer mỗi lượt, xin hòa, đầu hàng, rematch.</li>
                </ul>
              </section>
              <section class="caro-dash-card caro-dash-ach" id="caro-achievements">
                <div class="caro-dash-card-head">
                  <h2>Thành tựu</h2>
                </div>
                <div class="caro-ach-grid">
                  <div class="caro-ach-item">
                    <span class="caro-ach-ico">⭐</span>
                    <span class="caro-ach-name">Tân binh</span>
                    <div class="caro-ach-bar"><span style="width:${achPlayed}%"></span></div>
                  </div>
                  <div class="caro-ach-item">
                    <span class="caro-ach-ico">👑</span>
                    <span class="caro-ach-name">Thủ AI</span>
                    <div class="caro-ach-bar"><span style="width:${achAi}%"></span></div>
                  </div>
                  <div class="caro-ach-item">
                    <span class="caro-ach-ico">🔥</span>
                    <span class="caro-ach-name">Chuỗi thắng</span>
                    <div class="caro-ach-bar"><span style="width:${achStreak}%"></span></div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        <aside class="caro-dash-rail caro-scroll-thin caro-reveal" style="--i:2">
          <section class="caro-dash-card caro-card-vivid">
            <div class="caro-dash-card-head"><h2>Người chơi online</h2></div>
            <ul class="caro-online-list">${renderOnlinePlayersRail()}</ul>
          </section>

          <section class="caro-dash-card caro-card-vivid">
            <div class="caro-dash-card-head">
              <h2>Bảng xếp hạng</h2>
            </div>
            <div class="caro-dash-tabs compact">
              <button type="button" class="caro-dash-tab${caroLbTab === "week" ? " is-active" : ""}" data-act="lb-tab" data-tab="week">Tuần</button>
              <button type="button" class="caro-dash-tab${caroLbTab === "month" ? " is-active" : ""}" data-act="lb-tab" data-tab="month">Tháng</button>
              <button type="button" class="caro-dash-tab${caroLbTab === "all" ? " is-active" : ""}" data-act="lb-tab" data-tab="all">Tất cả</button>
            </div>
            <ol class="caro-lb-list">
              ${
                lbSlice.length
                  ? lbSlice
                      .map(
                        (row, i) => `<li class="caro-lb-row rank-${i + 1}">
                          <span class="caro-lb-rank">${i + 1}</span>
                          <span class="caro-lb-name">${escapeHtml(row.name || "—")}</span>
                          <span class="caro-lb-elo">${row.elo ?? "—"}</span>
                        </li>`
                      )
                      .join("")
                  : `<li class="caro-empty">Chưa có dữ liệu xếp hạng.</li>`
              }
            </ol>
            <button type="button" class="caro-btn ghost sm" data-act="rank" style="width:100%;margin-top:0.5rem">Chi tiết</button>
          </section>

          <section class="caro-dash-card caro-event-card">
            <div class="caro-event-box">
              <span class="caro-event-ico">🏆</span>
              <div>
                <h2 style="margin:0 0 0.25rem">Sự kiện</h2>
                <strong>Caro Season 1</strong>
                <p class="caro-muted" style="font-size:0.78rem;margin:0.35rem 0 0.65rem">Giải tuần · ELO &amp; phần thưởng hub</p>
                <button type="button" class="caro-btn sm primary glow-cyan" data-act="caro-notify">Tham gia</button>
              </div>
            </div>
          </section>

          <section class="caro-dash-profile card-glow caro-profile-glow">
            <div class="caro-dash-avatar lg">${escapeHtml(playerInitial())}</div>
            <h3>${escapeHtml(playerName())}</h3>
            <p class="caro-muted">Level ${level} · ELO ${stats.elo}</p>
            <div class="caro-xp"><span style="width:${xpPct}%"></span></div>
            <div class="caro-stat-grid">
              <div><span>Win rate</span><strong>${winRate}%</strong></div>
              <div><span>Streak</span><strong>${stats.streak}</strong></div>
              <div><span>Thắng</span><strong>${stats.win}</strong></div>
              <div><span>Thua</span><strong>${stats.loss}</strong></div>
            </div>
          </section>

          <section class="caro-dash-card caro-dash-guide">
            <h2>Hướng dẫn nhanh</h2>
            <ol>
              <li>Chọn Quick Match hoặc Tạo phòng.</li>
              <li>Chơi AI để luyện opening &amp; block.</li>
              <li>Xem replay trong Lịch sử local.</li>
              <li>Bật âm thanh &amp; theme bên dưới.</li>
            </ol>
          </section>

          <section class="caro-dash-card" id="caro-settings">
            <h2>Cài đặt bàn cờ</h2>
            <label class="caro-muted caro-setting-row">Theme
              <select data-act="theme">
                <option value="neon" ${boardTheme === "neon" ? "selected" : ""}>Neon</option>
                <option value="wood" ${boardTheme === "wood" ? "selected" : ""}>Gỗ</option>
                <option value="cyber" ${boardTheme === "cyber" ? "selected" : ""}>Cyberpunk</option>
                <option value="amoled" ${boardTheme === "amoled" ? "selected" : ""}>AMOLED</option>
              </select>
            </label>
          </section>
        </aside>
      </div>`;
  }

  function renderAiSetup() {
    return `
      <div class="caro-launcher" style="max-width:520px">
        <section class="caro-panel">
          <h2>Chơi với AI</h2>
          <form class="caro-form" data-form="ai">
            <label>Độ khó
              <select name="level">
                <option value="easy">Easy</option>
                <option value="medium" selected>Medium</option>
                <option value="hard">Hard</option>
                <option value="impossible">Impossible</option>
              </select>
            </label>
            <label>Bàn cờ
              <select name="size"><option>10</option><option selected>15</option><option>19</option></select>
            </label>
            <label>Luật
              <select name="mode"><option value="freestyle">Freestyle</option><option value="tournament">Tournament</option></select>
            </label>
            <label>Thời gian mỗi lượt (giây)
              <select name="turnSec"><option>30</option><option selected>60</option><option>90</option><option>180</option></select>
            </label>
            <div class="caro-form-actions">
              <button class="caro-btn primary" type="submit">Bắt đầu</button>
              <button class="caro-btn ghost" type="button" data-act="home">Huỷ</button>
            </div>
          </form>
        </section>
      </div>`;
  }

  function renderCreate() {
    return `
      <div class="caro-launcher" style="max-width:560px">
        <section class="caro-panel">
          <h2>Tạo phòng online</h2>
          <form class="caro-form" data-form="create">
            <label>Tên phòng <input name="name" maxlength="48" placeholder="Phòng Caro vui vẻ" /></label>
            <label>Mật khẩu (không bắt buộc) <input name="password" maxlength="32" placeholder="Để trống = không mật khẩu" /></label>
            <label>Kích thước
              <select name="size"><option>10</option><option selected>15</option><option>19</option></select>
            </label>
            <label>Chế độ thắng
              <select name="mode"><option value="freestyle">Freestyle</option><option value="tournament">Tournament</option></select>
            </label>
            <label>Thời gian mỗi lượt
              <select name="turnSec"><option>30</option><option selected>60</option><option>90</option><option>180</option></select>
            </label>
            <label><input type="checkbox" name="allowSpectators" checked /> Cho phép người xem</label>
            <label><input type="checkbox" name="public" checked /> Phòng công khai</label>
            <div class="caro-form-actions">
              <button class="caro-btn primary" type="submit">Tạo phòng</button>
              <button class="caro-btn ghost" type="button" data-act="home">Huỷ</button>
            </div>
          </form>
        </section>
      </div>`;
  }

  function renderJoin() {
    return `
      <div class="caro-launcher" style="max-width:480px">
        <section class="caro-panel">
          <h2>Tham gia phòng</h2>
          <form class="caro-form" data-form="join">
            <label>Mã phòng <input name="code" maxlength="8" placeholder="VD: A3K9M2" required /></label>
            <label>Mật khẩu <input name="password" maxlength="32" /></label>
            <label><input type="checkbox" name="spectate" /> Vào xem (spectator)</label>
            <div class="caro-form-actions">
              <button class="caro-btn primary" type="submit">Vào phòng</button>
              <button class="caro-btn ghost" type="button" data-act="home">Huỷ</button>
            </div>
          </form>
        </section>
      </div>`;
  }

  function renderLobby() {
    const r = onlineRoom;
    if (!r) return `<div class="caro-empty">Không có phòng.</div>`;
    return `
      <div class="caro-launcher" style="max-width:720px">
        <section class="caro-panel">
          <h2>Phòng · ${escapeHtml(r.name)}</h2>
          <div class="caro-list">
            <div class="caro-list-item"><span>Mã phòng</span><strong>${r.code}</strong>
              <button type="button" class="caro-btn ghost" data-act="copy-code">Copy</button></div>
            <div class="caro-list-item"><span>Host</span><strong>${escapeHtml(r.host)}</strong></div>
            <div class="caro-list-item"><span>Luật</span><strong>${r.size}x${r.size} · ${r.mode} · ${Math.round(r.turnMs / 1000)}s</strong></div>
          </div>
          <h2 style="margin-top:1rem">Người chơi</h2>
          <div class="caro-list">
            ${r.players
              .map(
                (p) => `<div class="caro-list-item"><span>${escapeHtml(p.name)} ${p.online ? "" : "(offline)"}</span>
                <span class="caro-badge">${p.ready ? "Sẵn sàng" : "Chưa sẵn sàng"}</span></div>`
              )
              .join("")}
          </div>
          <h2 style="margin-top:1rem">Người xem</h2>
          <div class="caro-muted">${(r.spectators || []).map(escapeHtml).join(", ") || "—"}</div>
          <div class="caro-form-actions" style="margin-top:1rem">
            <button type="button" class="caro-btn" data-act="ready">Sẵn sàng</button>
            <button type="button" class="caro-btn primary" data-act="start">Bắt đầu</button>
            <button type="button" class="caro-btn ghost" data-act="leave-online">Rời phòng</button>
          </div>
        </section>
      </div>`;
  }

  function renderLocalGame() {
    const m = localMatch;
    if (!m) return "";
    const turnName = m.turn === STONE_X ? m.players.x : m.players.o;
    const finished = m.status !== "playing";
    return `
      <div class="caro-game-layout">
        <div class="caro-board-wrap">
          <div class="caro-board-meta">
            <div>Lượt: <strong>${escapeHtml(turnName)}</strong> ${
              aiBusy ? `<span class="caro-ai-thinking">AI đang nghĩ…</span>` : ""
            }</div>
            <div>Timer: <span class="caro-timer" data-caro-timer>--</span>s</div>
          </div>
          <div class="caro-board-scroll" data-board-local>
            ${renderBoard(m.board, { winLine: m.winLine, disabled: finished || aiBusy || (m.modeKind === "ai" && m.turn !== m.meStone) })}
          </div>
          <div class="caro-form-actions">
            <button type="button" class="caro-btn" data-act="resign-local" ${finished ? "disabled" : ""}>Đầu hàng</button>
            <button type="button" class="caro-btn" data-act="draw-local" ${finished ? "disabled" : ""}>Xin hòa</button>
            <button type="button" class="caro-btn ghost" data-act="board-portal">← Sảnh game</button>
          </div>
        </div>
        <aside class="caro-side">
          <section class="caro-panel">
            <h2>Trận đấu</h2>
            <div class="caro-players">
              <div class="caro-player ${m.turn === STONE_X ? "active" : ""}"><span>X · ${escapeHtml(m.players.x)}</span></div>
              <div class="caro-player ${m.turn === STONE_O ? "active" : ""}"><span>O · ${escapeHtml(m.players.o)}</span></div>
            </div>
            <div class="caro-muted" style="margin-top:0.6rem">${m.size}x${m.size} · ${m.mode} · ${m.modeKind}</div>
            <h2 style="margin-top:0.9rem">Nước đi</h2>
            <div class="caro-moves">${m.moves
              .map(
                (mv, i) =>
                  `<div>#${i + 1} ${mv.stone === STONE_X ? "X" : "O"} → (${mv.r + 1},${mv.c + 1})</div>`
              )
              .join("") || '<div class="caro-empty">Chưa có nước.</div>'}</div>
          </section>
        </aside>
        ${
          finished
            ? `<div class="caro-overlay"><div class="caro-modal">
                <h3>${
                  m.endReason === "draw"
                    ? "Hòa!"
                    : m.winnerSide === "x"
                      ? `${escapeHtml(m.players.x)} thắng`
                      : `${escapeHtml(m.players.o)} thắng`
                }</h3>
                <p>${m.endReason === "timeout" ? "Hết giờ." : m.endReason === "resign" ? "Đối thủ đầu hàng." : "Ván đấu kết thúc."}</p>
                <div class="caro-form-actions" style="justify-content:center">
                  <button type="button" class="caro-btn primary" data-act="rematch-local">Chơi lại</button>
                  <button type="button" class="caro-btn" data-act="share-result">Chia sẻ vào chat</button>
                  <button type="button" class="caro-btn ghost" data-act="home">Launcher</button>
                </div>
              </div></div>`
            : ""
        }
      </div>`;
  }

  function renderOnlineGame() {
    const r = onlineRoom;
    if (!r) return "";
    const me = playerName();
    const myPlayer = (r.players || []).find((p) => p.name === me);
    const myTurn = r.status === "playing" && myPlayer && myPlayer.stone === r.turn;
    const finished = r.status === "finished" || r.status === "draw";
    const turnPlayer = (r.players || []).find((p) => p.stone === r.turn);
    return `
      <div class="caro-game-layout">
        <div class="caro-board-wrap">
          <div class="caro-board-meta">
            <div>${escapeHtml(r.name)} · <span class="caro-badge">${r.code}</span></div>
            <div>Lượt: <strong>${escapeHtml(turnPlayer?.name || "—")}</strong> · <span class="caro-timer" data-caro-timer>--</span>s</div>
          </div>
          <div class="caro-board-scroll" data-board-online>
            ${renderBoard(r.board || [], {
              winLine: r.winLine,
              disabled: finished || !myTurn,
            })}
          </div>
          <div class="caro-form-actions">
            <button type="button" class="caro-btn" data-act="resign-online" ${finished ? "disabled" : ""}>Đầu hàng</button>
            <button type="button" class="caro-btn" data-act="draw-online" ${finished ? "disabled" : ""}>Xin hòa</button>
            <button type="button" class="caro-btn ghost" data-act="copy-code">Copy mã</button>
            <button type="button" class="caro-btn ghost" data-act="leave-online">Rời</button>
          </div>
        </div>
        <aside class="caro-side">
          <section class="caro-panel">
            <h2>Người chơi</h2>
            <div class="caro-players">
              ${(r.players || [])
                .map(
                  (p) => `<div class="caro-player ${p.stone === r.turn && !finished ? "active" : ""}">
                  <span>${p.stone === 1 ? "X" : p.stone === 2 ? "O" : "?"} · ${escapeHtml(p.name)}</span>
                  <span class="caro-muted">${p.online ? "online" : "offline"}</span>
                </div>`
                )
                .join("")}
            </div>
            <div class="caro-muted" style="margin-top:0.5rem">Khán giả: ${(r.spectators || []).map(escapeHtml).join(", ") || "—"}</div>
            <h2 style="margin-top:0.8rem">Lịch sử nước</h2>
            <div class="caro-moves">${(r.moves || [])
              .map((mv, i) => `<div>#${i + 1} ${mv.stone === 1 ? "X" : "O"} (${mv.r + 1},${mv.c + 1})</div>`)
              .join("") || '<div class="caro-empty">—</div>'}</div>
            <h2 style="margin-top:0.8rem">Chat phòng</h2>
            <div class="caro-chat">
              <div class="caro-chat-log">${(r.chat || [])
                .map((c) => `<div><strong>${escapeHtml(c.name)}</strong>: ${escapeHtml(c.text)}</div>`)
                .join("")}</div>
              <form class="caro-chat-form" data-form="caro-chat">
                <input name="text" maxlength="240" placeholder="Nhắn trong phòng…" />
                <button class="caro-btn" type="submit">Gửi</button>
              </form>
            </div>
          </section>
        </aside>
        ${
          r.drawOfferFrom && r.drawOfferFrom !== me && !finished
            ? `<div class="caro-overlay"><div class="caro-modal">
                <h3>Đối thủ xin hòa</h3>
                <div class="caro-form-actions" style="justify-content:center">
                  <button type="button" class="caro-btn primary" data-act="draw-accept">Đồng ý</button>
                  <button type="button" class="caro-btn" data-act="draw-decline">Từ chối</button>
                </div>
              </div></div>`
            : ""
        }
        ${
          finished
            ? `<div class="caro-overlay"><div class="caro-modal">
                <h3>${r.status === "draw" ? "Hòa!" : `${escapeHtml(r.winner || "—")} thắng`}</h3>
                <div class="caro-form-actions" style="justify-content:center">
                  <button type="button" class="caro-btn primary" data-act="rematch-online">Chơi lại</button>
                  <button type="button" class="caro-btn" data-act="share-online">Chia sẻ kết quả</button>
                  <button type="button" class="caro-btn ghost" data-act="home">Launcher</button>
                </div>
              </div></div>`
            : ""
        }
      </div>`;
  }

  function renderHistory() {
    const local = loadLocalHistory();
    return `
      <div class="caro-launcher">
        <section class="caro-panel">
          <h2>Lịch sử local</h2>
          <div class="caro-list">${
            local.length
              ? local
                  .map(
                    (h) => `<div class="caro-list-item">
                <div>${escapeHtml(h.mode)} · ${h.size}x${h.size} · ${h.reason}<div class="caro-muted">${new Date(h.at).toLocaleString("vi")} · ${h.moves?.length || 0} nước</div></div>
                <button type="button" class="caro-btn" data-replay="${h.id}">Replay</button>
              </div>`
                  )
                  .join("")
              : `<div class="caro-empty">Trống</div>`
          }</div>
          <h2 style="margin-top:1rem">Lịch sử server</h2>
          <div class="caro-list">${
            serverHistory.length
              ? serverHistory
                  .map(
                    (h) => `<div class="caro-list-item"><div>${(h.players || []).map(escapeHtml).join(" vs ")}
                  <div class="caro-muted">${h.winner ? "Thắng: " + escapeHtml(h.winner) : "Hòa"} · ${new Date(h.at).toLocaleString("vi")}</div></div>
                  <button type="button" class="caro-btn ghost" data-replay-server="${h.id}">Replay</button></div>`
                  )
                  .join("")
              : `<div class="caro-empty">Chưa có trên server.</div>`
          }</div>
          <div class="caro-form-actions"><button type="button" class="caro-btn ghost" data-act="home">Quay lại</button></div>
        </section>
      </div>`;
  }

  function renderRank() {
    const local = loadStats();
    return `
      <div class="caro-launcher">
        <section class="caro-panel">
          <h2>Xếp hạng online</h2>
          <div class="caro-list">${
            leaderboard.length
              ? leaderboard
                  .map(
                    (r, i) => `<div class="caro-list-item"><span>#${i + 1} ${escapeHtml(r.name)}</span>
                  <strong>ELO ${r.elo} · ${r.win}W/${r.loss}L · ${r.winRate}%</strong></div>`
                  )
                  .join("")
              : `<div class="caro-empty">Chưa có dữ liệu online.</div>`
          }</div>
          <h2 style="margin-top:1rem">Local của bạn</h2>
          <div class="caro-list-item"><span>${escapeHtml(playerName())}</span><strong>ELO ${local.elo} · ${local.win}W ${local.loss}L ${local.draw}D · streak ${local.streak}</strong></div>
          <div class="caro-form-actions"><button type="button" class="caro-btn ghost" data-act="home">Quay lại</button></div>
        </section>
      </div>`;
  }

  function renderReplay() {
    if (!replay) return `<div class="caro-empty">Không có replay.</div>`;
    const board = cloneBoard(
      Array.from({ length: replay.size }, () => Array(replay.size).fill(STONE_EMPTY))
    );
    for (let i = 0; i <= replay.cursor; i++) {
      const mv = replay.moves[i];
      if (mv) board[mv.r][mv.c] = mv.stone;
    }
    return `
      <div class="caro-launcher" style="max-width:720px">
        <section class="caro-panel">
          <h2>Replay</h2>
          <div class="caro-board-scroll">${renderBoard(board, { disabled: true, cell: cellSize(replay.size) })}</div>
          <div class="caro-muted" style="margin:0.6rem 0">Nước ${Math.max(0, replay.cursor + 1)} / ${replay.moves.length}</div>
          <div class="caro-form-actions">
            <button type="button" class="caro-btn" data-act="rep-prev">Previous</button>
            <button type="button" class="caro-btn" data-act="rep-play">${replay.playing ? "Pause" : "Play"}</button>
            <button type="button" class="caro-btn" data-act="rep-next">Next</button>
            <button type="button" class="caro-btn" data-act="rep-fast">Tăng tốc</button>
            <button type="button" class="caro-btn ghost" data-act="home">Đóng</button>
          </div>
        </section>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function topBrandHtml() {
    if (view === "board-hub" || view === "game-soon") {
      return `BOARD <span>GAME</span>`;
    }
    return `CỜ <span>CARO</span>`;
  }

  function viewTitle() {
    if (view === "board-hub") return "Sảnh game";
    if (view === "game-soon") {
      const g = BOARD_GAMES.find((x) => x.id === gameSoonId);
      return g?.title || "Sắp ra mắt";
    }
    if (view === "caro-home") return "Caro";
    if (view === "ai-setup") return "AI";
    if (view === "create") return "Tạo phòng";
    if (view === "join") return "Tham gia";
    if (view === "lobby") return "Lobby";
    if (view === "history") return "Lịch sử";
    if (view === "rank") return "Xếp hạng";
    if (view === "replay") return "Replay";
    if (view === "local-game" || view === "online-game") return "Đang chơi";
    return "Board";
  }

  function render() {
    const title = viewTitle();

    let body = "";
    if (view === "board-hub") body = renderBoardHub();
    else if (view === "game-soon") body = renderGameSoon();
    else if (view === "caro-home") body = renderCaroHome();
    else if (view === "ai-setup") body = renderAiSetup();
    else if (view === "create") body = renderCreate();
    else if (view === "join") body = renderJoin();
    else if (view === "lobby") body = renderLobby();
    else if (view === "local-game") body = renderLocalGame();
    else if (view === "online-game") body = renderOnlineGame();
    else if (view === "history") body = renderHistory();
    else if (view === "rank") body = renderRank();
    else if (view === "replay") body = renderReplay();

    const inCaro = !["board-hub", "game-soon"].includes(view);

    const isDash = view === "caro-home" || view === "board-hub";

    if (isDash) {
      root.innerHTML = `<div class="caro-shell-dash">
        <div class="caro-dash-bg" aria-hidden="true"></div>
        ${body}${
        quickWaiting ? '<div class="caro-dash-toast-bar">Đang ghép Quick Match…</div>' : ""
      }</div>`;
      startTimerUi();
      return;
    }

    root.innerHTML = `
      <div class="caro-top">
        <div class="caro-brand">${topBrandHtml()} · ${escapeHtml(title)}${
          quickWaiting ? ' <span class="caro-ai-thinking">Đang ghép…</span>' : ""
        }</div>
        <div class="caro-top-actions">
          ${
            inCaro
              ? `<button type="button" class="caro-btn ghost" data-act="board-portal">← Sảnh game</button>
                 <button type="button" class="caro-btn ghost" data-act="caro-home">Caro</button>`
              : ""
          }
          <button type="button" class="caro-btn ghost" data-act="back-hub">← Hub</button>
        </div>
      </div>
      <div class="caro-body caro-scroll-thin"><div class="caro-view">${body}</div></div>
    `;
    startTimerUi();
  }

  async function refreshMeta() {
    const roomsRes = await sockEmit("caro:list_rooms", {});
    if (roomsRes?.ok) publicRooms = roomsRes.rooms || [];
    const lb = await sockEmit("caro:leaderboard", {});
    if (lb?.ok) leaderboard = lb.list || [];
    const hi = await sockEmit("caro:history", {});
    if (hi?.ok) serverHistory = hi.list || [];
  }

  function openReplayFromLocal(id) {
    const h = loadLocalHistory().find((x) => x.id === id);
    if (!h) return toast("Không tìm thấy replay");
    replay = {
      size: h.size,
      moves: h.moves || [],
      cursor: -1,
      playing: false,
      speed: 700,
      timer: null,
    };
    view = "replay";
    render();
  }

  function openReplayServer(id) {
    const h = serverHistory.find((x) => x.id === id);
    if (!h) return toast("Không tìm thấy");
    replay = {
      size: h.size || 15,
      moves: h.moves || [],
      cursor: -1,
      playing: false,
      speed: 700,
      timer: null,
    };
    view = "replay";
    render();
  }

  function stopReplayPlay() {
    if (replay?.timer) clearInterval(replay.timer);
    if (replay) {
      replay.timer = null;
      replay.playing = false;
    }
  }

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act], [data-pick-game], [data-join-code], [data-replay], [data-replay-server], .caro-cell");
    if (!t) return;

    if (t.matches(".caro-cell") && view === "local-game") {
      doLocalMove(Number(t.dataset.r), Number(t.dataset.c));
      return;
    }
    if (t.matches(".caro-cell") && view === "online-game") {
      const res = await sockEmit("caro:move", { r: Number(t.dataset.r), c: Number(t.dataset.c) });
      if (!res?.ok) toast(res?.reason || "Không đánh được");
      return;
    }

    const act = t.dataset.act;
    const pickGame = t.dataset.pickGame;
    if (pickGame) {
      if (pickGame === "uno") {
        gameSoonId = "uno";
        view = "game-soon";
        render();
        return;
      }
      const g = BOARD_GAMES.find((x) => x.id === pickGame);
      if (!g) return;
      if (g.status === "live") {
        view = "caro-home";
        refreshMeta().then(() => render());
        render();
      } else {
        gameSoonId = g.id;
        view = "game-soon";
        render();
      }
      return;
    }
    const joinCode = t.dataset.joinCode;
    if (joinCode) {
      if (!(await requireLogin())) return;
      const res = await sockEmit("caro:join_room", { code: joinCode, playerName: playerName() });
      if (!res?.ok) return toast(res?.reason || "Lỗi");
      onlineRoom = res.room;
      view = res.room.status === "playing" ? "online-game" : "lobby";
      render();
      return;
    }
    if (t.dataset.replay) return openReplayFromLocal(t.dataset.replay);
    if (t.dataset.replayServer) return openReplayServer(t.dataset.replayServer);

    if (act === "back-hub") {
      stopTimer();
      stopReplayPlay();
      sockEmit("caro:leave", {});
      sockEmit("caro:cancel_quick", {});
      ctx.onBackHub?.();
      return;
    }
    if (act === "board-portal") {
      stopReplayPlay();
      stopTimer();
      localMatch = null;
      quickWaiting = false;
      sockEmit("caro:leave", {});
      sockEmit("caro:cancel_quick", {});
      view = "board-hub";
      render();
      return;
    }
    if (act === "caro-home" || act === "open-caro") {
      view = "caro-home";
      refreshMeta().then(() => render());
      render();
      return;
    }
    if (act === "home") {
      stopReplayPlay();
      localMatch = null;
      view = "caro-home";
      refreshMeta().then(() => render());
      render();
      return;
    }
    if (act === "ai") {
      view = "ai-setup";
      render();
      return;
    }
    if (act === "local") {
      startLocal({ kind: "local", size: 15, mode: "freestyle", turnSec: 90 });
      return;
    }
    if (act === "create") {
      if (!(await requireLogin())) return;
      view = "create";
      render();
      return;
    }
    if (act === "join") {
      if (!(await requireLogin())) return;
      view = "join";
      render();
      return;
    }
    if (act === "quick") {
      if (!(await requireLogin())) return;
      quickWaiting = true;
      render();
      const res = await sockEmit("caro:quick_match", { playerName: playerName() });
      if (!res?.ok) {
        quickWaiting = false;
        toast(res?.reason || "Lỗi ghép");
        render();
        return;
      }
      if (res.room) {
        quickWaiting = false;
        onlineRoom = res.room;
        view = "online-game";
        render();
      } else toast("Đang chờ đối thủ…");
      return;
    }
    if (act === "room-tab") {
      caroRoomTab = t.dataset.tab || "all";
      render();
      return;
    }
    if (act === "lb-tab") {
      caroLbTab = t.dataset.tab || "all";
      render();
      return;
    }
    if (act === "caro-achievements") {
      view = "caro-home";
      render();
      requestAnimationFrame(() => {
        root.querySelector("#caro-achievements")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (act === "caro-settings") {
      view = "caro-home";
      render();
      requestAnimationFrame(() => {
        root.querySelector("#caro-settings")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (act === "hub-open-chat") {
      ctx.onBackHub?.();
      return;
    }
    if (act === "hub-stub") {
      toast("Mục này sẽ mở từ Hub chính WebChat.");
      return;
    }
    if (act === "caro-notify") {
      toast("Thông báo trận đấu — đang phát triển.");
      return;
    }
    if (act === "refresh-rooms") {
      await refreshMeta();
      render();
      return;
    }
    if (act === "history") {
      await refreshMeta();
      view = "history";
      render();
      return;
    }
    if (act === "rank") {
      await refreshMeta();
      view = "rank";
      render();
      return;
    }
    if (act === "sound") {
      soundOn = t.checked;
      localStorage.setItem(STORAGE_SOUND, soundOn ? "1" : "0");
      return;
    }
    if (act === "resign-local") {
      if (!localMatch) return;
      endLocal(localMatch.turn === STONE_X ? "o" : "x", "resign");
      return;
    }
    if (act === "draw-local") {
      if (confirm("Đồng ý hòa ván này?")) endLocal(null, "draw");
      return;
    }
    if (act === "rematch-local") {
      const prev = localMatch;
      startLocal({
        kind: prev.modeKind,
        size: prev.size,
        mode: prev.mode,
        turnSec: Math.round(prev.turnMs / 1000),
        aiLevel: prev.aiLevel,
      });
      return;
    }
    if (act === "share-result" || act === "share-online") {
      const text =
        act === "share-online"
          ? `🏁 Caro ${onlineRoom?.code || ""}: ${
              onlineRoom?.status === "draw" ? "Hòa" : `${onlineRoom?.winner || "?"} thắng`
            } (${onlineRoom?.moves?.length || 0} nước)`
          : `🏁 Caro ${localMatch?.modeKind}: ${
              localMatch?.endReason === "draw"
                ? "Hòa"
                : localMatch?.winnerSide === "x"
                  ? localMatch.players.x + " thắng"
                  : localMatch.players.o + " thắng"
            }`;
      ctx.onShareToChat?.(text);
      toast("Đã gửi gợi ý chia sẻ — dán vào phòng chat nếu cần.");
      try {
        await navigator.clipboard.writeText(text);
        toast("Đã copy kết quả vào clipboard");
      } catch (_) {}
      return;
    }
    if (act === "copy-code") {
      const code = onlineRoom?.code;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        toast("Đã copy mã " + code);
      } catch {
        toast(code);
      }
      return;
    }
    if (act === "ready") {
      const res = await sockEmit("caro:ready", {});
      if (!res?.ok) toast("Không đổi trạng thái");
      return;
    }
    if (act === "start") {
      const res = await sockEmit("caro:start", {});
      if (!res?.ok) toast(res?.reason || "Không bắt đầu được");
      return;
    }
    if (act === "leave-online") {
      await sockEmit("caro:leave", {});
      onlineRoom = null;
      view = "caro-home";
      render();
      return;
    }
    if (act === "resign-online") {
      await sockEmit("caro:resign", {});
      return;
    }
    if (act === "draw-online") {
      await sockEmit("caro:draw_offer", {});
      toast("Đã gửi xin hòa");
      return;
    }
    if (act === "draw-accept") {
      await sockEmit("caro:draw_response", { accept: true });
      return;
    }
    if (act === "draw-decline") {
      await sockEmit("caro:draw_response", { accept: false });
      return;
    }
    if (act === "rematch-online") {
      const res = await sockEmit("caro:rematch", {});
      if (!res?.ok) toast(res?.reason || "Chỉ host tạo lại");
      else {
        view = "lobby";
        render();
      }
      return;
    }
    if (act === "rep-prev" && replay) {
      stopReplayPlay();
      replay.cursor = Math.max(-1, replay.cursor - 1);
      render();
      return;
    }
    if (act === "rep-next" && replay) {
      stopReplayPlay();
      replay.cursor = Math.min(replay.moves.length - 1, replay.cursor + 1);
      render();
      return;
    }
    if (act === "rep-play" && replay) {
      if (replay.playing) {
        stopReplayPlay();
        render();
        return;
      }
      replay.playing = true;
      render();
      replay.timer = setInterval(() => {
        if (!replay) return;
        if (replay.cursor >= replay.moves.length - 1) {
          stopReplayPlay();
          render();
          return;
        }
        replay.cursor++;
        render();
      }, replay.speed);
      return;
    }
    if (act === "rep-fast" && replay) {
      replay.speed = Math.max(180, Math.floor(replay.speed * 0.7));
      toast("Tốc độ: " + replay.speed + "ms");
      return;
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t?.dataset?.act === "sound") {
      soundOn = t.checked;
      localStorage.setItem(STORAGE_SOUND, soundOn ? "1" : "0");
    }
    if (t?.dataset?.act === "theme") {
      boardTheme = t.value;
      localStorage.setItem(STORAGE_THEME, boardTheme);
      toast("Theme: " + boardTheme);
    }
  });

  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("form");
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    if (form.dataset.form === "ai") {
      startLocal({
        kind: "ai",
        aiLevel: String(fd.get("level") || "medium"),
        size: Number(fd.get("size") || 15),
        mode: String(fd.get("mode") || "freestyle"),
        turnSec: Number(fd.get("turnSec") || 60),
      });
      return;
    }
    if (form.dataset.form === "create") {
      if (!(await requireLogin())) return;
      const res = await sockEmit("caro:create_room", {
        playerName: playerName(),
        name: String(fd.get("name") || ""),
        password: String(fd.get("password") || ""),
        size: Number(fd.get("size") || 15),
        mode: String(fd.get("mode") || "freestyle"),
        turnSec: Number(fd.get("turnSec") || 60),
        allowSpectators: fd.get("allowSpectators") === "on",
        public: fd.get("public") === "on",
      });
      if (!res?.ok) return toast(res?.reason || "Lỗi tạo phòng");
      onlineRoom = res.room;
      view = "lobby";
      render();
      return;
    }
    if (form.dataset.form === "join") {
      if (!(await requireLogin())) return;
      const res = await sockEmit("caro:join_room", {
        playerName: playerName(),
        code: String(fd.get("code") || ""),
        password: String(fd.get("password") || ""),
        spectate: fd.get("spectate") === "on",
      });
      if (!res?.ok) return toast(res?.reason || "Lỗi vào phòng");
      onlineRoom = res.room;
      view = res.room.status === "playing" ? "online-game" : "lobby";
      render();
      return;
    }
    if (form.dataset.form === "caro-chat") {
      const text = String(fd.get("text") || "").trim();
      if (!text) return;
      await sockEmit("caro:chat", { text });
      form.reset();
    }
  });

  bindSocket();
  view = "board-hub";
  render();

  return {
    open() {
      root.hidden = false;
      bindSocket();
      view = "board-hub";
      render();
      refreshMeta().then(() => render());
    },
    close() {
      stopTimer();
      stopReplayPlay();
      root.hidden = true;
    },
  };
}
