/**
 * Pool online rooms — authoritative shot resolve; clients animate via pool:shot_fx.
 */
import crypto from "crypto";
import {
  createMatch,
  beginShot,
  finishShot,
  tryPlaceCue,
} from "./public/pool/pool-rules.js";
import { simulateUntilStop } from "./public/pool/pool-physics.js";

/** @type {Map<string, object>} */
const rooms = new Map();
/** @type {Map<string, string>} */
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
    balls: room.match?.balls,
    turn: room.match?.turn,
    phase: room.match?.phase,
    groups: room.match?.groups,
    winner: room.match?.winner,
    message: room.match?.message,
    ballInHand: room.match?.ballInHand,
    bet: room.bet,
    tableTheme: room.tableTheme,
    chat: room.chat.slice(-40),
  };
}

function emitRoom(io, room) {
  io.to(`pool:${room.id}`).emit("pool:state", fullState(room));
}

function leaveSocket(io, socket) {
  const roomId = socketRoom.get(socket.id);
  if (!roomId) return;
  socketRoom.delete(socket.id);
  socket.leave(`pool:${roomId}`);
  const room = rooms.get(roomId);
  if (!room) return;
  const p = room.players.find((x) => x.socketId === socket.id);
  if (p) p.socketId = null;
  if (room.status === "lobby" && room.players.every((x) => !x.socketId)) {
    rooms.delete(roomId);
    return;
  }
  emitRoom(io, room);
}

