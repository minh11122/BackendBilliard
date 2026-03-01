const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadCloud.middleware");
const serviceController = require("../controller/service.controller");

router.post(
  "/create",
  upload.single("image"),
  serviceController.createService
);

module.exports = router;