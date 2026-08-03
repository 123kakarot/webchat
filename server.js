import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import crypto from "crypto";
import { validateDisplayName } from "./nameFilter.js";
import { maybeUploadToObjectStorage } from "./storage.js";
import { attachCaroServer } from "./caro-server.js";
import {
  initDb,
  isPersistent,
  loadRecentMessages,
  saveMessage,
  messageExists,
  incrementReaction,
  clearUserReactions,
  hydrateReactionCache,
  listRoomsByCodes,
  countMessagesSince,
  createRoom,
  getOrCreateDirectRoom,
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
  getRoomMemberRoleMap,
  setRoomMemberRole,
  normalizeRoomCode,
  upsertRoomRead,
  getRoomReads,
  messageBelongsToRoom,
  listRoomPins,
  pinRoomMessage,
  unpinRoomMessage,
  listCommonGroupRooms,
  listContactsForUser,
  listFriendsForUser,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  listFriendSuggestions,
  sendFriendRequest,
  respondFriendRequest,
  getFriendRelation,
  isRegisteredRoomMember,
  setRoomMute,
  clearRoomMute,
  isUserMutedInRoom,
  listRoomJoinRequests,
  addRoomJoinRequest,
  removeRoomJoinRequest,
  recallMessage,
  editMessageText,
  castPollVote,
  lockPollMessage,
  getDbOverview,
  upsertUserAvatarCache,
  getUserAvatarCache,
  ensureUserPublicId,
  resolveFriendTargetInput,
  lookupUserByPublicId,
  getUserPublicId,
} from "./db.js";

const MIN_CLIENT_BUILD = String(process.env.MIN_CLIENT_BUILD || "95");
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), persistent: isPersistent() });
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

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!rateLimitOk(`upload:${clientIp(req)}`, 40, 60_000)) {
    res.status(429).json({ error: "Quá nhiều upload — thử lại sau." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file" });
    return;
  }
  const localPath = path.join(uploadsDir, req.file.filename);
  let url = `/uploads/${req.file.filename}`;
  const remote = await maybeUploadToObjectStorage(localPath, req.file.filename, req.file.mimetype);
  if (remote) url = remote;
  res.json({
    url,
    fileName: req.file.originalname.slice(0, 200),
    mime: req.file.mimetype,
    persistent: Boolean(remote || process.env.S3_BUCKET),
  });
});

/** @type {Map<string, { id: string, name: string, clientId: string, roomId: number | null, roomCode: string | null, authPolicyOk: boolean }>} */
const online = new Map();

/** @type {Map<number, Map<string, { name: string, until: number }>>} */
const roomTyping = new Map();

const TYPING_TTL_MS = 4500;

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏"]);

/** @type {Map<string, { count: number, reset: number }>} */
const rateBuckets = new Map();

function rateLimitOk(key, max, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  return b.count <= max;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local")
    .split(",")[0]
    .trim();
}

function broadcastUsers(roomId) {
  const names = [...online.values()]
    .filter((u) => u.roomId === roomId)
    .map((u) => u.name);
  io.to(`room:${roomId}`).emit("users", names);
}

function emitToUserByName(name, event, data) {
  const target = String(name ?? "").trim();
  if (!target) return;
  for (const [sid, u] of online) {
    if (u.name === target) io.to(sid).emit(event, data);
  }
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
  const roleMap = await getRoomMemberRoleMap(roomId);
  const members = memberNames.map((name) => ({
    name,
    online: onlineSet.has(name),
    isOwner: Boolean(owner && name === owner),
    isDeputy: roleMap[name] === "deputy",
  }));
  members.sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    if (a.isDeputy !== b.isDeputy) return a.isDeputy ? -1 : 1;
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

async function kickMemberByName(roomId, targetName, reason) {
  const rid = Number(roomId);
  const target = String(targetName ?? "").trim().slice(0, 32);
  if (!Number.isFinite(rid) || !target) return;
  await removeRoomMember(rid, target);
  await removeRoomReadStateForUser(rid, target);
  const room = await getRoomById(rid);
  for (const [sid, u] of online) {
    if (Number(u.roomId) === rid && u.name === target) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) kickUserFromRoom(sock, u, reason);
    }
  }
  await enforceRoomMembership(rid, room?.ownerName || "");
}

