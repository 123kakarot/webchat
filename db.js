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

/** @type {Array<{ id: number, name: string, kind: string, code: string, owner_name?: string, avatar_url?: string }>} */
const memoryRooms = [];
/** @type {Map<number, Map<string, string>>} */
const memoryRoomMembers = new Map();
/** @type {Map<number, Map<string, { lastMessageId: number, avatarUrl: string }>>} */
const memoryRoomReads = new Map();
/** @type {Map<number, Array<{ messageId: number, pinnedBy: string, pinnedAt: number, sortOrder: number }>>} */
const memoryRoomPins = new Map();
let memoryNextRoomId = 1;

const MAX_ROOM_PINS = 3;

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

    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_name VARCHAR(32);
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

    CREATE TABLE IF NOT EXISTS room_members (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_name VARCHAR(32) NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      role VARCHAR(16) NOT NULL DEFAULT 'member',
      PRIMARY KEY (room_id, user_name)
    );

    ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member';

    CREATE TABLE IF NOT EXISTS room_read_state (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_name VARCHAR(32) NOT NULL,
      last_message_id INTEGER NOT NULL DEFAULT 0,
      avatar_url VARCHAR(500) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_name)
    );

    CREATE TABLE IF NOT EXISTS room_pins (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      pinned_by VARCHAR(32) NOT NULL,
      pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sort_order SMALLINT NOT NULL DEFAULT 0,
      PRIMARY KEY (room_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS room_pins_room_idx ON room_pins (room_id, sort_order);
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

function parseMeta(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
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
    meta: parseMeta(row.meta),
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

export async function countMessagesSince(roomId, sinceMs) {
  const rid = Number(roomId);
  const since = Number(sinceMs) || 0;
  if (!Number.isFinite(rid)) return 0;

  if (useMemory) {
    return memoryMessages.filter((m) => m.roomId === rid && (m.at || 0) > since).length;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM messages WHERE room_id = $1 AND (EXTRACT(EPOCH FROM created_at) * 1000) > $2`,
    [rid, since]
  );
  return rows[0]?.c ?? 0;
}

function roomRowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    code: row.code,
    ownerName: row.owner_name ?? row.ownerName ?? "",
    avatarUrl: row.avatar_url ?? row.avatarUrl ?? "",
  };
}

function pinEntryFromMessage(pinMeta, msg) {
  const p = previewFromMessage(msg);
  return {
    messageId: pinMeta.messageId,
    pinnedBy: pinMeta.pinnedBy,
    pinnedAt: pinMeta.pinnedAt,
    preview: p.preview,
    name: msg.name || "",
    type: msg.type || "text",
  };
}

async function loadMessageForPin(roomId, messageId) {
  const mid = Number(messageId);
  const rid = Number(roomId);
  if (useMemory) {
    const m = memoryMessages.find((x) => x.id === mid && x.roomId === rid);
    return m ? { ...m } : null;
  }
  const { rows } = await pool.query(
    `SELECT id, room_id, name, type, text, url, file_name, sticker, meta, created_at,
            (EXTRACT(EPOCH FROM created_at) * 1000) AS at
     FROM messages WHERE id = $1 AND room_id = $2`,
    [mid, rid]
  );
  return rows[0] ? rowToMessage(rows[0]) : null;
}

export async function listRoomPins(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return [];

  if (useMemory) {
    const list = memoryRoomPins.get(rid) ?? [];
    const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.pinnedAt - b.pinnedAt);
    const out = [];
    for (const p of sorted) {
      const msg = await loadMessageForPin(rid, p.messageId);
      if (!msg) continue;
      out.push(
        pinEntryFromMessage(
          { messageId: p.messageId, pinnedBy: p.pinnedBy, pinnedAt: p.pinnedAt },
          msg
        )
      );
    }
    return out;
  }

  const { rows } = await pool.query(
    `SELECT p.message_id, p.pinned_by, p.pinned_at, p.sort_order,
            m.id, m.room_id, m.name, m.type, m.text, m.url, m.file_name, m.sticker, m.meta,
            (EXTRACT(EPOCH FROM m.created_at) * 1000) AS at
     FROM room_pins p
     JOIN messages m ON m.id = p.message_id AND m.room_id = p.room_id
     WHERE p.room_id = $1
     ORDER BY p.sort_order ASC, p.pinned_at ASC`,
    [rid]
  );
  return rows.map((r) => {
    const msg = rowToMessage(r);
    return pinEntryFromMessage(
      {
        messageId: r.message_id,
        pinnedBy: r.pinned_by,
        pinnedAt: r.pinned_at ? new Date(r.pinned_at).getTime() : Date.now(),
      },
      msg
    );
  });
}

export async function pinRoomMessage(roomId, messageId, pinnedBy) {
  const rid = Number(roomId);
  const mid = Number(messageId);
  const who = String(pinnedBy ?? "").trim().slice(0, 32);
  if (!Number.isFinite(rid) || !Number.isFinite(mid) || !who) {
    return { ok: false, reason: "Dữ liệu không hợp lệ." };
  }
  if (!(await messageBelongsToRoom(mid, rid))) {
    return { ok: false, reason: "Tin nhắn không thuộc phòng này." };
  }

  if (useMemory) {
    if (!memoryRoomPins.has(rid)) memoryRoomPins.set(rid, []);
    const list = memoryRoomPins.get(rid);
    if (list.some((p) => p.messageId === mid)) {
      return { ok: true, pins: await listRoomPins(rid) };
    }
    if (list.length >= MAX_ROOM_PINS) {
      return { ok: false, reason: `Chỉ ghim tối đa ${MAX_ROOM_PINS} tin.` };
    }
    const sortOrder = list.length ? Math.max(...list.map((p) => p.sortOrder)) + 1 : 0;
    list.push({ messageId: mid, pinnedBy: who, pinnedAt: Date.now(), sortOrder });
    return { ok: true, pins: await listRoomPins(rid) };
  }

  const { rows: existing } = await pool.query(
    `SELECT 1 FROM room_pins WHERE room_id = $1 AND message_id = $2`,
    [rid, mid]
  );
  if (existing.length) return { ok: true, pins: await listRoomPins(rid) };

  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM room_pins WHERE room_id = $1`,
    [rid]
  );
  if ((cnt[0]?.c ?? 0) >= MAX_ROOM_PINS) {
    return { ok: false, reason: `Chỉ ghim tối đa ${MAX_ROOM_PINS} tin.` };
  }

  const { rows: ord } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM room_pins WHERE room_id = $1`,
    [rid]
  );
  const sortOrder = (ord[0]?.m ?? -1) + 1;
  await pool.query(
    `INSERT INTO room_pins (room_id, message_id, pinned_by, sort_order) VALUES ($1, $2, $3, $4)`,
    [rid, mid, who, sortOrder]
  );
  return { ok: true, pins: await listRoomPins(rid) };
}

export async function unpinRoomMessage(roomId, messageId) {
  const rid = Number(roomId);
  const mid = Number(messageId);
  if (!Number.isFinite(rid) || !Number.isFinite(mid)) {
    return { ok: false, reason: "Dữ liệu không hợp lệ." };
  }

  if (useMemory) {
    const list = memoryRoomPins.get(rid);
    if (!list) return { ok: true, pins: [] };
    const next = list.filter((p) => p.messageId !== mid);
    if (next.length) memoryRoomPins.set(rid, next);
    else memoryRoomPins.delete(rid);
    return { ok: true, pins: await listRoomPins(rid) };
  }

  await pool.query(`DELETE FROM room_pins WHERE room_id = $1 AND message_id = $2`, [rid, mid]);
  return { ok: true, pins: await listRoomPins(rid) };
}

export async function listCommonGroupRooms(nameA, nameB) {
  const a = String(nameA ?? "").trim().slice(0, 32);
  const b = String(nameB ?? "").trim().slice(0, 32);
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return [];

  if (useMemory) {
    const out = [];
    for (const r of memoryRooms) {
      if (r.kind === "direct") continue;
      const map = memoryRoomMembers.get(r.id);
      if (!map) continue;
      if (map.has(a) && map.has(b)) out.push(roomRowToClient(r));
    }
    return out.sort((x, y) => (x.name || "").localeCompare(y.name || "", "vi"));
  }

  const { rows } = await pool.query(
    `
    SELECT r.id, r.name, r.kind, r.code, r.owner_name, r.avatar_url
    FROM rooms r
    WHERE COALESCE(r.kind, 'group') <> 'direct'
      AND EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.user_name = $1)
      AND EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.user_name = $2)
    ORDER BY r.name ASC
    `,
    [a, b]
  );
  return rows.map(roomRowToClient).filter(Boolean);
}

export async function messageBelongsToRoom(messageId, roomId) {
  const mid = Number(messageId);
  const rid = Number(roomId);
  if (!Number.isFinite(mid) || !Number.isFinite(rid)) return false;

  if (useMemory) {
    return memoryMessages.some((m) => m.id === mid && m.roomId === rid);
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM messages WHERE id = $1 AND room_id = $2`,
    [mid, rid]
  );
  return rows.length > 0;
}

