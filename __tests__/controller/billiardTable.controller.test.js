const tableService = require("../../services/billiardTable.service");
const billiardTableController = require("../../controller/billiardTable.controller");

jest.mock("../../services/billiardTable.service");
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

describe("Billiard Table Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getBilliardTables", () => {
    it("should return tables with status counts and pagination", async () => {
      const req = { query: { club_id: "c1", page: "1", limit: "5" } };
      const res = createRes();

      tableService.getTables.mockResolvedValue({
        tables: [{ _id: "t1", table_number: "01" }],
        total: 1,
        totalPages: 1,
        currentPage: 1
      });
      tableService.getTableStatusCounts.mockResolvedValue({ total: 1, available: 1 });

      await billiardTableController.getBilliardTables(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.length).toBe(1);
    });

    it("should return 400 if club_id is missing", async () => {
      const req = { query: {}, user: {} };
      const res = createRes();
      await billiardTableController.getBilliardTables(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("createBilliardTable", () => {
    it("should create a table successfully with images", async () => {
      const req = {
        body: { club_id: "c1", table_type_id: "tt1", table_number: "01", price: "50000" },
        files: [{ path: "http://cloud.com/img1.jpg" }]
      };
      const res = createRes();

      tableService.createTable.mockResolvedValue({ _id: "t1", table_number: "01" });

      await billiardTableController.createBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(tableService.createTable).toHaveBeenCalledWith(expect.objectContaining({
        table_number: "01",
        images: ["http://cloud.com/img1.jpg"]
      }));
    });

    it("should return 409 if table number already exists", async () => {
        const req = {
          body: { club_id: "c1", table_type_id: "tt1", table_number: "DUP", price: "50000" }
        };
        const res = createRes();
  
        const error = new Error("Already exists");
        error.code = 11000;
        tableService.createTable.mockRejectedValue(error);
  
        await billiardTableController.createBilliardTable(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
      });
  });

  describe("updateBilliardTable", () => {
    it("should update table and handle removed images from cloudinary", async () => {
      const req = {
        params: { id: "t1" },
        body: { club_id: "c1", table_type_id: "tt1", table_number: "New", price: "60000", removedImages: ["http://cloud.com/old.jpg"] },
        files: [{ path: "http://cloud.com/new.jpg" }]
      };
      const res = createRes();

      tableService.getTableById.mockResolvedValue({ images: ["http://cloud.com/old.jpg", "http://cloud.com/keep.jpg"] });
      tableService.updateTable.mockResolvedValue({ _id: "t1", table_number: "New" });

      await billiardTableController.updateBilliardTable(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(tableService.updateTable).toHaveBeenCalledWith("t1", expect.objectContaining({
          images: expect.arrayContaining(["http://cloud.com/keep.jpg", "http://cloud.com/new.jpg"])
      }));
    });
  });

  describe("deleteBilliardTable", () => {
    it("should delete table and clean up images", async () => {
        const req = { params: { id: "t1" } };
        const res = createRes();
  
        tableService.getTableById.mockResolvedValue({ images: ["img1.jpg"] });
        tableService.deleteTable.mockResolvedValue(true);
  
        await billiardTableController.deleteBilliardTable(req, res);
  
        expect(tableService.deleteTable).toHaveBeenCalledWith("t1");
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 400 if table is in use", async () => {
        const req = { params: { id: "t1" } };
        const res = createRes();
  
        tableService.deleteTable.mockRejectedValue(new Error("Cannot delete table in use"));
  
        await billiardTableController.deleteBilliardTable(req, res);
  
        expect(res.status).toHaveBeenCalledWith(400);
      });
  });
});
