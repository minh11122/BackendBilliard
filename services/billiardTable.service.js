const mongoose = require("mongoose");
const BilliardTable = require("../models/billiard_table.model");
const Booking = require("../models/booking.model");
const TableType = require("../models/table_type.model");

/**
 * Lấy danh sách bàn theo điều kiện (phân trang, tìm kiếm, lọc)
 * Mỗi bàn được enrich thêm thông tin booking đang hoạt động (nếu có)
 */
const getTables = async (club_id, { page = 1, limit = 5, search, table_type_id, status } = {}) => {
    const query = { club_id: new mongoose.Types.ObjectId(club_id) };

    // 1. Tìm kiếm theo tên hoặc số bàn (Không phân biệt hoa thường)
    if (search) {
        query.table_number = { $regex: search, $options: "i" };
    }

    // 2. Lọc theo Loại bàn
    if (table_type_id) {
        query.table_type_id = new mongoose.Types.ObjectId(table_type_id);
    }

    // 3. Lọc theo Trạng thái (chỉ áp dụng cho status bảng billiard_table)
    if (status && ["Available", "Maintenance", "Holding"].includes(status)) {
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

    // 7. Lấy tất cả booking đang hoạt động cho các bàn này
    const tableIds = tables.map(t => t._id);
    const activeBookings = await Booking.find({
        table_id: { $in: tableIds },
        status: { $in: ["Playing", "Booked", "Pending"] }
    })
        .populate("account_id", "fullname email phone")
        .sort({ created_at: -1 })
        .lean();

    // Tạo map: table_id -> booking mới nhất đang active
    const bookingMap = {};
    for (const b of activeBookings) {
        const tid = b.table_id.toString();
        // Ưu tiên Playing > Booked > Pending
        if (!bookingMap[tid]) {
            bookingMap[tid] = b;
        } else {
            const priority = { Playing: 3, Booked: 2, Pending: 1 };
            if ((priority[b.status] || 0) > (priority[bookingMap[tid].status] || 0)) {
                bookingMap[tid] = b;
            }
        }
    }

    // 8. Gắn booking vào từng bàn
    const enrichedTables = tables.map(t => {
        const tableObj = t.toObject();
        tableObj.activeBooking = bookingMap[t._id.toString()] || null;
        return tableObj;
    });

    return {
        tables: enrichedTables,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page)
    };
};

/**
 * Lấy chi tiết một bàn bida theo ID
 */
const getTableById = async (tableId) => {
    const table = await BilliardTable.findById(tableId).populate("table_type_id", "name");
    
    if (!table) {
        const error = new Error("Không tìm thấy bàn!");
        error.statusCode = 404;
        throw error;
    }
    
    return table;
};

/**
 * Đếm số lượng bàn theo trạng thái thực tế (kết hợp billiard_table + booking)
 * - Playing: bàn có booking đang ở trạng thái Playing
 * - Booked: bàn có booking Booked (chưa check-in)
 * - Holding: bàn đang bị giữ chỗ (Holding) hoặc có booking Pending
 * - Available: bàn sẵn sàng, không có booking active
 * - Maintenance: bàn đang bảo trì
 */
const getTableStatusCounts = async (club_id) => {
    const clubObjId = new mongoose.Types.ObjectId(club_id);

    // Lấy tất cả bàn của club
    const allTables = await BilliardTable.find({ club_id: clubObjId }).lean();
    const tableIds = allTables.map(t => t._id);

    // Lấy tất cả booking đang hoạt động
    const activeBookings = await Booking.find({
        table_id: { $in: tableIds },
        status: { $in: ["Playing", "Booked", "Pending"] }
    }).lean();

    // Map booking theo table_id (ưu tiên Playing > Booked > Pending)
    const bookingMap = {};
    const priority = { Playing: 3, Booked: 2, Pending: 1 };
    for (const b of activeBookings) {
        const tid = b.table_id.toString();
        if (!bookingMap[tid] || (priority[b.status] || 0) > (priority[bookingMap[tid].status] || 0)) {
            bookingMap[tid] = b;
        }
    }

    const result = {
        total: allTables.length,
        available: 0,
        inUse: 0,  // Playing
        booked: 0, // Booked (đã đặt, chưa check-in)
        holding: 0, // Holding/Pending
        maintenance: 0
    };

    for (const table of allTables) {
        const tid = table._id.toString();
        const booking = bookingMap[tid];

        if (table.status === "Maintenance") {
            result.maintenance++;
        } else if (booking) {
            if (booking.status === "Playing") result.inUse++;
            else if (booking.status === "Booked") result.booked++;
            else result.holding++; // Pending
        } else if (table.status === "Holding") {
            result.holding++;
        } else {
            result.available++;
        }
    }

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
    getTableById,
    getTableStatusCounts,
    createTable,
    updateTable,
    deleteTable,
    getAllTableTypes,
    createTableType
};
