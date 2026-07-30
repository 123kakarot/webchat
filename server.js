import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import crypto from "crypto";
import { validateDisplayName } from "./nameFilter.js";
import {
  initDb,
  isPersistent,
  loadRecentMessages,
  saveMessage,
  messageExists,
  toggleReaction,
  hydrateReactionCache,
  listRoomsByCodes,
  createRoom,
  getRoomByCode,
  normalizeRoomCode,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/nameFilter.js", (_req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "nameFilter.js"));
});
app.use("/uploads", express.static(uploadsDir));

app.get("/api/status", (_req, res) => {
  res.json({ persistent: isPersistent() });
});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).slice(0, 16);
    const safe = crypto.randomBytes(8).toString("hex") + ext;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file" });
    return;
  }
  res.json({
    url: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname.slice(0, 200),
    mime: req.file.mimetype,
  });
});

/** @type {Map<string, { id: string, name: string, roomId: number | null, roomCode: string | null }>} */
const online = new Map();

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏"]);

function broadcastUsers(roomId) {
  const names = [...online.values()]
    .filter((u) => u.roomId === roomId)
    .map((u) => u.name);
  io.to(`room:${roomId}`).emit("users", names);
}

function parseJoinPayload(raw) {
  if (typeof raw === "string") {
    return { name: raw.trim(), rejoin: false };
  }
  if (raw && typeof raw === "object") {
    return {
      name: String(raw.name ?? "").trim(),
      rejoin: Boolean(raw.rejoin),
    };
  }
  return { name: "", rejoin: false };
}

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function previewText(msg) {
  const type = msg.type || "text";
  if (type === "sticker") return "Sticker " + (msg.sticker || "");
  if (type === "image") return "Hình ảnh";
  if (type === "file") return "📎 " + (msg.fileName || "Tệp");
  if (type === "contact") return "Danh thiếp";
  if (type === "payment") return "Chuyển khoản";
  return String(msg.text || "").slice(0, 80);
}

