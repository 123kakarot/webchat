import crypto from "crypto";
import {
  SIDE_RED,
  SIDE_BLACK,
  createInitialBoard,
  applyMove,
  legalMovesFrom,
  gameResult,
  isInCheck,
  moveNotation,
  pieceSide,
  oppositeSide,
} from "./public/xiangqi/xiangqi-engine.js";

/** @type {Map<string, object>} */
const rooms = new Map();
/** @type {Map<string, string>} socketId -> roomId */
const socketRoom = new Map();
/** @type {string[]} */
const quickQueue = [];

function code6() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function fullState(room) {
  return {
    id: room.id,
    code: room.code,
    host: room.host,
    players: room.players.map((p) => ({
      name: p.name,
      side: p.side,
      ready: p.ready,
      connected: Boolean(p.socketId),
    })),
    status: room.status,
    board: room.board,
    turn: room.turn,
    moves: room.moves,
    winner: room.winner,
    checkSide: room.checkSide,
    turnMs: room.turnMs,
    turnDeadline: room.turnDeadline,
    redTimeMs: room.redTimeMs,
    blackTimeMs: room.blackTimeMs,
    chat: room.chat.slice(-40),
    createdAt: room.createdAt,
  };
}

function emitRoom(io, room) {
  io.to(`xq:${room.id}`).emit("xq:state", fullState(room));
}

function leaveSocket(io, socket) {
  const roomId = socketRoom.get(socket.id);
  if (!roomId) return;
  socketRoom.delete(socket.id);
  socket.leave(`xq:${roomId}`);
  const room = rooms.get(roomId);
  if (!room) return;
  const p = room.players.find((x) => x.socketId === socket.id);
  if (p) p.socketId = null;
  room.spectators = (room.spectators || []).filter((s) => s.socketId !== socket.id);
  if (room.status === "lobby" && room.players.every((x) => !x.socketId)) {
    rooms.delete(roomId);
    return;
  }
  emitRoom(io, room);
}

function startGame(room) {
  room.board = createInitialBoard();
  room.turn = SIDE_RED;
  room.moves = [];
  room.status = "playing";
  room.winner = null;
  room.checkSide = null;
  room.drawOfferFrom = null;
  room.turnDeadline = Date.now() + room.turnMs;
  // Host = Red, guest = Black
  if (room.players[0]) room.players[0].side = SIDE_RED;
  if (room.players[1]) room.players[1].side = SIDE_BLACK;
}

function finishGame(room, winner) {
  room.status = winner === "draw" ? "draw" : "finished";
  room.winner = winner;
  room.turnDeadline = null;
}

/**
 * @param {import("socket.io").Server} io
 */
