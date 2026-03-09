const express = require("express");
const router = express.Router();
const clubController = require("../controller/club.controller");

const authenticate = require("../middleware/authenticate.middleware");

router.get("/", clubController.getAllClubs);
router.get("/owner/clubs", authenticate, clubController.getClubsByAccount);
router.get("/:id", clubController.getClubById);

module.exports = router;