export function attachPoolServer(io) {
  io.on("connection", (socket) => {
    socket.on("disconnect", () => {
      const q = quickQueue.indexOf(socket.id);
      if (q >= 0) quickQueue.splice(q, 1);
      leaveSocket(io, socket);
    });

    socket.on("pool:create_room", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      leaveSocket(io, socket);
      const room = {
        id: crypto.randomUUID(),
        code: code6(),
        host: name,
        players: [{ name, side: 0, ready: true, socketId: socket.id }],
        status: "lobby",
        bet: Number(raw?.bet) || 100,
        tableTheme: raw?.tableTheme || "classic",
        chat: [],
        match: null,
        createdAt: Date.now(),
      };
      rooms.set(room.id, room);
      socketRoom.set(socket.id, room.id);
      socket.join(`pool:${room.id}`);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
      emitRoom(io, room);
    });

    socket.on("pool:join_room", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      const code = String(raw?.code || "")
        .trim()
        .toUpperCase();
      const room = [...rooms.values()].find((r) => r.code === code);
      if (!room) return typeof ack === "function" && ack({ ok: false, reason: "Không thấy phòng." });
      if (room.players.length >= 2 && !room.players.some((p) => p.name === name)) {
        return typeof ack === "function" && ack({ ok: false, reason: "Phòng đủ người." });
      }
      leaveSocket(io, socket);
      let p = room.players.find((x) => x.name === name);
      if (!p) {
        p = { name, side: 1, ready: false, socketId: socket.id };
        room.players.push(p);
      } else p.socketId = socket.id;
      socketRoom.set(socket.id, room.id);
      socket.join(`pool:${room.id}`);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
      emitRoom(io, room);
    });

    socket.on("pool:ready", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const p = room.players.find((x) => x.name === me);
      if (p) p.ready = true;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("pool:start", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      if (room.host !== me) return typeof ack === "function" && ack({ ok: false, reason: "Chỉ chủ phòng." });
      if (room.players.length < 2) return typeof ack === "function" && ack({ ok: false, reason: "Cần 2 người." });
      room.match = createMatch({
        mode: "online",
        names: [room.players[0].name, room.players[1].name],
        tableTheme: room.tableTheme,
      });
      room.players[0].side = 0;
      room.players[1].side = 1;
      room.status = "playing";
      room.match.bet = room.bet;
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
    });

    socket.on("pool:shot", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room?.match || room.status !== "playing") {
        return typeof ack === "function" && ack({ ok: false, reason: "Chưa trong trận." });
      }
      const me = String(socket.data?.name || "").trim();
      const player = room.players.find((p) => p.name === me && p.socketId === socket.id);
      if (!player || player.side !== room.match.turn) {
        return typeof ack === "function" && ack({ ok: false, reason: "Chưa tới lượt." });
      }

      if (raw?.placeCue) {
        tryPlaceCue(room.match, Number(raw.x), Number(raw.y));
        room.match.ballInHand = false;
        emitRoom(io, room);
        return typeof ack === "function" && ack({ ok: true, room: fullState(room) });
      }

      const angle = Number(raw?.angle);
      const power = Number(raw?.power);
      const spin = raw?.spin || { x: 0, y: 0 };
      io.to(`pool:${room.id}`).emit("pool:shot_fx", {
        angle,
        power,
        spin,
        cueX: raw?.cueX,
        cueY: raw?.cueY,
        by: player.side,
      });

      const started = beginShot(room.match, angle, power, spin);
      if (!started.ok) return typeof ack === "function" && ack({ ok: false, reason: started.reason });
      const events = simulateUntilStop(room.match.balls);
      room.match._shotEvents = {
        pocketed: events.pocketed,
        firstContact: events.firstContact,
        cushionHits: events.cushionHits,
      };
      finishShot(room.match);
      if (room.match.status === "finished") room.status = "finished";
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true, room: fullState(room) });
    });

    socket.on("pool:chat", (raw, ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const text = String(raw?.text || "").slice(0, 120);
      if (!text) return typeof ack === "function" && ack({ ok: false });
      room.chat.push({ name: me, text, at: Date.now() });
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("pool:react", (raw) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room) return;
      const me = String(socket.data?.name || "").trim();
      io.to(`pool:${room.id}`).emit("pool:react", {
        name: me,
        emoji: String(raw?.emoji || "👏").slice(0, 4),
      });
    });

    socket.on("pool:resign", (ack) => {
      const room = rooms.get(socketRoom.get(socket.id));
      if (!room?.match || room.status !== "playing") return typeof ack === "function" && ack({ ok: false });
      const me = String(socket.data?.name || "").trim();
      const player = room.players.find((p) => p.name === me);
      if (!player) return typeof ack === "function" && ack({ ok: false });
      room.match.status = "finished";
      room.match.winner = 1 - player.side;
      room.match.message = `${me} đầu hàng.`;
      room.status = "finished";
      emitRoom(io, room);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("pool:quick_match", (raw, ack) => {
      const name = String(socket.data?.name || raw?.playerName || "").trim().slice(0, 32);
      if (!name) return typeof ack === "function" && ack({ ok: false, reason: "Cần đăng nhập." });
      const otherId = quickQueue.find((id) => id !== socket.id);
      if (otherId) {
        quickQueue.splice(quickQueue.indexOf(otherId), 1);
        const otherSock = io.sockets.sockets.get(otherId);
        if (!otherSock) {
          quickQueue.push(socket.id);
          return typeof ack === "function" && ack({ ok: true, waiting: true });
        }
        leaveSocket(io, socket);
        leaveSocket(io, otherSock);
        const otherName = String(otherSock.data?.name || "P2").trim();
        const room = {
          id: crypto.randomUUID(),
          code: code6(),
          host: name,
          players: [
            { name, side: 0, ready: true, socketId: socket.id },
            { name: otherName, side: 1, ready: true, socketId: otherId },
          ],
          status: "playing",
          bet: 100,
          tableTheme: "classic",
          chat: [],
          match: createMatch({ mode: "online", names: [name, otherName] }),
          createdAt: Date.now(),
        };
        room.match.bet = 100;
        rooms.set(room.id, room);
        socketRoom.set(socket.id, room.id);
        socketRoom.set(otherId, room.id);
        socket.join(`pool:${room.id}`);
        otherSock.join(`pool:${room.id}`);
        const state = fullState(room);
        socket.emit("pool:quick_matched", { room: state });
        otherSock.emit("pool:quick_matched", { room: state });
        emitRoom(io, room);
        return typeof ack === "function" && ack({ ok: true, room: state });
      }
      if (!quickQueue.includes(socket.id)) quickQueue.push(socket.id);
      if (typeof ack === "function") ack({ ok: true, waiting: true });
    });

    socket.on("pool:cancel_quick", () => {
      const q = quickQueue.indexOf(socket.id);
      if (q >= 0) quickQueue.splice(q, 1);
    });

    socket.on("pool:leave", () => leaveSocket(io, socket));
  });
}
