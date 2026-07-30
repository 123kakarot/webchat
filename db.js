import pg from "pg";

const { Pool } = pg;

/** @type {import("pg").Pool | null} */
let pool = null;
let useMemory = true;

/** @type {Map<number, Map<string, Set<string>>>} */
const memoryReactions = new Map();
/** @type {Array<object>} */
const memoryMessages = [];
let memoryNextId = 1;

export function isPersistent() {
  return !useMemory;
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
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'text',
      text TEXT,
      url VARCHAR(500),
      file_name VARCHAR(200),
      sticker VARCHAR(16),
      meta JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at);

    CREATE TABLE IF NOT EXISTS reactions (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_name VARCHAR(32) NOT NULL,
      emoji VARCHAR(8) NOT NULL,
      PRIMARY KEY (message_id, user_name)
    );
  `);

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

export async function loadRecentMessages(limit = 250) {
  if (useMemory) {
    const slice = memoryMessages.slice(-limit);
    return attachReactions(slice.map((m) => ({ ...m })));
  }

  const { rows } = await pool.query(
    `SELECT id, name, type, text, url, file_name, sticker, meta, created_at,
            (EXTRACT(EPOCH FROM created_at) * 1000) AS at
     FROM messages
     ORDER BY id DESC
     LIMIT $1`,
    [limit]
  );
  rows.reverse();
  const messages = rows.map(rowToMessage);
  return attachReactions(messages);
}

export async function saveMessage(payload) {
  const { name, type, text, url, fileName, sticker, meta } = payload;

  if (useMemory) {
    const id = memoryNextId++;
    const msg = {
      id,
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
    if (memoryMessages.length > 500) {
      const removed = memoryMessages.shift();
      if (removed) memoryReactions.delete(removed.id);
    }
    return { ...msg, reactions: {} };
  }

  const { rows } = await pool.query(
    `INSERT INTO messages (name, type, text, url, file_name, sticker, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, name, type, text, url, file_name, sticker, meta, created_at,
               (EXTRACT(EPOCH FROM created_at) * 1000) AS at`,
    [
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
      memoryMessages.push({ ...m });
    }
  }
  memoryMessages.sort((a, b) => a.id - b.id);
}
