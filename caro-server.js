import crypto from "crypto";
import {
  STONE_EMPTY,
  STONE_X,
  STONE_O,
  createBoard,
  clampSize,
  placeStone,
  checkWinAt,
  isBoardFull,
  opponent,
} from "./public/caro/caro-engine.js";

/** @typedef {{
 *  id: string,
 *  code: string,
 *  name: string,
 *  password: string,
 *  size: number,
 *  mode: string,
 *  turnMs: number,
 *  allowSpectators: boolean,
 *  public: boolean,
 *  host: string,
 *  players: Array<{ name: string, stone: number|null, ready: boolean, socketId: string|null }>,
 *  spectators: Array<{ name: string, socketId: string }>,
 *  status: string,
 *  board: number[][],
 *  turn: number,
 *  moves: Array<{ r:number,c:number,stone:number,at:number }>,
 *  winner: string|null,
 *  winLine: Array<[number,number]>|null,
 *  turnDeadline: number|null,
 *  chat: Array<{ name: string, text: string, at: number }>,
 *  drawOfferFrom: string|null,
 *  createdAt: number,
 * }} CaroRoom */

/** @type {Map<string, CaroRoom>} */
const rooms = new Map();
/** @type {Map<string, string>} socketId -> roomId */
const socketRoom = new Map();
/** @type {Array<object>} */
const matchHistory = [];
/** @type {Map<string, { name: string, played: number, win: number, loss: number, draw: number, streak: number, elo: number }>} */
const ratings = new Map();
/** @type {string[]} */
const quickQueue = [];

function code6() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function ensureRating(name) {
  const key = String(name || "").trim();
  if (!key) return null;
  if (!ratings.has(key)) {
    ratings.set(key, { name: key, played: 0, win: 0, loss: 0, draw: 0, streak: 0, elo: 1000 });
  }
  return ratings.get(key);
}

function applyElo(winner, loser, draw = false) {
  const a = ensureRating(winner);
  const b = ensureRating(loser);
  if (!a || !b) return;
  a.played++;
  b.played++;
  if (draw) {
    a.draw++;
    b.draw++;
    a.streak = 0;
    b.streak = 0;
    const ea = 1 / (1 + 10 ** ((b.elo - a.elo) / 400));
    a.elo = Math.round(a.elo + 16 * (0.5 - ea));
    b.elo = Math.round(b.elo + 16 * (0.5 - (1 - ea)));
    return;
  }
  a.win++;
  b.loss++;
  a.streak++;
  b.streak = 0;
  const ea = 1 / (1 + 10 ** ((b.elo - a.elo) / 400));
  a.elo = Math.round(a.elo + 24 * (1 - ea));
  b.elo = Math.round(b.elo + 24 * (0 - (1 - ea)));
}

function publicRoomView(room) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    size: room.size,
    mode: room.mode,
    turnMs: room.turnMs,
    allowSpectators: room.allowSpectators,
    public: room.public,
    host: room.host,
    status: room.status,
    players: room.players.map((p) => ({
      name: p.name,
      stone: p.stone,
      ready: p.ready,
      online: Boolean(p.socketId),
    })),
    spectators: room.spectators.map((s) => s.name),
    hasPassword: Boolean(room.password),
    createdAt: room.createdAt,
  };
}

function fullState(room) {
  return {
    ...publicRoomView(room),
    board: room.board,
    turn: room.turn,
    moves: room.moves,
    winner: room.winner,
    winLine: room.winLine,
    turnDeadline: room.turnDeadline,
    chat: room.chat.slice(-80),
    drawOfferFrom: room.drawOfferFrom,
  };
}

function emitRoom(io, room) {
  io.to(`caro:${room.id}`).emit("caro:state", fullState(room));
}

