// middleware/optionalAuthenticate.middleware.js
const jwt = require("jsonwebtoken");

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // Không có token thì bỏ qua, cho next()
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // có user -> backend xác định được accountId
  } catch (error) {
    console.warn("⚠️ Token không hợp lệ, bỏ qua:", error.message);
  }

  next();
};

module.exports = optionalAuthenticate;
