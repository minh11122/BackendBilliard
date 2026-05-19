const express = require("express");
const router = express.Router();
const tableController = require("../controller/billiardTable.controller");
const uploadCloud = require("../middleware/uploadCloud.middleware");
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

// Public: lấy danh sách loại bàn
router.get("/types", tableController.getTableTypes);

// Protected: tất cả route bàn yêu cầu đăng nhập + role OWNER/STAFF_CLUB
router.get("/", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), tableController.getBilliardTables);
router.post("/", authenticate, authorizeRole("OWNER"), uploadCloud.array("images", 5), tableController.createBilliardTable);

router.get("/:id", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), tableController.getBilliardTableById);
router.put("/:id", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), uploadCloud.array("images", 5), tableController.updateBilliardTable);
router.delete("/:id", authenticate, authorizeRole("OWNER"), tableController.deleteBilliardTable);

module.exports = router;