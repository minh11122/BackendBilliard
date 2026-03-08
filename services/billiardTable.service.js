const mongoose = require("mongoose");
const BilliardTable = require("../models/billiard_table.model");
const TableType = require("../models/table_type.model");
/**
 * Lấy danh sách bàn theo điều kiện (phân trang, tìm kiếm, lọc)
 */
const getTables = async ({ club_id, page = 1, limit = 5, search, table_type_id, status }) => {
    const query = { club_id: new mongoose.Types.ObjectId(club_id) };

    // 1. Tìm kiếm theo tên hoặc số bàn (Không phân biệt hoa thường)
    if (search) {
        query.table_number = { $regex: search, $options: "i" };
    }

    // 2. Lọc theo Loại bàn
    if (table_type_id) {
        query.table_type_id = new mongoose.Types.ObjectId(table_type_id);
    }

    // 3. Lọc theo Trạng thái
    if (status) {
        query.status = status;
    }

    // 4. Tính toán Phân trang
    const skip = (page - 1) * limit;

    // 5. Query dữ liệu
    const tables = await BilliardTable.find(query)
        .populate("table_type_id", "name") // Nối bảng TableType để lấy tên loại bàn (Pool, Carom...)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ created_at: -1 }); // Mới nhất lên đầu

    // 6. Đếm tổng số record để làm phân trang trên UI
    const total = await BilliardTable.countDocuments(query);

    return {
        tables,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page)
    };
};

/**
 * Đếm số lượng bàn theo từng trạng thái (Tất cả, Sẵn sàng, Đang sử dụng, Bảo trì)
 */
const getTableStatusCounts = async (club_id) => {
    const counts = await BilliardTable.aggregate([
        { $match: { club_id: new mongoose.Types.ObjectId(club_id) } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    // Khởi tạo object đếm mặc định
    const result = {
        total: 0,
        available: 0,
        inUse: 0,
        maintenance: 0
    };

    counts.forEach(item => {
        if (item._id === "Available") result.available = item.count;
        if (item._id === "In Use") result.inUse = item.count;
        if (item._id === "Maintenance") result.maintenance = item.count;
        result.total += item.count;
    });

    return result;
};

const createTable = async (tableData) => {
    const { club_id, table_number } = tableData;

    // 1. Kiểm tra nghiệp vụ: Tên/Số bàn đã tồn tại trong Club này chưa?
    const existingTable = await BilliardTable.findOne({ club_id, table_number });
    if (existingTable) {
        // Chủ động ném lỗi ra cho Controller bắt, kèm theo status code
        const error = new Error(`Bàn "${table_number}" đã tồn tại trong cơ sở này!`);
        error.statusCode = 409; // 409 Conflict
        throw error;
    }

    // 2. Tạo và lưu record mới vào Database
    const newTable = new BilliardTable(tableData);
    await newTable.save();

    return newTable;
};

/**
 * Cập nhật thông tin bàn
 */
const updateTable = async (tableId, updateData) => {
    const { club_id, table_number } = updateData;

    // Nếu có đổi tên/số bàn, kiểm tra xem tên mới có bị trùng với bàn khác trong cùng Club không
    if (table_number) {
        const existingTable = await BilliardTable.findOne({
            club_id,
            table_number,
            _id: { $ne: tableId } // Tìm bàn khác có cùng tên
        });

        if (existingTable) {
            throw new Error(`Bàn số ${table_number} đã tồn tại!`);
        }
    }

    // Thực hiện cập nhật
    const updatedTable = await BilliardTable.findByIdAndUpdate(
        tableId,
        updateData,
        { new: true } // Trả về data mới sau khi update
    );

    return updatedTable;
};

/**
 * Xóa bàn bida
 */
const deleteTable = async (tableId) => {
    const table = await BilliardTable.findById(tableId);

    if (!table) {
        throw new Error("Không tìm thấy bàn!");
    }

    // Ràng buộc nghiệp vụ: Không được xóa bàn đang có khách chơi
    if (table.status === "In Use") {
        throw new Error("Không thể xóa bàn đang được sử dụng!");
    }

    // Thực hiện xóa cứng (Hoặc sau này bạn có thể chuyển thành Xóa mềm - update status thành 'Deleted')
    await BilliardTable.findByIdAndDelete(tableId);
    return true;
};

/**
 * Lấy danh sách Loại bàn (Table Types)
 */
const getAllTableTypes = async () => {
    return await TableType.find({}); };

/**
 * Tạo Loại bàn mới (Để test)
 */
const createTableType = async (typeData) => {
    const newType = new TableType(typeData);
    await newType.save();
    return newType;
};

module.exports = {
    getTables,
    getTableStatusCounts,
    createTable,
    updateTable,
    deleteTable,
    getAllTableTypes,
    createTableType
};
