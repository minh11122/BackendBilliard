const tableService = require("../services/billiardTable.service");
const BilliardTable = require("../models/billiard_table.model");

const getBilliardTables = async (req, res) => {
    try {
        // Lấy club_id từ Token đã được middleware giải mã (bảo mật nhất) hoặc fallback từ query
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.query.club_id;
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

        const table = await tableService.getTableById(id);

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

        // ƯU TIÊN 1: Lấy club_id từ Token đã được middleware giải mã (bảo mật nhất)
        // ƯU TIÊN 2: Fallback lấy từ req.body do Frontend gửi lên (dùng để test nếu chưa có auth)
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.body.club_id;

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

        let image_url = "";
        if (req.file) {
            image_url = req.file.path;
        }

        const tableStatus = isActive === "false" ? "Maintenance" : "Available";

        const tableData = {
            club_id,
            table_type_id,
            table_number,
            area: area || "Khu vực chung", // Đảm bảo có dữ liệu nếu UI bị gỡ bỏ input
            price: Number(price),
            brand: brand || "",
            description,
            image_url,
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
                message: `Tên bàn "${table_number}" đã tồn tại trong quán. Vui lòng chọn tên khác!`
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

        // Lấy club_id từ Token hoặc Fallback
        const club_id = req.user?.club_id || req.user?.id || req.accountId || req.body.club_id;
        
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

        let image_url = req.body.image_url; // Lấy URL ảnh cũ (nếu có gửi lên)
        // Nếu có upload file ảnh mới thì ghi đè
        if (req.file) {
            image_url = req.file.path;
        }

        // Ưu tiên status gửi trực tiếp, fallback sang isActive
        const tableStatus = status || (isActive === "false" ? "Maintenance" : "Available");

        const updateData = {
            club_id,
            table_type_id,
            table_number,
            area: area || "Khu vực chung",
            price: Number(price),
            brand: brand || "",
            description,
            status: tableStatus
        };
        
        if (image_url) {
             updateData.image_url = image_url;
        }

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

        if (!id) {
            return res.status(400).json({ success: false, message: "Thiếu ID bàn" });
        }

        await tableService.deleteTable(id);

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