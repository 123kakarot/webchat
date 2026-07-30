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
  countMessagesSince,
  createRoom,
  getRoomByCode,
  getRoomById,
  addRoomMember,
  listRoomMemberNames,
  updateRoomFields,
  deleteRoomById,
  removeRoomMember,
  removeRoomReadStateForUser,
  isNameAllowedInRoom,
  listRegisteredRoomMemberNames,
  normalizeRoomCode,
  upsertRoomRead,
  getRoomReads,
  messageBelongsToRoom,
  getDbOverview,
} from "./db.js";

const MIN_CLIENT_BUILD = String(process.env.MIN_CLIENT_BUILD || "39");
const AUTH_POLICY = String(process.env.AUTH_POLICY || "36");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

io.use((socket, next) => {
  const build = String(socket.handshake.auth?.clientBuild ?? "").trim();
  if (build !== MIN_CLIENT_BUILD) {
    return next(new Error("UPGRADE_REQUIRED"));
  }
  socket.data.clientBuild = build;
  next();
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

app.get("/api/status", async (_req, res) => {
  try {
    const overview = await getDbOverview({ roomLimit: 0, messageLimit: 0 });
    res.json({
      persistent: isPersistent(),
      mode: overview.mode,
      counts: overview.counts,
      minClientBuild: MIN_CLIENT_BUILD,
      authPolicy: AUTH_POLICY,
    });
  } catch (err) {
    console.error("[api/status]", err);
    res.json({
      persistent: isPersistent(),
      counts: null,
      minClientBuild: MIN_CLIENT_BUILD,
      authPolicy: AUTH_POLICY,
    });
  }
});

function adminAuthorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.query.key === secret || req.get("X-Admin-Secret") === secret;
}

app.get("/api/db/overview", async (req, res) => {
  if (!adminAuthorized(req)) {
    res.status(403).json({
      error: "Forbidden",
      hint: "Set ADMIN_SECRET on Render, then open /api/db/overview?key=YOUR_SECRET",
    });
    return;
  }
  try {
    const roomLimit = Math.min(Number(req.query.rooms) || 50, 100);
    const messageLimit = Math.min(Number(req.query.messages) || 30, 100);
    const data = await getDbOverview({ roomLimit, messageLimit });
    res.json(data);
  } catch (err) {
    console.error("[api/db/overview]", err);
    res.status(500).json({ error: "DB query failed" });
  }
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

/** @type {Map<string, { id: string, name: string, clientId: string, roomId: number | null, roomCode: string | null, authPolicyOk: boolean }>} */
const online = new Map();

/** @type {Map<number, Map<string, { name: string, until: number }>>} */
const roomTyping = new Map();

const TYPING_TTL_MS = 4500;

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏"]);

function broadcastUsers(roomId) {
  const names = [...online.values()]
    .filter((u) => u.roomId === roomId)
    .map((u) => u.name);
  io.to(`room:${roomId}`).emit("users", names);
}

async function buildRoomRoster(roomId) {
  const room = await getRoomById(roomId);
  if (!room) return null;
  const owner = room.ownerName || "";
  let memberNames = await listRoomMemberNames(roomId);
  if (owner && !memberNames.includes(owner)) {
    memberNames = [...memberNames, owner].sort((a, b) => a.localeCompare(b, "vi"));
  }
  const onlineSet = new Set(
    [...online.values()].filter((u) => u.roomId === roomId).map((u) => u.name)
  );
  const members = memberNames.map((name) => ({
    name,
    online: onlineSet.has(name),
    isOwner: Boolean(owner && name === owner),
  }));
  members.sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name, "vi");
  });
  return {
    roomId: room.id,
    code: room.code,
    name: room.name,
    ownerName: owner,
    avatarUrl: room.avatarUrl || "",
    memberCount: members.length,
    onlineCount: onlineSet.size,
    members,
  };
}

function broadcastRoomRoster(roomId) {
  buildRoomRoster(roomId).then((roster) => {
    if (roster) io.to(`room:${roomId}`).emit("room_roster", roster);
  });
  broadcastUsers(roomId);
}