export async function upsertRoomRead(roomId, userName, lastMessageId, avatarUrl = "") {
  const rid = Number(roomId);
  const name = String(userName ?? "").trim().slice(0, 32);
  const mid = Number(lastMessageId);
  const av = String(avatarUrl ?? "").slice(0, 500);
  if (!Number.isFinite(rid) || !name || !Number.isFinite(mid) || mid < 1) return false;

  if (useMemory) {
    if (!memoryRoomReads.has(rid)) memoryRoomReads.set(rid, new Map());
    const map = memoryRoomReads.get(rid);
    const prev = map.get(name);
    if (prev && prev.lastMessageId >= mid) {
      if (av && av !== prev.avatarUrl) map.set(name, { ...prev, avatarUrl: av });
      return false;
    }
    map.set(name, { lastMessageId: mid, avatarUrl: av || prev?.avatarUrl || "" });
    return true;
  }

  const { rows } = await pool.query(
    `
    INSERT INTO room_read_state (room_id, user_name, last_message_id, avatar_url, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (room_id, user_name) DO UPDATE SET
      last_message_id = GREATEST(room_read_state.last_message_id, EXCLUDED.last_message_id),
      avatar_url = CASE WHEN EXCLUDED.avatar_url <> '' THEN EXCLUDED.avatar_url ELSE room_read_state.avatar_url END,
      updated_at = NOW()
    RETURNING last_message_id
    `,
    [rid, name, mid, av]
  );
  return Number(rows[0]?.last_message_id) === mid;
}

