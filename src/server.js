require("dotenv").config();

const http = require("node:http");
const { Server } = require("socket.io");
const { loadConfig } = require("./config");
const { createStore } = require("./db");
const { createApp, createSessionMiddleware } = require("./app");
const { chatSchema, hashPassword, parseOrThrow } = require("./security");

const config = loadConfig();
const store = createStore({
  dbPath: config.dbPath,
  reportThreshold: config.reportThreshold,
  adminSeed: {
    ...config.adminSeed,
    passwordHash: hashPassword(config.adminSeed.password),
  },
});
const sessionMiddleware = createSessionMiddleware(config);
const app = createApp({ config, store, sessionMiddleware });
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.appOrigin,
    credentials: true,
  },
});

function wrap(middleware) {
  return (socket, next) => middleware(socket.request, {}, next);
}

io.use(wrap(sessionMiddleware));
io.use((socket, next) => {
  const userId = socket.request.session?.userId;
  const user = userId ? store.getUserById(userId) : null;
  if (!user || user.status !== "active") {
    return next(new Error("UNAUTHORIZED"));
  }
  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.user;
  socket.join("global");
  socket.join(`user:${user.id}`);

  socket.on("global:send", (payload) => {
    try {
      const parsed = parseOrThrow(chatSchema, payload, { content: "multiline" });
      const message = store.addGlobalMessage({
        userId: user.id,
        content: parsed.content,
      });
      io.to("global").emit("global:new", message);
    } catch (error) {
      socket.emit("chat:error", error.message);
    }
  });

  socket.on("direct:send", (payload) => {
    try {
      const recipientId = Number(payload?.recipientId);
      const recipient = store.getUserById(recipientId);
      if (!recipient || recipient.status !== "active") {
        throw new Error("대화 상대를 찾을 수 없습니다.");
      }
      const parsed = parseOrThrow(chatSchema, payload, { content: "multiline" });
      const message = store.addDirectMessage({
        senderId: user.id,
        recipientId,
        content: parsed.content,
      });
      io.to(`user:${user.id}`).to(`user:${recipientId}`).emit("direct:new", message);
    } catch (error) {
      socket.emit("chat:error", error.message);
    }
  });
});

server.listen(config.port, () => {
  console.log(`Tiny market server listening on ${config.appOrigin}`);
});