async function broadcastRoomReads(roomId) {
  const readers = await getRoomReads(roomId);
  io.to(`room:${roomId}`).emit("room_reads", { roomId, readers });
}

function kickUserFromRoom(socket, user, reason) {
  if (!user?.roomId) return;
  const rid = user.roomId;
  clearUserTyping(user);
  socket.leave(roomChannel(rid));
  user.roomId = null;
  user.roomCode = null;
  socket.emit("room_kicked", {
    reason: reason || "Bạn không còn trong nhóm.",
    roomId: rid,
  });
}

async function enforceRoomMembership(roomId, ownerName = "") {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return;
  for (const [sid, u] of online) {
    if (Number(u.roomId) !== rid) continue;
    const ok = await isNameAllowedInRoom(rid, u.name, ownerName);
    if (!ok) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) {
        kickUserFromRoom(
          sock,
          u,
          "Tên này đã bị gỡ khỏi nhóm. Bấm 「Tên của bạn」 đặt tên mới rồi vào lại."
        );
      }
    }
  }
}

function parseJoinPayload(raw) {
  if (typeof raw === "string") {
    return { name: raw.trim(), rejoin: false, clientId: "", authPolicy: "", clientBuild: "" };
  }
  if (raw && typeof raw === "object") {
    return {
      name: String(raw.name ?? "").trim(),
      rejoin: Boolean(raw.rejoin),
      clientId: String(raw.clientId ?? "").trim().slice(0, 64),
      authPolicy: String(raw.authPolicy ?? "").trim(),
      clientBuild: String(raw.clientBuild ?? "").trim(),
    };
  }
  return { name: "", rejoin: false, clientId: "", authPolicy: "", clientBuild: "" };
}

function ensureClientId(raw) {
  const id = String(raw ?? "").trim().slice(0, 64);
  if (id.length >= 8) return id;
  return crypto.randomUUID();
}

function isDisplayNameTakenInRoom(roomId, name, exceptClientId = "") {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return false;
  const except = String(exceptClientId ?? "").trim();
  const rid = Number(roomId);
  return [...online.values()].some(
    (u) => Number(u.roomId) === rid && u.name.toLowerCase() === key && u.clientId !== except
  );
}

function isDisplayNameTaken(name, exceptClientId = "") {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return false;
  const except = String(exceptClientId ?? "").trim();
  return [...online.values()].some(
    (u) => u.name.toLowerCase() === key && u.clientId !== except
  );
}

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function pruneRoomTypingMap(roomId) {
  const rid = Number(roomId);
  const map = roomTyping.get(rid);
  if (!map) return null;
  const now = Date.now();
  for (const [cid, entry] of map) {
    if (entry.until < now) map.delete(cid);
  }
  if (map.size === 0) {
    roomTyping.delete(rid);
    return null;
  }
  return map;
}

function broadcastRoomTyping(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return;
  const map = pruneRoomTypingMap(rid);
  const users = [];
  if (map) {
    for (const entry of map.values()) {
      users.push({ name: entry.name });
    }
    users.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }
  io.to(roomChannel(rid)).emit("room_typing", { roomId: rid, users });
}

function clearUserTyping(user) {
  if (!user?.clientId || user.roomId == null) return;
  const rid = user.roomId;
  const map = roomTyping.get(rid);
  if (!map || !map.delete(user.clientId)) return;
  if (map.size === 0) roomTyping.delete(rid);
  broadcastRoomTyping(rid);
}

