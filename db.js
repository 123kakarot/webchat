import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

/** @type {import("pg").Pool | null} */
let pool = null;
let useMemory = true;

/** @type {Map<number, Map<string, Set<string>>>} */
const memoryReactions = new Map();
/** @type {Array<object>} */
const memoryMessages = [];
let memoryNextId = 1;

/** @type {Array<{ id: number, name: string, kind: string, code: string }>} */
const memoryRooms = [];
let memoryNextRoomId = 1;

export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
  return code;
}

export function normalizeRoomCode(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

async function uniqueRoomCodePg() {
  for (let i = 0; i < 12; i++) {
    const code = generateRoomCode();
    const { rows } = await pool.query(`SELECT 1 FROM rooms WHERE code = $1`, [code]);
    if (!rows.length) return code;
  }
  throw new Error("code generation failed");
}

function uniqueRoomCodeMemory() {
  for (let i = 0; i < 12; i++) {
    const code = generateRoomCode();
    if (!memoryRooms.some((r) => r.code === code)) return code;
  }
  throw new Error("code generation failed");
}

export function isPersistent() {
  return !useMemory;
}

async function backfillRoomCodesPg() {
  const { rows } = await pool.query(`SELECT id FROM rooms WHERE code IS NULL OR code = ''`);
  for (const row of rows) {
    const code = await uniqueRoomCodePg();
    await pool.query(`UPDATE rooms SET code = $1 WHERE id = $2`, [code, row.id]);
  }
}

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[db] No DATABASE_URL — chat history only in RAM until restart");
    useMemory = true;
    return;
  }

  pool = new Pool({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      kind VARCHAR(16) NOT NULL DEFAULT 'group',
      code VARCHAR(8),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS code VARCHAR(8);
    CREATE UNIQUE INDEX IF NOT EXISTS rooms_code_unique ON rooms (code);

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
      name VARCHAR(32) NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'text',
      text TEXT,
      url VARCHAR(500),
      file_name VARCHAR(200),
      sticker VARCHAR(16),
      meta JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE;

    CREATE INDEX IF NOT EXISTS messages_room_created_idx ON messages (room_id, id DESC);

    CREATE TABLE IF NOT EXISTS reactions (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_name VARCHAR(32) NOT NULL,
      emoji VARCHAR(8) NOT NULL,
      PRIMARY KEY (message_id, user_name)
    );
  `);

  await backfillRoomCodesPg();
  await pool.query(
    `UPDATE messages SET room_id = NULL WHERE room_id IS NOT NULL AND room_id NOT IN (SELECT id FROM rooms)`
  );

  useMemory = false;
  console.log("[db] PostgreSQL ready — chat history persisted");
}

function normalizeAt(row) {
  if (row.at != null && row.at !== "") {
    const n = Number(row.at);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  if (row.created_at) {
    const t = new Date(row.created_at).getTime();
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function rowToMessage(row) {
  return {
    id: row.id,
    roomId: row.room_id ?? row.roomId ?? 1,
    name: row.name,
    type: row.type,
    text: row.text ?? "",
    url: row.url ?? "",
    fileName: row.file_name ?? row.fileName ?? "",
    sticker: row.sticker ?? "",
    meta: typeof row.meta === "object" && row.meta ? row.meta : {},
    at: normalizeAt(row),
    reactions: row.reactions ?? {},
  };
}

function reactionsMapToObject(map) {
  if (!map) return {};
  const out = {};
  for (const [emoji, users] of map) {
    if (users.size) out[emoji] = [...users];
  }
  return out;
}

async function attachReactions(messages) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => m.id);

  if (useMemory) {
    return messages.map((m) => ({
      ...m,
      reactions: reactionsMapToObject(memoryReactions.get(m.id)),
    }));
  }

  const { rows } = await pool.query(
    `SELECT message_id, emoji, user_name FROM reactions WHERE message_id = ANY($1::int[])`,
    [ids]
  );
  /** @type {Record<number, Record<string, string[]>>} */
  const byMsg = {};
  for (const r of rows) {
    if (!byMsg[r.message_id]) byMsg[r.message_id] = {};
    if (!byMsg[r.message_id][r.emoji]) byMsg[r.message_id][r.emoji] = [];
    byMsg[r.message_id][r.emoji].push(r.user_name);
  }
  return messages.map((m) => ({ ...m, reactions: byMsg[m.id] ?? {} }));
}

function previewFromMessage(m) {
  if (!m) return { preview: "Chưa có tin nhắn", lastAt: 0, lastName: "" };
  const type = m.type || "text";
  let preview = m.text || "";
  if (type === "sticker") preview = "Sticker " + (m.sticker || "");
  else if (type === "image") preview = "Hình ảnh";
  else if (type === "file") preview = "📎 " + (m.fileName || "Tệp");
  else if (type === "contact") preview = "Danh thiếp";
  else if (type === "payment") preview = "Thông tin chuyển khoản";
  else if (type === "reaction") preview = m.text || "👍";
  return {
    preview: preview.slice(0, 80),
    lastAt: m.at || 0,
    lastName: m.name || "",
  };
}

export async function listRoomsByCodes(codes) {
  const normalized = [...new Set(codes.map(normalizeRoomCode).filter(Boolean))];
  if (!normalized.length) return [];

  if (useMemory) {
    return memoryRooms
      .filter((r) => normalized.includes(r.code))
      .map((r) => {
        const roomMsgs = memoryMessages.filter((m) => m.roomId === r.id);
        const last = roomMsgs[roomMsgs.length - 1];
        const p = previewFromMessage(last);
        return { id: r.id, name: r.name, kind: r.kind, code: r.code, ...p };
      });
  }

  const { rows } = await pool.query(
    `
    SELECT r.id, r.name, r.kind, r.code,
           lm.name AS last_name,
           lm.type AS last_type,
           lm.text AS last_text,
           lm.sticker,
           lm.file_name,
           (EXTRACT(EPOCH FROM lm.created_at) * 1000) AS last_at
    FROM rooms r
    LEFT JOIN LATERAL (
      SELECT * FROM messages m WHERE m.room_id = r.id ORDER BY m.id DESC LIMIT 1
    ) lm ON TRUE
    WHERE r.code = ANY($1::text[])
    ORDER BY lm.created_at DESC NULLS LAST, r.id ASC
    `,
    [normalized]
  );

  return rows.map((row) => {
    let preview = row.last_text || "";
    const type = row.last_type || "text";
    if (!row.last_name) preview = "Chưa có tin nhắn";
    else if (type === "sticker") preview = "Sticker " + (row.sticker || "");
    else if (type === "image") preview = "Hình ảnh";
    else if (type === "file") preview = "📎 " + (row.file_name || "Tệp");
    else if (type === "contact") preview = "Danh thiếp";
    else if (type === "payment") preview = "Chuyển khoản";
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      code: row.code,
      preview: String(preview).slice(0, 80),
      lastAt: row.last_at ? Math.round(Number(row.last_at)) : 0,
      lastName: row.last_name || "",
    };
  });
}

/** @deprecated use listRoomsByCodes */
export async function listRooms() {
  if (useMemory) return listRoomsByCodes(memoryRooms.map((r) => r.code));
  const { rows } = await pool.query(`SELECT code FROM rooms WHERE code IS NOT NULL`);
  return listRoomsByCodes(rows.map((r) => r.code));
}

export async function getRoomByCode(rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (code.length < 4) return null;

  if (useMemory) {
    const room = memoryRooms.find((r) => r.code === code);
    if (!room) return null;
    return { id: room.id, name: room.name, kind: room.kind, code: room.code };
  }

  const { rows } = await pool.query(
    `SELECT id, name, kind, code FROM rooms WHERE code = $1`,
    [code]
  );
  return rows[0] ?? null;
}

export async function createRoom(name) {
  const trimmed = String(name ?? "").trim().slice(0, 64);
  if (!trimmed) throw new Error("empty name");

  if (useMemory) {
    const code = uniqueRoomCodeMemory();
    const room = { id: memoryNextRoomId++, name: trimmed, kind: "group", code };
    memoryRooms.push(room);
    return {
      id: room.id,
      name: room.name,
      kind: room.kind,
      code: room.code,
      preview: "Chưa có tin nhắn",
      lastAt: 0,
      lastName: "",
    };
  }

  const code = await uniqueRoomCodePg();
  const { rows } = await pool.query(
    `INSERT INTO rooms (name, kind, code) VALUES ($1, 'group', $2) RETURNING id, name, kind, code`,
    [trimmed, code]
  );
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    code: r.code,
    preview: "Chưa có tin nhắn",
    lastAt: 0,
    lastName: "",
  };
}

export async function roomExists(roomId) {
  if (useMemory) return memoryRooms.some((r) => r.id === roomId);
  const { rows } = await pool.query(`SELECT 1 FROM rooms WHERE id = $1`, [roomId]);
  return rows.length > 0;
}

export async function loadRecentMessages(roomId, limit = 250) {
  const rid = Number(roomId) || 1;

  if (useMemory) {
    const slice = memoryMessages.filter((m) => m.roomId === rid).slice(-limit);
    return attachReactions(slice.map((m) => ({ ...m })));
  }

  const { rows } = await pool.query(
    `SELECT id, room_id, name, type, text, url, file_name, sticker, meta, created_at,
            (EXTRACT(EPOCH FROM created_at) * 1000) AS at
     FROM messages
     WHERE room_id = $1
     ORDER BY id DESC
     LIMIT $2`,
    [rid, limit]
  );
  rows.reverse();
  const messages = rows.map(rowToMessage);
  return attachReactions(messages);
}

export async function saveMessage(payload) {
  const { roomId = 1, name, type, text, url, fileName, sticker, meta } = payload;
  const rid = Number(roomId) || 1;

  if (useMemory) {
    const id = memoryNextId++;
    const msg = {
      id,
      roomId: rid,
      name,
      type,
      text: text ?? "",
      url: url ?? "",
      fileName: fileName ?? "",
      sticker: sticker ?? "",
      meta: meta ?? {},
      at: Date.now(),
    };
    memoryMessages.push(msg);
    memoryReactions.set(id, new Map());
    if (memoryMessages.length > 2000) {
      const removed = memoryMessages.shift();
      if (removed) memoryReactions.delete(removed.id);
    }
    return { ...msg, reactions: {} };
  }

  const { rows } = await pool.query(
    `INSERT INTO messages (room_id, name, type, text, url, file_name, sticker, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, room_id, name, type, text, url, file_name, sticker, meta, created_at,
               (EXTRACT(EPOCH FROM created_at) * 1000) AS at`,
    [
      rid,
      name,
      type,
      text || null,
      url || null,
      fileName || null,
      sticker || null,
      JSON.stringify(meta ?? {}),
    ]
  );
  return { ...rowToMessage(rows[0]), reactions: {} };
}

export async function messageExists(id) {
  if (useMemory) return memoryMessages.some((m) => m.id === id);
  const { rows } = await pool.query(`SELECT 1 FROM messages WHERE id = $1`, [id]);
  return rows.length > 0;
}

export async function toggleReaction(messageId, userName, emoji) {
  if (useMemory) {
    const map = memoryReactions.get(messageId);
    if (!map) return null;

    let users = map.get(emoji);
    if (users?.has(userName)) {
      users.delete(userName);
      if (!users.size) map.delete(emoji);
    } else {
      for (const set of map.values()) set.delete(userName);
      for (const [e, set] of [...map.entries()]) {
        if (!set.size) map.delete(e);
      }
      users = map.get(emoji) ?? new Set();
      users.add(userName);
      map.set(emoji, users);
    }
    return reactionsMapToObject(map);
  }

  const { rows: existing } = await pool.query(
    `SELECT emoji FROM reactions WHERE message_id = $1 AND user_name = $2`,
    [messageId, userName]
  );

  if (existing.length && existing[0].emoji === emoji) {
    await pool.query(`DELETE FROM reactions WHERE message_id = $1 AND user_name = $2`, [
      messageId,
      userName,
    ]);
  } else {
    await pool.query(
      `INSERT INTO reactions (message_id, user_name, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_name) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [messageId, userName, emoji]
    );
  }

  const { rows } = await pool.query(
    `SELECT emoji, user_name FROM reactions WHERE message_id = $1`,
    [messageId]
  );
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const r of rows) {
    if (!out[r.emoji]) out[r.emoji] = [];
    out[r.emoji].push(r.user_name);
  }
  return out;
}

export async function hydrateReactionCache(messages) {
  if (!useMemory) return;
  for (const m of messages) {
    const map = new Map();
    for (const [emoji, users] of Object.entries(m.reactions ?? {})) {
      map.set(emoji, new Set(users));
    }
    memoryReactions.set(m.id, map);
    if (m.id >= memoryNextId) memoryNextId = m.id + 1;
  }
  for (const m of messages) {
    if (!memoryMessages.some((x) => x.id === m.id)) {
      memoryMessages.push({ ...m, roomId: m.roomId ?? 1 });
    }
  }
  memoryMessages.sort((a, b) => a.id - b.id);
}