function leaveSocket(io, socket) {
  const roomId = socketRoom.get(socket.id);
  if (!roomId) return;
  const room = rooms.get(roomId);
  socketRoom.delete(socket.id);
  socket.leave(`caro:${roomId}`);
  if (!room) return;

  const p = room.players.find((x) => x.socketId === socket.id);
  if (p) p.socketId = null;
  room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);

  const qIdx = quickQueue.indexOf(socket.id);
  if (qIdx >= 0) quickQueue.splice(qIdx, 1);

  if (room.status === "playing" && p) {
    // mark offline; don't auto-resign immediately
  }

  const onlinePlayers = room.players.filter((x) => x.socketId);
  if (!onlinePlayers.length && !room.spectators.length && room.status !== "playing") {
    rooms.delete(roomId);
    return;
  }
  emitRoom(io, room);
}

function startGame(room) {
  room.status = "playing";
  room.board = createBoard(room.size);
  room.turn = STONE_X;
  room.moves = [];
  room.winner = null;
  room.winLine = null;
  room.drawOfferFrom = null;
  room.turnDeadline = Date.now() + room.turnMs;
  if (room.players[0]) room.players[0].stone = STONE_X;
  if (room.players[1]) room.players[1].stone = STONE_O;
}

function finishGame(room, winnerName, reason = "win") {
  room.status = reason === "draw" ? "draw" : "finished";
  room.winner = winnerName || null;
  room.turnDeadline = null;
  const names = room.players.map((p) => p.name);
  if (names.length >= 2) {
    if (reason === "draw") applyElo(names[0], names[1], true);
    else if (winnerName) {
      const loser = names.find((n) => n !== winnerName) || names[1];
      applyElo(winnerName, loser, false);
    }
  }
  matchHistory.unshift({
    id: crypto.randomUUID(),
    code: room.code,
    players: names,
    winner: winnerName,
    reason,
    size: room.size,
    mode: room.mode,
    moves: room.moves.slice(),
    at: Date.now(),
  });
  if (matchHistory.length > 200) matchHistory.length = 200;
}

/**
 * @param {import("socket.io").Server} io
 */
