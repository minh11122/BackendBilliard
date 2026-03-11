const express = require("express");
const router = express.Router();
const serviceController = require("../controller/service.controller");
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

// Tất cả route service yêu cầu đăng nhập + role OWNER
router.get("/", authenticate, authorizeRole("OWNER"), serviceController.getServices);
router.get("/:id", authenticate, authorizeRole("OWNER"), serviceController.getServiceById);
router.post("/", authenticate, authorizeRole("OWNER"), serviceController.createService);
router.put("/:id", authenticate, authorizeRole("OWNER"), serviceController.updateService);
router.patch("/:id/deactivate", authenticate, authorizeRole("OWNER"), serviceController.deactivateService);
router.patch("/:id/reactivate", authenticate, authorizeRole("OWNER"), serviceController.reactivateService);
router.delete("/:id", authenticate, authorizeRole("OWNER"), serviceController.deleteServicePermanently);

module.exports = router;