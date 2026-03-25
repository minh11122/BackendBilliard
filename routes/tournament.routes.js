const express = require("express");
const router = express.Router();
const {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  getMyRegisteredTournamentIds,
  getTournamentPlayers,
  updateTournament,
  deleteTournament,
  createTournamentPayOSPayment,
  verifyTournamentPayOSPayment,
  tournamentPayOSWebhook
} = require("../controller/tournament.controller");
const upload = require("../middleware/uploadCloud.middleware");
const authenticate = require("../middleware/authenticate.middleware");

// GET /tournaments — list all tournaments for a club (x-club-id header or ?club_id=)
router.get("/", getTournamentsByClub);

// GET /tournaments/public — get public tournaments
router.get("/public", getPublicTournaments);
router.get("/my/registered-ids", authenticate, getMyRegisteredTournamentIds);

// GET /tournaments/:id — get single tournament details
router.get("/:id", getTournamentById);
router.get("/:id/players", getTournamentPlayers);

// Tournament registration via PayOS
router.post("/:id/payos/create-payment", authenticate, createTournamentPayOSPayment);
router.post("/payos/verify", authenticate, verifyTournamentPayOSPayment);
router.post("/payos/webhook", tournamentPayOSWebhook);

// POST /tournaments — create a new tournament
router.post("/", upload.single("banner"), createTournament);

// PUT /tournaments/:id — update a tournament
router.put("/:id", upload.single("banner"), updateTournament);

// DELETE /tournaments/:id — delete a tournament
router.delete("/:id", deleteTournament);

module.exports = router;
