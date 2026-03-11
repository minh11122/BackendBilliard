const mongoose = require("mongoose");
const Service = require("../models/service.model");

/**
 * Lấy danh sách dịch vụ theo club_id (phân trang, tìm kiếm, lọc status)
 */
const getServices = async (club_id, { page = 1, limit = 10, search, status = "Active" } = {}) => {
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

    return {
        services,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page)
    };
};

/**
 * Lấy chi tiết một dịch vụ
 */
const getServiceById = async (serviceId) => {
    const service = await Service.findById(serviceId);
    if (!service) {
        const error = new Error("Không tìm thấy dịch vụ!");
        error.statusCode = 404;
        throw error;
    }
    return service;
};

/**
 * Tạo dịch vụ mới
 */
const createService = async (serviceData) => {
    const { club_id, name } = serviceData;

    // Kiểm tra trùng tên trong cùng Club
    const existing = await Service.findOne({ club_id, name, status: "Active" });
    if (existing) {
        const error = new Error(`Dịch vụ "${name}" đã tồn tại trong quán!`);
        error.statusCode = 409;
        throw error;
    }

    const newService = new Service({
        ...serviceData,
        status: "Active",
        created_at: new Date()
    });
    await newService.save();
    return newService;
};

/**
 * Cập nhật dịch vụ
 */
const updateService = async (serviceId, updateData) => {
    const { club_id, name } = updateData;

    // Kiểm tra trùng tên (trừ chính nó)
    if (name) {
        const existing = await Service.findOne({
            club_id,
            name,
            status: "Active",
            _id: { $ne: serviceId }
        });
        if (existing) {
            const error = new Error(`Dịch vụ "${name}" đã tồn tại trong quán!`);
            error.statusCode = 409;
            throw error;
        }
    }

    const updated = await Service.findByIdAndUpdate(serviceId, updateData, { new: true });
    return updated;
};

/**
 * Vô hiệu hóa (soft delete)
 */
const deactivateService = async (serviceId) => {
    const service = await Service.findByIdAndUpdate(
        serviceId,
        { status: "Inactive" },
        { new: true }
    );
    if (!service) {
        const error = new Error("Không tìm thấy dịch vụ!");
        error.statusCode = 404;
        throw error;
    }
    return service;
};

/**
 * Khôi phục dịch vụ
 */
const reactivateService = async (serviceId) => {
    const service = await Service.findByIdAndUpdate(
        serviceId,
        { status: "Active" },
        { new: true }
    );
    if (!service) {
        const error = new Error("Không tìm thấy dịch vụ!");
        error.statusCode = 404;
        throw error;
    }
    return service;
};

/**
 * Xóa vĩnh viễn
 */
const deleteServicePermanently = async (serviceId) => {
    const service = await Service.findById(serviceId);
    if (!service) {
        const error = new Error("Không tìm thấy dịch vụ!");
        error.statusCode = 404;
        throw error;
    }
    await Service.findByIdAndDelete(serviceId);
    return true;
};

/**
 * Đếm số lượng dịch vụ theo trạng thái
 */
const getServiceStatusCounts = async (club_id) => {
    const counts = await Service.aggregate([
        { $match: { club_id: new mongoose.Types.ObjectId(club_id) } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const result = { total: 0, active: 0, inactive: 0 };
    counts.forEach(item => {
        if (item._id === "Active") result.active = item.count;
        if (item._id === "Inactive") result.inactive = item.count;
        result.total += item.count;
    });
    return result;
};

module.exports = {
    getServices,
    getServiceById,
    createService,
    updateService,
    deactivateService,
    reactivateService,
    deleteServicePermanently,
    getServiceStatusCounts
};
