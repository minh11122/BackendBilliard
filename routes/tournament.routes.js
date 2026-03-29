const express = require("express");
const router = express.Router();
const {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  getMyRegisteredTournamentIds,
  getTournamentPlayers,
  openTournamentRegistration,
  closeTournamentRegistration,
  generateTournamentBracket,
  startTournament,
  getTournamentBracket,
  getTournamentMatches,
  startRoundMatch,
  updateMatchResult,
  getRoundRobinLeaderboard,
  updateTournament,
  deleteTournament,
  createTournamentPayOSPayment,
  verifyTournamentPayOSPayment,
  tournamentPayOSWebhook
} = require("../controller/tournament.controller");
const upload = require("../middleware/uploadCloud.middleware");
const authenticate = require("../middleware/authenticate.middleware");

// GET /tournaments - list all tournaments for a club (x-club-id header or ?club_id=)
router.get("/", authenticate, getTournamentsByClub);

// GET /tournaments/public - get public tournaments
router.get("/public", getPublicTournaments);
router.get("/my/registered-ids", authenticate, getMyRegisteredTournamentIds);

// Public bracket / match view
router.get("/:id/bracket", getTournamentBracket);
router.get("/:id/matches", getTournamentMatches);
router.get("/:id/leaderboard", getRoundRobinLeaderboard);

// GET /tournaments/:id - get single tournament details
router.get("/:id", getTournamentById);
router.get("/:id/players", getTournamentPlayers);

// Registration control & bracket generation
router.post("/:id/open", authenticate, openTournamentRegistration);
router.post("/:id/close", authenticate, closeTournamentRegistration);
router.post("/:id/generate-bracket", authenticate, generateTournamentBracket);
router.post("/:id/start", authenticate, startTournament);

// Match operations
router.post("/:id/matches/:matchId/start", authenticate, startRoundMatch);
router.post("/:id/matches/:matchId/result", authenticate, updateMatchResult);

// Tournament registration via PayOS
router.post("/:id/payos/create-payment", authenticate, createTournamentPayOSPayment);
router.post("/payos/verify", authenticate, verifyTournamentPayOSPayment);
router.post("/payos/webhook", tournamentPayOSWebhook);

// POST /tournaments - create a new tournament
router.post("/", authenticate, upload.single("banner"), createTournament);

// PUT /tournaments/:id - update a tournament
router.put("/:id", authenticate, upload.single("banner"), updateTournament);

// DELETE /tournaments/:id - delete a tournament
router.delete("/:id", authenticate, deleteTournament);

module.exports = router;
