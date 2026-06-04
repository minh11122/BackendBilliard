const mongoose = require("mongoose");
const Service = require("../../models/service.model");
const Club = require("../../models/club.model");

const cloudinary = require("../../configs/cloudinary.config");
const { canAccessClub } = require("./club.helpers");




const getServices = async (req, res) => {
    try {
        const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;
        const { page = 1, limit = 10, search, status = "Active" } = req.query || {};

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Khong xac dinh duoc ID quan." });
        }

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        const query = { club_id: new mongoose.Types.ObjectId(club_id), status };

        if (search) {
            query.name = { $regex: search, $options: "i" };
        }

        const skip = (page - 1) * limit;

        const services = await Service.find(query)
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ created_at: -1 });

        const total = await Service.countDocuments(query);

        const countData = await Service.aggregate([
            { $match: { club_id: new mongoose.Types.ObjectId(club_id) } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        let totalCount = 0;
        let activeCount = 0;
        let inactiveCount = 0;

        countData.forEach(item => {
            if (item._id === "Active") activeCount = item.count;
            if (item._id === "Inactive") inactiveCount = item.count;
            totalCount += item.count;
        });

        const statusCounts = {
            total: totalCount,
            active: activeCount,
            inactive: inactiveCount
        };

        return res.status(200).json({
            success: true,
            data: services,
            pagination: {
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                limit: parseInt(limit)
            },
            statusCounts
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
        if (!service) return res.status(404).json({ success: false, message: "Không tìm thấy dịch vụ!" });

        if (req.user?.role === "OWNER") {
            const isOwner = await canAccessClub(req, service.club_id);
            if (!isOwner) return res.status(403).json({ success: false, message: "Bạn không có quyền xem dịch vụ của quán khác!" });
        } else if (req.user?.role === "STAFF_CLUB" && req.user.club_id !== service.club_id.toString()) {
            return res.status(403).json({ success: false, message: "Nhân viên không có quyền xem dịch vụ của quán khác!" });
        }
        
        return res.status(200).json({ success: true, data: service });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const createService = async (req, res) => {
    try {
        const { name, price, description } = req.body;
        const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Khong xac dinh duoc ID quan." });
        }

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Ban khong co quyen tao dich vu cho quan nay." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Tên dịch vụ không được để trống." });
        }
        if (name.trim().length > 150) {
            return res.status(400).json({ success: false, message: "Tên dịch vụ tối đa 150 ký tự." });
        }
        if (price === undefined || price === null || Number.isNaN(Number(price))) {
            return res.status(400).json({ success: false, message: "Giá dịch vụ bắt buộc và phải là số." });
        }
        if (Number(price) <= 0) {
            return res.status(400).json({ success: false, message: "Giá dịch vụ phải lớn hơn 0." });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mô tả tối đa 500 ký tự." });
        }

        // Kiểm tra trùng tên trong cùng Club
        const existing = await Service.findOne({ club_id, name: name.trim(), status: "Active" });
        if (existing) {
            return res.status(409).json({ success: false, message: `Dịch vụ "${name.trim()}" đã tồn tại trong quán!` });
        }

        const images = req.files ? req.files.map(f => f.path) : [];

        const serviceData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            images,
            description: description || "",
            created_by: req.user?.id || req.accountId || null,
            status: "Active",
            created_at: new Date()
        };

        const newService = new Service(serviceData);
        await newService.save();

        return res.status(201).json({
            success: true,
            message: "Tao dich vu thanh cong.",
            data: newService
        });
    } catch (error) {
        console.error("Error in createService:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateService = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, description, removedImages } = req.body;
        const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;

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

        // Kiểm tra trùng tên (trừ chính nó)
        const existingName = await Service.findOne({
            club_id,
            name: name.trim(),
            status: "Active",
            _id: { $ne: id }
        });
        
        if (existingName) {
            return res.status(409).json({ success: false, message: `Dịch vụ "${name.trim()}" đã tồn tại trong quán!` });
        }

        const existing = await Service.findById(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Không tìm thấy dịch vụ." });
        }

        if (existing.club_id.toString() !== club_id) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền sửa dịch vụ của quán khác!" });
        }
        
        let currentImages = existing.images || [];

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

        const remainingImages = currentImages.filter(img => !removedList.includes(img));
        const newImages = req.files ? req.files.map(f => f.path) : [];

        const updateData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            images: [...remainingImages, ...newImages],
            description: description || ""
        };

        const updated = await Service.findByIdAndUpdate(id, updateData, { new: true });

        return res.status(200).json({
            success: true,
            message: "Cap nhat dich vu thanh cong.",
            data: updated
        });
    } catch (error) {
        console.error("Error in updateService:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deactivateService = async (req, res) => {
    try {
        const { id } = req.params;
        
        const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;
        
        if (!club_id) return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        const existing = await Service.findById(id);
        if (!existing) return res.status(404).json({ success: false, message: "Không tìm thấy dịch vụ!" });
        if (existing.club_id.toString() !== club_id) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền sửa dịch vụ của quán khác!" });
        }

        const service = await Service.findByIdAndUpdate(
            id,
            { status: "Inactive" },
            { new: true }
        );
        
        return res.status(200).json({
            success: true,
            message: "Da vo hieu hoa dich vu.",
            data: service
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const reactivateService = async (req, res) => {
    try {
        const { id } = req.params;
        
        const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;
        if (!club_id) return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        const existing = await Service.findById(id);
        if (!existing) return res.status(404).json({ success: false, message: "Không tìm thấy dịch vụ!" });
        if (existing.club_id.toString() !== club_id) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền sửa dịch vụ của quán khác!" });
        }

        const service = await Service.findByIdAndUpdate(
            id,
            { status: "Active" },
            { new: true }
        );
        
        return res.status(200).json({
            success: true,
            message: "Da khoi phuc dich vu.",
            data: service
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteServicePermanently = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findById(id);
        if (!service) {
            return res.status(404).json({ success: false, message: "Không tìm thấy dịch vụ." });
        }
        
        const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;
        if (!club_id) return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        if (service.club_id.toString() !== club_id.toString()) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền xóa dịch vụ của quán khác!" });
        }

        if (service.images && service.images.length > 0) {
            for (const url of service.images) {
                try {
                    const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                    await cloudinary.uploader.destroy(publicId);
                } catch (e) {
                    console.error("Lỗi xóa ảnh khi delete service:", e);
                }
            }
        }

        await Service.findByIdAndDelete(id);
        
        return res.status(200).json({
            success: true,
            message: "Da xoa vinh vien dich vu."
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
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
