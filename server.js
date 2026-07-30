import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

/** @type {Map<string, { id: string, name: string }>} */
const online = new Map();

function broadcastUsers() {
  io.emit("users", [...online.values()].map((u) => u.name));
}

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", (name) => {
    const trimmed = String(name ?? "").trim().slice(0, 32);
    if (!trimmed || joined) return;

    joined = true;
    online.set(socket.id, { id: socket.id, name: trimmed });
    socket.emit("joined", { name: trimmed });
    io.emit("system", `${trimmed} đã vào phòng`);
    broadcastUsers();
  });

  socket.on("message", (text) => {
    const user = online.get(socket.id);
    if (!user) return;

    const body = String(text ?? "").trim().slice(0, 2000);
    if (!body) return;

    io.emit("message", {
      name: user.name,
      text: body,
      at: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    const user = online.get(socket.id);
    if (user) {
      online.delete(socket.id);
      io.emit("system", `${user.name} đã rời phòng`);
      broadcastUsers();
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
httpServer.listen(PORT, HOST, () => {
  console.log(`Chat listening on ${HOST}:${PORT}`);
});