function watchChannel(code) {
  return `watch:${normalizeRoomCode(code)}`;
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
    const previewPatch = {
      code: roomCode,
      roomId,
      preview: previewText(saved),
      lastAt: saved.at,
      lastName: saved.name,
    };
    io.to(roomChannel(roomId)).emit("room_preview", previewPatch);
    io.to(watchChannel(roomCode)).emit("room_preview", previewPatch);
  }
  return saved;
}

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", async (raw, ack) => {
    const respond = (payload) => {
      if (typeof ack === "function") ack(payload);
    };

    const { name: rawName, rejoin, clientId: rawClientId, authPolicy, clientBuild } = parseJoinPayload(raw);
    const trimmed = rawName.slice(0, 32);
    if (joined) {
      const existing = online.get(socket.id);
      if (existing?.name) {
        const payload = {
          ok: true,
          name: existing.name,
          clientId: existing.clientId,
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

    if (authPolicy !== AUTH_POLICY || clientBuild !== MIN_CLIENT_BUILD) {
      const reason =
        "Cần tải lại trang (Ctrl+F5) để cập nhật Webchat v39 — sau đó nhập lại tên.";
      socket.emit("join_error", reason);
      socket.emit("upgrade_required", { reason });
      respond({ ok: false, reason });
      return;
    }

    const clientId = ensureClientId(rawClientId);

    joined = true;
    online.set(socket.id, {
      id: socket.id,
      name: trimmed,
      clientId,
      roomId: null,
      roomCode: null,
      authPolicyOk: true,
    });

    const payload = {
      ok: true,
      name: trimmed,
      clientId,
      persistent: isPersistent(),
      rejoin: Boolean(rejoin),
    };
    socket.emit("joined", payload);
    respond(payload);
  });

  socket.on("sync_rooms", async (payload) => {
    let codes = [];
    let readAt = {};
    if (Array.isArray(payload)) {
      codes = payload;
    } else if (payload && typeof payload === "object") {
      codes = Array.isArray(payload.codes) ? payload.codes : [];
      if (payload.readAt && typeof payload.readAt === "object") readAt = payload.readAt;
    }

    const normalized = [...new Set(codes.map(normalizeRoomCode).filter((c) => c.length >= 4))];

    const prev = socket.data?.watchedCodes || [];
    for (const c of prev) {
      if (!normalized.includes(c)) socket.leave(watchChannel(c));
    }
    for (const c of normalized) {
      socket.join(watchChannel(c));
    }
    socket.data = { ...(socket.data || {}), watchedCodes: normalized };

    const rooms = await listRoomsByCodes(normalized);
    const user = online.get(socket.id);
    const activeRoomId = user?.roomId ?? null;
    for (const room of rooms) {
      if (Number(room.id) === Number(activeRoomId)) {
        room.unreadCount = 0;
      } else {
        const since = Number(readAt[room.id] ?? readAt[String(room.id)] ?? 0);
        room.unreadCount = await countMessagesSince(room.id, since);
      }
    }
    socket.emit("rooms_list", rooms);
  });

  socket.on("join_room", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };

    try {
      const user = online.get(socket.id);
      if (!user) {
        const reason = "Phiên đăng nhập hết hạn — tải lại trang (F5) rồi thử lại.";
        socket.emit("room_join_error", reason);
        respond({ ok: false, reason });
        return;
      }

      const code = normalizeRoomCode(typeof payload === "string" ? payload : payload?.code);
      const previousName =
        typeof payload === "object" && payload
          ? String(payload.previousName ?? "").trim().slice(0, 32)
          : "";
      if (code.length < 4) {
        const reason = "Mã phòng không hợp lệ";
        socket.emit("room_join_error", reason);
        respond({ ok: false, reason });
        return;
      }

      const room = await getRoomByCode(code);
      if (!room) {
        const reason = "Mã phòng không đúng";
        socket.emit("room_join_error", reason);
        respond({ ok: false, reason });
        return;
      }

      if (isDisplayNameTakenInRoom(room.id, user.name, user.clientId)) {
        const reason =
          "Trong nhóm này đã có người dùng tên này. Đổi tên (Tên của bạn) rồi vào lại — không trùng trong cùng nhóm.";
        socket.emit("room_join_error", reason);
        respond({ ok: false, reason });
        return;
      }

      const allowed = await isNameAllowedInRoom(room.id, user.name, room.ownerName || "");
      if (!allowed) {
        const reason =
          "Tên này đã bị gỡ khỏi nhóm (hoặc không còn trong danh sách). Bấm 「Tên của bạn」 đặt tên mới — khác tên cũ — rồi vào lại. Muốn giữ tên cũ: nhờ trưởng nhóm thêm lại.";
        socket.emit("room_join_error", reason);
        respond({ ok: false, reason });
        return;
      }

      if (previousName && previousName.toLowerCase() !== user.name.toLowerCase()) {
        await removeRoomMember(room.id, previousName);
        await removeRoomReadStateForUser(room.id, previousName);
      }

      if (user.roomId) {
        clearUserTyping(user);
        socket.leave(roomChannel(user.roomId));
      }

      user.roomId = room.id;
      user.roomCode = room.code;
      socket.join(roomChannel(room.id));

      await addRoomMember(room.id, user.name);

      const history = await loadRecentMessages(room.id, 250);
      const roster = await buildRoomRoster(room.id);
      const readers = await getRoomReads(room.id);
      const data = {
        ok: true,
        roomId: room.id,
        code: room.code,
        name: room.name,
        ownerName: room.ownerName || "",
        avatarUrl: room.avatarUrl || "",
        roster,
        readers,
        history,
      };
      socket.emit("room_joined", data);
      respond(data);
      broadcastRoomRoster(room.id);
      await enforceRoomMembership(room.id, room.ownerName || "");
    } catch (err) {
      console.error("[join_room]", err);
      const reason = "Lỗi server khi vào phòng.";
      socket.emit("room_join_error", reason);
      respond({ ok: false, reason });
    }
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

    const name =
      typeof nameRaw === "string"
        ? nameRaw
        : String(nameRaw?.name ?? nameRaw?.roomName ?? "Nhóm mới");
    const avatarUrl = typeof nameRaw === "object" && nameRaw ? String(nameRaw.avatarUrl ?? "").slice(0, 500) : "";

    try {
      const room = await createRoom(name, user.name, avatarUrl);
      socket.emit("room_created", room);
      respond({ ok: true, room });
    } catch (err) {
      console.error("[create_room]", err);
      const reason = "Không tạo được phòng (lỗi cơ sở dữ liệu).";
      socket.emit("room_error", reason);
      respond({ ok: false, reason });
    }
  });

  socket.on("typing", (payload) => {
    const user = online.get(socket.id);
    if (!user?.roomId) return;
    const rid = user.roomId;
    const active = payload?.active !== false;
    if (!active) {
      clearUserTyping(user);
      return;
    }
    let map = roomTyping.get(rid);
    if (!map) {
      map = new Map();
      roomTyping.set(rid, map);
    }
    map.set(user.clientId, { name: user.name, until: Date.now() + TYPING_TTL_MS });
    broadcastRoomTyping(rid);
  });

  socket.on("mark_read", async (payload) => {
    const user = online.get(socket.id);
    if (!user?.roomId) return;
    const messageId = Number(payload?.messageId);
    if (!Number.isInteger(messageId) || messageId < 1) return;
    if (!(await messageBelongsToRoom(messageId, user.roomId))) return;
    const avatarUrl = String(payload?.avatarUrl ?? "").slice(0, 500);
    await upsertRoomRead(user.roomId, user.name, messageId, avatarUrl);
    broadcastRoomReads(user.roomId);
  });

  socket.on("update_profile", async (payload) => {
    const user = online.get(socket.id);
    if (!user || !payload) return;

    const trimmed = String(payload.name ?? "").trim().slice(0, 32);
    const check = validateDisplayName(trimmed);
    if (!check.ok) {
      socket.emit("profile_error", check.reason);
      return;
    }

    const old = user.name;
    if (user.roomId && isDisplayNameTakenInRoom(user.roomId, trimmed, user.clientId)) {
      socket.emit("profile_error", "Trong nhóm này đã có người dùng tên này. Chọn tên khác.");
      return;
    }

    user.name = trimmed;
    if (user.roomId && old.toLowerCase() !== trimmed.toLowerCase()) {
      const roomMeta = await getRoomById(user.roomId);
      const allowed = await isNameAllowedInRoom(
        user.roomId,
        trimmed,
        roomMeta?.ownerName || ""
      );
      if (!allowed) {
        user.name = old;
        socket.emit(
          "profile_error",
          "Tên mới không có trong danh sách thành viên. Liên hệ trưởng nhóm."
        );
        return;
      }
      await removeRoomMember(user.roomId, old);
      await removeRoomReadStateForUser(user.roomId, old);
      await addRoomMember(user.roomId, trimmed);
    }
    socket.emit("profile_updated", { name: trimmed });
    if (user.roomId) {
      io.to(roomChannel(user.roomId)).emit("system", {
        text: `${old} đổi tên thành ${trimmed}`,
        roomId: user.roomId,
      });
      broadcastRoomRoster(user.roomId);
    }
  });

  socket.on("update_room", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    const room = await getRoomById(user.roomId);
    if (!room) {
      respond({ ok: false, reason: "Phòng không tồn tại." });
      return;
    }
    if (room.ownerName && user.name !== room.ownerName) {
      respond({ ok: false, reason: "Chỉ trưởng nhóm mới được đổi thông tin nhóm." });
      return;
    }
    const nextName = payload?.name != null ? String(payload.name).trim().slice(0, 64) : undefined;
    const nextAvatar = payload?.avatarUrl != null ? String(payload.avatarUrl).slice(0, 500) : undefined;
    if (nextName !== undefined && !nextName) {
      respond({ ok: false, reason: "Tên nhóm không được trống." });
      return;
    }
    try {
      const updated = await updateRoomFields(user.roomId, {
        name: nextName,
        avatarUrl: nextAvatar,
      });
      if (!updated) {
        respond({ ok: false, reason: "Không cập nhật được." });
        return;
      }
      io.to(roomChannel(user.roomId)).emit("room_updated", updated);
      io.to(watchChannel(updated.code)).emit("room_updated", updated);
      broadcastRoomRoster(user.roomId);
      respond({ ok: true, room: updated });
    } catch (err) {
      console.error("[update_room]", err);
      respond({ ok: false, reason: "Lỗi server." });
    }
  });

  socket.on("delete_room", async (_payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId || !user.roomCode) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    const room = await getRoomById(user.roomId);
    if (!room) {
      respond({ ok: false, reason: "Phòng không tồn tại." });
      return;
    }
    if (!room.ownerName || user.name !== room.ownerName) {
      respond({ ok: false, reason: "Chỉ trưởng nhóm mới được xóa phòng." });
      return;
    }
    const code = room.code;
    const rid = room.id;
    try {
      const ok = await deleteRoomById(rid);
      if (!ok) {
        respond({ ok: false, reason: "Không xóa được phòng." });
        return;
      }
      const patch = { code, roomId: rid, deleted: true };
      io.to(roomChannel(rid)).emit("room_deleted", patch);
      io.to(watchChannel(code)).emit("room_deleted", patch);
      for (const u of online.values()) {
        if (u.roomId === rid) {
          u.roomId = null;
          u.roomCode = null;
        }
      }
      respond({ ok: true, code });
    } catch (err) {
      console.error("[delete_room]", err);
      respond({ ok: false, reason: "Lỗi server." });
    }
  });

  socket.on("message", async (payload) => {
    const user = online.get(socket.id);
    if (!user || !user.roomId) return;
    if (!user.authPolicyOk) {
      socket.emit("upgrade_required", {
        reason: "Cần tải lại trang (Ctrl+F5) để cập nhật Webchat v39.",
      });
      socket.disconnect(true);
      return;
    }

    const roomMeta = await getRoomById(user.roomId);
    if (!(await isNameAllowedInRoom(user.roomId, user.name, roomMeta?.ownerName || ""))) {
      kickUserFromRoom(
        socket,
        user,
        "Tên này đã bị gỡ khỏi nhóm. Bấm 「Tên của bạn」 đặt tên mới rồi vào lại."
      );
      return;
    }

    clearUserTyping(user);

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

    meta.clientId = user.clientId;

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
      clearUserTyping(user);
      online.delete(socket.id);
      if (rid) broadcastRoomRoster(rid);
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

setInterval(async () => {
  const roomIds = new Set(
    [...online.values()].map((u) => u.roomId).filter((id) => id != null)
  );
  for (const rid of roomIds) {
    try {
      const room = await getRoomById(rid);
      await enforceRoomMembership(rid, room?.ownerName || "");
    } catch (err) {
      console.error("[enforceRoomMembership]", rid, err);
    }
  }
}, 30000);
