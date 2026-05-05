const locationController = require("../../controller/location.controller");
const Province = require("../../models/province.model");
const District = require("../../models/district.model");

jest.mock("../../models/province.model");
jest.mock("../../models/district.model");

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Location Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getProvinces", () => {
    it("should return sorted provinces", async () => {
      const req = {};
      const res = createRes();

      Province.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ name: "A" }, { name: "B" }]) });

      await locationController.getProvinces(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.any(Array));
    });

    it("should handle error in getProvinces", async () => {
      const req = {};
      const res = createRes();

      Province.find.mockReturnValue({ sort: jest.fn().mockRejectedValue(new Error("Database failure")) });

      await locationController.getProvinces(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Database failure" }));
    });
  });

  describe("getDistrictsByProvince", () => {
    it("should return districts for a province excluding 'xa'", async () => {
      const req = { params: { provinceCode: "1" } };
      const res = createRes();

      District.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ name: "District 1" }]) });

      await locationController.getDistrictsByProvince(req, res);

      expect(District.find).toHaveBeenCalledWith(expect.objectContaining({
        province_code: "1",
        type: { $ne: "xa" }
      }));
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