function isRoomOwner(userName, ownerName) {
  return Boolean(ownerName && userName === ownerName);
}

async function actorManageLevel(roomId, actorName, ownerName) {
  if (isRoomOwner(actorName, ownerName)) return "owner";
  const roles = await getRoomMemberRoleMap(roomId);
  if (roles[actorName] === "deputy") return "deputy";
  return null;
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
  if (type === "system") return String(msg.text || "").slice(0, 80);
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

async function postRoomSystem(roomId, roomCode, text) {
  const rid = Number(roomId);
  const line = String(text ?? "").trim().slice(0, 500);
  if (!Number.isFinite(rid) || !line) return null;
  const code = roomCode ? normalizeRoomCode(roomCode) : "";
  return emitMessage(rid, code.length >= 4 ? code : "", {
    name: "—",
    type: "system",
    text: line,
  });
}

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", async (raw, ack) => {
    if (!rateLimitOk(`join:${clientIp(socket.request)}`, 30, 60_000)) {
      if (typeof ack === "function") ack({ ok: false, reason: "Quá nhiều lần đăng nhập — thử lại sau." });
      return;
    }
    const respond = (payload) => {
      if (typeof ack === "function") ack(payload);
    };

    const { name: rawName, rejoin, clientId: rawClientId, authPolicy, clientBuild } = parseJoinPayload(raw);
    const trimmed = rawName.slice(0, 32);
    if (joined) {
      const existing = online.get(socket.id);
      if (existing?.name) {
        socket.data.name = existing.name;
        let publicId = "";
        try {
          publicId = (await ensureUserPublicId(existing.name)) || "";
        } catch (err) {
          console.error("[join rejoin publicId]", err);
        }
        const payload = {
          ok: true,
          name: existing.name,
          clientId: existing.clientId,
          persistent: isPersistent(),
          rejoin: Boolean(rejoin),
          publicId,
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
        "Cần tải lại trang (Ctrl+F5) để cập nhật Webchat v41 — sau đó nhập lại tên.";
      socket.emit("join_error", reason);
      socket.emit("upgrade_required", { reason });
      respond({ ok: false, reason });
      return;
    }

    const clientId = ensureClientId(rawClientId);

    joined = true;
    socket.data.name = trimmed;
    online.set(socket.id, {
      id: socket.id,
      name: trimmed,
      clientId,
      roomId: null,
      roomCode: null,
      authPolicyOk: true,
    });

    let publicId = "";
    try {
      publicId = (await ensureUserPublicId(trimmed)) || "";
    } catch (err) {
      console.error("[join publicId]", err);
    }

    const payload = {
      ok: true,
      name: trimmed,
      clientId,
      persistent: isPersistent(),
      rejoin: Boolean(rejoin),
      publicId,
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

      const owner = room.ownerName || "";
      const onList = await isRegisteredRoomMember(room.id, user.name);
      const isOwner =
        owner && user.name.trim().toLowerCase() === owner.trim().toLowerCase();
      if (room.requireApproval && !onList && !isOwner) {
        await addRoomJoinRequest(room.id, user.name);
        const requests = await listRoomJoinRequests(room.id);
        io.to(roomChannel(room.id)).emit("join_requests", { roomId: room.id, requests });
        if (room.ownerName) {
          emitToUserByName(room.ownerName, "notification_ping", {
            kind: "join_request",
            roomId: room.id,
            roomCode: room.code,
            roomName: room.name,
            userName: user.name,
          });
        }
        const reason = "Đã gửi yêu cầu vào nhóm — chờ trưởng/phó phòng duyệt.";
        socket.emit("room_join_error", reason);
        respond({ ok: false, reason, pendingApproval: true });
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
      const pins = await listRoomPins(room.id);
      const joinRequests =
        (await actorManageLevel(room.id, user.name, room.ownerName || ""))
          ? await listRoomJoinRequests(room.id)
          : [];
      const data = {
        ok: true,
        roomId: room.id,
        code: room.code,
        name: room.name,
        ownerName: room.ownerName || "",
        avatarUrl: room.avatarUrl || "",
        requireApproval: Boolean(room.requireApproval),
        roster,
        readers,
        history,
        pins,
        joinRequests,
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
    const avatarData =
      typeof nameRaw === "object" && nameRaw
        ? sanitizeAvatarDataPayload(nameRaw.avatarDataUrl)
        : "";

    try {
      const room = await createRoom(name, user.name, avatarUrl, "group", avatarData);
      socket.emit("room_created", room);
      respond({ ok: true, room });
    } catch (err) {
      console.error("[create_room]", err);
      const reason = "Không tạo được phòng (lỗi cơ sở dữ liệu).";
      socket.emit("room_error", reason);
      respond({ ok: false, reason });
    }
  });

  socket.on("open_direct_chat", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    const target = String(payload?.targetName ?? "").trim().slice(0, 32);
    if (!target) {
      respond({ ok: false, reason: "Thiếu tên người nhận." });
      return;
    }
    if (target.toLowerCase() === user.name.toLowerCase()) {
      respond({ ok: false, reason: "Không thể chat riêng với chính mình." });
      return;
    }
    try {
      const room = await getOrCreateDirectRoom(user.name, target);
      respond({ ok: true, room });
    } catch (err) {
      console.error("[open_direct_chat]", err);
      respond({ ok: false, reason: "Không mở được chat riêng." });
    }
  });

  socket.on("list_contacts", async (_payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    try {
      const list = await listFriendsForUser(user.name);
      const onlineNames = new Set(
        [...online.values()].map((u) => u.name).filter(Boolean)
      );
      respond({
        ok: true,
        contacts: list.map((c) => ({
          ...c,
          online: onlineNames.has(c.name),
        })),
      });
    } catch (err) {
      console.error("[list_contacts]", err);
      respond({ ok: false, reason: "Không tải được danh bạ." });
    }
  });

  socket.on("sync_friends", async (_payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    try {
      const onlineNames = new Set(
        [...online.values()].map((u) => u.name).filter(Boolean)
      );
      const friends = await listFriendsForUser(user.name);
      const incoming = await listIncomingFriendRequests(user.name);
      const outgoing = await listOutgoingFriendRequests(user.name);
      respond({
        ok: true,
        friends: friends.map((c) => ({ ...c, online: onlineNames.has(c.name) })),
        incoming,
        outgoing,
      });
    } catch (err) {
      console.error("[sync_friends]", err);
      respond({ ok: false, reason: "Không tải được danh bạ." });
    }
  });

  socket.on("friend_suggestions", async (_payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    try {
      const suggestions = await listFriendSuggestions(user.name);
      respond({ ok: true, suggestions });
    } catch (err) {
      console.error("[friend_suggestions]", err);
      respond({ ok: false, reason: "Không tải được gợi ý." });
    }
  });

  socket.on("lookup_user_id", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    try {
      const result = await lookupUserByPublicId(payload?.publicId ?? payload?.id ?? "");
      respond(result);
    } catch (err) {
      console.error("[lookup_user_id]", err);
      respond({ ok: false, reason: "Không tra được ID." });
    }
  });

  socket.on("friend_request", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    const rawTarget = String(payload?.targetName ?? payload?.target ?? "").trim();
    if (!rawTarget) {
      respond({ ok: false, reason: "Thiếu tên hoặc ID." });
      return;
    }
    try {
      const resolved = await resolveFriendTargetInput(rawTarget);
      if (!resolved.ok) {
        respond(resolved);
        return;
      }
      const target = resolved.name;
      const result = await sendFriendRequest(user.name, target);
      if (result.ok && result.status === "pending_out") {
        emitToUserByName(target, "friend_incoming", {
          fromName: user.name,
        });
      } else if (result.ok && result.status === "friends") {
        emitToUserByName(target, "friend_accepted", { name: user.name });
      }
      respond({ ...result, targetName: target, targetPublicId: resolved.publicId || "" });
    } catch (err) {
      console.error("[friend_request]", err);
      respond({ ok: false, reason: "Không gửi được lời mời." });
    }
  });

  socket.on("friend_respond", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    const other = String(payload?.targetName ?? "").trim().slice(0, 32);
    const accept = Boolean(payload?.accept);
    if (!other) {
      respond({ ok: false, reason: "Thiếu tên." });
      return;
    }
    try {
      const result = await respondFriendRequest(user.name, other, accept);
      if (result.ok && accept && result.status === "friends") {
        emitToUserByName(other, "friend_accepted", { name: user.name });
      }
      respond(result);
    } catch (err) {
      console.error("[friend_respond]", err);
      respond({ ok: false, reason: "Không xử lý được lời mời." });
    }
  });

  socket.on("sync_notifications", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    let codes = [];
    if (Array.isArray(payload?.codes)) codes = payload.codes;
    const normalized = [...new Set(codes.map(normalizeRoomCode).filter((c) => c.length >= 4))];
    try {
      const friendRequests = await listIncomingFriendRequests(user.name);
      const joinRequests = [];
      for (const code of normalized) {
        const room = await getRoomByCode(code);
        if (!room?.id) continue;
        const level = await actorManageLevel(room.id, user.name, room.ownerName || "");
        if (!level) continue;
        const reqs = await listRoomJoinRequests(room.id);
        for (const reqName of reqs) {
          joinRequests.push({
            roomId: room.id,
            roomCode: room.code,
            roomName: room.name || room.code,
            userName: reqName,
          });
        }
      }
      respond({ ok: true, friendRequests, joinRequests });
    } catch (err) {
      console.error("[sync_notifications]", err);
      respond({ ok: false, reason: "Không tải được thông báo." });
    }
  });

  socket.on("common_rooms", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    const target = String(payload?.targetName ?? "").trim().slice(0, 32);
    if (!target) {
      respond({ ok: false, reason: "Thiếu tên." });
      return;
    }
    try {
      const rooms = await listCommonGroupRooms(user.name, target);
      const publicId = (await getUserPublicId(target)) || "";
      respond({ ok: true, rooms, publicId });
    } catch (err) {
      console.error("[common_rooms]", err);
      respond({ ok: false, reason: "Không tải được nhóm chung." });
    }
  });

  socket.on("pin_message", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    const roomMeta = await getRoomById(user.roomId);
    const owner = roomMeta?.ownerName || "";
    if (!owner || user.name !== owner) {
      respond({ ok: false, reason: "Chỉ trưởng nhóm mới được ghim tin." });
      return;
    }
    const messageId = Number(payload?.messageId);
    if (!Number.isInteger(messageId) || messageId < 1) {
      respond({ ok: false, reason: "Tin không hợp lệ." });
      return;
    }
    try {
      const result = await pinRoomMessage(user.roomId, messageId, user.name);
      if (result.ok) {
        io.to(roomChannel(user.roomId)).emit("room_pins", { roomId: user.roomId, pins: result.pins });
      }
      respond(result);
    } catch (err) {
      console.error("[pin_message]", err);
      respond({ ok: false, reason: "Không ghim được tin." });
    }
  });

  socket.on("unpin_message", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    const roomMeta = await getRoomById(user.roomId);
    const owner = roomMeta?.ownerName || "";
    if (!owner || user.name !== owner) {
      respond({ ok: false, reason: "Chỉ trưởng nhóm mới được bỏ ghim." });
      return;
    }
    const messageId = Number(payload?.messageId);
    if (!Number.isInteger(messageId) || messageId < 1) {
      respond({ ok: false, reason: "Tin không hợp lệ." });
      return;
    }
    try {
      const result = await unpinRoomMessage(user.roomId, messageId);
      if (result.ok) {
        io.to(roomChannel(user.roomId)).emit("room_pins", { roomId: user.roomId, pins: result.pins });
      }
      respond(result);
    } catch (err) {
      console.error("[unpin_message]", err);
      respond({ ok: false, reason: "Không bỏ ghim được." });
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
    const avatarData = sanitizeAvatarDataPayload(payload?.avatarDataUrl);
    await upsertRoomRead(user.roomId, user.name, messageId, avatarUrl);
    if (avatarUrl || avatarData) {
      await upsertUserAvatarCache(user.name, avatarUrl, avatarData);
    }
    broadcastRoomReads(user.roomId);
  });

  function sanitizeAvatarDataPayload(raw) {
    const s = String(raw ?? "");
    if (!s.startsWith("data:image/") || s.length > 120_000) return "";
    return s;
  }

  socket.on("save_user_avatar", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user) {
      respond({ ok: false, reason: "Chưa đăng nhập." });
      return;
    }
    try {
      const avatarUrl = String(payload?.avatarUrl ?? "").slice(0, 500);
      const avatarData = sanitizeAvatarDataPayload(payload?.avatarDataUrl);
      if (!avatarUrl && !avatarData) {
        respond({ ok: false, reason: "Thiếu ảnh." });
        return;
      }
      await upsertUserAvatarCache(user.name, avatarUrl, avatarData);
      respond({ ok: true });
    } catch (err) {
      console.error("[save_user_avatar]", err);
      respond({ ok: false, reason: "Không lưu được ảnh." });
    }
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
      const roomMeta = await getRoomById(user.roomId);
      await postRoomSystem(
        user.roomId,
        roomMeta?.code || user.roomCode || "",
        `${old} đổi tên thành ${trimmed}`
      );
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
    const nextAvatarData =
      payload?.avatarDataUrl != null ? sanitizeAvatarDataPayload(payload.avatarDataUrl) : undefined;
    const nextRequireApproval =
      payload?.requireApproval != null ? Boolean(payload.requireApproval) : undefined;
    if (nextName !== undefined && !nextName) {
      respond({ ok: false, reason: "Tên nhóm không được trống." });
      return;
    }
    try {
      const updated = await updateRoomFields(user.roomId, {
        name: nextName,
        avatarUrl: nextAvatar,
        avatarData: nextAvatarData,
        requireApproval: nextRequireApproval,
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

  socket.on("room_member_manage", async (payload, ack) => {
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
    const action = String(payload?.action ?? "").trim();
    const target = String(payload?.targetName ?? "").trim().slice(0, 32);
    if (!target) {
      respond({ ok: false, reason: "Thiếu tên thành viên." });
      return;
    }
    const level = await actorManageLevel(user.roomId, user.name, room.ownerName || "");
    if (!level) {
      respond({ ok: false, reason: "Bạn không có quyền quản lý thành viên." });
      return;
    }

    const owner = room.ownerName || "";
    const roles = await getRoomMemberRoleMap(user.roomId);
    const targetIsOwner = isRoomOwner(target, owner);
    const targetIsDeputy = roles[target] === "deputy";
    const registered = await listRegisteredRoomMemberNames(user.roomId);
    const onList = registered.some((n) => n === target) || targetIsOwner;

    try {
      if (action === "kick") {
        if (target === user.name) {
          respond({ ok: false, reason: "Không thể tự mời chính mình ra." });
          return;
        }
        if (targetIsOwner) {
          respond({ ok: false, reason: "Không thể mời trưởng nhóm ra." });
          return;
        }
        if (level === "deputy" && (targetIsDeputy || !onList)) {
          respond({ ok: false, reason: "Phó phòng chỉ mời được thành viên thường." });
          return;
        }
        await kickMemberByName(
          user.roomId,
          target,
          "Bạn đã bị trưởng/phó phòng mời ra khỏi nhóm."
        );
        await postRoomSystem(
          user.roomId,
          room.code,
          `${user.name} đã mời ${target} ra khỏi nhóm`
        );
        broadcastRoomRoster(user.roomId);
        respond({ ok: true });
        return;
      }

      if (action === "set_deputy" || action === "unset_deputy" || action === "transfer_owner") {
        if (level !== "owner") {
          respond({ ok: false, reason: "Chỉ trưởng nhóm mới làm được thao tác này." });
          return;
        }
      }

      if (action === "set_deputy") {
        if (targetIsOwner || target === user.name) {
          respond({ ok: false, reason: "Không thể gán phó phòng cho trưởng nhóm." });
          return;
        }
        if (!registered.includes(target)) {
          respond({ ok: false, reason: "Thành viên chưa có trong danh sách phòng." });
          return;
        }
        const ok = await setRoomMemberRole(user.roomId, target, "deputy");
        if (!ok) {
          respond({ ok: false, reason: "Không gán được phó phòng." });
          return;
        }
        await postRoomSystem(
          user.roomId,
          room.code,
          `${user.name} bổ nhiệm ${target} làm phó phòng`
        );
        broadcastRoomRoster(user.roomId);
        respond({ ok: true });
        return;
      }

      if (action === "unset_deputy") {
        if (!targetIsDeputy) {
          respond({ ok: false, reason: "Thành viên này không phải phó phòng." });
          return;
        }
        await setRoomMemberRole(user.roomId, target, "member");
        await postRoomSystem(
          user.roomId,
          room.code,
          `${user.name} bỏ chức phó phòng của ${target}`
        );
        broadcastRoomRoster(user.roomId);
        respond({ ok: true });
        return;
      }

      if (action === "transfer_owner") {
        if (target === user.name) {
          respond({ ok: false, reason: "Bạn đang là trưởng nhóm." });
          return;
        }
        if (!registered.includes(target) && !targetIsOwner) {
          await addRoomMember(user.roomId, target);
        }
        const updated = await updateRoomFields(user.roomId, { ownerName: target });
        if (!updated) {
          respond({ ok: false, reason: "Không chuyển được trưởng nhóm." });
          return;
        }
        if (roles[target] === "deputy") {
          await setRoomMemberRole(user.roomId, target, "member");
        }
        await addRoomMember(user.roomId, target);
        await addRoomMember(user.roomId, user.name);
        io.to(roomChannel(user.roomId)).emit("room_updated", updated);
        io.to(watchChannel(updated.code)).emit("room_updated", updated);
        await postRoomSystem(
          user.roomId,
          updated.code,
          `${user.name} chuyển quyền trưởng nhóm cho ${target}`
        );
        broadcastRoomRoster(user.roomId);
        respond({ ok: true, room: updated });
        return;
      }

      if (action === "add_member") {
        const check = validateDisplayName(target);
        if (!check.ok) {
          respond({ ok: false, reason: check.reason });
          return;
        }
        if (registered.includes(target)) {
          respond({ ok: false, reason: "Thành viên đã có trong nhóm." });
          return;
        }
        await addRoomMember(user.roomId, target);
        await removeRoomJoinRequest(user.roomId, target);
        await postRoomSystem(user.roomId, room.code, `${user.name} đã thêm ${target} vào nhóm`);
        broadcastRoomRoster(user.roomId);
        const requests = await listRoomJoinRequests(user.roomId);
        io.to(roomChannel(user.roomId)).emit("join_requests", {
          roomId: user.roomId,
          requests,
        });
        respond({ ok: true });
        return;
      }

      if (action === "mute") {
        if (target === user.name || targetIsOwner) {
          respond({ ok: false, reason: "Không thể cấm chat mục tiêu này." });
          return;
        }
        if (level === "deputy" && targetIsDeputy) {
          respond({ ok: false, reason: "Phó phòng không cấm chat phó phòng khác." });
          return;
        }
        const minutes = Number(payload?.minutes) || 15;
        await setRoomMute(user.roomId, target, minutes, user.name);
        await postRoomSystem(
          user.roomId,
          room.code,
          `${user.name} cấm chat ${target} trong ${minutes} phút`
        );
        respond({ ok: true });
        return;
      }

      if (action === "unmute") {
        await clearRoomMute(user.roomId, target);
        await postRoomSystem(user.roomId, room.code, `${user.name} bỏ cấm chat ${target}`);
        respond({ ok: true });
        return;
      }

      if (action === "approve_join") {
        if (level !== "owner" && level !== "deputy") {
          respond({ ok: false, reason: "Không có quyền duyệt." });
          return;
        }
        const pending = await listRoomJoinRequests(user.roomId);
        if (!pending.includes(target)) {
          respond({ ok: false, reason: "Không có yêu cầu này." });
          return;
        }
        await addRoomMember(user.roomId, target);
        await removeRoomJoinRequest(user.roomId, target);
        await postRoomSystem(user.roomId, room.code, `${user.name} duyệt ${target} vào nhóm`);
        broadcastRoomRoster(user.roomId);
        io.to(roomChannel(user.roomId)).emit("join_requests", {
          roomId: user.roomId,
          requests: await listRoomJoinRequests(user.roomId),
        });
        respond({ ok: true });
        return;
      }

      if (action === "deny_join") {
        if (level !== "owner" && level !== "deputy") {
          respond({ ok: false, reason: "Không có quyền từ chối." });
          return;
        }
        await removeRoomJoinRequest(user.roomId, target);
        io.to(roomChannel(user.roomId)).emit("join_requests", {
          roomId: user.roomId,
          requests: await listRoomJoinRequests(user.roomId),
        });
        respond({ ok: true });
        return;
      }

      respond({ ok: false, reason: "Thao tác không hợp lệ." });
    } catch (err) {
      console.error("[room_member_manage]", err);
      respond({ ok: false, reason: "Lỗi server." });
    }
  });

  socket.on("message", async (payload) => {
    const user = online.get(socket.id);
    if (!user || !user.roomId) return;
    if (!rateLimitOk(`msg:${user.clientId}`, 80, 60_000)) {
      socket.emit("message_error", "Gửi tin quá nhanh — chờ vài giây.");
      return;
    }
    if (!user.authPolicyOk) {
      socket.emit("upgrade_required", {
        reason: "Cần tải lại trang (Ctrl+F5) để cập nhật Webchat v41.",
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

    if (await isUserMutedInRoom(user.roomId, user.name)) {
      socket.emit("message_error", "Bạn đang bị cấm chat tạm thời trong nhóm này.");
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
          if (key === "options" && Array.isArray(v)) {
            meta.options = v
              .map((o) => String(o ?? "").trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 8);
            continue;
          }
          if (key === "votes" && v && typeof v === "object" && !Array.isArray(v)) {
            meta.votes = v;
            continue;
          }
          if (key === "allowMultiple" || key === "locked") {
            meta[key] = Boolean(v);
            continue;
          }
          const maxLen = key === "avatarUrl" ? 500 : 200;
          meta[key] = String(v ?? "").slice(0, maxLen);
        }
      }
    }

    if (type === "text" && !text) return;
    if (type === "sticker" && !sticker) return;
    if ((type === "image" || type === "file") && !url) return;
    if (type === "reaction") text = text || "👍";
    if (type === "contact" && !meta.phone && !meta.displayName) return;
    if (type === "payment" && !meta.account) return;
    if (type === "poll") {
      const opts = Array.isArray(meta.options) ? meta.options : [];
      if (!text.trim() || opts.length < 2) return;
      meta.votes = meta.votes || {};
    }

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

  socket.on("recall_message", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    const messageId = Number(payload?.messageId);
    try {
      const result = await recallMessage(messageId, user.name, user.roomId);
      if (result.ok && result.message) {
        io.to(roomChannel(user.roomId)).emit("message_updated", result.message);
      }
      respond(result);
    } catch (err) {
      console.error("[recall_message]", err);
      respond({ ok: false, reason: "Không thu hồi được." });
    }
  });

  socket.on("edit_message", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    const messageId = Number(payload?.messageId);
    const text = String(payload?.text ?? "");
    try {
      const result = await editMessageText(messageId, user.name, user.roomId, text);
      if (result.ok && result.message) {
        const withReact = { ...result.message, reactions: {} };
        io.to(roomChannel(user.roomId)).emit("message_updated", withReact);
      }
      respond(result);
    } catch (err) {
      console.error("[edit_message]", err);
      respond({ ok: false, reason: "Không sửa được tin." });
    }
  });

  socket.on("poll_vote", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    try {
      const result = await castPollVote(
        payload?.messageId,
        user.name,
        payload?.optionIndices ?? payload?.optionIndex
      );
      if (result.ok && result.message) {
        io.to(roomChannel(user.roomId)).emit("message_updated", result.message);
        io.to(roomChannel(user.roomId)).emit("poll_activity", {
          kind: "vote",
          roomId: user.roomId,
          messageId: result.message.id,
          actor: user.name,
          topic: result.message.text || "Bình chọn",
        });
      }
      respond(result);
    } catch (err) {
      console.error("[poll_vote]", err);
      respond({ ok: false, reason: "Không bỏ phiếu được." });
    }
  });

  socket.on("poll_lock", async (payload, ack) => {
    const respond = (data) => {
      if (typeof ack === "function") ack(data);
    };
    const user = online.get(socket.id);
    if (!user?.roomId) {
      respond({ ok: false, reason: "Chưa vào phòng." });
      return;
    }
    try {
      const result = await lockPollMessage(payload?.messageId, user.name);
      if (result.ok && result.message) {
        io.to(roomChannel(user.roomId)).emit("message_updated", result.message);
        io.to(roomChannel(user.roomId)).emit("poll_activity", {
          kind: "lock",
          roomId: user.roomId,
          messageId: result.message.id,
          actor: user.name,
          topic: result.message.text || "Bình chọn",
        });
      }
      respond(result);
    } catch (err) {
      console.error("[poll_lock]", err);
      respond({ ok: false, reason: "Không khóa được." });
    }
  });

  socket.on("react", async (payload) => {
    const user = online.get(socket.id);
    if (!user || !payload) return;

    const messageId = Number(payload.messageId);
    if (!Number.isInteger(messageId) || messageId < 1) return;
    if (!(await messageExists(messageId))) return;

    if (payload.clear) {
      const reactions = await clearUserReactions(messageId, user.name);
      if (reactions === null) return;
      io.emit("message_reactions", { messageId, reactions });
      return;
    }

    const emoji = String(payload.emoji ?? "").slice(0, 8);
    if (!ALLOWED_REACTIONS.has(emoji)) return;

    const reactions = await incrementReaction(messageId, user.name, emoji);
    if (!reactions) return;

    io.emit("message_reactions", { messageId, reactions });
  });

  socket.on("disconnect", async () => {
    const user = online.get(socket.id);
    if (user) {
      const rid = user.roomId;
      const name = user.name;
      clearUserTyping(user);
      online.delete(socket.id);
      if (rid && name) {
        broadcastRoomRoster(rid);
      }
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

await initDb();
await hydrateReactionCache([]);
attachCaroServer(io);

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
