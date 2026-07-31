/**
 * Smoke test: login → create room → join → message → rejoin → list rooms
 * Run: node scripts/flow-test.mjs [baseUrl]
 */
import { io } from "socket.io-client";

const base = process.argv[2] || "http://127.0.0.1:3000";
const NAME = "FlowBot";
const CLIENT_BUILD = "67";
const AUTH_POLICY = "36";

function joinPayload(name, rejoin = false) {
  return { name, rejoin, authPolicy: AUTH_POLICY, clientBuild: CLIENT_BUILD };
}

function once(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function emitAck(socket, event, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

async function main() {
  const socket = io(base, {
    transports: ["polling", "websocket"],
    auth: { clientBuild: CLIENT_BUILD },
  });
  await new Promise((res, rej) => {
    socket.once("connect", res);
    socket.once("connect_error", rej);
    setTimeout(() => rej(new Error("connect timeout")), 10000);
  });
  console.log("OK connect");

  const joinRes = await emitAck(socket, "join", joinPayload(NAME, false));
  if (!joinRes?.ok) throw new Error("join failed: " + JSON.stringify(joinRes));
  console.log("OK join", joinRes.name);

  const createRes = await emitAck(socket, "create_room", "Phong flow test");
  if (!createRes?.ok || !createRes.room?.code) throw new Error("create failed");
  const code = createRes.room.code;
  console.log("OK create", code);

  const roomRes = await emitAck(socket, "join_room", { code });
  if (!roomRes?.ok) throw new Error("join_room failed");
  console.log("OK join_room", roomRes.name);

  socket.emit("message", { type: "text", text: "hello from flow-test" });
  await once(socket, "message", 5000).catch(() => null);
  console.log("OK message sent");

  const join2 = await emitAck(socket, "join", joinPayload(NAME, true));
  if (!join2?.ok) throw new Error("rejoin failed");
  const room2 = await emitAck(socket, "join_room", { code });
  if (!room2?.ok) throw new Error("rejoin_room failed");
  console.log("OK rejoin + join_room", room2.history?.length ?? 0, "messages in history");

  const listPromise = once(socket, "rooms_list", 5000);
  socket.emit("sync_rooms", [code]);
  const rooms = await listPromise;
  if (!Array.isArray(rooms) || !rooms.some((r) => r.code === code)) {
    throw new Error("rooms_list missing created room");
  }
  console.log("OK sync_rooms", rooms.length, "room(s)");

  socket.close();
  console.log("\nAll flow checks passed.");
}

main().catch((e) => {
  console.error("\nFAIL:", e.message || e);
  process.exit(1);
});
