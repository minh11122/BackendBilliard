const clubBankController = require("../../controller/clubBank.controller");
const ClubBank = require("../../models/club_bank.model");
const Club = require("../../models/club.model");

jest.mock("../../models/club_bank.model");
jest.mock("../../models/club.model");

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Club Bank Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getBankByClub", () => {
    const validClubId = "65d1a1111111111111111111";
    const ownerId = "u1";

    it("should return full secrets for club owner", async () => {
      const req = { params: { id: validClubId }, user: { accountId: ownerId } };
      const res = createRes();

      ClubBank.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
        club_id: validClubId,
        payos_api_key: "REAL_SECRET_123",
        payos_checksum_key: "REAL_CHECKSUM_456"
      })});
      Club.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: validClubId }) }) });

      await clubBankController.getBankByClub(req, res);

      expect(res.json.mock.calls[0][0].data.payos_api_key).toBe("REAL_SECRET_123");
      expect(res.json.mock.calls[0][0].data.can_view_payos_secrets).toBe(true);
    });

    it("should return masked secrets for non-owners", async () => {
      const req = { params: { id: validClubId }, user: { accountId: "other_user" } };
      const res = createRes();

      ClubBank.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
        club_id: validClubId,
        payos_api_key: "REAL_SECRET_123"
      })});
      Club.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });

      await clubBankController.getBankByClub(req, res);

      expect(res.json.mock.calls[0][0].data.payos_api_key).toContain("***");
      expect(res.json.mock.calls[0][0].data.can_view_payos_secrets).toBe(false);
    });
  });

  describe("upsertBankByClub", () => {
    const validClubId = "65d1a1111111111111111111";
    const ownerId = "u1";

    it("should update bank info successfully for owner", async () => {
      const req = {
        params: { id: validClubId },
        user: { accountId: ownerId },
        body: { payos_client_id: "id1", payos_api_key: "key1", payos_checksum_key: "check1" }
      };
      const res = createRes();

      Club.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: validClubId }) });
      const mockBank = { save: jest.fn().mockResolvedValue(true) };
      ClubBank.findOne.mockResolvedValue(mockBank);

      await clubBankController.upsertBankByClub(req, res);

      expect(mockBank.payos_client_id).toBe("id1");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 403 if not the owner", async () => {
      const req = { 
        params: { id: validClubId }, 
        user: { accountId: "u2" }, 
        body: { payos_client_id: "id1", payos_api_key: "key1", payos_checksum_key: "check1" } 
      };
      const res = createRes();
      Club.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      await clubBankController.upsertBankByClub(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
