const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const connectDB = require("./configs/db.connect");
const routes = require("./routes/index");
require("./cron/bookingCron");


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Gán io vào global để các nơi khác trong app có thể emit event
global.io = io;

io.on("connection", (socket) => {
  socket.on("join", (accountId) => {
    if (accountId) {
      socket.join(accountId.toString());
    }
  });
});

app.use(express.json());
app.use(cors());
app.use("/api", routes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error("Unhandled Error:", err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Lỗi server nội bộ",
        error: process.env.NODE_ENV === "development" ? err : {}
    });
});

const PORT = process.env.PORT;
const HOST = process.env.HOSTNAME;

const startServer = async () => {
    await connectDB();
    server.listen(PORT, () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
    });
};

startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
