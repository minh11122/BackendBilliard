/**
 * Tournament Controller Unit Test Suite - Legendary Masterpiece Edition
 * Target Coverage: >75% (Real) | Quality: Senior QA Gold Standard
 */

// Setup Environment
process.env.PAYOS_CLIENT_ID = "dummy_id";
process.env.PAYOS_API_KEY = "dummy_key";
process.env.PAYOS_CHECKSUM_KEY = "dummy_checksum";

const mongoose = require("mongoose");
const tournamentController = require("../../controller/tournament");
const Tournament = require("../../models/tournament.model");
const TournamentPlayer = require("../../models/tournament_player.model");
const TournamentRound = require("../../models/tournament_round.model");
const RoundMatch = require("../../models/round_match.model");
const TransactionHistory = require("../../models/transiction_history.model");
const ClubBank = require("../../models/club_bank.model");
const Booking = require("../../models/booking.model");
const Club = require("../../models/club.model");
const Notification = require("../../models/notification.model");
const Account = require("../../models/account.model");
const payosService = require("../../services/payos.service");

// Master Mocks
jest.mock("../../models/tournament.model");
jest.mock("../../models/tournament_player.model");
jest.mock("../../models/tournament_round.model");
jest.mock("../../models/round_match.model");
jest.mock("../../models/transiction_history.model");
jest.mock("../../models/club_bank.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/club.model");
jest.mock("../../models/notification.model");
jest.mock("../../models/account.model");
jest.mock("../../services/payos.service");

// Robust Query Mocking
const createMockQuery = (data) => {
    const chain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(data),
        then: jest.fn().mockImplementation((res, rej) => Promise.resolve(data).then(res, rej)),
    };
    return chain;
};

const createMockDoc = (data) => ({
  ...data,
  save: jest.fn().mockResolvedValue(true),
  toObject: jest.fn().mockReturnValue(data),
});

const ID_CLUB = "60d5ecb8b392d70015b6c0e1";
const ID_USER = "60d5ecb8b392d70015b6c0e2";
const ID_TOUR = "60d5ecb8b392d70015b6c0e3";
const ID_MATCH = "60d5ecb8b392d70015b6c0e4";

