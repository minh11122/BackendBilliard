const express = require("express");
const router = express.Router();
const tableController = require("../controller/billiardTable.controller");
const uploadCloud = require("../middleware/uploadCloud.middleware");

router.get("/types", tableController.getTableTypes);
router.post("/types", tableController.createTableType);

router.get("/", tableController.getBilliardTables);
router.post("/", uploadCloud.single("image"), tableController.createBilliardTable);

router.get("/:id", tableController.getBilliardTableById);
router.put("/:id", uploadCloud.single("image"), tableController.updateBilliardTable);
router.delete("/:id", tableController.deleteBilliardTable);
module.exports = router;