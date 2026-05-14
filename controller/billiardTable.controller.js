const tableService = require("../services/billiardTable.service");
const BilliardTable = require("../models/billiard_table.model");
const cloudinary = require("../configs/cloudinary.config");
const Booking = require("../models/booking.model");
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

const getBilliardTables = async (req, res) => {
    try {
        // Lấy club_id từ query hoặc req.user.club_id
        const club_id = req.query.club_id || req.user?.club_id || req.body?.club_id;
        const { page = 1, limit = 5, search, table_type_id, status } = req.query;

        if (!club_id) {
            return res.status(400).json({
                success: false,
                message: "Không xác định được ID Quán (club_id). Vui lòng đăng nhập lại."
            });
        }

        // Chạy song song 2 Promise để lấy danh sách bàn và số lượng thống kê (Tối ưu tốc độ)
        const [tableData, counts] = await Promise.all([
            tableService.getTables(club_id, { page, limit, search, table_type_id, status }),
            tableService.getTableStatusCounts(club_id)
        ]);

        return res.status(200).json({
            success: true,
            message: "Get billiard tables successfully",
            data: tableData.tables,
            pagination: {
                total: tableData.total,
                totalPages: tableData.totalPages,
                currentPage: tableData.currentPage,
                limit: parseInt(limit || 5)
            },
            statusCounts: counts // Trả về data cho các Tab trạng thái trên UI
        });

    } catch (error) {
        console.error("Error in getBilliardTables:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};

const getBilliardTableById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID bàn"
            });
        }

        const table = await BilliardTable.findById(id).populate("table_type_id", "name");
        if (!table) {
            return res.status(404).json({
                success: false,
                message: "KhÃ´ng tÃ¬m tháº¥y bÃ n!"
            });
        }

        if (!(await canAccessClub(req, table.club_id))) {
            return res.status(403).json({
                success: false,
                message: "Báº¡n khÃ´ng cÃ³ quyá»n xem bÃ n nÃ y"
            });
        }

        return res.status(200).json({
            success: true,
            data: table
        });
    } catch (error) {
        console.error("Error in getBilliardTableById:", error);
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "Lỗi server nội bộ"
        });
    }
};

const createBilliardTable = async (req, res) => {
    try {
        // Lấy thông tin bàn từ form
        const { table_type_id, table_number, area, price, brand, description, isActive } = req.body;

        // Lấy club_id
        const club_id = req.body.club_id || req.query.club_id || req.user?.club_id;

        if (!club_id) {
            return res.status(400).json({
                success: false,
                message: "Không xác định được ID Quán (club_id). Vui lòng đăng nhập lại."
            });
        }

        // Validate cơ bản
        if (!table_type_id || !table_number || !price) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập đầy đủ: Tên bàn, Loại bàn và Đơn giá!"
            });
        }

        // Lấy URL ảnh từ Cloudinary (multer đã upload nhiều ảnh)
        const images = req.files ? req.files.map(f => f.path) : [];

        const tableStatus = isActive === "false" ? "Maintenance" : "Available";

        const tableData = {
            club_id,
            table_type_id,
            table_number,
            area: area || "Khu vực chung",
            price: Number(price),
            brand: brand || "",
            description,
            images,
            status: tableStatus
        };

        const newTable = await tableService.createTable(tableData);

        return res.status(201).json({
            success: true,
            message: "Thêm bàn bida mới thành công!",
            data: newTable
        });

    } catch (error) {
        console.error("Error in createBilliardTable:", error);
        
        // MongoDB duplicate key error (11000)
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `Tên bàn "${req.body.table_number}" đã tồn tại trong quán. Vui lòng chọn tên khác!`
            });
        }

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "Lỗi server nội bộ"
        });
    }
};

