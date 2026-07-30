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
  listRooms,
  createRoom,
  roomExists,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));
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

/** @type {Map<string, { id: string, name: string, roomId: number | null }>} */
const online = new Map();

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏"]);

function broadcastUsers(roomId) {
  const names = [...online.values()]
    .filter((u) => u.roomId === roomId)
    .map((u) => u.name);
  io.to(`room:${roomId}`).emit("users", names);
}

async function broadcastRoomsList() {
  const rooms = await listRooms();
  io.emit("rooms_list", rooms);
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

async function emitMessage(roomId, payload) {
  const saved = await saveMessage({ roomId, ...payload });
  io.to(roomChannel(roomId)).emit("message", saved);
  await broadcastRoomsList();
  return saved;
}

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", async (raw) => {
    const { name: rawName, rejoin } = parseJoinPayload(raw);
    const trimmed = rawName.slice(0, 32);
    if (joined) return;

    const check = validateDisplayName(trimmed);
    if (!check.ok) {
      socket.emit("join_error", check.reason);
      return;
    }

    joined = true;
    online.set(socket.id, { id: socket.id, name: trimmed, roomId: null });

    const rooms = await listRooms();
    socket.emit("joined", {
      name: trimmed,
      persistent: isPersistent(),
      rejoin,
    });
    socket.emit("rooms_list", rooms);

    if (!rejoin) {
      io.emit("system", { text: `${trimmed} đã online`, roomId: null });
    }
  });

  socket.on("join_room", async (roomIdRaw) => {
    const user = online.get(socket.id);
    if (!user) return;

    const roomId = Number(roomIdRaw);
    if (!Number.isInteger(roomId) || !(await roomExists(roomId))) return;

    if (user.roomId) {
      socket.leave(roomChannel(user.roomId));
    }

    user.roomId = roomId;
    socket.join(roomChannel(roomId));

    const history = await loadRecentMessages(roomId, 250);
    socket.emit("room_joined", { roomId, history });
    broadcastUsers(roomId);
  });

  socket.on("create_room", async (nameRaw) => {
    const user = online.get(socket.id);
    if (!user) return;

    try {
      const room = await createRoom(nameRaw);
      await broadcastRoomsList();
      socket.emit("room_created", room);
    } catch {
      socket.emit("room_error", "Không tạo được nhóm");
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

    await emitMessage(user.roomId, {
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
const bootHistory = await loadRecentMessages(1, 250);
await hydrateReactionCache(bootHistory);

httpServer.listen(PORT, HOST, () => {
  console.log(`Chat listening on ${HOST}:${PORT} (persistent=${isPersistent()})`);
});
