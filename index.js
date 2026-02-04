const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./configs/db.connect");
const routes = require("./routes/index");


const app = express();
app.use(express.json());
app.use(cors());
app.use("/api", routes);

connectDB();


const PORT = process.env.PORT;
const HOST = process.env.HOSTNAME;
app.listen(PORT, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});