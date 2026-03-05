const express = require("express");
const router = express.Router();
const clubController = require("../controller/club.controller");

router.get("/", clubController.getAllClubs);
router.get("/:id", clubController.getClubById);

module.exports = router;
