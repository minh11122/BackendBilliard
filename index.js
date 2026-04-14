const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./configs/db.connect");
const routes = require("./routes/index");


const app = express();
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
    app.listen(PORT, () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
    });
};

startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