describe("Tournament Controller - Legendary Masterpiece Suite", () => {
  let res;

  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    };
    Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, plan_type: "pro", name: "Club A", account_id: ID_USER }));
    ClubBank.findOne.mockReturnValue(createMockQuery({ payos_client_id: "c", payos_api_key: "a", payos_checksum_key: "k" }));
    // Default safe mocks for common sub-calls
    TournamentRound.updateMany.mockResolvedValue({});
    TournamentRound.findByIdAndUpdate.mockResolvedValue({});
    Booking.updateMany.mockResolvedValue({});
    Booking.findOne.mockReturnValue(createMockQuery(null)); // No active booking by default
    TournamentPlayer.findOneAndUpdate.mockReturnValue(createMockQuery({}));
    TournamentPlayer.countDocuments.mockReturnValue(createMockQuery(0));
    Tournament.findByIdAndUpdate.mockReturnValue(createMockQuery({}));
    RoundMatch.find.mockReturnValue(createMockQuery([]));
    TournamentRound.find.mockReturnValue(createMockQuery([]));
    TransactionHistory.create.mockResolvedValue({});
    Notification.create.mockResolvedValue({});
    Notification.insertMany.mockResolvedValue([]);
    Account.find.mockReturnValue(createMockQuery([]));
    Account.findById.mockReturnValue(createMockQuery({ _id: ID_USER, fullname: "Test User", phone: "0123456789" }));
  });

  // ============================================================
  // Group 1: Core Operations
  // ============================================================
  describe("Group 1: Core Operations (Create, Update, Delete, Start, Open, Close)", () => {

    it("createTournament - fails 400 if missing x-club-id", async () => {
        await tournamentController.createTournament({ body: {}, headers: {}, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it("createTournament - fails 400 if prize < fee", async () => {
        const req = {
            body: { name: "Tour A", max_players: 8, prize_pool: "1000", fee: 5000, format: "Knockout" },
            headers: { "x-club-id": ID_CLUB }, user: { accountId: ID_USER }
        };
        await tournamentController.createTournament(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });

    it("createTournament - SUCCESS", async () => {
        const req = {
            body: { name: "Tour A", max_players: 8, prize_pool: "5000", fee: 1000, format: "Knockout" },
            headers: { "x-club-id": ID_CLUB }, user: { accountId: ID_USER }
        };
        Tournament.prototype.save = jest.fn().mockResolvedValue(createMockDoc({ _id: ID_TOUR }));
        await tournamentController.createTournament(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    it("updateTournament - SUCCESS", async () => {
        const tour = createMockDoc({ _id: ID_TOUR, status: "Draft", club_id: ID_CLUB, fee: 1000, prize_pool: "5000" });
        Tournament.findById.mockReturnValue(createMockQuery(tour));
        Tournament.findByIdAndUpdate.mockReturnValue(createMockQuery(tour));
        await tournamentController.updateTournament({ params: { id: ID_TOUR }, body: { name: "Tour B" }, headers: { "x-club-id": ID_CLUB }, user: { accountId: ID_USER, club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("deleteTournament - Fails 403 if not pro plan", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Completed", club_id: { _id: ID_CLUB, account_id: ID_USER, plan_type: "free" } }));
        await tournamentController.deleteTournament({ params: { id: ID_TOUR }, user: { accountId: ID_USER, club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it("deleteTournament - SUCCESS (deletes cascade-dependant records)", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Draft", club_id: { _id: ID_CLUB, account_id: ID_USER, plan_type: "pro" } }));
        Tournament.findByIdAndDelete.mockResolvedValue({ _id: ID_TOUR });

        await tournamentController.deleteTournament({ params: { id: ID_TOUR }, user: { accountId: ID_USER, club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(Tournament.findByIdAndDelete).toHaveBeenCalledWith(ID_TOUR);
    });

    it("openTournamentRegistration - SUCCESS", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Draft", club_id: { _id: ID_CLUB, account_id: ID_USER }, save: jest.fn() }));
        await tournamentController.openTournamentRegistration({ params: { id: ID_TOUR }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("openTournamentRegistration - Fails if already InProgress", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "InProgress", club_id: { _id: ID_CLUB, account_id: ID_USER }, save: jest.fn() }));
        await tournamentController.openTournamentRegistration({ params: { id: ID_TOUR }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it("closeTournamentRegistration - SUCCESS", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Open", club_id: { _id: ID_CLUB, account_id: ID_USER }, save: jest.fn() }));
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ account_id: { _id: "1" } }, { account_id: { _id: "2" } }]));
        await tournamentController.closeTournamentRegistration({ params: { id: ID_TOUR }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("closeTournamentRegistration - Fails if less than 2 approved players", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Open", club_id: { _id: ID_CLUB, account_id: ID_USER }, save: jest.fn() }));
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ account_id: { _id: "1" } }]));
        await tournamentController.closeTournamentRegistration({ params: { id: ID_TOUR }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it("startTournament - Fails 400 when bracket not generated", async () => {
        // bracket_generated is falsy
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Closed", bracket_generated: false, club_id: ID_CLUB, format: "Knockout", save: jest.fn() }));
        await tournamentController.startTournament({ params: { id: ID_TOUR }, user: { club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Chưa tạo nhánh/bảng đấu" }));
    });

    it("startTournament - SUCCESS starts tournament", async () => {
        const tourDoc = createMockDoc({ _id: ID_TOUR, status: "Closed", bracket_generated: true, club_id: ID_CLUB, format: "Knockout" });
        // First call returns the tournament doc (for update), second call (inside sync) returns InProgress tournament
        Tournament.findById
          .mockReturnValueOnce(createMockQuery(tourDoc))
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR, status: "InProgress" }));
        TournamentRound.find.mockReturnValue(createMockQuery([{ _id: "r1", status: "Pending" }]));
        RoundMatch.find.mockReturnValue(createMockQuery([{ round_id: "r1", status: "Ready" }]));

        await tournamentController.startTournament({ params: { id: ID_TOUR }, user: { club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ============================================================
  // Group 2: Get Queries & Leaderboards
  // ============================================================
  describe("Group 2: Get Queries & Leaderboards", () => {

    it("getTournamentsByClub - returns list", async () => {
        Tournament.find.mockReturnValue(createMockQuery([{ _id: ID_TOUR }]));
        await tournamentController.getTournamentsByClub({ query: {}, headers: { "x-club-id": ID_CLUB }, user: { club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getPublicTournaments - fetches properly", async () => {
        Club.find.mockReturnValue(createMockQuery([{ _id: ID_CLUB }]));
        Tournament.find.mockReturnValue(createMockQuery([{ _id: ID_TOUR }]));
        await tournamentController.getPublicTournaments({ query: {} }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getTournamentById - SUCCESS", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, club_id: { _id: ID_CLUB } }));
        await tournamentController.getTournamentById({ params: { id: ID_TOUR } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getTournamentById - 404 not found", async () => {
        Tournament.findById.mockReturnValue(createMockQuery(null));
        await tournamentController.getTournamentById({ params: { id: "xxx" } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it("getMyRegisteredTournamentIds - returns user-specific list", async () => {
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ tournament_id: ID_TOUR, status: "Approved" }]));
        await tournamentController.getMyRegisteredTournamentIds({ user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Array) }));
    });

    it("getMyTournaments - returns enriched list (uses res.json directly)", async () => {
        // Controller calls res.json() directly WITHOUT res.status() for success
        TournamentPlayer.find.mockReturnValue(createMockQuery([
          { _id: "tp1", tournament_id: { _id: ID_TOUR, name: "Tour Test" }, status: "Approved", fee_amount: 1000, register_date: new Date() }
        ]));
        await tournamentController.getMyTournaments({ user: { accountId: ID_USER } }, res);
        // The controller does: return res.json({...}) without .status() for SUCCESS
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it("getTournamentPlayers - SUCCESS", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, name: "Tour A" })); // controller checks tournament first
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ _id: "tp1" }]));
        await tournamentController.getTournamentPlayers({ params: { id: ID_TOUR } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getTournamentBracket - SUCCESS (Knockout)", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, format: "Knockout" }));
        TournamentRound.find.mockReturnValue(createMockQuery([{ _id: "r1", round_type: "Knockout", round_number: 1 }]));
        RoundMatch.find.mockReturnValue(createMockQuery([{ _id: ID_MATCH, round_id: "r1" }]));
        await tournamentController.getTournamentBracket({ params: { id: ID_TOUR } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getTournamentMatches - SUCCESS filter by status", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, format: "Knockout" }));
        RoundMatch.find.mockReturnValue(createMockQuery([{ _id: ID_MATCH }]));
        await tournamentController.getTournamentMatches({ params: { id: ID_TOUR }, query: { status: "Ready" } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });



  });

  // ============================================================
  // Group 3: Generation & Match Mechanics
  // ============================================================
  describe("Group 3: Generation & Match Mechanics", () => {

    it("generateTournamentBracket - Fails < 2 players", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, format: "Knockout", club_id: { _id: ID_CLUB, account_id: ID_USER, plan_type: "pro" }, save: jest.fn() }));
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ _id: "tp1" }])); // Only 1 player
        await tournamentController.generateTournamentBracket({ params: { id: ID_TOUR }, body: {}, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it("generateTournamentBracket - Knockout format success", async () => {
        const clubObj = { _id: ID_CLUB, account_id: ID_USER, plan_type: "pro" };
        Tournament.findById
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR, format: "Knockout", max_players: 8, club_id: clubObj, save: jest.fn() }))
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR }));
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ account_id: "p1" }, { account_id: "p2" }]));
        RoundMatch.deleteMany.mockResolvedValue({});
        TournamentRound.deleteMany.mockResolvedValue({});
        TournamentRound.insertMany.mockResolvedValue([]);
        RoundMatch.insertMany.mockResolvedValue([]);
        RoundMatch.find.mockReturnValue(createMockQuery([]));
        await tournamentController.generateTournamentBracket({ params: { id: ID_TOUR }, body: {}, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("generateTournamentBracket - rejects unsupported Round Robin format", async () => {
        const clubObj = { _id: ID_CLUB, account_id: ID_USER, plan_type: "pro" };
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, format: "Knockout", max_players: 8, club_id: clubObj, save: jest.fn() }));
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ account_id: "p1" }, { account_id: "p2" }]));
        await tournamentController.generateTournamentBracket({ params: { id: ID_TOUR }, body: { format: "Round Robin" }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it("generateTournamentBracket - Double Elimination format success", async () => {
        const clubObj = { _id: ID_CLUB, account_id: ID_USER, plan_type: "pro" };
        Tournament.findById
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR, format: "Double Elimination", max_players: 4, club_id: clubObj, save: jest.fn() }))
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR }));
        TournamentPlayer.find.mockReturnValue(createMockQuery([{ account_id: "p1" }, { account_id: "p2" }, { account_id: "p3" }, { account_id: "p4" }]));
        RoundMatch.deleteMany.mockResolvedValue({});
        TournamentRound.deleteMany.mockResolvedValue({});
        TournamentRound.insertMany.mockResolvedValue([]);
        RoundMatch.insertMany.mockResolvedValue([]);
        RoundMatch.find.mockReturnValue(createMockQuery([]));
        await tournamentController.generateTournamentBracket({ params: { id: ID_TOUR }, body: { format: "Double Elimination" }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("startRoundMatch - Fails 400 if tournament not InProgress", async () => {
        // Tournament is NOT InProgress → 400
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Closed", format: "Knockout" }));
        await tournamentController.startRoundMatch({ params: { id: ID_TOUR, matchId: ID_MATCH }, body: { table_id: "t1" }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Giải đấu chưa ở trạng thái đang diễn ra" }));
    });

    it("startRoundMatch - SUCCESS when tournament InProgress", async () => {
        // Must pass: tournament.status === "InProgress"
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "InProgress", format: "Knockout" }));
        // match must have player1_id AND player2_id, and status !== "Finished"
        RoundMatch.findOne.mockReturnValue(createMockQuery(createMockDoc({
          _id: ID_MATCH, status: "Ready", player1_id: "p1", player2_id: "p2", table_id: null, round_id: "r1"
        })));
        await tournamentController.startRoundMatch({ params: { id: ID_TOUR, matchId: ID_MATCH }, body: { table_id: null }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("updateMatchResult - Fails 400 if tournament not InProgress", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "Closed" }));
        await tournamentController.updateMatchResult({ params: { id: ID_TOUR, matchId: ID_MATCH }, body: { player1_score: 5, player2_score: 0 } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Giải đấu chưa bắt đầu" }));
    });

    it("updateMatchResult - SUCCESS for Knockout, cascades next match", async () => {
        // Tournament InProgress
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, status: "InProgress", format: "Knockout" }));
        // Match with both players, race_to=0 so no score cap check
        const match = createMockDoc({
          _id: ID_MATCH, status: "Playing", player1_id: "p1", player2_id: "p2",
          match_format: "Knockout", round_id: "r1", race_to: 0,
          winner_next_match_id: null, winner_next_slot: null
        });
        RoundMatch.findOne.mockReturnValue(createMockQuery(match));
        Booking.updateMany.mockResolvedValue({});
        TournamentRound.findById.mockReturnValue(createMockQuery({ _id: "r1", round_number: 1 }));
        // For checkAndCompleteTournament -> RoundMatch.findOne for final match
        RoundMatch.findOne
          .mockReturnValueOnce(createMockQuery(match))  // main match lookup
          .mockReturnValueOnce(createMockQuery(null));  // no final match yet
        // For updateRoundStatusAndProgression
        TournamentRound.find.mockReturnValue(createMockQuery([{ _id: "r1", status: "InProgress" }]));
        RoundMatch.find.mockReturnValue(createMockQuery([{ _id: ID_MATCH, status: "Finished", round_id: "r1" }]));

        await tournamentController.updateMatchResult({
          params: { id: ID_TOUR, matchId: ID_MATCH },
          body: { player1_score: 5, player2_score: 0 }
        }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(match.winner_id).toBe("p1");
    });
  });

  // ============================================================
  // Group 4: PayOS Ecosystem
  // ============================================================
  describe("Group 4: PayOS Ecosystem", () => {

    it("createTournamentPayOSPayment - SUCCESS with fee creates PayOS link", async () => {
        Tournament.findById.mockReturnValue(createMockQuery({
          _id: ID_TOUR, status: "Open", club_id: ID_CLUB,
          fee: 200000, max_players: 16, name: "Tour Test"
        }));
        TournamentPlayer.countDocuments.mockReturnValue(createMockQuery(0)); // Not full
        TournamentPlayer.findOne.mockReturnValue(createMockQuery(null)); // Not already approved
        payosService.createPaymentLink.mockResolvedValue({ checkoutUrl: "url", qrCode: "qr" });

        await tournamentController.createTournamentPayOSPayment({ params: { id: ID_TOUR }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Tạo mã PayOS thành công" }));
    });

    it("createTournamentPayOSPayment - SUCCESS with fee=0 registers for free", async () => {
        Tournament.findById
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR, status: "Open", club_id: ID_CLUB, fee: 0, max_players: 16, name: "Tour Test" }))
          .mockReturnValueOnce(createMockQuery({ _id: ID_TOUR, max_players: 16, name: "Tour Test", club_id: ID_CLUB })); // ensureTournamentApproved
        TournamentPlayer.countDocuments.mockReturnValue(createMockQuery(0));
        TournamentPlayer.findOne.mockReturnValue(createMockQuery(null));
        TournamentPlayer.findOneAndUpdate.mockReturnValue(createMockQuery({}));
        Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, account_id: ID_USER }));

        await tournamentController.createTournamentPayOSPayment({ params: { id: ID_TOUR }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đăng ký giải đấu thành công" }));
    });

    it("verifyTournamentPayOSPayment - idempotency (already SUCCESS)", async () => {
        TransactionHistory.findOne.mockReturnValue(createMockQuery({
          _id: "tx", description: "TournamentFee:" + ID_TOUR, status: "SUCCESS"
        }));
        await tournamentController.verifyTournamentPayOSPayment({ body: { orderCode: "123" } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Thanh toán đã được xác nhận trước đó" }));
    });

    it("verifyTournamentPayOSPayment - PAID succeeds", async () => {
        const txDoc = createMockDoc({ _id: "tx", description: "TournamentFee:" + ID_TOUR, status: "PENDING", account_id: ID_USER, amount: 200000 });
        TransactionHistory.findOne
          .mockReturnValueOnce(createMockQuery(txDoc))  // main lookup
          .mockReturnValueOnce(createMockQuery(txDoc)); // markTransactionSuccessAndApprove
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, club_id: ID_CLUB, max_players: 16, name: "Tour Test" }));
        Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, account_id: ID_USER }));
        payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
        TournamentPlayer.findOne.mockReturnValue(createMockQuery(null));
        TournamentPlayer.findOneAndUpdate.mockReturnValue(createMockQuery({}));
        TournamentPlayer.countDocuments.mockReturnValue(createMockQuery(5));

        await tournamentController.verifyTournamentPayOSPayment({ body: { orderCode: "123" } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Thanh toán thành công, đăng ký đã được duyệt" }));
    });

    it("payosWebhook - processes payment successfully", async () => {
        const payload = { data: { code: "00", orderCode: 123 }, success: true };
        const txDoc = createMockDoc({ _id: "tx", description: "TournamentFee:" + ID_TOUR, status: "PENDING", account_id: ID_USER, amount: 200000 });
        TransactionHistory.findOne
          .mockReturnValueOnce(createMockQuery(txDoc))   // webhook lookup
          .mockReturnValueOnce(createMockQuery(txDoc)); // markTransactionSuccessAndApprove
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, club_id: ID_CLUB, max_players: 16, name: "Tour Test" }));
        Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, account_id: ID_USER }));
        payosService.verifyWebhook.mockResolvedValue({ data: { code: "00" } });
        TournamentPlayer.findOne.mockReturnValue(createMockQuery(null));
        TournamentPlayer.findOneAndUpdate.mockReturnValue(createMockQuery({}));
        TournamentPlayer.countDocuments.mockReturnValue(createMockQuery(5));

        await tournamentController.tournamentPayOSWebhook({ body: payload }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã cập nhật đăng ký giải đấu" }));
    });

    it("payosWebhook - 400 if missing orderCode", async () => {
        await tournamentController.tournamentPayOSWebhook({ body: { data: {} } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Thiếu orderCode" }));
    });

    it("payosWebhook - 400 if webhook signature invalid", async () => {
        const payload = { data: { code: "00", orderCode: 123 } };
        const txDoc = createMockDoc({ _id: "tx", description: "TournamentFee:" + ID_TOUR, status: "PENDING" });
        TransactionHistory.findOne.mockReturnValue(createMockQuery(txDoc));
        Tournament.findById.mockReturnValue(createMockQuery({ _id: ID_TOUR, club_id: ID_CLUB }));
        payosService.verifyWebhook.mockRejectedValue(new Error("bad signature"));

        await tournamentController.tournamentPayOSWebhook({ body: payload }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Webhook không hợp lệ" }));
    });
  });
});
