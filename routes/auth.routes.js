const express = require("express");
const router = express.Router();
const {
  register,
  registerGoogle,
  forgotPassword,
  login,
  loginGoogle,
} = require("../controller/auth/auth.controller");

router.post("/auth/register", register);
// router.post('/auth/verify-otp', verifyOtp);
router.post("/auth/register/google", registerGoogle);
router.post("/auth/forgot-password", forgotPassword);
// router.post('/auth/resend-otp', resendOtp);
router.post("/auth/login", login);
router.post("/auth/login/google", loginGoogle);

module.exports = router;
