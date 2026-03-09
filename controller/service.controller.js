const serviceService = require("../services/service.service");

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
        const { name, price, discount_percent, description } = req.body;
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.body.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });
        }

        // Validate chặt chẽ
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
        if (discount_percent !== undefined && discount_percent !== null && discount_percent !== "") {
            const disc = Number(discount_percent);
            if (isNaN(disc) || disc < 0 || disc > 100) {
                return res.status(400).json({ success: false, message: "Giảm giá phải từ 0 đến 100%!" });
            }
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mô tả tối đa 500 ký tự!" });
        }

        const serviceData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            discount_percent: Number(discount_percent) || 0,
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
        const { name, price, discount_percent, description } = req.body;
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.body.club_id;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });
        }

        // Validate chặt chẽ
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
        if (discount_percent !== undefined && discount_percent !== null && discount_percent !== "") {
            const disc = Number(discount_percent);
            if (isNaN(disc) || disc < 0 || disc > 100) {
                return res.status(400).json({ success: false, message: "Giảm giá phải từ 0 đến 100%!" });
            }
        }
        if (description && description.length > 500) {
            return res.status(400).json({ success: false, message: "Mô tả tối đa 500 ký tự!" });
        }

        const updateData = {
            club_id,
            name: name.trim(),
            price: Number(price),
            discount_percent: Number(discount_percent) || 0,
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