const mongoose = require("mongoose");
const billiardTableController = require("../../controller/club/billiardTable.controller");
const BilliardTable = require("../../models/billiard_table.model");
const Booking = require("../../models/booking.model");
const TableType = require("../../models/table_type.model");
const RoundMatch = require("../../models/round_match.model");
const cloudinary = require("../../configs/cloudinary.config");

jest.mock("../../models/billiard_table.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/table_type.model");
jest.mock("../../models/round_match.model");
jest.mock("../../controller/club/club.helpers", () => ({
  canAccessClub: jest.fn().mockResolvedValue(true),
  checkOwnerAccess: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../configs/cloudinary.config", () => ({
  uploader: {
    destroy: jest.fn().mockResolvedValue({ result: "ok" }),
  },
}));

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const clubId = "64a7c938b8156e300d6b5101";
const anotherClubId = "64a7c938b8156e300d6b5201";
const tableId = "64a7c938b8156e300d6b5102";
const tableTypeId = "64a7c938b8156e300d6b5103";
const invalidObjectId = "abc123";

describe("Billiard Table Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => { });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getBilliardTables", () => {
    it("should return 400 when missing club_id", async () => {
      const req = { query: {}, user: {} };
      const res = createRes();

      await billiardTableController.getBilliardTables(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return tables successfully", async () => {
      const req = {
        query: {
          page: "1",
          limit: "5",
          search: "VIP"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      const tableData = [
        {
          _id: tableId,
          table_number: "VIP-01",
          status: "Available",
          toObject: () => ({
            _id: tableId,
            table_number: "VIP-01",
            status: "Available"
          })
        }
      ];

      BilliardTable.find
        .mockReturnValueOnce({
          populate: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          sort: jest.fn().mockResolvedValue(tableData)
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([
            {
              _id: tableId,
              status: "Available"
            }
          ])
        });

      BilliardTable.countDocuments.mockResolvedValue(1);

      Booking.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      });

      await billiardTableController.getBilliardTables(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should convert status to In Use when booking Playing exists", async () => {
      const req = {
        query: {},
        user: { club_id: clubId }
      };

      const res = createRes();

      const tableData = [
        {
          _id: tableId,
          status: "Available",
          toObject: () => ({
            _id: tableId,
            status: "Available"
          })
        }
      ];

      BilliardTable.find
        .mockReturnValueOnce({
          populate: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          sort: jest.fn().mockResolvedValue(tableData)
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([
            {
              _id: tableId,
              status: "Available"
            }
          ])
        });

      BilliardTable.countDocuments.mockResolvedValue(1);

      Booking.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            table_id: tableId,
            status: "Playing"
          }
        ])
      });

      await billiardTableController.getBilliardTables(req, res);

      expect(res.json.mock.calls[0][0].data[0].status).toBe("In Use");
    });

    it("should return 500 when error occurs", async () => {
      const req = {
        query: {},
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.find.mockImplementation(() => {
        throw new Error("Database failed");
      });

      await billiardTableController.getBilliardTables(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("getBilliardTableById", () => {
    it("should return 400 when missing id", async () => {
      const req = { params: {} };
      const res = createRes();

      await billiardTableController.getBilliardTableById(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 when table not found", async () => {
      const req = {
        params: { id: tableId }
      };

      const res = createRes();

      BilliardTable.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null)
      });

      await billiardTableController.getBilliardTableById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return table successfully", async () => {
      const req = {
        params: { id: tableId }
      };

      const res = createRes();

      BilliardTable.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: tableId,
          table_number: "VIP-01"
        })
      });

      await billiardTableController.getBilliardTableById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("createBilliardTable", () => {
    it("should return 403 when missing club_id", async () => {
      const req = {
        body: {}
      };

      const res = createRes();

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should return 400 when missing required fields", async () => {
      const req = {
        body: {
          table_number: "VIP-01"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when table_number is empty after trim", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "     ",
          price: "50000"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 for invalid price", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "VIP-01",
          price: "-100"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 for invalid table_type_id", async () => {
      const req = {
        body: {
          table_type_id: invalidObjectId,
          table_number: "VIP-01",
          price: "50000"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when description exceeds limit", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "VIP-01",
          price: "50000",
          description: "a".repeat(501)
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 409 when duplicate table exists", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "VIP-01",
          price: "50000"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      TableType.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: tableTypeId })
      });

      BilliardTable.exists.mockResolvedValue(true);

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it("should return 400 when upload exceeds image limit", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "VIP-01",
          price: "50000"
        },
        files: [
          { path: "1.jpg" },
          { path: "2.jpg" },
          { path: "3.jpg" },
          { path: "4.jpg" },
          { path: "5.jpg" },
          { path: "6.jpg" }
        ],
        user: { club_id: clubId }
      };

      const res = createRes();

      TableType.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: tableTypeId })
      });

      BilliardTable.exists.mockResolvedValue(false);

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should create table successfully", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "VIP-01",
          price: "50000",
          description: "Bàn VIP gần cửa sổ"
        },
        files: [
          {
            path: "https://res.cloudinary.com/demo/image/upload/v1/billiards/table1.jpg"
          }
        ],
        user: { club_id: clubId }
      };

      const res = createRes();

      TableType.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: tableTypeId })
      });

      BilliardTable.exists.mockResolvedValue(false);

      BilliardTable.prototype.save = jest.fn().mockResolvedValue({
        _id: tableId
      });

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should set Maintenance status when isActive is false", async () => {
      const req = {
        body: {
          table_type_id: tableTypeId,
          table_number: "VIP-02",
          price: "50000",
          isActive: false
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      TableType.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: tableTypeId })
      });

      BilliardTable.exists.mockResolvedValue(false);

      BilliardTable.prototype.save = jest.fn().mockResolvedValue({
        _id: tableId
      });

      await billiardTableController.createBilliardTable(req, res);

      expect(BilliardTable.prototype.save).toHaveBeenCalled();
    });
  });

  describe("updateBilliardTable", () => {
    it("should return 400 for invalid id", async () => {
      const req = {
        params: { id: invalidObjectId },
        body: {},
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 when table not found", async () => {
      const req = {
        params: { id: tableId },
        body: {},
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue(null);

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 403 when editing another club table", async () => {
      const req = {
        params: { id: tableId },
        body: {},
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: anotherClubId
      });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should return 400 for invalid status", async () => {
      const req = {
        params: { id: tableId },
        body: {
          status: "INVALID_STATUS"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: []
      });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when update description too long", async () => {
      const req = {
        params: { id: tableId },
        body: {
          description: "a".repeat(501)
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: []
      });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when maintenance table has active booking", async () => {
      const req = {
        params: { id: tableId },
        body: {
          status: "Maintenance"
        },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: []
      });

      Booking.exists.mockResolvedValue(true);

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when updated images exceed limit", async () => {
      const req = {
        params: { id: tableId },
        body: {},
        files: [
          { path: "1.jpg" },
          { path: "2.jpg" },
          { path: "3.jpg" }
        ],
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: [
          "a.jpg",
          "b.jpg",
          "c.jpg"
        ]
      });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should update successfully", async () => {
      const req = {
        params: { id: tableId },
        body: {
          table_number: "VIP-02",
          price: "70000",
          removedImages: [
            "https://res.cloudinary.com/demo/image/upload/v1/billiards/old.jpg"
          ]
        },
        files: [
          {
            path: "https://res.cloudinary.com/demo/image/upload/v1/billiards/new.jpg"
          }
        ],
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        _id: tableId,
        club_id: clubId,
        status: "Available",
        images: [
          "https://res.cloudinary.com/demo/image/upload/v1/billiards/old.jpg"
        ]
      });

      BilliardTable.exists.mockResolvedValue(false);

      Booking.exists.mockResolvedValue(false);

      BilliardTable.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: tableId,
          table_number: "VIP-02"
        })
      });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle mongo duplicate error in update", async () => {
      const req = {
        params: { id: tableId },
        body: {},
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: []
      });

      BilliardTable.findByIdAndUpdate.mockImplementation(() => {
        throw { code: 11000 };
      });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe("deleteBilliardTable", () => {
    it("should return 400 for invalid id", async () => {
      const req = {
        params: { id: invalidObjectId },
        user: { club_id: clubId }
      };

      const res = createRes();

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 when table not found", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue(null);

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 403 when deleting another club table", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: anotherClubId
      });

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should return 400 when table is in use", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "In Use"
      });

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when active booking exists", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: []
      });

      Booking.exists.mockResolvedValue(true);
      RoundMatch.exists.mockResolvedValue(false);

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when active tournament match exists", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        club_id: clubId,
        status: "Available",
        images: []
      });

      Booking.exists.mockResolvedValue(false);
      RoundMatch.exists.mockResolvedValue(true);

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: "Không thể xóa bàn vì bàn đang được gán cho một trận đấu giải."
      }));
    });

    it("should delete successfully", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockResolvedValue({
        _id: tableId,
        club_id: clubId,
        status: "Available",
        images: [
          "https://res.cloudinary.com/demo/image/upload/v1/billiards/table1.jpg"
        ]
      });

      Booking.exists.mockResolvedValue(false);
      RoundMatch.exists.mockResolvedValue(false);

      BilliardTable.findByIdAndDelete.mockResolvedValue(true);

      await billiardTableController.deleteBilliardTable(req, res);

      expect(cloudinary.uploader.destroy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 500 when delete throws error", async () => {
      const req = {
        params: { id: tableId },
        user: { club_id: clubId }
      };

      const res = createRes();

      BilliardTable.findById.mockRejectedValue(new Error("DB ERROR"));

      await billiardTableController.deleteBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("getTableTypes", () => {
    it("should return table types successfully", async () => {
      const req = {};
      const res = createRes();

      TableType.find.mockResolvedValue([
        {
          _id: tableTypeId,
          name: "Pool"
        }
      ]);

      await billiardTableController.getTableTypes(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 500 when getTableTypes fails", async () => {
      const req = {};
      const res = createRes();

      TableType.find.mockRejectedValue(new Error("Database failed"));

      await billiardTableController.getTableTypes(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});