export function attachXiangqiServer(io) {
  io.on("connection", (socket) => {
    socket.on("disconnect", () => {
      const q = quickQueue.indexOf(socket.id);
      if (q >= 0) quickQueue.splice(q, 1);
      leaveSocket(io, socket);
    });

    socket.on("xq:create_room", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });

      leaveSocket(io, socket);

      const room = {
        id: crypto.randomUUID(),
        code: code6(),
        host: name,
        players: [{ name, side: SIDE_RED, ready: true, socketId: socket.id }],
        spectators: [],
        status: "lobby",
        board: createInitialBoard(),
        turn: SIDE_RED,
        moves: [],
        winner: null,
        checkSide: null,
        turnMs: 600_000,
        turnDeadline: null,
        redTimeMs: 600_000,
        blackTimeMs: 600_000,
        chat: [],
        drawOfferFrom: null,
        createdAt: Date.now(),
      };
      rooms.set(room.id, room);
      socketRoom.set(socket.id, room.id);
      socket.join(`xq:${room.id}`);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
      emitRoom(io, room);
    });

    socket.on("xq:join_room", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      const code = String(raw?.code || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const room = [...rooms.values()].find((r) => r.code === code);
      if (!room) return typeof ack === "function" && ack({ ok: false, reason: "Không tìm thấy phòng." });

      leaveSocket(io, socket);

      const existing = room.players.find((p) => p.name === name);
      if (existing) {
        existing.socketId = socket.id;
      } else if (room.players.length >= 2) {
        return typeof ack === "function" && ack({ ok: false, reason: "Phòng đã đủ 2 người." });
      } else {
        room.players.push({ name, side: SIDE_BLACK, ready: true, socketId: socket.id });
      }
      socketRoom.set(socket.id, room.id);
      socket.join(`xq:${room.id}`);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
      emitRoom(io, room);
    });

    socket.on("xq:leave", () => leaveSocket(io, socket));

    socket.on("xq:ready", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "lobby") return typeof ack === "function" && ack({ ok: false });
      const p = room.players.find((x) => x.socketId === socket.id);
      if (!p) return typeof ack === "function" && ack({ ok: false });
      p.ready = !p.ready;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true, ready: p.ready });
    });

    socket.on("xq:start", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false, reason: "Hết phòng." });
      const me = String(socket.data?.name || "").trim();
      if (room.host !== me) return typeof ack === "function" && ack({ ok: false, reason: "Chỉ chủ phòng bắt đầu." });
      if (room.players.length < 2) {
        return typeof ack === "function" && ack({ ok: false, reason: "Cần bạn vào phòng (mã " + room.code + ")." });
      }
      if (!room.players.every((p) => p.ready || p.name === room.host)) {
        const guest = room.players.find((p) => p.name !== room.host);
        if (guest && !guest.ready) {
          return typeof ack === "function" && ack({ ok: false, reason: "Chờ đối thủ sẵn sàng." });
        }
      }
      startGame(room);
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
    });

    socket.on("xq:move", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "playing") {
        return typeof ack === "function" && ack({ ok: false, reason: "Chưa trong trận." });
      }
      const me = String(socket.data?.name || "").trim();
      const player = room.players.find((p) => p.name === me && p.socketId === socket.id);
      if (!player || player.side !== room.turn) {
        return typeof ack === "function" && ack({ ok: false, reason: "Chưa tới lượt." });
      }
      const fromR = Number(raw?.fromR);
      const fromC = Number(raw?.fromC);
      const toR = Number(raw?.toR);
      const toC = Number(raw?.toC);
      const legal = legalMovesFrom(room.board, fromR, fromC, room.turn);
      if (!legal.some(([r, c]) => r === toR && c === toC)) {
        return typeof ack === "function" && ack({ ok: false, reason: "Nước không hợp lệ." });
      }
      const moving = room.board[fromR][fromC];
      const cap = room.board[toR][toC];
      room.board = applyMove(room.board, fromR, fromC, toR, toC);
      room.moves.push({
        fromR,
        fromC,
        toR,
        toC,
        piece: moving,
        capture: cap,
        side: room.turn,
        note: moveNotation({ fromR, fromC, toR, toC, piece: moving, capture: cap }, room.board),
      });
      room.turn = oppositeSide(room.turn);
      room.turnDeadline = Date.now() + room.turnMs;
      room.checkSide = isInCheck(room.board, room.turn) ? room.turn : null;
      const res = gameResult(room.board, room.turn);
      if (res) finishGame(room, res);
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
    });

    socket.on("xq:resign", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room || room.status !== "playing") return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const player = room.players.find((p) => p.name === me);
      if (!player?.side) return typeof ack === "function" && ack({ ok: false });
      finishGame(room, oppositeSide(player.side));
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("xq:chat", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const text = String(raw?.text || "").trim().slice(0, 240);
      if (!me || !text) return typeof ack === "function" && ack({ ok: false });
      room.chat.push({ name: me, text, at: Date.now() });
      if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("xq:quick_match", (ack) => {
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
        if (!otherName || otherName === name) continue;

        leaveSocket(io, socket);
        leaveSocket(io, otherSock);

        const room = {
          id: crypto.randomUUID(),
          code: code6(),
          host: otherName,
          players: [
            { name: otherName, side: SIDE_RED, ready: true, socketId: otherId },
            { name, side: SIDE_BLACK, ready: true, socketId: socket.id },
          ],
          spectators: [],
          status: "lobby",
          board: createInitialBoard(),
          turn: SIDE_RED,
          moves: [],
          winner: null,
          checkSide: null,
          turnMs: 600_000,
          turnDeadline: null,
          redTimeMs: 600_000,
          blackTimeMs: 600_000,
          chat: [],
          drawOfferFrom: null,
          createdAt: Date.now(),
        };
        rooms.set(room.id, room);
        socketRoom.set(socket.id, room.id);
        socketRoom.set(otherId, room.id);
        socket.join(`xq:${room.id}`);
        otherSock.join(`xq:${room.id}`);
        startGame(room);
        const state = fullState(room);
        socket.emit("xq:quick_matched", { room: state });
        otherSock.emit("xq:quick_matched", { room: state });
        emitRoom(io, room);
        if (typeof ack === "function") ack({ ok: true, room: state });
        return;
      }
      quickQueue.push(socket.id);
      if (typeof ack === "function") ack({ ok: true, waiting: true });
    });

    socket.on("xq:cancel_quick", () => {
      const q = quickQueue.indexOf(socket.id);
      if (q >= 0) quickQueue.splice(q, 1);
    });

    void pieceSide;
  });
}
