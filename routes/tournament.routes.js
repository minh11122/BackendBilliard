const express = require("express");
const router = express.Router();
const {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  getMyRegisteredTournamentIds,
  getMyTournaments,
  getTournamentPlayers,
  openTournamentRegistration,
  closeTournamentRegistration,
  generateTournamentBracket,
  startTournament,
  getTournamentBracket,
  getTournamentMatches,
  startRoundMatch,
  updateMatchResult,
  updateTournament,
  deleteTournament,
  createTournamentPayOSPayment,
  verifyTournamentPayOSPayment,
  tournamentPayOSWebhook,
  cancelTournament
} = require("../controller/tournament");
const upload = require("../middleware/uploadCloud.middleware");
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

// GET /tournaments - management list for a club (x-club-id header or ?club_id=)
router.get("/", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), getTournamentsByClub);

// GET /tournaments/public - get public tournaments
router.get("/public", getPublicTournaments);
router.get("/my/registered-ids", authenticate, getMyRegisteredTournamentIds);
router.get("/my/tournaments", authenticate, getMyTournaments);

// Public bracket / match view
router.get("/:id/bracket", getTournamentBracket);
router.get("/:id/matches", getTournamentMatches);

// GET /tournaments/:id - get single tournament details
router.get("/:id", getTournamentById);
router.get("/:id/players", getTournamentPlayers);

// Registration control & bracket generation
router.post("/:id/open", authenticate, authorizeRole("OWNER"), openTournamentRegistration);
router.post("/:id/close", authenticate, authorizeRole("OWNER"), closeTournamentRegistration);
router.post("/:id/generate-bracket", authenticate, authorizeRole("OWNER"), generateTournamentBracket);
router.post("/:id/start", authenticate, authorizeRole("OWNER"), startTournament);
router.post("/:id/cancel", authenticate, authorizeRole("OWNER"), cancelTournament);

// Match operations
router.post("/:id/matches/:matchId/start", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), startRoundMatch);
router.post("/:id/matches/:matchId/result", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), updateMatchResult);

// Tournament registration via PayOS
router.post("/:id/payos/create-payment", authenticate, createTournamentPayOSPayment);
router.post("/payos/verify", authenticate, verifyTournamentPayOSPayment);
router.post("/payos/webhook", tournamentPayOSWebhook);

// POST /tournaments - create a new tournament
router.post("/", authenticate, authorizeRole("OWNER"), upload.single("banner"), createTournament);

// PUT /tournaments/:id - update a tournament
router.put("/:id", authenticate, authorizeRole("OWNER"), upload.single("banner"), updateTournament);

// DELETE /tournaments/:id - delete a tournament
router.delete("/:id", authenticate, authorizeRole("OWNER"), deleteTournament);

module.exports = router;