async function emitMessage(roomId, roomCode, payload) {
  const saved = await saveMessage({ roomId, ...payload });
  io.to(roomChannel(roomId)).emit("message", saved);
  if (roomCode) {
    io.to(roomChannel(roomId)).emit("room_preview", {
      code: roomCode,
      preview: previewText(saved),
      lastAt: saved.at,
      lastName: saved.name,
    });
  }
  return saved;
}

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", async (raw, ack) => {
    const respond = (payload) => {
      if (typeof ack === "function") ack(payload);
    };

    const { name: rawName, rejoin } = parseJoinPayload(raw);
    const trimmed = rawName.slice(0, 32);
    if (joined) {
      const existing = online.get(socket.id);
      if (existing?.name) {
        const payload = {
          ok: true,
          name: existing.name,
          persistent: isPersistent(),
          rejoin: Boolean(rejoin),
        };
        socket.emit("joined", payload);
        respond(payload);
      }
      return;
    }

    const check = validateDisplayName(trimmed);
    if (!check.ok) {
      socket.emit("join_error", check.reason);
      respond({ ok: false, reason: check.reason });
      return;
    }

    joined = true;
    online.set(socket.id, { id: socket.id, name: trimmed, roomId: null, roomCode: null });

    const payload = {
      ok: true,
      name: trimmed,
      persistent: isPersistent(),
      rejoin: Boolean(rejoin),
    };
    socket.emit("joined", payload);
    respond(payload);
  });

  socket.on("sync_rooms", async (codes) => {
    const list = Array.isArray(codes) ? codes : [];
    const rooms = await listRoomsByCodes(list);
    socket.emit("rooms_list", rooms);
  });

  socket.on("join_room", async (payload) => {
    const user = online.get(socket.id);
    if (!user) {
      socket.emit("room_join_error", "Phiên đăng nhập hết hạn — tải lại trang (F5) rồi thử lại.");
      return;
    }

    const code = normalizeRoomCode(typeof payload === "string" ? payload : payload?.code);
    if (code.length < 4) {
      socket.emit("room_join_error", "Mã phòng không hợp lệ");
      return;
    }

    const room = await getRoomByCode(code);
    if (!room) {
      socket.emit("room_join_error", "Mã phòng không đúng");
      return;
    }

    if (user.roomId) {
      socket.leave(roomChannel(user.roomId));
    }

    user.roomId = room.id;
    user.roomCode = room.code;
    socket.join(roomChannel(room.id));

    const history = await loadRecentMessages(room.id, 250);
    socket.emit("room_joined", {
      roomId: room.id,
      code: room.code,
      name: room.name,
      history,
    });
    broadcastUsers(room.id);
  });

  socket.on("create_room", async (nameRaw, ack) => {
    const respond = (payload) => {
      if (typeof ack === "function") ack(payload);
    };

    const user = online.get(socket.id);
    if (!user) {
      const reason = "Phiên đăng nhập hết hạn — tải lại trang (F5) rồi tạo phòng lại.";
      socket.emit("room_error", reason);
      respond({ ok: false, reason });
      return;
    }

    const name = typeof nameRaw === "string" ? nameRaw : String(nameRaw?.name ?? "Nhóm mới");

    try {
      const room = await createRoom(name);
      socket.emit("room_created", room);
      respond({ ok: true, room });
    } catch (err) {
      console.error("[create_room]", err);
      const reason = "Không tạo được phòng (lỗi cơ sở dữ liệu).";
      socket.emit("room_error", reason);
      respond({ ok: false, reason });
    }
  });

  socket.on("update_profile", (payload) => {
    const user = online.get(socket.id);
    if (!user || !payload) return;

    const trimmed = String(payload.name ?? "").trim().slice(0, 32);
    const check = validateDisplayName(trimmed);
    if (!check.ok) {
      socket.emit("profile_error", check.reason);
      return;
    }

    const old = user.name;
    user.name = trimmed;
    socket.emit("profile_updated", { name: trimmed });
    if (user.roomId) {
      io.to(roomChannel(user.roomId)).emit("system", {
        text: `${old} đổi tên thành ${trimmed}`,
        roomId: user.roomId,
      });
      broadcastUsers(user.roomId);
    }
  });

  socket.on("message", async (payload) => {
    const user = online.get(socket.id);
    if (!user || !user.roomId) return;

    let type = "text";
    let text = "";
    let url = "";
    let fileName = "";
    let sticker = "";
    let meta = {};

    if (typeof payload === "string") {
      text = payload.trim().slice(0, 2000);
    } else if (payload && typeof payload === "object") {
      type = String(payload.type ?? "text").slice(0, 20);
      text = String(payload.text ?? "").trim().slice(0, 2000);
      url = String(payload.url ?? "").trim().slice(0, 500);
      fileName = String(payload.fileName ?? "").trim().slice(0, 200);
      sticker = String(payload.sticker ?? "").trim().slice(0, 16);
      if (payload.meta && typeof payload.meta === "object") {
        for (const [k, v] of Object.entries(payload.meta)) {
          const key = String(k).slice(0, 32);
          meta[key] = String(v ?? "").slice(0, 200);
        }
      }
    }

    if (type === "text" && !text) return;
    if (type === "sticker" && !sticker) return;
    if ((type === "image" || type === "file") && !url) return;
    if (type === "reaction") text = text || "👍";
    if (type === "contact" && !meta.phone && !meta.displayName) return;
    if (type === "payment" && !meta.account) return;

    await emitMessage(user.roomId, user.roomCode, {
      name: user.name,
      type,
      text,
      url,
      fileName,
      sticker,
      meta,
    });
  });

  socket.on("react", async (payload) => {
    const user = online.get(socket.id);
    if (!user || !payload) return;

    const messageId = Number(payload.messageId);
    const emoji = String(payload.emoji ?? "").slice(0, 8);
    if (!Number.isInteger(messageId) || messageId < 1) return;
    if (!ALLOWED_REACTIONS.has(emoji)) return;
    if (!(await messageExists(messageId))) return;

    const reactions = await toggleReaction(messageId, user.name, emoji);
    if (!reactions) return;

    io.emit("message_reactions", { messageId, reactions });
  });

  socket.on("disconnect", () => {
    const user = online.get(socket.id);
    if (user) {
      const rid = user.roomId;
      online.delete(socket.id);
      if (rid) {
        io.to(roomChannel(rid)).emit("system", {
          text: `${user.name} đã rời phòng`,
          roomId: rid,
        });
        broadcastUsers(rid);
      }
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

await initDb();
await hydrateReactionCache([]);

httpServer.listen(PORT, HOST, () => {
  console.log(`Chat listening on ${HOST}:${PORT} (persistent=${isPersistent()})`);
});
