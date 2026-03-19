const serviceService = require("../services/service.service");
const cloudinary = require("../configs/cloudinary.config");

const getServices = async (req, res) => {
    try {
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.query.club_id;
        const { page = 1, limit = 10, search, status = "Active" } = req.query;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });
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
                limit: parseInt(limit)
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
        const service = await serviceService.getServiceById(id);
        return res.status(200).json({ success: true, data: service });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({ success: false, message: error.message });
    }
};

const createService = async (req, res) => {
    try {
        const { name, price, description } = req.body;
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.body.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Tên dịch vụ không được để trống!" });
        }
        if (name.trim().length > 150) {
            return res.status(400).json({ success: false, message: "Tên dịch vụ tối đa 150 ký tự!" });
        }
        if (price === undefined || price === null || isNaN(Number(price))) {
            return res.status(400).json({ success: false, message: "Giá dịch vụ là bắt buộc và phải là số!" });
        }
        if (Number(price) <= 0) {
            return res.status(400).json({ success: false, message: "Giá dịch vụ phải lớn hơn 0!" });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mô tả tối đa 500 ký tự!" });
        }

        // Lấy URL ảnh từ Cloudinary (multer đã upload)
        const images = req.files ? req.files.map(f => f.path) : [];

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
            message: "Tạo dịch vụ thành công!",
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
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.body.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Tên dịch vụ không được để trống!" });
        }
        if (name.trim().length > 150) {
            return res.status(400).json({ success: false, message: "Tên dịch vụ tối đa 150 ký tự!" });
        }
        if (price === undefined || price === null || isNaN(Number(price))) {
            return res.status(400).json({ success: false, message: "Giá dịch vụ là bắt buộc và phải là số!" });
        }
        if (Number(price) <= 0) {
            return res.status(400).json({ success: false, message: "Giá dịch vụ phải lớn hơn 0!" });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mô tả tối đa 500 ký tự!" });
        }

        // Lấy dịch vụ hiện tại để xử lý ảnh
        const existing = await serviceService.getServiceById(id);
        let currentImages = existing.images || [];

        // Xử lý danh sách ảnh bị xóa
        let removedList = [];
        if (removedImages) {
            removedList = Array.isArray(removedImages) ? removedImages : [removedImages];
        }

        // Xóa ảnh cũ khỏi Cloudinary
        for (const url of removedList) {
            try {
                const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                await cloudinary.uploader.destroy(publicId);
            } catch (e) {
                console.error("Lỗi xóa ảnh Cloudinary:", e);
            }
        }

        // Ảnh còn lại = ảnh cũ trừ ảnh bị xóa
        const remainingImages = currentImages.filter(img => !removedList.includes(img));

        // Ảnh mới upload
        const newImages = req.files ? req.files.map(f => f.path) : [];

        const updateData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            images: [...remainingImages, ...newImages],
            description: description || ""
        };

        const updated = await serviceService.updateService(id, updateData);

        if (!updated) {
            return res.status(404).json({ success: false, message: "Không tìm thấy dịch vụ." });
        }

        return res.status(200).json({
            success: true,
            message: "Cập nhật dịch vụ thành công!",
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
        const service = await serviceService.deactivateService(id);
        return res.status(200).json({
            success: true,
            message: "Đã vô hiệu hóa dịch vụ.",
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
        const service = await serviceService.reactivateService(id);
        return res.status(200).json({
            success: true,
            message: "Đã khôi phục dịch vụ.",
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

        // Xóa ảnh Cloudinary trước khi xóa service
        try {
            const service = await serviceService.getServiceById(id);
            if (service.images && service.images.length > 0) {
                for (const url of service.images) {
                    const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                    await cloudinary.uploader.destroy(publicId);
                }
            }
        } catch (e) {
            console.error("Lỗi xóa ảnh khi delete service:", e);
        }

        await serviceService.deleteServicePermanently(id);
        return res.status(200).json({
            success: true,
            message: "Đã xóa vĩnh viễn dịch vụ."
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