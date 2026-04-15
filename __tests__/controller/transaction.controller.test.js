const transactionController = require("../../controller/transaction.controller");
const TransactionHistory = require("../../models/transiction_history.model");
const Club = require("../../models/club.model");
const mongoose = require("mongoose");

jest.mock("../../models/transiction_history.model");
jest.mock("../../models/club.model");

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Transaction Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getMyTransferHistory", () => {
    it("should return personal transaction history via aggregation", async () => {
      const validAccountId = "65d1a1111111111111111111";
      const req = { user: { accountId: validAccountId } };
      const res = createRes();

      TransactionHistory.aggregate.mockResolvedValue([{ _id: "t1", amount: 50000 }]);

      await transactionController.getMyTransferHistory(req, res);

      expect(TransactionHistory.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
        { $match: { account_id: new mongoose.Types.ObjectId(validAccountId) } }
      ]));
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getClubTransferHistory", () => {
    const validClubId = "65d1a1111111111111111111";
    const validOwnerId = "65d1a2222222222222222222";

    it("should allow owner to view their club's history", async () => {
      const req = {
        user: { accountId: validOwnerId, role: "OWNER" },
        query: { club_id: validClubId }
      };
      const res = createRes();

      Club.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: validClubId }) });
      TransactionHistory.aggregate.mockResolvedValue([{ _id: "tx1", amount: 100000 }]);

      await transactionController.getClubTransferHistory(req, res);

      expect(Club.findOne).toHaveBeenCalled();
      expect(TransactionHistory.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
        { $match: { "table.club_id": new mongoose.Types.ObjectId(validClubId) } }
      ]));
      expect(res.json.mock.calls[0][0].data.length).toBe(1);
    });

    it("should allow staff to view club's history without ownership check", async () => {
        const req = {
          user: { accountId: "staff1", role: "STAFF_CLUB", club_id: validClubId }
        };
        const res = createRes();
  
        TransactionHistory.aggregate.mockResolvedValue([{ _id: "tx2" }]);
  
        await transactionController.getClubTransferHistory(req, res);
  
        expect(Club.findOne).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });

    it("should return 403 if owner tries to access unauthorized club", async () => {
      const req = { user: { accountId: validOwnerId, role: "OWNER" }, query: { club_id: "other_club" } };
      const res = createRes();

      Club.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

      await transactionController.getClubTransferHistory(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