const updateBilliardTable = async (req, res) => {
    try {
        const { id } = req.params; // Lấy ID bàn từ URL
        const { table_type_id, table_number, area, price, brand, description, isActive, status } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: "Thiếu ID bàn" });
        }

        // Lấy club_id
        const club_id = req.body.club_id || req.query.club_id || req.user?.club_id;
        
        if (!club_id) {
            return res.status(400).json({
                success: false,
                message: "Không xác định được ID Quán (club_id). Vui lòng đăng nhập lại."
            });
        }

        // Validate cơ bản
        if (!table_type_id || !table_number || !price) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập đầy đủ: Tên bàn, Loại bàn và Đơn giá!"
            });
        }

        // Lấy bàn hiện tại để xử lý ảnh
        const existing = await BilliardTable.findOne({ _id: id, club_id }).populate("table_type_id", "name");
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "KhÃ´ng tÃ¬m tháº¥y bÃ n!"
            });
        }
        let currentImages = existing.images || [];

        // Xử lý danh sách ảnh bị xóa
        let removedList = [];
        const removedImages = req.body.removedImages;
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

        // Ưu tiên status gửi trực tiếp, fallback sang isActive
        const tableStatus = status || (isActive === "false" ? "Maintenance" : "Available");

        if (tableStatus === "Maintenance") {
            const activeBookings = await Booking.countDocuments({
                table_id: id,
                status: { $in: ["Booked", "Playing"] }
            });
            if (activeBookings > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Không thể chuyển bàn sang trạng thái bảo trì vì đang có lịch đặt hoặc đang được chơi."
                });
            }
        }

        const updateData = {
            club_id,
            table_type_id,
            table_number,
            area: area || "Khu vực chung",
            price: Number(price),
            brand: brand || "",
            description,
            status: tableStatus,
            images: [...remainingImages, ...newImages]
        };

        const updatedTable = await tableService.updateTable(id, updateData);

        if (!updatedTable) {
            return res.status(404).json({ success: false, message: "Không tìm thấy bàn để cập nhật" });
        }

        return res.status(200).json({
            success: true,
            message: "Cập nhật bàn thành công",
            data: updatedTable
        });

    } catch (error) {
        console.error("Error in updateBilliardTable:", error);
        
        // MongoDB duplicate key error hoặc Lỗi tùy chỉnh ném từ service
        if (error.code === 11000 || error.message.includes("đã tồn tại")) {
            return res.status(409).json({
                success: false,
                message: `Tên bàn "${req.body.table_number}" đã tồn tại trong quán. Vui lòng chọn tên khác!`
            });
        }

        const statusCode = error.statusCode || 400;
        return res.status(statusCode).json({ success: false, message: error.message || "Lỗi cập nhật bàn" });
    }
};

const deleteBilliardTable = async (req, res) => {
    try {
        const { id } = req.params;
        const club_id = req.user?.club_id;

        if (!id || !club_id) {
            return res.status(400).json({ success: false, message: "Thiếu ID bàn" });
        }

        const activeBookings = await Booking.countDocuments({
            table_id: id,
            status: { $in: ["Booked", "Playing"] }
        });
        if (activeBookings > 0) {
            return res.status(400).json({
                success: false,
                message: "Không thể xóa bàn vì đang có lịch đặt hoặc đang được chơi."
            });
        }

        // Xóa ảnh Cloudinary trước khi xóa bàn
        try {
            const table = await BilliardTable.findOne({ _id: id, club_id });
            if (table.images && table.images.length > 0) {
                for (const url of table.images) {
                    const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                    await cloudinary.uploader.destroy(publicId);
                }
            }
        } catch (e) {
            console.error("Lỗi xóa ảnh khi delete bàn:", e);
        }

        const deleted = await BilliardTable.findOneAndDelete({ _id: id, club_id });
        if (!deleted) {
            return res.status(404).json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y bÃ n!" });
        }

        return res.status(200).json({
            success: true,
            message: "Xóa bàn thành công"
        });

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Controller Lấy danh sách loại bàn
const getTableTypes = async (req, res) => {
    try {
        const tableTypes = await tableService.getAllTableTypes();
        return res.status(200).json({
            success: true,
            data: tableTypes
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Controller Tạo loại bàn
const createTableType = async (req, res) => {
    try {
        const newType = await tableService.createTableType(req.body);
        return res.status(201).json({
            success: true,
            data: newType
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getBilliardTables,
    getBilliardTableById,
    createBilliardTable,
    updateBilliardTable,
    deleteBilliardTable,
    getTableTypes,   
    createTableType  
};
