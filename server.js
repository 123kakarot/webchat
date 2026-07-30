import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import crypto from "crypto";
import { validateDisplayName } from "./nameFilter.js";

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

/** @type {Map<string, { id: string, name: string }>} */
const online = new Map();

function broadcastUsers() {
  io.emit("users", [...online.values()].map((u) => u.name));
}

function emitMessage(payload) {
  io.emit("message", { ...payload, at: Date.now() });
}

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", (name) => {
    const trimmed = String(name ?? "").trim().slice(0, 32);
    if (joined) return;

    const check = validateDisplayName(trimmed);
    if (!check.ok) {
      socket.emit("join_error", check.reason);
      return;
    }

    joined = true;
    online.set(socket.id, { id: socket.id, name: trimmed });
    socket.emit("joined", { name: trimmed });
    io.emit("system", `${trimmed} đã vào phòng`);
    broadcastUsers();
  });

  socket.on("message", (payload) => {
    const user = online.get(socket.id);
    if (!user) return;

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

    emitMessage({
      name: user.name,
      type,
      text,
      url,
      fileName,
      sticker,
      meta,
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