export async function getRoomReads(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return [];

  if (useMemory) {
    const map = memoryRoomReads.get(rid);
    if (!map) return [];
    return [...map.entries()].map(([userName, v]) => ({
      userName,
      lastMessageId: v.lastMessageId,
      avatarUrl: v.avatarUrl || "",
    }));
  }

  const { rows } = await pool.query(
    `SELECT user_name, last_message_id, avatar_url FROM room_read_state WHERE room_id = $1`,
    [rid]
  );
  return rows.map((r) => ({
    userName: r.user_name,
    lastMessageId: Number(r.last_message_id) || 0,
    avatarUrl: r.avatar_url || "",
  }));
}

export async function listRegisteredRoomMemberNames(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return [];

  if (useMemory) {
    const map = memoryRoomMembers.get(rid);
    return map ? [...map.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi")) : [];
  }

  const { rows } = await pool.query(
    `SELECT user_name FROM room_members WHERE room_id = $1 ORDER BY user_name ASC`,
    [rid]
  );
  return rows.map((r) => r.user_name).filter(Boolean);
}

/** null = open room (no whitelist rows); else restricted membership applies */
export async function getRoomMemberWhitelist(roomId) {
  const registered = await listRegisteredRoomMemberNames(roomId);
  if (!registered.length) return null;
  return registered;
}

function normalizeMemberKey(userName) {
  return String(userName ?? "").trim().toLowerCase();
}

export async function roomHasMessageAuthorName(roomId, userName) {
  const rid = Number(roomId);
  const key = normalizeMemberKey(userName);
  if (!Number.isFinite(rid) || !key) return false;

  if (useMemory) {
    return memoryMessages.some(
      (m) => m.roomId === rid && normalizeMemberKey(m.name) === key
    );
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM messages WHERE room_id = $1 AND lower(trim(name)) = $2 LIMIT 1`,
    [rid, key]
  );
  return rows.length > 0;
}

/** Whitelist + owner; trimmed former members must use a new display name to rejoin */
export async function isNameAllowedInRoom(roomId, userName, ownerName = "") {
  const whitelist = await getRoomMemberWhitelist(roomId);
  if (whitelist === null) return true;
  const key = normalizeMemberKey(userName);
  if (!key) return false;
  const owner = normalizeMemberKey(ownerName);
  if (owner && key === owner) return true;
  if (whitelist.some((n) => normalizeMemberKey(n) === key)) return true;
  if (await roomHasMessageAuthorName(roomId, userName)) return false;
  return true;
}

export async function removeRoomMember(roomId, userName) {
  const rid = Number(roomId);
  const name = String(userName ?? "").trim().slice(0, 32);
  if (!Number.isFinite(rid) || !name) return;

  if (useMemory) {
    memoryRoomMembers.get(rid)?.delete(name);
    return;
  }

  await pool.query(`DELETE FROM room_members WHERE room_id = $1 AND user_name = $2`, [rid, name]);
}

export async function removeRoomReadStateForUser(roomId, userName) {
  const rid = Number(roomId);
  const name = String(userName ?? "").trim().slice(0, 32);
  if (!Number.isFinite(rid) || !name) return;

  if (useMemory) {
    return;
  }

  await pool.query(`DELETE FROM room_read_state WHERE room_id = $1 AND user_name = $2`, [rid, name]);
}

export async function getRoomMemberRoleMap(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return {};

  if (useMemory) {
    const map = memoryRoomMembers.get(rid);
    if (!map) return {};
    return Object.fromEntries(map);
  }

  const { rows } = await pool.query(
    `SELECT user_name, role FROM room_members WHERE room_id = $1`,
    [rid]
  );
  /** @type {Record<string, string>} */
  const out = {};
  for (const r of rows) {
    out[r.user_name] = r.role === "deputy" ? "deputy" : "member";
  }
  return out;
}

export async function setRoomMemberRole(roomId, userName, role) {
  const rid = Number(roomId);
  const name = String(userName ?? "").trim().slice(0, 32);
  const nextRole = role === "deputy" ? "deputy" : "member";
  if (!Number.isFinite(rid) || !name) return false;

  if (useMemory) {
    const map = memoryRoomMembers.get(rid);
    if (!map || !map.has(name)) return false;
    map.set(name, nextRole);
    return true;
  }

  const { rowCount } = await pool.query(
    `UPDATE room_members SET role = $3 WHERE room_id = $1 AND user_name = $2`,
    [rid, name, nextRole]
  );
  return rowCount > 0;
}

export async function addRoomMember(roomId, userName) {
  const rid = Number(roomId);
  const name = String(userName ?? "").trim().slice(0, 32);
  if (!Number.isFinite(rid) || !name) return;

  if (useMemory) {
    if (!memoryRoomMembers.has(rid)) memoryRoomMembers.set(rid, new Map());
    const map = memoryRoomMembers.get(rid);
    if (!map.has(name)) map.set(name, "member");
    return;
  }

  await pool.query(
    `INSERT INTO room_members (room_id, user_name, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
    [rid, name]
  );
}

export async function listRoomMemberNames(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return [];

  const registered = await listRegisteredRoomMemberNames(roomId);
  if (registered.length > 0) {
    return registered;
  }

  if (useMemory) {
    const map = memoryRoomMembers.get(rid) ?? new Map();
    const fromMsg = memoryMessages.filter((m) => m.roomId === rid).map((m) => m.name);
    return [...new Set([...map.keys(), ...fromMsg])].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi"));
  }

  const { rows } = await pool.query(
    `
    SELECT user_name FROM room_members WHERE room_id = $1
    UNION
    SELECT DISTINCT name AS user_name FROM messages WHERE room_id = $1
    ORDER BY user_name ASC
    `,
    [rid]
  );
  return rows.map((r) => r.user_name).filter(Boolean);
}

export async function getRoomById(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return null;

  if (useMemory) {
    const room = memoryRooms.find((r) => r.id === rid);
    return room ? roomRowToClient(room) : null;
  }

  const { rows } = await pool.query(
    `SELECT id, name, kind, code, owner_name, avatar_url FROM rooms WHERE id = $1`,
    [rid]
  );
  return roomRowToClient(rows[0]);
}

export async function updateRoomFields(roomId, { name, avatarUrl, ownerName } = {}) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return null;

  if (useMemory) {
    const room = memoryRooms.find((r) => r.id === rid);
    if (!room) return null;
    if (name != null) room.name = String(name).trim().slice(0, 64) || room.name;
    if (avatarUrl != null) room.avatar_url = String(avatarUrl).slice(0, 500);
    if (ownerName != null) room.owner_name = String(ownerName).trim().slice(0, 32);
    return roomRowToClient(room);
  }

  const sets = [];
  const vals = [];
  let i = 1;
  if (name != null) {
    sets.push(`name = $${i++}`);
    vals.push(String(name).trim().slice(0, 64));
  }
  if (avatarUrl != null) {
    sets.push(`avatar_url = $${i++}`);
    vals.push(String(avatarUrl).slice(0, 500));
  }
  if (ownerName != null) {
    sets.push(`owner_name = $${i++}`);
    vals.push(String(ownerName).trim().slice(0, 32));
  }
  if (!sets.length) return getRoomById(rid);
  vals.push(rid);
  const { rows } = await pool.query(
    `UPDATE rooms SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, name, kind, code, owner_name, avatar_url`,
    vals
  );
  return roomRowToClient(rows[0]);
}

export async function deleteRoomById(roomId) {
  const rid = Number(roomId);
  if (!Number.isFinite(rid)) return false;

  if (useMemory) {
    const idx = memoryRooms.findIndex((r) => r.id === rid);
    if (idx < 0) return false;
    memoryRooms.splice(idx, 1);
    memoryRoomMembers.delete(rid);
    memoryRoomReads.delete(rid);
    memoryRoomPins.delete(rid);
    for (let j = memoryMessages.length - 1; j >= 0; j--) {
      if (memoryMessages[j].roomId === rid) memoryMessages.splice(j, 1);
    }
    return true;
  }

  const { rowCount } = await pool.query(`DELETE FROM rooms WHERE id = $1`, [rid]);
  return rowCount > 0;
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
        return {
          id: r.id,
          name: r.name,
          kind: r.kind,
          code: r.code,
          ownerName: r.owner_name ?? "",
          avatarUrl: r.avatar_url ?? "",
          ...p,
        };
      });
  }

  const { rows } = await pool.query(
    `
    SELECT r.id, r.name, r.kind, r.code, r.owner_name, r.avatar_url,
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
      ownerName: row.owner_name || "",
      avatarUrl: row.avatar_url || "",
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
    return roomRowToClient(room);
  }

  const { rows } = await pool.query(
    `SELECT id, name, kind, code, owner_name, avatar_url FROM rooms WHERE code = $1`,
    [code]
  );
  return roomRowToClient(rows[0]);
}

export async function createRoom(name, ownerName = "", avatarUrl = "", kind = "group") {
  const trimmed = String(name ?? "").trim().slice(0, 64);
  if (!trimmed) throw new Error("empty name");
  const owner = String(ownerName ?? "").trim().slice(0, 32);
  const avatar = String(avatarUrl ?? "").slice(0, 500);
  const roomKind = kind === "direct" ? "direct" : "group";

  if (useMemory) {
    const code = uniqueRoomCodeMemory();
    const room = {
      id: memoryNextRoomId++,
      name: trimmed,
      kind: roomKind,
      code,
      owner_name: owner,
      avatar_url: avatar,
    };
    memoryRooms.push(room);
    if (owner) {
      if (!memoryRoomMembers.has(room.id)) memoryRoomMembers.set(room.id, new Map());
      memoryRoomMembers.get(room.id).set(owner, "member");
    }
    return {
      id: room.id,
      name: room.name,
      kind: room.kind,
      code: room.code,
      ownerName: owner,
      avatarUrl: avatar,
      preview: "Chưa có tin nhắn",
      lastAt: 0,
      lastName: "",
    };
  }

  const code = await uniqueRoomCodePg();
  const { rows } = await pool.query(
    `INSERT INTO rooms (name, kind, code, owner_name, avatar_url) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, kind, code, owner_name, avatar_url`,
    [trimmed, roomKind, code, owner || null, avatar || null]
  );
  const r = rows[0];
  if (owner) await addRoomMember(r.id, owner);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    code: r.code,
    ownerName: r.owner_name || "",
    avatarUrl: r.avatar_url || "",
    preview: "Chưa có tin nhắn",
    lastAt: 0,
    lastName: "",
  };
}

export async function findDirectRoomBetween(nameA, nameB) {
  const a = String(nameA ?? "").trim().slice(0, 32);
  const b = String(nameB ?? "").trim().slice(0, 32);
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;

  if (useMemory) {
    for (const r of memoryRooms) {
      if (r.kind !== "direct") continue;
      const map = memoryRoomMembers.get(r.id);
      if (!map || map.size !== 2) continue;
      const names = [...map.keys()];
      if (names.includes(a) && names.includes(b)) return roomRowToClient(r);
    }
    return null;
  }

  const { rows } = await pool.query(
    `
    SELECT r.id, r.name, r.kind, r.code, r.owner_name, r.avatar_url
    FROM rooms r
    WHERE r.kind = 'direct'
      AND EXISTS (SELECT 1 FROM room_members m1 WHERE m1.room_id = r.id AND m1.user_name = $1)
      AND EXISTS (SELECT 1 FROM room_members m2 WHERE m2.room_id = r.id AND m2.user_name = $2)
      AND (SELECT COUNT(*)::int FROM room_members m WHERE m.room_id = r.id) = 2
    LIMIT 1
    `,
    [a, b]
  );
  return roomRowToClient(rows[0]);
}

export async function getOrCreateDirectRoom(creatorName, targetName) {
  const creator = String(creatorName ?? "").trim().slice(0, 32);
  const target = String(targetName ?? "").trim().slice(0, 32);
  if (!creator || !target) throw new Error("missing names");
  if (creator.toLowerCase() === target.toLowerCase()) throw new Error("same user");

  const existing = await findDirectRoomBetween(creator, target);
  if (existing) return existing;

  const sorted = [creator, target].sort((x, y) => x.localeCompare(y, "vi"));
  const label = `${sorted[0]} · ${sorted[1]}`.slice(0, 64);
  const room = await createRoom(label, creator, "", "direct");
  await addRoomMember(room.id, target);
  return room;
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

/** @returns {Promise<{ mode: string, counts: object, rooms: object[], recentMessages: object[] }>} */
export async function getDbOverview({ roomLimit = 40, messageLimit = 25 } = {}) {
  if (useMemory) {
    const rooms = memoryRooms.map((r) => {
      const msgs = memoryMessages.filter((m) => m.roomId === r.id);
      const last = msgs[msgs.length - 1];
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        kind: r.kind,
        message_count: msgs.length,
        last_message_at: last?.at ? new Date(last.at).toISOString() : null,
      };
    });
    const recentMessages = memoryMessages.slice(-messageLimit).map((m) => ({
      id: m.id,
      room_id: m.roomId,
      name: m.name,
      type: m.type,
      text: (m.text || "").slice(0, 120),
      created_at: m.at ? new Date(m.at).toISOString() : null,
    }));
    return {
      mode: "memory",
      counts: {
        rooms: memoryRooms.length,
        messages: memoryMessages.length,
        reactions: [...memoryReactions.values()].reduce((n, m) => n + m.size, 0),
      },
      rooms: rooms.slice(-roomLimit).reverse(),
      recentMessages,
    };
  }

  const [roomCount, msgCount, reactCount] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM rooms`),
    pool.query(`SELECT COUNT(*)::int AS n FROM messages`),
    pool.query(`SELECT COUNT(*)::int AS n FROM reactions`),
  ]);

  const { rows: rooms } = await pool.query(
    `
    SELECT r.id, r.name, r.code, r.kind, r.created_at,
           COUNT(m.id)::int AS message_count,
           MAX(m.created_at) AS last_message_at
    FROM rooms r
    LEFT JOIN messages m ON m.room_id = r.id
    GROUP BY r.id
    ORDER BY MAX(m.created_at) DESC NULLS LAST, r.id DESC
    LIMIT $1
    `,
    [roomLimit]
  );

  const { rows: recentMessages } = await pool.query(
    `
    SELECT m.id, m.room_id, m.name, m.type,
           LEFT(COALESCE(m.text, ''), 120) AS text,
           m.created_at,
           r.code AS room_code
    FROM messages m
    LEFT JOIN rooms r ON r.id = m.room_id
    ORDER BY m.id DESC
    LIMIT $1
    `,
    [messageLimit]
  );

  return {
    mode: "postgres",
    counts: {
      rooms: roomCount.rows[0]?.n ?? 0,
      messages: msgCount.rows[0]?.n ?? 0,
      reactions: reactCount.rows[0]?.n ?? 0,
    },
    rooms,
    recentMessages,
  };
}