export function attachCaroServer(io) {
  io.on("connection", (socket) => {
    socket.on("disconnect", () => leaveSocket(io, socket));

    socket.on("caro:list_rooms", (ack) => {
      const list = [...rooms.values()]
        .filter((r) => r.public && r.status !== "finished" && r.status !== "draw")
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 40)
        .map(publicRoomView);
      if (typeof ack === "function") ack({ ok: true, rooms: list });
    });

    socket.on("caro:leaderboard", (ack) => {
      const list = [...ratings.values()]
        .sort((a, b) => b.elo - a.elo || b.win - a.win)
        .slice(0, 30)
        .map((r) => ({
          ...r,
          winRate: r.played ? Math.round((r.win / r.played) * 100) : 0,
        }));
      if (typeof ack === "function") ack({ ok: true, list });
    });

    socket.on("caro:history", (ack) => {
      if (typeof ack === "function") ack({ ok: true, list: matchHistory.slice(0, 40) });
    });

    socket.on("caro:create_room", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });

      const room = {
        id: crypto.randomUUID(),
        code: code6(),
        name: String(raw?.name || `${name}'s room`).trim().slice(0, 48) || "Phòng Caro",
        password: String(raw?.password || "").slice(0, 32),
        size: clampSize(raw?.size),
        mode: raw?.mode === "tournament" ? "tournament" : "freestyle",
        turnMs: [30, 60, 90, 180].includes(Number(raw?.turnSec))
          ? Number(raw.turnSec) * 1000
          : 60_000,
        allowSpectators: raw?.allowSpectators !== false,
        public: raw?.public !== false,
        host: name,
        players: [{ name, stone: null, ready: false, socketId: socket.id }],
        spectators: [],
        status: "lobby",
        board: createBoard(clampSize(raw?.size)),
        turn: STONE_X,
        moves: [],
        winner: null,
        winLine: null,
        turnDeadline: null,
        chat: [],
        drawOfferFrom: null,
        createdAt: Date.now(),
      };
      rooms.set(room.id, room);
      socketRoom.set(socket.id, room.id);
      socket.join(`caro:${room.id}`);
      ensureRating(name);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
      emitRoom(io, room);
    });

    socket.on("caro:join_room", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      const code = String(raw?.code || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const room = [...rooms.values()].find((r) => r.code === code);
      if (!room) return typeof ack === "function" && ack({ ok: false, reason: "Không tìm thấy phòng." });
      if (room.password && room.password !== String(raw?.password || "")) {
        return typeof ack === "function" && ack({ ok: false, reason: "Sai mật khẩu phòng." });
      }

      leaveSocket(io, socket);

      const existing = room.players.find((p) => p.name === name);
      const slotFull = room.players.filter((p) => p.socketId || p.name).length >= 2;
      const asSpectator = Boolean(raw?.spectate) || (!existing && slotFull);
      if (asSpectator) {
        if (!room.allowSpectators) {
          return typeof ack === "function" && ack({ ok: false, reason: "Phòng không cho xem." });
        }
        room.spectators = room.spectators.filter((s) => s.name !== name);
        room.spectators.push({ name, socketId: socket.id });
      } else {
        if (existing) {
          existing.socketId = socket.id;
        } else room.players.push({ name, stone: null, ready: false, socketId: socket.id });
      }
      socketRoom.set(socket.id, room.id);
      socket.join(`caro:${room.id}`);
      ensureRating(name);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
      emitRoom(io, room);
    });

    socket.on("caro:resume", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      leaveSocket(io, socket);
      const active = [...rooms.values()]
        .filter((r) => r.status !== "finished" && r.status !== "draw")
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      for (const room of active) {
        const p = room.players.find((x) => x.name === name);
        if (!p) continue;
        p.socketId = socket.id;
        room.spectators = room.spectators.filter((s) => s.name !== name);
        socketRoom.set(socket.id, room.id);
        socket.join(`caro:${room.id}`);
        ensureRating(name);
        if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
        emitRoom(io, room);
        return;
      }
      if (typeof ack === "function") ack({ ok: false, reason: "Không còn phòng đang mở." });
    });

    socket.on("caro:leave", () => leaveSocket(io, socket));

    socket.on("caro:ready", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const p = room.players.find((x) => x.socketId === socket.id);
      if (!p || room.status !== "lobby") return typeof ack === "function" && ack({ ok: false });
      p.ready = !p.ready;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true, ready: p.ready });
    });

    socket.on("caro:start", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false, reason: "Hết phòng." });
      const me = String(socket.data?.name || "").trim();
      if (room.host !== me) return typeof ack === "function" && ack({ ok: false, reason: "Chỉ host bắt đầu." });
      if (room.players.length < 2) {
        return typeof ack === "function" && ack({ ok: false, reason: "Cần 2 người chơi." });
      }
      if (!room.players.every((p) => p.ready || p.name === room.host)) {
        // host can force; others should be ready ideally — require both ready except allow host force if both present
      }
      if (!room.players[1]?.ready && room.players[1]?.name) {
        // soft: require guest ready
        if (!room.players.every((p) => p.ready)) {
          return typeof ack === "function" && ack({ ok: false, reason: "Chờ mọi người sẵn sàng." });
        }
      }
      startGame(room);
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:move", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "playing") {
        return typeof ack === "function" && ack({ ok: false, reason: "Chưa trong trận." });
      }
      const me = String(socket.data?.name || "").trim();
      const player = room.players.find((p) => p.name === me && p.socketId === socket.id);
      if (!player || player.stone !== room.turn) {
        return typeof ack === "function" && ack({ ok: false, reason: "Chưa tới lượt." });
      }
      if (room.turnDeadline && Date.now() > room.turnDeadline + 800) {
        const other = room.players.find((p) => p.name !== me)?.name || null;
        finishGame(room, other, "timeout");
        emitRoom(io, room);
        return typeof ack === "function" && ack({ ok: false, reason: "Hết giờ." });
      }
      const r = Number(raw?.r);
      const c = Number(raw?.c);
      if (!placeStone(room.board, r, c, player.stone)) {
        return typeof ack === "function" && ack({ ok: false, reason: "Ô không hợp lệ." });
      }
      room.moves.push({ r, c, stone: player.stone, at: Date.now() });
      const win = checkWinAt(room.board, r, c, room.mode);
      if (win.win) {
        room.winLine = win.line;
        finishGame(room, me, "win");
      } else if (isBoardFull(room.board)) {
        finishGame(room, null, "draw");
      } else {
        room.turn = opponent(player.stone);
        room.turnDeadline = Date.now() + room.turnMs;
      }
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:resign", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "playing") return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const other = room.players.find((p) => p.name !== me)?.name || null;
      finishGame(room, other, "resign");
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:draw_offer", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "playing") return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      room.drawOfferFrom = me;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:draw_response", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "playing" || !room.drawOfferFrom) {
        return typeof ack === "function" && ack({ ok: false });
      }
      const me = String(socket.data?.name || "").trim();
      if (me === room.drawOfferFrom) return typeof ack === "function" && ack({ ok: false });
      if (raw?.accept) finishGame(room, null, "draw");
      else room.drawOfferFrom = null;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:chat", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const text = String(raw?.text || "").trim().slice(0, 240);
      if (!me || !text) return typeof ack === "function" && ack({ ok: false });
      room.chat.push({ name: me, text, at: Date.now() });
      if (room.chat.length > 120) room.chat.splice(0, room.chat.length - 120);
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:rematch", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      if (room.host !== me) return typeof ack === "function" && ack({ ok: false, reason: "Chỉ host." });
      room.players.forEach((p) => {
        p.ready = false;
      });
      room.status = "lobby";
      room.board = createBoard(room.size);
      room.moves = [];
      room.winner = null;
      room.winLine = null;
      room.turnDeadline = null;
      room.drawOfferFrom = null;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("caro:quick_match", (ack) => {
      const name = String(socket.data?.name || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      if (quickQueue.includes(socket.id)) {
        return typeof ack === "function" && ack({ ok: true, waiting: true });
      }
      while (quickQueue.length) {
        const otherId = quickQueue.shift();
        const otherSock = io.sockets.sockets.get(otherId);
        if (!otherSock || !otherSock.data?.name) continue;
        const otherName = String(otherSock.data.name).trim();
        if (otherName === name) continue;
        leaveSocket(io, socket);
        leaveSocket(io, otherSock);
        const room = {
          id: crypto.randomUUID(),
          code: code6(),
          name: "Quick Match",
          password: "",
          size: 15,
          mode: "freestyle",
          turnMs: 60_000,
          allowSpectators: true,
          public: false,
          host: otherName,
          players: [
            { name: otherName, stone: null, ready: true, socketId: otherId },
            { name, stone: null, ready: true, socketId: socket.id },
          ],
          spectators: [],
          status: "lobby",
          board: createBoard(15),
          turn: STONE_X,
          moves: [],
          winner: null,
          winLine: null,
          turnDeadline: null,
          chat: [],
          drawOfferFrom: null,
          createdAt: Date.now(),
        };
        rooms.set(room.id, room);
        socketRoom.set(socket.id, room.id);
        socketRoom.set(otherId, room.id);
        socket.join(`caro:${room.id}`);
        otherSock.join(`caro:${room.id}`);
        startGame(room);
        emitRoom(io, room);
        otherSock.emit("caro:quick_matched", { room: fullState(room) });
        if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
        return;
      }
      quickQueue.push(socket.id);
      if (typeof ack === "function") ack({ ok: true, waiting: true });
    });

    socket.on("caro:cancel_quick", () => {
      const i = quickQueue.indexOf(socket.id);
      if (i >= 0) quickQueue.splice(i, 1);
    });
  });

  // turn timeout ticker
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status !== "playing" || !room.turnDeadline) continue;
      if (now <= room.turnDeadline + 500) continue;
      const current = room.players.find((p) => p.stone === room.turn);
      const other = room.players.find((p) => p.stone !== room.turn);
      finishGame(room, other?.name || null, "timeout");
      emitRoom(io, room);
    }
  }, 1000);
}
