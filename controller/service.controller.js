const serviceService = require("../services/service.service");
const cloudinary = require("../configs/cloudinary.config");
const Service = require("../models/service.model");
const Club = require("../models/club.model");

const canAccessClub = async (req, clubId) => {
    if (!clubId || !req.user) return false;
    if (req.user.role === "STAFF_CLUB") return String(req.user.club_id) === String(clubId);
    if (req.user.role === "OWNER") {
        const ownedClub = await Club.findOne({ _id: clubId, account_id: req.user.accountId }).select("_id").lean();
        return !!ownedClub;
    }
    return false;
};

const getServices = async (req, res) => {
    try {
        const club_id = req.query.club_id || req.user?.club_id || req.body?.club_id;
        const { page = 1, limit = 10, search, status = "Active" } = req.query;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Khong xac dinh duoc ID quan." });
        }

        const [serviceData, counts] = await Promise.all([
            serviceService.getServices(club_id, { page, limit, search, status }),
            serviceService.getServiceStatusCounts(club_id)
        ]);

        return res.status(200).json({
            success: true,
            data: serviceData.services,
            pagination: {
                total: serviceData.total,
                totalPages: serviceData.totalPages,
                currentPage: serviceData.currentPage,
                limit: parseInt(limit, 10)
            },
            statusCounts: counts
        });
    } catch (error) {
        console.error("Error in getServices:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getServiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findById(id);
        if (!service) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }
        if (!(await canAccessClub(req, service.club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen xem dich vu nay." });
        }
        return res.status(200).json({ success: true, data: service });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

const createService = async (req, res) => {
    try {
        const { name, price, description } = req.body;
        const club_id = req.body.club_id || req.query.club_id || req.user?.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Khong xac dinh duoc ID quan." });
        }

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen tao dich vu cho quan nay." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Ten dich vu khong duoc de trong." });
        }
        if (name.trim().length > 150) {
            return res.status(400).json({ success: false, message: "Ten dich vu toi da 150 ky tu." });
        }
        if (price === undefined || price === null || Number.isNaN(Number(price))) {
            return res.status(400).json({ success: false, message: "Gia dich vu bat buoc va phai la so." });
        }
        if (Number(price) <= 0) {
            return res.status(400).json({ success: false, message: "Gia dich vu phai lon hon 0." });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mo ta toi da 500 ky tu." });
        }

        const images = req.files ? req.files.map((file) => file.path) : [];

        const serviceData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            images,
            description: description || "",
            created_by: req.user?.id || req.accountId || null
        };

        const newService = await serviceService.createService(serviceData);

        return res.status(201).json({
            success: true,
            message: "Tao dich vu thanh cong.",
            data: newService
        });
    } catch (error) {
        console.error("Error in createService:", error);
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

const updateService = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, description, removedImages } = req.body;
        const club_id = req.body.club_id || req.query.club_id || req.user?.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Khong xac dinh duoc ID quan." });
        }

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen cap nhat dich vu cho quan nay." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Ten dich vu khong duoc de trong." });
        }
        if (name.trim().length > 150) {
            return res.status(400).json({ success: false, message: "Ten dich vu toi da 150 ky tu." });
        }
        if (price === undefined || price === null || Number.isNaN(Number(price))) {
            return res.status(400).json({ success: false, message: "Gia dich vu bat buoc va phai la so." });
        }
        if (Number(price) <= 0) {
            return res.status(400).json({ success: false, message: "Gia dich vu phai lon hon 0." });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mo ta toi da 500 ky tu." });
        }

        const existing = await Service.findOne({ _id: id, club_id });
        if (!existing) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }

        const currentImages = existing.images || [];
        let removedList = [];
        if (removedImages) {
            removedList = Array.isArray(removedImages) ? removedImages : [removedImages];
        }

        for (const url of removedList) {
            try {
                const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                await cloudinary.uploader.destroy(publicId);
            } catch (e) {
                console.error("Loi xoa anh Cloudinary:", e);
            }
        }

        const remainingImages = currentImages.filter((img) => !removedList.includes(img));
        const newImages = req.files ? req.files.map((file) => file.path) : [];

        const updateData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            images: [...remainingImages, ...newImages],
            description: description || ""
        };

        const updated = await serviceService.updateService(id, updateData);

        if (!updated) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }

        return res.status(200).json({
            success: true,
            message: "Cap nhat dich vu thanh cong.",
            data: updated
        });
    } catch (error) {
        console.error("Error in updateService:", error);
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

const deactivateService = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findById(id);
        if (!service) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }
        if (!(await canAccessClub(req, service.club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen vo hieu hoa dich vu nay." });
        }

        service.status = "Inactive";
        await service.save();

        return res.status(200).json({
            success: true,
            message: "Da vo hieu hoa dich vu.",
            data: service
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

const reactivateService = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findById(id);
        if (!service) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }
        if (!(await canAccessClub(req, service.club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen khoi phuc dich vu nay." });
        }

        service.status = "Active";
        await service.save();

        return res.status(200).json({
            success: true,
            message: "Da khoi phuc dich vu.",
            data: service
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

const deleteServicePermanently = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findById(id);
        if (!service) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }
        if (!(await canAccessClub(req, service.club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen xoa dich vu nay." });
        }

        const club_id = service.club_id;

        try {
            if (service.images && service.images.length > 0) {
                for (const url of service.images) {
                    const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                    await cloudinary.uploader.destroy(publicId);
                }
            }
        } catch (e) {
            console.error("Loi xoa anh khi delete service:", e);
        }

        const deleted = await Service.findOneAndDelete({ _id: id, club_id });
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Khong tim thay dich vu." });
        }
        return res.status(200).json({
            success: true,
            message: "Da xoa vinh vien dich vu."
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

module.exports = {
    getServices,
    getServiceById,
    createService,
    updateService,
    deactivateService,
    reactivateService,
    deleteServicePermanently
};
