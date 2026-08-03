import {
  applyMove,
  allLegalMoves,
  createMatchState,
  gameResult,
  isInCheck,
  legalMovesFrom,
  moveNotation,
  pieceLabel,
  pieceSide,
  SIDE_BLACK,
  SIDE_RED,
} from "./xiangqi-engine.js";
import { aiThinkDelay, pickAiMove } from "./xiangqi-ai.js";

const STORAGE_XQ_STATS = "xiangqi-local-stats";

export function createXiangqiModule(deps) {
  const { escapeHtml, playerName, toast, beep } = deps;

  /** @type {any} */
  let match = null;
  let selected = null;
  let targets = [];
  let aiBusy = false;
  let replayIdx = -1;
  let replayPlaying = false;
  let replayTimer = null;
  let chatLog = [];

  function loadStats() {
    try {
      return (
        JSON.parse(localStorage.getItem(STORAGE_XQ_STATS) || "null") || {
          elo: 1000,
          win: 0,
          loss: 0,
          draw: 0,
          played: 0,
          streak: 0,
          masterWins: 0,
        }
      );
    } catch {
      return { elo: 1000, win: 0, loss: 0, draw: 0, played: 0, streak: 0, masterWins: 0 };
    }
  }

  function saveStats(s) {
    localStorage.setItem(STORAGE_XQ_STATS, JSON.stringify(s));
  }

  function startAi(level) {
    match = createMatchState({ mode: "ai", aiLevel: level, meSide: SIDE_RED });
    selected = null;
    targets = [];
    chatLog = [];
    return match;
  }

  function startLocalPvp() {
    match = createMatchState({ mode: "local", meSide: SIDE_RED });
    selected = null;
    targets = [];
    chatLog = [];
    return match;
  }

  function clearMatch() {
    match = null;
    selected = null;
    targets = [];
    stopReplay();
  }

  function stopReplay() {
    replayPlaying = false;
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = null;
  }

  function boardAtReplay() {
    if (!match?.moves?.length || replayIdx < 0) return match.board;
    let b = createMatchState().board;
    for (let i = 0; i <= replayIdx && i < match.moves.length; i++) {
      const m = match.moves[i];
      b = applyMove(b, m.fromR, m.fromC, m.toR, m.toC);
    }
    return b;
  }

  function finishGame(winner) {
    if (!match || match.status !== "playing") return;
    match.status = winner === "draw" ? "draw" : "finished";
    match.winner = winner;
    const stats = loadStats();
    stats.played++;
    if (match.mode === "ai") {
      const meWin = winner === match.meSide;
      const meLoss = winner && winner !== "draw" && winner !== match.meSide;
      if (winner === "draw") {
        stats.draw++;
        stats.streak = 0;
      } else if (meWin) {
        stats.win++;
        stats.streak++;
        stats.elo += 15;
        if (match.aiLevel === "master") stats.masterWins++;
      } else if (meLoss) {
        stats.loss++;
        stats.streak = 0;
        stats.elo = Math.max(800, stats.elo - 12);
      }
    }
    saveStats(stats);
    beep?.(620, 120, "sine", 0.05);
  }

  function afterMove() {
    if (!match) return;
    const res = gameResult(match.board, match.turn);
    if (res) {
      finishGame(res);
      return;
    }
    match.checkSide = isInCheck(match.board, match.turn) ? match.turn : null;
    if (match.mode === "ai" && match.turn !== match.meSide && match.status === "playing") {
      runAiTurn();
    }
  }

  async function runAiTurn() {
    if (!match || aiBusy) return;
    aiBusy = true;
    await new Promise((r) => setTimeout(r, aiThinkDelay(match.aiLevel)));
    const mv = pickAiMove(match.board, match.turn, match.aiLevel);
    aiBusy = false;
    if (!mv || match.status !== "playing") return;
    commitMove(mv.fromR, mv.fromC, mv.toR, mv.toC);
  }

  function commitMove(fromR, fromC, toR, toC) {
    if (!match || match.status !== "playing") return;
    const cap = match.board[toR][toC];
    const moving = match.board[fromR][fromC];
    match.board = applyMove(match.board, fromR, fromC, toR, toC);
    match.moves.push({
      fromR,
      fromC,
      toR,
      toC,
      piece: moving,
      capture: cap,
      side: match.turn,
      note: moveNotation({ fromR, fromC, toR, toC, piece: moving, capture: cap }, match.board),
    });
    match.turn = match.turn === SIDE_RED ? SIDE_BLACK : SIDE_RED;
    match.turnDeadline = Date.now() + match.turnMs;
    if (cap && cap !== ".") beep?.(880, 50, "square", 0.04);
    else beep?.(520, 40, "sine", 0.03);
    selected = null;
    targets = [];
    afterMove();
  }

  function onCellClick(r, c) {
    if (!match || match.status !== "playing" || aiBusy) return false;
    if (match.mode === "ai" && match.turn !== match.meSide) return false;

    const board = match.board;
    const p = board[r][c];
    const mySide =
      match.mode === "local"
        ? match.turn
        : match.meSide;

    if (selected) {
      const [sr, sc] = selected;
      const hit = targets.some(([tr, tc]) => tr === r && tc === c);
      if (hit) {
        commitMove(sr, sc, r, c);
        return true;
      }
    }

    if (p !== "." && pieceSide(p) === mySide) {
      selected = [r, c];
      targets = legalMovesFrom(board, r, c, mySide);
      return true;
    }
    selected = null;
    targets = [];
    return true;
  }

  function renderBoardHtml(board, interactive) {
    let html = `<div class="xq-board" role="grid" aria-label="Bàn cờ tướng">`;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        const isSel = selected && selected[0] === r && selected[1] === c;
        const isT = targets.some(([tr, tc]) => tr === r && tc === c);
        html += `<button type="button" class="xq-cell${isSel ? " is-selected" : ""}${isT ? " is-target" : ""}" data-xq-r="${r}" data-xq-c="${c}" ${
          interactive ? "" : "tabindex=-1"
        }>`;
        html += `<span class="xq-dot-hint" aria-hidden="true"></span>`;
        if (p !== ".") {
          const side = pieceSide(p) === SIDE_RED ? "red" : "black";
          html += `<span class="xq-piece ${side}">${pieceLabel(p)}</span>`;
        }
        html += `</button>`;
      }
    }
    html += `</div>`;
    return html;
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderHome() {
    const stats = loadStats();
    return `
      <div class="xq-shell xq-home-grid caro-reveal">
        <div>
          <section class="xq-hero">
            <p class="xq-kicker">Trí tuệ · Chiến thuật · Bản lĩnh</p>
            <h1 class="xq-title">CỜ TƯỚNG</h1>
            <p class="xq-lead">Cờ Tướng là trò chơi chiến thuật dành cho hai người, nơi mỗi nước đi đều có thể thay đổi cục diện trận đấu. Hãy rèn luyện tư duy, tính toán nhiều bước và chinh phục đối thủ từ AI đến những kỳ thủ mạnh nhất trên hệ thống.</p>
            <div class="xq-info-chips">
              <span class="xq-chip">♟ 9×10</span>
              <span class="xq-chip">👥 2 người chơi</span>
              <span class="xq-chip">🤖 AI 4 cấp độ</span>
              <span class="xq-chip">🌐 Online Realtime</span>
              <span class="xq-chip">🏆 Xếp hạng ELO</span>
              <span class="xq-chip">🎥 Replay</span>
              <span class="xq-chip">⏱ Timer</span>
              <span class="xq-chip">📈 Thống kê</span>
            </div>
          </section>

          <section class="xq-rules-grid" style="margin-top:1rem">
            <div class="xq-panel">
              <h3>Luật chơi</h3>
              <p><strong>Mục tiêu:</strong> Chiếu bí Tướng đối phương.</p>
              <p><strong>Bàn cờ:</strong> 9 cột · 10 hàng · Sông chia đôi · Cửu cung.</p>
            </div>
            <div class="xq-panel">
              <h3>Quân cờ</h3>
              <div class="xq-piece-list">
                <span>Tướng 帅/将</span><span>Sĩ 仕/士</span>
                <span>Tượng 相/象</span><span>Mã 马</span>
                <span>Xe 车</span><span>Pháo 炮</span>
                <span>Tốt 兵/卒</span>
              </div>
            </div>
            <div class="xq-panel">
              <h3>Luật đặc biệt</h3>
              <ul style="margin:0;padding-left:1.1rem;font-size:0.82rem;line-height:1.55">
                <li>Tướng không được đối mặt trực tiếp.</li>
                <li>Pháo nhảy qua đúng một quân để ăn.</li>
                <li>Tượng không qua sông · Sĩ trong cung.</li>
                <li>Tốt qua sông đi ngang · Mã bị chặn chân.</li>
              </ul>
            </div>
          </section>

          <section class="xq-panel" style="margin-top:1rem">
            <h3>Thành tựu</h3>
            <div class="xq-ach">
              <span>🏆 Thắng 10 trận</span>
              <span>🏆 Thắng AI Master</span>
              <span>🏆 Không mất Xe</span>
              <span>🏆 Chiếu bí trong 30 nước</span>
              <span>🏆 100 trận Online</span>
            </div>
          </section>
        </div>

        <aside class="xq-panel">
          <h3>Chế độ chơi</h3>
          <div class="xq-mode-list">
            <button type="button" class="xq-mode-btn" data-act="xq-quick">
              <span>⚡</span><span><strong>Quick Match</strong><span>Ghép đối thủ ngẫu nhiên — sắp ra mắt online.</span></span>
            </button>
            <div class="xq-mode-divider"></div>
            <div class="xq-mode-btn" style="cursor:default">
              <span>🤖</span>
              <span><strong>Chơi với AI</strong>
                <div class="xq-ai-levels">
                  <button type="button" data-act="xq-ai" data-level="easy">Easy</button>
                  <button type="button" data-act="xq-ai" data-level="medium">Medium</button>
                  <button type="button" data-act="xq-ai" data-level="hard">Hard</button>
                  <button type="button" data-act="xq-ai" data-level="master">Master</button>
                </div>
              </span>
            </div>
            <div class="xq-mode-divider"></div>
            <button type="button" class="xq-mode-btn" data-act="xq-local">
              <span>👥</span><span><strong>Chơi với bạn</strong><span>Cùng máy · 2 người luân phiên.</span></span>
            </button>
            <button type="button" class="xq-mode-btn" data-act="xq-room-soon">
              <span>🔑</span><span><strong>Tạo / nhập phòng</strong><span>Online phòng riêng — đang xây.</span></span>
            </button>
            <div class="xq-mode-divider"></div>
            <button type="button" class="xq-mode-btn" data-act="xq-rank-soon">
              <span>🏆</span><span><strong>Xếp hạng</strong><span>Đấu xếp hạng ELO — sắp mở.</span></span>
            </button>
            <button type="button" class="xq-mode-btn" data-act="xq-spectate-soon">
              <span>📺</span><span><strong>Xem trận đấu</strong><span>Spectator · chat · reaction 👏🔥.</span></span>
            </button>
          </div>
          <div class="xq-panel" style="margin-top:0.85rem;padding:0.75rem">
            <h3>Thống kê</h3>
            <div class="xq-stat-row">
              <span>ELO <strong>${stats.elo}</strong></span>
              <span>Thắng <strong>${stats.win}</strong></span>
              <span>Thua <strong>${stats.loss}</strong></span>
              <span>Hòa <strong>${stats.draw}</strong></span>
            </div>
          </div>
        </aside>
      </div>`;
  }

  function renderPlay() {
    if (!match) return `<div class="caro-empty">Chưa có ván.</div>`;
    const stats = loadStats();
    const board = replayIdx >= 0 ? boardAtReplay() : match.board;
    const oppSide = match.meSide === SIDE_RED ? SIDE_BLACK : SIDE_RED;
    const topSide = SIDE_BLACK;
    const botSide = SIDE_RED;
    const topCheck = match.checkSide === topSide && match.status === "playing";
    const botCheck = match.checkSide === botSide && match.status === "playing";

    const overlay =
      match.status === "finished" || match.status === "draw"
        ? `<div class="xq-checkmate-overlay" data-act="xq-dismiss-win">
            <div class="xq-checkmate-card">
              <div style="font-size:2.5rem">🏆</div>
              <h2>${match.status === "draw" ? "HÒA" : "CHECKMATE"}</h2>
              <p>${
                match.status === "draw"
                  ? "Trận hòa."
                  : match.winner === match.meSide || match.mode === "local"
                    ? "Bạn chiến thắng!"
                    : "Đối thủ thắng."
              }</p>
              <p class="caro-muted">${match.mode === "ai" ? "+15 ELO khi thắng AI" : ""}</p>
              <button type="button" class="caro-btn primary" data-act="xq-home">Về sảnh Cờ Tướng</button>
            </div>
          </div>`
        : "";

    return `
      <div class="xq-shell">
        ${overlay}
        <div class="xq-game-top">
          <strong>Cờ Tướng</strong>
          <span class="caro-muted">${match.mode === "ai" ? `AI · ${match.aiLevel}` : "Local 2 người"} · ${escapeHtml(playerName())}</span>
        </div>
        <div class="xq-player-bar${topCheck ? " in-check" : ""}">
          <span>Đối thủ ${match.mode === "ai" ? "(AI)" : ""} · ${topSide === SIDE_RED ? stats.elo : stats.elo + 34} ELO ${topCheck ? "🔥 Chiếu" : ""}</span>
          <span>⏱ ${formatTime(match.blackTimeMs)}</span>
        </div>
        <div class="xq-game-layout">
          <div class="xq-board-wrap">
            ${renderBoardHtml(board, match.status === "playing" && replayIdx < 0)}
          </div>
          <aside class="xq-side-panel">
            <div class="xq-panel">
              <h3>Lịch sử nước đi</h3>
              <div class="xq-move-log">${
                match.moves.length
                  ? match.moves.map((m, i) => `<div>#${i + 1} ${escapeHtml(m.note || "")}</div>`).join("")
                  : "—"
              }</div>
            </div>
            <div class="xq-panel xq-chat-box">
              <h3>Chat · Reaction</h3>
              <div class="xq-move-log">${chatLog.map((x) => `<div>${escapeHtml(x)}</div>`).join("") || '<span class="caro-muted">👏 🔥 😂 — spectator sắp có</span>'}</div>
              <input type="text" maxlength="120" placeholder="Nhắn nhanh…" data-xq-chat-input />
              <div class="xq-actions">
                <button type="button" class="caro-btn ghost" data-act="xq-react" data-emoji="👏">👏</button>
                <button type="button" class="caro-btn ghost" data-act="xq-react" data-emoji="🔥">🔥</button>
                <button type="button" class="caro-btn ghost" data-act="xq-react" data-emoji="😂">😂</button>
              </div>
            </div>
            <div class="xq-panel">
              <h3>Replay</h3>
              <div class="xq-replay-bar">
                <button type="button" class="caro-btn ghost" data-act="xq-replay-start">▶ Play</button>
                <button type="button" class="caro-btn ghost" data-act="xq-replay-pause">Pause</button>
                <button type="button" class="caro-btn ghost" data-act="xq-replay-prev">◀</button>
                <button type="button" class="caro-btn ghost" data-act="xq-replay-next">▶</button>
              </div>
            </div>
            <div class="xq-actions">
              <button type="button" class="caro-btn ghost" data-act="xq-draw">Hòa</button>
              <button type="button" class="caro-btn" data-act="xq-resign">Đầu hàng</button>
              <button type="button" class="caro-btn ghost" data-act="xq-home">← Sảnh</button>
            </div>
          </aside>
        </div>
        <div class="xq-player-bar${botCheck ? " in-check" : ""}" style="margin-top:0.5rem">
          <span>Bạn · ${stats.elo} ELO ${botCheck ? "🔥 Chiếu" : ""}</span>
          <span>⏱ ${formatTime(match.redTimeMs)}</span>
        </div>
      </div>`;
  }

  function handleAction(act, el) {
    if (act === "xq-ai") {
      startAi(el?.dataset?.level || "medium");
      return "xiangqi-play";
    }
    if (act === "xq-local") {
      startLocalPvp();
      return "xiangqi-play";
    }
    if (act === "xq-home") {
      clearMatch();
      return "xiangqi-home";
    }
    if (act === "xq-quick" || act === "xq-room-soon" || act === "xq-rank-soon" || act === "xq-spectate-soon") {
      toast("Chế độ online đang được xây — thử AI hoặc 2 người cùng máy trước nhé.");
      return null;
    }
    if (act === "xq-resign" && match?.status === "playing") {
      const loser = match.turn;
      finishGame(loser === SIDE_RED ? SIDE_BLACK : SIDE_RED);
      return "xiangqi-play";
    }
    if (act === "xq-draw" && match?.status === "playing") {
      finishGame("draw");
      return "xiangqi-play";
    }
    if (act === "xq-react") {
      chatLog.push(`${playerName()} ${el?.dataset?.emoji || "👏"}`);
      return "xiangqi-play";
    }
    if (act === "xq-replay-prev" && match?.moves?.length) {
      replayIdx = Math.max(-1, replayIdx - 1);
      return "xiangqi-play";
    }
    if (act === "xq-replay-next" && match?.moves?.length) {
      replayIdx = Math.min(match.moves.length - 1, replayIdx + 1);
      return "xiangqi-play";
    }
    if (act === "xq-replay-pause") {
      stopReplay();
      return "xiangqi-play";
    }
    if (act === "xq-replay-start" && match?.moves?.length) {
      stopReplay();
      replayIdx = -1;
      replayPlaying = true;
      replayTimer = setInterval(() => {
        if (!match?.moves?.length) return;
        replayIdx++;
        if (replayIdx >= match.moves.length - 1) stopReplay();
        deps.onReplayTick?.();
      }, 700);
      return "xiangqi-play";
    }
    if (act === "xq-dismiss-win") return "xiangqi-play";
    return null;
  }

  function handleCellClick(r, c) {
    return onCellClick(r, c);
  }

  function getMatch() {
    return match;
  }

  return {
    renderHome,
    renderPlay,
    handleAction,
    handleCellClick,
    clearMatch,
    getMatch,
    loadStats,
  };
}
