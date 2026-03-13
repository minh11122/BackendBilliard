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
  getInforById,
  updateProfile
} = require("../controller/auth/auth.controller");
const authenticate = require("../middleware/authenticate.middleware");
const authorize = require("../middleware/authorize.middleware");

router.post("/auth/register", register);
router.post("/auth/verify-otp", verifyOtp);
router.post("/auth/register/google", registerGoogle);
router.post("/auth/forgot-password", forgotPassword);
router.post("/auth/resend-otp", resendOtp);
router.post("/auth/login", login);
router.post("/auth/login/google", loginGoogle);
router.post("/auth/get-role-name-by-id", getRoleNameById);

router.get("/getprofile", authenticate, authorize("CUSTOMER"),getInforById);
router.post("/updateprofile", authenticate, authorize("CUSTOMER"),updateProfile)


module.exports = router;
