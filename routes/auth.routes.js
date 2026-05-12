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
  updateProfile,
  updatePassword,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  countUnread,
  checkProfileStatus
} = require("../controller/auth");
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
router.post("/updateprofile", authenticate, authorize("CUSTOMER"),updateProfile);
router.post("/updatepassword", authenticate, authorize("CUSTOMER"),updatePassword);

router.get("/notifications", authenticate, authorize("CUSTOMER", "OWNER"), getNotifications);
router.get("/notifications/unread/count", authenticate, authorize("CUSTOMER", "OWNER"), countUnread);
router.patch("/notifications/:id/read", authenticate, authorize("CUSTOMER", "OWNER"), markAsRead);
router.patch("/notifications/read-all", authenticate, authorize("CUSTOMER", "OWNER"), markAllAsRead);
router.delete("/notifications/:id", authenticate, authorize("CUSTOMER", "OWNER"), deleteNotification);
router.delete("/notifications", authenticate, authorize("CUSTOMER", "OWNER"), deleteAllNotifications);

router.get("/profile/check",authenticate,authorize("CUSTOMER"),checkProfileStatus);


module.exports = router;
