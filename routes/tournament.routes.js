const express = require("express");
const router = express.Router();
const {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament
} = require("../controller/tournament.controller");
const upload = require("../middleware/uploadCloud.middleware");

// GET /tournaments — list all tournaments for a club (x-club-id header or ?club_id=)
router.get("/", getTournamentsByClub);

// GET /tournaments/public — get public tournaments
router.get("/public", getPublicTournaments);

// GET /tournaments/:id — get single tournament details
router.get("/:id", getTournamentById);

// POST /tournaments — create a new tournament
router.post("/", upload.single("banner"), createTournament);

// PUT /tournaments/:id — update a tournament
router.put("/:id", upload.single("banner"), updateTournament);

// DELETE /tournaments/:id — delete a tournament
router.delete("/:id", deleteTournament);

module.exports = router;
