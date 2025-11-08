const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // change to your frontend URL in production
    methods: ["GET", "POST"]
  }
});

let waitingUser = null;
const activePairs = new Map(); // socket.id -> partnerId
const userData = new Map(); // socket.id -> { name, status }

io.on("connection", (socket) => {
  console.log(`🟢 User connected: ${socket.id}`);
  io.emit("user-count", io.engine.clientsCount); 

  socket.on("register", (name) => {
    userData.set(socket.id, { name, status: "online" });
    io.emit("user-count", io.engine.clientsCount); // send count to all users
    io.to(socket.id).emit("status", `Registered as ${name}`);
  });

  socket.on("find-partner", () => {
    const user = userData.get(socket.id);
    if (!user) return io.to(socket.id).emit("status", "Please register first.");

    user.status = "waiting";
    console.log(`🔍 ${user.name} (${socket.id}) is looking for a partner...`);

    // Pair logic
    if (waitingUser && waitingUser !== socket.id) {
      const partnerId = waitingUser;
      waitingUser = null;

      const partner = userData.get(partnerId);
      if (!partner) return;

      user.status = "in_call";
      partner.status = "in_call";

      activePairs.set(socket.id, partnerId);
      activePairs.set(partnerId, socket.id);

      // Decide who creates the offer
      const initiator = Math.random() < 0.5 ? socket.id : partnerId;

      io.to(socket.id).emit("partner-found", {
        partnerId,
        partnerName: partner.name,
        initiator: socket.id === initiator
      });

      io.to(partnerId).emit("partner-found", {
        partnerId: socket.id,
        partnerName: user.name,
        initiator: partnerId === initiator
      });

      console.log(`🤝 ${user.name} paired with ${partner.name}`);
    } else {
      waitingUser = socket.id;
      io.to(socket.id).emit("waiting", "⏳ Waiting for a partner...");
      console.log(`${user.name} is waiting...`);
    }
  });

  // WebRTC signaling
  socket.on("signal", (data) => {
    const { to, ...payload } = data;
    if (!to) return;

    if (io.sockets.sockets.get(to)) {
      io.to(to).emit("signal", { from: socket.id, ...payload });
    }
  });

  // End call
  socket.on("end-call", ({ partnerId }) => {
    const user = userData.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("call-ended");
      console.log(`📞 Call ended by ${user?.name || socket.id}`);

      const partner = userData.get(partnerId);
      if (partner) partner.status = "online";
      if (user) user.status = "online";

      activePairs.delete(socket.id);
      activePairs.delete(partnerId);
    }
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    const user = userData.get(socket.id);
    console.log(`🔴 ${user?.name || "Unknown"} disconnected`);

    if (waitingUser === socket.id) waitingUser = null;

    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partner-left");
      const partner = userData.get(partnerId);
      if (partner) partner.status = "online";

      activePairs.delete(socket.id);
      activePairs.delete(partnerId);
      io.emit("user-count", io.engine.clientsCount); 
    }

    userData.delete(socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

