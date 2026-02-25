const express = require("express");
const router = express.Router();
const {
  register,
  verifyOtp,
  forgotPassword,
  login,
  resendOtp,
  getRoleNameById,
  googleAuth,
  registerGoogle,
  loginGoogle,
} = require("../controller/auth/auth.controller");

router.post("/auth/register", register);
router.post("/auth/verify-otp", verifyOtp);
router.post("/auth/register/google", registerGoogle);
router.post("/auth/forgot-password", forgotPassword);
router.post("/auth/resend-otp", resendOtp);
router.post("/auth/login", login);
router.post("/auth/login/google", loginGoogle);
router.post("/auth/get-role-name-by-id", getRoleNameById);

module.exports = router;
