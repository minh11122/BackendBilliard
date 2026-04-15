const serviceController = require("../../controller/service.controller");
const serviceService = require("../../services/service.service");
const cloudinary = require("../../configs/cloudinary.config");

jest.mock("../../services/service.service");
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

describe("Service Controller - Unit Tests", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("getServices", () => {
        it("should return list of services for a club", async () => {
            const req = { query: { club_id: "c1" }, user: { club_id: "c1" } };
            const res = createRes();

            serviceService.getServices.mockResolvedValue({
                services: [{ _id: "s1", name: "Pepsi" }],
                total: 1,
                totalPages: 1,
                currentPage: 1
            });
            serviceService.getServiceStatusCounts.mockResolvedValue({ total: 1, active: 1 });

            await serviceController.getServices(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json.mock.calls[0][0].data.length).toBe(1);
        });

        it("should return 400 if club_id missing", async () => {
            const req = { query: {} };
            const res = createRes();
            await serviceController.getServices(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe("createService", () => {
        it("should create a service successfully", async () => {
            const req = {
                body: { club_id: "c1", name: "Cocacola", price: "15000", description: "Soft drink" },
                files: [{ path: "http://cloud.com/coke.jpg" }],
                user: { id: "u1" }
            };
            const res = createRes();

            serviceService.createService.mockResolvedValue({ _id: "s1", name: "Cocacola" });

            await serviceController.createService(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(serviceService.createService).toHaveBeenCalledWith(expect.objectContaining({
                name: "Cocacola",
                price: 15000,
                images: ["http://cloud.com/coke.jpg"]
            }));
        });

        it("should return 400 for invalid price", async () => {
            const req = { body: { club_id: "c1", name: "Coke", price: "-10" } };
            const res = createRes();
            await serviceController.createService(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].message).toContain("lớn hơn 0");
        });

        it("should return 400 for non-numeric price", async () => {
            const req = { body: { club_id: "c1", name: "Coke", price: "abc" } };
            const res = createRes();
            await serviceController.createService(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe("updateService", () => {
        it("should update service and delete old images via cloudinary", async () => {
            const req = {
                params: { id: "s1" },
                body: { club_id: "c1", name: "New Coke", price: "16000", removedImages: ["http://cloud.com/old.jpg"] },
                files: [{ path: "http://cloud.com/new.jpg" }]
            };
            const res = createRes();

            serviceService.getServiceById.mockResolvedValue({ images: ["http://cloud.com/old.jpg", "http://cloud.com/keep.jpg"] });
            serviceService.updateService.mockResolvedValue({ _id: "s1", name: "New Coke" });

            await serviceController.updateService(req, res);

            expect(cloudinary.uploader.destroy).toHaveBeenCalled();
            expect(serviceService.updateService).toHaveBeenCalledWith("s1", expect.objectContaining({
                images: expect.arrayContaining(["http://cloud.com/keep.jpg", "http://cloud.com/new.jpg"])
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe("delete/deactivate", () => {
        it("should deactivate service", async () => {
            const req = { params: { id: "s1" } };
            const res = createRes();
            serviceService.deactivateService.mockResolvedValue({ _id: "s1", status: "Inactive" });
            await serviceController.deactivateService(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it("should delete service permanently and cleanup images", async () => {
            const req = { params: { id: "s1" } };
            const res = createRes();
            serviceService.getServiceById.mockResolvedValue({ images: ["http://res.cloudinary.com/demo/image/upload/v1/folder/service1.jpg"] });
            
            await serviceController.deleteServicePermanently(req, res);
            
            expect(cloudinary.uploader.destroy).toHaveBeenCalledWith("folder/service1");
            expect(serviceService.deleteServicePermanently).toHaveBeenCalledWith("s1");
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
