const serviceController = require("../../controller/service.controller");
const Service = require("../../models/service.model");
const cloudinary = require("../../configs/cloudinary.config");

jest.mock("../../models/service.model");
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
const serviceId = "64a7c938b8156e300d6b5102";

describe("Service Controller - Unit Tests", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, "error").mockImplementation(() => {});
    });
    
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("getServices", () => {
        it("should return list of services for a club", async () => {
            const req = { query: {}, user: { club_id: clubId } };
            const res = createRes();

            const mockFindQuery = {
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue([{ _id: serviceId, name: "Pepsi" }])
            };

            Service.find.mockReturnValue(mockFindQuery);
            Service.countDocuments.mockResolvedValue(1);
            Service.aggregate.mockResolvedValue([{ _id: "Active", count: 1 }]);

            await serviceController.getServices(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json.mock.calls[0][0].data.length).toBe(1);
            expect(res.json.mock.calls[0][0].statusCounts.total).toBe(1);
        });

        it("should return 400 if club_id missing", async () => {
            const req = { query: {}, user: {} };
            const res = createRes();
            await serviceController.getServices(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe("createService", () => {
        it("should create a service successfully", async () => {
            const req = {
                body: { name: "Cocacola", price: "15000", description: "Soft drink" },
                files: [{ path: "http://cloud.com/coke.jpg" }],
                user: { id: "u1", club_id: clubId }
            };
            const res = createRes();

            Service.findOne.mockResolvedValue(null);
            Service.prototype.save = jest.fn().mockResolvedValue({ _id: serviceId, name: "Cocacola" });

            await serviceController.createService(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(Service.prototype.save).toHaveBeenCalled();
        });

        it("should return 400 for invalid price", async () => {
            const req = { body: { name: "Coke", price: "-10" }, user: { club_id: clubId } };
            const res = createRes();
            await serviceController.createService(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].message).toContain("lớn hơn 0");
        });

        it("should return 400 for non-numeric price", async () => {
            const req = { body: { name: "Coke", price: "abc" }, user: { club_id: clubId } };
            const res = createRes();
            await serviceController.createService(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
        
        it("should return 409 if name already exists", async () => {
            const req = {
                body: { name: "Cocacola", price: "15000", description: "Soft drink" },
                user: { club_id: clubId }
            };
            const res = createRes();

            Service.findOne.mockResolvedValue({ _id: serviceId, name: "Cocacola" });

            await serviceController.createService(req, res);
            expect(res.status).toHaveBeenCalledWith(409);
        });
    });

    describe("updateService", () => {
        it("should update service and delete old images via cloudinary", async () => {
            const req = {
                params: { id: serviceId },
                body: { name: "New Coke", price: "16000", removedImages: ["http://cloud.com/old.jpg"] },
                files: [{ path: "http://cloud.com/new.jpg" }],
                user: { club_id: clubId }
            };
            const res = createRes();

            Service.findOne.mockResolvedValue(null);
            Service.findById.mockResolvedValue({ club_id: clubId, images: ["http://cloud.com/old.jpg", "http://cloud.com/keep.jpg"] });
            Service.findByIdAndUpdate.mockResolvedValue({ _id: serviceId, name: "New Coke" });

            await serviceController.updateService(req, res);

            expect(cloudinary.uploader.destroy).toHaveBeenCalled();
            expect(Service.findByIdAndUpdate).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe("delete/deactivate", () => {
        it("should deactivate service", async () => {
            const req = { params: { id: serviceId }, user: { club_id: clubId } };
            const res = createRes();
            Service.findById.mockResolvedValue({ club_id: clubId });
            Service.findByIdAndUpdate.mockResolvedValue({ _id: serviceId, status: "Inactive" });
            await serviceController.deactivateService(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });
        
        it("should reactivate service", async () => {
            const req = { params: { id: serviceId }, user: { club_id: clubId } };
            const res = createRes();
            Service.findById.mockResolvedValue({ club_id: clubId });
            Service.findByIdAndUpdate.mockResolvedValue({ _id: serviceId, status: "Active" });
            await serviceController.reactivateService(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("should delete service permanently and cleanup images", async () => {
            const req = { params: { id: serviceId }, user: { club_id: clubId } };
            const res = createRes();
            Service.findById.mockResolvedValue({ club_id: clubId, images: ["http://res.cloudinary.com/demo/image/upload/v1/folder/service1.jpg"] });
            Service.findByIdAndDelete.mockResolvedValue(true);
            
            await serviceController.deleteServicePermanently(req, res);
            
            expect(cloudinary.uploader.destroy).toHaveBeenCalledWith("folder/service1");
            expect(Service.findByIdAndDelete).toHaveBeenCalledWith(serviceId);
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
