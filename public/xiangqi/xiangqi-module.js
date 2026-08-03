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
    stopReplay();
    aiGen++;
    aiBusy = false;
    match = createMatchState({ mode: "ai", aiLevel: level, meSide: SIDE_RED });
    selected = null;
    targets = [];
    chatLog = [];
    replayIdx = -1;
    return match;
  }

  function startLocalPvp() {
    stopReplay();
    aiGen++;
    aiBusy = false;
    match = createMatchState({ mode: "local", meSide: SIDE_RED });
    selected = null;
    targets = [];
    chatLog = [];
    replayIdx = -1;
    return match;
  }

  function clearMatch() {
    stopReplay();
    aiGen++;
    aiBusy = false;
    match = null;
    selected = null;
    targets = [];
  }

  let aiGen = 0;

  function notifyUi() {
    try {
      deps.onUpdate?.();
    } catch (_) {}
  }

  /** Chỉ cập nhật bàn — nhẹ hơn full render (giảm đơ). */
  function notifyBoard() {
    try {
      if (deps.onBoardUpdate?.()) return;
    } catch (_) {}
    notifyUi();
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
      void runAiTurn();
    }
  }

  async function runAiTurn() {
    if (!match) return;
    if (match.mode !== "ai" || match.status !== "playing" || match.turn === match.meSide) {
      aiBusy = false;
      return;
    }
    if (aiBusy) return;

    const gen = ++aiGen;
    aiBusy = true;
    notifyBoard();

    const thinkingMatch = match;
    const level = thinkingMatch.aiLevel || "medium";
    const side = thinkingMatch.turn;

    try {
      await new Promise((r) => setTimeout(r, aiThinkDelay(level)));
      if (gen !== aiGen || match !== thinkingMatch || match.status !== "playing" || match.turn !== side) {
        return;
      }

      let mv = null;
      try {
        mv = pickAiMove(match.board, side, level, { ply: match.moves?.length || 0 });
      } catch (err) {
        console.error("pickAiMove", err);
        mv = allLegalMoves(match.board, side)[0] || null;
      }

      if (gen !== aiGen || match !== thinkingMatch) return;

      aiBusy = false;
      if (mv) {
        commitMove(mv.fromR, mv.fromC, mv.toR, mv.toC);
      } else {
        const res = gameResult(match.board, side);
        if (res) finishGame(res);
      }
    } catch (err) {
      console.error("xiangqi AI", err);
      aiBusy = false;
    } finally {
      if (gen === aiGen) aiBusy = false;
      notifyBoard();
    }
  }

  function commitMove(fromR, fromC, toR, toC) {
    if (!match || match.status !== "playing") return false;
    const moving = match.board[fromR]?.[fromC];
    if (!moving || moving === ".") return false;
    // Chỉ cho đi nước hợp lệ
    const legal = legalMovesFrom(match.board, fromR, fromC, match.turn);
    if (!legal.some(([tr, tc]) => tr === toR && tc === toC)) return false;

    const cap = match.board[toR][toC];
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
    return true;
  }

  function onCellClick(r, c) {
    if (!match || match.status !== "playing" || aiBusy) return false;
    if (match.mode === "ai" && match.turn !== match.meSide) return false;

    const board = match.board;
    const p = board[r][c];
    const mySide = match.mode === "local" ? match.turn : match.meSide;

    if (selected) {
      const [sr, sc] = selected;
      const hit = targets.some(([tr, tc]) => tr === r && tc === c);
      if (hit) {
        const ok = commitMove(sr, sc, r, c);
        return ok;
      }
      // Click quân mình khác → chọn lại
      if (p !== "." && pieceSide(p) === mySide) {
        selected = [r, c];
        targets = legalMovesFrom(board, r, c, mySide);
        return true;
      }
      selected = null;
      targets = [];
      return true;
    }

    if (p !== "." && pieceSide(p) === mySide) {
      selected = [r, c];
      targets = legalMovesFrom(board, r, c, mySide);
      return true;
    }
    return false;
  }

  /** Toạ độ pixel trên SVG bàn chuẩn (có sông giữa). */
  function boardPoint(r, c) {
    const x = c * 100;
    const y = r <= 4 ? r * 100 : 500 + (r - 5) * 100;
    return { x, y };
  }

  function renderBoardMarkers() {
    // Dấu góc truyền thống quanh ô Pháo / Tốt
    const spots = [
      [2, 1],
      [2, 7],
      [7, 1],
      [7, 7],
      [3, 0],
      [3, 2],
      [3, 4],
      [3, 6],
      [3, 8],
      [6, 0],
      [6, 2],
      [6, 4],
      [6, 6],
      [6, 8],
    ];
    const arm = 14;
    const gap = 5;
    return spots
      .map(([r, c]) => {
        const { x, y } = boardPoint(r, c);
        const parts = [];
        // 4 góc hướng vào giao điểm
        if (c > 0) {
          parts.push(`M${x - arm},${y - gap} H${x - gap} V${y - arm}`);
          parts.push(`M${x - arm},${y + gap} H${x - gap} V${y + arm}`);
        }
        if (c < 8) {
          parts.push(`M${x + arm},${y - gap} H${x + gap} V${y - arm}`);
          parts.push(`M${x + arm},${y + gap} H${x + gap} V${y + arm}`);
        }
        // Biên trái/phải: chỉ vẽ phía trong bàn
        if (c === 0) {
          parts.length = 0;
          parts.push(`M${x + gap},${y - arm} V${y - gap} H${x + arm}`);
          parts.push(`M${x + gap},${y + arm} V${y + gap} H${x + arm}`);
        }
        if (c === 8) {
          parts.length = 0;
          parts.push(`M${x - gap},${y - arm} V${y - gap} H${x - arm}`);
          parts.push(`M${x - gap},${y + arm} V${y + gap} H${x - arm}`);
        }
        return `<path d="${parts.join(" ")}" />`;
      })
      .join("");
  }

  function renderBoardHtml(board, interactive) {
    const VB_W = 800;
    const VB_H = 900;
    let grid = "";

    // Viền kép ngoài
    grid += `<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="none" stroke-width="6" />`;
    grid += `<rect x="8" y="8" width="${VB_W - 16}" height="${VB_H - 16}" fill="none" stroke-width="2" opacity="0.55" />`;

    // 10 đường ngang (0..4 và 5..9 với khoảng sông 400–500)
    for (let r = 0; r <= 9; r++) {
      const y = boardPoint(r, 0).y;
      grid += `<line x1="0" y1="${y}" x2="${VB_W}" y2="${y}" />`;
    }

    // 9 đường dọc — ĐỨT ở sông (không xuyên 楚河漢界)
    for (let c = 0; c <= 8; c++) {
      const x = c * 100;
      grid += `<line x1="${x}" y1="0" x2="${x}" y2="400" />`;
      grid += `<line x1="${x}" y1="500" x2="${x}" y2="900" />`;
    }

    // Cửu cung (X)
    grid += `<line x1="300" y1="0" x2="500" y2="200" /><line x1="500" y1="0" x2="300" y2="200" />`;
    grid += `<line x1="300" y1="700" x2="500" y2="900" /><line x1="500" y1="700" x2="300" y2="900" />`;

    // Chữ sông
    const river = `
      <text x="200" y="458" text-anchor="middle" class="xq-river-txt">楚 河</text>
      <text x="600" y="458" text-anchor="middle" class="xq-river-txt">漢 界</text>`;

    let points = "";
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        const { x, y } = boardPoint(r, c);
        const left = (x / VB_W) * 100;
        const top = (y / VB_H) * 100;
        const isSel = selected && selected[0] === r && selected[1] === c;
        const isT = targets.some(([tr, tc]) => tr === r && tc === c);
        points += `<button type="button" class="xq-point${isSel ? " is-selected" : ""}${isT ? " is-target" : ""}${
          p !== "." ? " has-piece" : ""
        }" style="left:${left}%;top:${top}%" data-xq-r="${r}" data-xq-c="${c}" ${
          interactive ? "" : "tabindex=-1"
        } aria-label="${r},${c}">`;
        points += `<span class="xq-dot-hint" aria-hidden="true"></span>`;
        if (p !== ".") {
          const side = pieceSide(p) === SIDE_RED ? "red" : "black";
          points += `<span class="xq-piece ${side}">${pieceLabel(p)}</span>`;
        }
        points += `</button>`;
      }
    }

    return `<div class="xq-board" data-xq-board-root role="grid" aria-label="Bàn cờ tướng">
      <svg class="xq-board-svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" aria-hidden="true">
        <rect class="xq-board-face" x="0" y="0" width="${VB_W}" height="${VB_H}" />
        <g class="xq-grid-lines" fill="none" stroke="#3d2410" stroke-linecap="square">${grid}</g>
        <g class="xq-pos-marks" fill="none" stroke="#3d2410" stroke-width="2.2">${renderBoardMarkers()}</g>
        ${river}
      </svg>
      <div class="xq-points">${points}</div>
    </div>`;
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function heroBoardArt() {
    return `<svg class="xq-hero-board-svg" viewBox="0 0 280 240" aria-hidden="true">
      <defs>
        <linearGradient id="xqBoardGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1a2a4a"/>
          <stop offset="100%" stop-color="#0a1428"/>
        </linearGradient>
        <filter id="xqGlow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <radialGradient id="xqRed" cx="35%" cy="30%"><stop offset="0%" stop-color="#ffb347"/><stop offset="100%" stop-color="#e11"/></radialGradient>
        <radialGradient id="xqBlk" cx="35%" cy="30%"><stop offset="0%" stop-color="#5a7a9a"/><stop offset="100%" stop-color="#1a2838"/></radialGradient>
      </defs>
      <rect x="28" y="18" width="224" height="204" rx="10" fill="url(#xqBoardGrad)" stroke="#29d9ff" stroke-width="2" filter="url(#xqGlow)"/>
      ${[0,1,2,3,4,5,6,7,8].map((i)=>`<line x1="${40+i*24}" y1="30" x2="${40+i*24}" y2="210" stroke="#29d9ff" stroke-opacity="0.35" stroke-width="1"/>`).join("")}
      ${[0,1,2,3,4,5,6,7,8,9].map((i)=>`<line x1="40" y1="${30+i*20}" x2="232" y2="${30+i*20}" stroke="#29d9ff" stroke-opacity="0.35" stroke-width="1"/>`).join("")}
      <text x="140" y="128" text-anchor="middle" fill="#ffd166" fill-opacity="0.35" font-size="11" letter-spacing="4">楚河 · 漢界</text>
      <circle cx="88" cy="50" r="13" fill="url(#xqBlk)" stroke="#00d2ff" stroke-width="1.5" filter="url(#xqGlow)"/><text x="88" y="54" text-anchor="middle" fill="#e8f4ff" font-size="11" font-weight="700">車</text>
      <circle cx="140" cy="50" r="14" fill="url(#xqBlk)" stroke="#00d2ff" stroke-width="1.5" filter="url(#xqGlow)"/><text x="140" y="55" text-anchor="middle" fill="#e8f4ff" font-size="12" font-weight="800">將</text>
      <circle cx="192" cy="50" r="13" fill="url(#xqBlk)" stroke="#00d2ff" stroke-width="1.5"/><text x="192" y="54" text-anchor="middle" fill="#e8f4ff" font-size="11" font-weight="700">馬</text>
      <circle cx="112" cy="190" r="13" fill="url(#xqRed)" stroke="#ffd166" stroke-width="1.5" filter="url(#xqGlow)"/><text x="112" y="194" text-anchor="middle" fill="#fff" font-size="11" font-weight="700">炮</text>
      <circle cx="164" cy="190" r="14" fill="url(#xqRed)" stroke="#ffd166" stroke-width="1.5" filter="url(#xqGlow)"/><text x="164" y="195" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">帅</text>
      <circle cx="64" cy="170" r="11" fill="url(#xqRed)" stroke="#ffd166" stroke-width="1.2"/><text x="64" y="174" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">兵</text>
    </svg>`;
  }

  function renderHome(extra = {}) {
    const stats = loadStats();
    const online = extra.online ?? 24;
    const live = extra.live ?? 3;
    const topName = extra.topName || "—";
    const winRate = stats.played ? Math.round((stats.win / stats.played) * 100) : 0;

    return `
      <div class="xq-shell">
        <section class="xq-hero-cinematic caro-reveal" style="--i:0">
          <div>
            <div class="xq-hero-brand">
              <div class="xq-hero-piece-3d" aria-hidden="true">帥</div>
              <div>
                <p class="xq-kicker">Trí tuệ — Chiến thuật — Tư duy sâu</p>
                <h1 class="xq-title-glow">CỜ TƯỚNG</h1>
              </div>
            </div>
            <p class="xq-lead">Mỗi nước đi đổi cục diện. Rèn luyện tư duy, tính toán nhiều bước — từ AI đến kỳ thủ mạnh trên hệ thống.</p>
            <div class="xq-hero-mini">
              <div class="xq-mini-card">
                <strong>Luật cơ bản</strong>
                Bàn 9×10 · 16 quân mỗi bên<br/>Chiếu bí Tướng để thắng
              </div>
              <div class="xq-mini-card">
                <strong>Chế độ</strong>
                AI 4 cấp · Local 2 người<br/>Online · Spectator sắp mở
              </div>
            </div>
            <button type="button" class="xq-play-now" data-act="xq-ai" data-level="medium">
              <span class="glow" aria-hidden="true"></span>
              ▶ Chơi ngay
            </button>
          </div>
          <div class="xq-hero-art">
            <div class="xq-hero-orbit" aria-hidden="true"></div>
            ${heroBoardArt()}
          </div>
        </section>

        <div class="caro-hub-stats caro-reveal" style="--i:1;margin-top:1rem">
          <div class="caro-hub-stat tint-cyan">
            <span class="stat-ico" aria-hidden="true">👥</span>
            <div><span>Người online</span><strong>${online}</strong></div>
          </div>
          <div class="caro-hub-stat tint-blue">
            <span class="stat-ico" aria-hidden="true">⚔</span>
            <div><span>Trận đang diễn ra</span><strong>${live}</strong></div>
          </div>
          <div class="caro-hub-stat tint-gold">
            <span class="stat-ico" aria-hidden="true">🏆</span>
            <div><span>Top hôm nay</span><strong>${escapeHtml(topName)}</strong></div>
          </div>
          <div class="caro-hub-stat tint-purple">
            <span class="stat-ico" aria-hidden="true">🔥</span>
            <div><span>Chuỗi thắng</span><strong>${stats.streak}</strong></div>
          </div>
        </div>

        <div class="xq-mode-grid caro-reveal" style="--i:1;margin-top:1rem">
          <article class="xq-mode-card m-ai">
            <span class="xq-hot-tag">HOT</span>
            <span class="ico">🤖</span>
            <h3>Chơi với AI</h3>
            <p>Easy → Master · mở ván ngay</p>
            <div class="xq-ai-row">
              <button type="button" data-act="xq-ai" data-level="easy">Easy</button>
              <button type="button" data-act="xq-ai" data-level="medium">Medium</button>
              <button type="button" data-act="xq-ai" data-level="hard">Hard</button>
              <button type="button" class="master" data-act="xq-ai" data-level="master">Master</button>
            </div>
          </article>
          <button type="button" class="xq-mode-card m-friends" data-act="xq-local">
            <span class="ico">👥</span>
            <h3>Chơi với bạn</h3>
            <p>Cùng máy · 2 người luân phiên</p>
            <span class="cta">Chơi ngay</span>
          </button>
          <button type="button" class="xq-mode-card m-online" data-act="xq-quick">
            <span class="ico">⚡</span>
            <h3>Chơi online</h3>
            <p>Quick Match · ghép ngẫu nhiên</p>
            <span class="cta">Ghép trận</span>
          </button>
          <button type="button" class="xq-mode-card m-create" data-act="xq-room-soon">
            <span class="ico">＋</span>
            <h3>Tạo phòng</h3>
            <p>Phòng riêng · mã mời · spectator</p>
            <span class="cta">Tạo phòng</span>
          </button>
        </div>

        <div class="xq-info-row caro-reveal" style="--i:2;margin-top:1rem">
          <div class="xq-glass">
            <h3>Luật chơi</h3>
            <p><strong>Mục tiêu:</strong> Chiếu bí Tướng đối phương.</p>
            <p>9 cột · 10 hàng · Sông · Cửu cung</p>
          </div>
          <div class="xq-glass">
            <h3>Quân cờ</h3>
            <div class="xq-piece-list">
              <span>帅/将 Tướng</span><span>仕/士 Sĩ</span>
              <span>相/象 Tượng</span><span>马 Mã</span>
              <span>车 Xe</span><span>炮 Pháo</span>
              <span>兵/卒 Tốt</span>
            </div>
          </div>
          <div class="xq-glass">
            <h3>Luật đặc biệt</h3>
            <ul style="margin:0;padding-left:1.05rem">
              <li>Tướng không đối mặt</li>
              <li>Pháo nhảy 1 quân để ăn</li>
              <li>Tượng không qua sông · Mã bị chặn chân</li>
            </ul>
          </div>
        </div>

        <section class="xq-glass caro-reveal" style="--i:3;margin-top:1rem">
          <h3>Thành tựu</h3>
          <div class="xq-ach-row">
            <span class="xq-ach-pill">🏆 Thắng 10 trận</span>
            <span class="xq-ach-pill">👑 Thắng AI Master</span>
            <span class="xq-ach-pill">🚗 Không mất Xe</span>
            <span class="xq-ach-pill">⚡ Chiếu bí ≤30 nước</span>
            <span class="xq-ach-pill">🌐 100 trận Online</span>
          </div>
        </section>

        <section class="xq-glass caro-reveal" style="--i:3;margin-top:1rem;display:none" data-xq-stats-hidden>
          <h3>Thống kê</h3>
          <div class="xq-win-ring" style="--pct:${winRate}"><span>${winRate}%</span></div>
        </section>
      </div>`;
  }

  function renderPlay() {
    if (!match) return `<div class="caro-empty">Chưa có ván.</div>`;
    const stats = loadStats();
    const board = replayIdx >= 0 ? boardAtReplay() : match.board;
    const topCheck = match.checkSide === SIDE_BLACK && match.status === "playing";
    const botCheck = match.checkSide === SIDE_RED && match.status === "playing";
    const winRate = stats.played ? Math.round((stats.win / stats.played) * 100) : 0;
    const oppLabel =
      match.mode === "ai" ? `AI · ${String(match.aiLevel || "medium").toUpperCase()}` : "Đối thủ Local";
    const oppElo = stats.elo + 34;
    const turnLabel =
      match.status !== "playing"
        ? match.status === "draw"
          ? "Hòa"
          : "Kết thúc"
        : match.turn === SIDE_RED
          ? "Lượt Đỏ"
          : "Lượt Đen";

    const movePairs = [];
    for (let i = 0; i < match.moves.length; i += 2) {
      movePairs.push({
        n: Math.floor(i / 2) + 1,
        a: match.moves[i]?.note || "—",
        b: match.moves[i + 1]?.note || "",
      });
    }
    const recentPairs = movePairs.slice(-6).reverse();

    const overlay =
      match.status === "finished" || match.status === "draw"
        ? `<div class="xq-checkmate-overlay" data-act="xq-dismiss-win">
            <div class="xq-checkmate-card">
              <div class="xq-win-trophy" aria-hidden="true">🏆</div>
              <h2>${match.status === "draw" ? "HÒA CỜ" : "CHECKMATE"}</h2>
              <p>${
                match.status === "draw"
                  ? "Trận hòa — cả hai đều bản lĩnh."
                  : match.winner === match.meSide || match.mode === "local"
                    ? "Bạn chiến thắng!"
                    : "Đối thủ thắng."
              }</p>
              <p class="xq-elo-delta">${match.mode === "ai" && match.winner === match.meSide ? "+15 ELO" : ""}</p>
              <button type="button" class="xq-btn-primary" data-act="xq-home">Về sảnh Cờ Tướng</button>
            </div>
          </div>`
        : "";

    const level = match.aiLevel || "medium";

    return `
      <div class="xq-play-arena xq-shell">
        ${overlay}
        <div class="xq-play-ambient" aria-hidden="true"></div>

        <header class="xq-play-header">
          <div class="xq-play-crumb">
            <button type="button" class="xq-link" data-act="xq-home">Cờ Tướng</button>
            <span>/</span>
            <span>${match.mode === "ai" ? "Chơi với AI" : "Chơi Local"}</span>
          </div>
          <div class="xq-play-timer-pill">
            <span class="xq-timer-ico" aria-hidden="true">⏱</span>
            <div>
              <small>Thời gian còn lại</small>
              <strong data-xq-clock>${formatTime(match.redTimeMs)}</strong>
            </div>
          </div>
          <button type="button" class="xq-icon-btn" data-act="xq-home" title="Sảnh" aria-label="Về sảnh">⌂</button>
        </header>

        <div class="xq-play-grid">
          <aside class="xq-play-left">
            <section class="xq-glass-card">
              <h3>Nước đi gần đây</h3>
              <div class="xq-move-grid">
                ${
                  recentPairs.length
                    ? recentPairs
                        .map(
                          (p) => `<div class="xq-move-pair">
                            <span class="xq-move-n">${p.n}</span>
                            <span>${escapeHtml(p.a)}</span>
                            <span>${escapeHtml(p.b)}</span>
                          </div>`
                        )
                        .join("")
                    : `<p class="xq-muted">Chưa có nước — hãy đi tiên.</p>`
                }
              </div>
            </section>
            <section class="xq-glass-card xq-chat-card">
              <h3>Chat phòng</h3>
              <div class="xq-chat-log">${
                chatLog.length
                  ? chatLog.map((x) => `<div class="xq-chat-line">${escapeHtml(x)}</div>`).join("")
                  : `<p class="xq-muted">👏 🔥 😂 — spectator sắp có</p>`
              }</div>
              <div class="xq-chat-compose">
                <input type="text" maxlength="120" placeholder="Nhập tin nhắn…" data-xq-chat-input />
              </div>
              <div class="xq-react-row">
                <button type="button" class="xq-react" data-act="xq-react" data-emoji="👏">👏</button>
                <button type="button" class="xq-react" data-act="xq-react" data-emoji="🔥">🔥</button>
                <button type="button" class="xq-react" data-act="xq-react" data-emoji="😂">😂</button>
              </div>
            </section>
          </aside>

          <section class="xq-play-center">
            <div class="xq-player-card${topCheck ? " in-check" : ""}">
              <span class="xq-avatar dark">AI</span>
              <div class="xq-player-meta">
                <strong>${escapeHtml(oppLabel)}</strong>
                <span>${oppElo} ELO ${topCheck ? "· 🔥 Chiếu" : ""}</span>
              </div>
              <span class="xq-side-badge black">Đen</span>
              <span class="xq-mini-clock">${formatTime(match.blackTimeMs)}</span>
            </div>

            <div class="xq-board-stage">
              <div class="xq-board-glow" aria-hidden="true"></div>
              <div class="xq-board-wrap wood" data-xq-board-host>
                ${renderBoardHtml(board, match.status === "playing" && replayIdx < 0)}
              </div>
              <div class="xq-turn-chip" data-xq-turn-chip>${turnLabel}${aiBusy ? " · AI đang nghĩ…" : ""}</div>
            </div>

            <div class="xq-player-card you${botCheck ? " in-check" : ""}">
              <span class="xq-avatar red">${escapeHtml((playerName()[0] || "B").toUpperCase())}</span>
              <div class="xq-player-meta">
                <strong>${escapeHtml(playerName())}</strong>
                <span>${stats.elo} ELO ${botCheck ? "· 🔥 Chiếu" : ""}</span>
              </div>
              <span class="xq-side-badge red">Đỏ</span>
              <span class="xq-mini-clock">${formatTime(match.redTimeMs)}</span>
            </div>
          </section>

          <aside class="xq-play-right">
            <section class="xq-glass-card">
              <h3>Chế độ</h3>
              <div class="xq-mode-tabs">
                <button type="button" class="xq-tab" data-act="xq-quick">Quick</button>
                <button type="button" class="xq-tab is-active" data-act="xq-home">AI</button>
                <button type="button" class="xq-tab" data-act="xq-local">Local</button>
              </div>
              ${
                match.mode === "ai"
                  ? `<div class="xq-ai-levels-play">
                      <button type="button" class="${level === "easy" ? "is-on" : ""}" data-act="xq-ai" data-level="easy">Easy</button>
                      <button type="button" class="${level === "medium" ? "is-on" : ""}" data-act="xq-ai" data-level="medium">Medium</button>
                      <button type="button" class="${level === "hard" ? "is-on" : ""}" data-act="xq-ai" data-level="hard">Hard</button>
                      <button type="button" class="master ${level === "master" ? "is-on" : ""}" data-act="xq-ai" data-level="master">Master</button>
                    </div>`
                  : ""
              }
            </section>

            <section class="xq-vs-card">
              <div class="xq-vs-col">
                <span class="xq-avatar red sm">${escapeHtml((playerName()[0] || "B").toUpperCase())}</span>
                <strong>Bạn</strong>
                <span>${stats.elo}</span>
                <small>${stats.win}W ${stats.loss}L ${stats.draw}D</small>
              </div>
              <div class="xq-vs-mid">VS</div>
              <div class="xq-vs-col">
                <span class="xq-avatar dark sm">AI</span>
                <strong>Đối thủ</strong>
                <span>${oppElo}</span>
                <small>${match.mode === "ai" ? level : "local"}</small>
              </div>
            </section>

            <section class="xq-glass-card">
              <h3>Thống kê</h3>
              <div class="xq-stat-bars">
                <div><span>Win rate</span><strong>${winRate}%</strong>
                  <div class="xq-bar"><i style="width:${winRate}%"></i></div>
                </div>
                <div class="xq-stat-inline">
                  <span>Chuỗi thắng <strong>${stats.streak}</strong></span>
                  <span>Tổng trận <strong>${stats.played}</strong></span>
                </div>
              </div>
            </section>

            <section class="xq-glass-card">
              <h3>Replay</h3>
              <div class="xq-replay-bar">
                <button type="button" data-act="xq-replay-start">▶</button>
                <button type="button" data-act="xq-replay-pause">❚❚</button>
                <button type="button" data-act="xq-replay-prev">◀</button>
                <button type="button" data-act="xq-replay-next">▶▶</button>
              </div>
            </section>

            <div class="xq-play-actions">
              <button type="button" class="xq-btn-ghost" data-act="xq-draw">Hòa</button>
              <button type="button" class="xq-btn-danger" data-act="xq-resign">Đầu hàng</button>
              <button type="button" class="xq-btn-primary" data-act="xq-home">← Sảnh</button>
            </div>
          </aside>
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

  function getTurnChipText() {
    if (!match) return "";
    const turnLabel =
      match.status !== "playing"
        ? match.status === "draw"
          ? "Hòa"
          : "Kết thúc"
        : match.turn === SIDE_RED
          ? "Lượt Đỏ"
          : "Lượt Đen";
    return `${turnLabel}${aiBusy ? " · AI đang nghĩ…" : ""}`;
  }

  function patchBoardIn(rootEl) {
    if (!match || !rootEl) return false;
    const host = rootEl.querySelector("[data-xq-board-host]");
    if (!host) return false;
    host.innerHTML = renderBoardHtml(match.board, match.status === "playing" && replayIdx < 0);
    const chip = rootEl.querySelector("[data-xq-turn-chip]");
    if (chip) chip.textContent = getTurnChipText();
    return true;
  }

  return {
    renderHome,
    renderPlay,
    handleAction,
    handleCellClick,
    clearMatch,
    getMatch,
    loadStats,
    patchBoardIn,
    isAiBusy: () => aiBusy,
  };
}
