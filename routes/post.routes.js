const express = require("express");
const router = express.Router();
const postController = require("../controller/post.controller");
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

// ================= CUSTOMER =================

// Xem danh sách bài post đã duyệt
router.get("/", postController.getApprovedPosts);


// ================= OWNER =================

// Tạo bài post (owner)
router.post(
  "/",
  authenticate,
  authorizeRole("OWNER"),
  postController.createPost
);

// Xem bài post của mình
router.get(
  "/my",
  authenticate,
  authorizeRole("OWNER"),
  postController.getMyPosts
);

// Lấy danh sách bài chờ duyệt (STAFF_SYSTEM)
router.get(
  "/pending",
  authenticate,
  authorizeRole("STAFF_SYSTEM"),
  postController.getPendingPosts
);

// Chi tiết bài post đã duyệt (đặt sau /my và /pending để tránh đụng route động)
router.get("/:id", postController.getApprovedPostDetail);

// Cập nhật bài post
router.put(
  "/:id",
  authenticate,
  authorizeRole("OWNER"),
  postController.updatePost
);

// Xóa bài post
router.delete(
  "/:id",
  authenticate,
  authorizeRole("OWNER"),
  postController.deletePost
);


// ================= STAFF SYSTEM =================


// Duyệt / từ chối bài post (gộp)
router.put(
  "/:id/review",
  authenticate,
  authorizeRole("STAFF_SYSTEM"),
  postController.reviewPost
);

module.exports = router;