const mongoose = require("mongoose");
const BilliardTable = require("../models/billiard_table.model");
const Club = require("../models/club.model");

const checkOwnerAccess = async (clubId, accountId) => {
    if (!clubId || !accountId) return false;
    const club = await Club.findOne({ _id: clubId, account_id: accountId });
    return !!club;
};

const Booking = require("../models/booking.model");
const TableType = require("../models/table_type.model");
const cloudinary = require("../configs/cloudinary.config");

const getBilliardTables = async (req, res) => {
    try {
        const club_id = req.user?.club_id || req.query.club_id || req.body.club_id;
        const { page = 1, limit = 5, search, table_type_id, status } = req.query;

        if (!club_id) {
            return res.status(400).json({ success: false, message: "Không xác định được ID Quán." });
        }

        if (req.user?.role === "OWNER") {
            const isOwner = await checkOwnerAccess(club_id, req.user.accountId || req.user.id);
            if (!isOwner) return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        const getTables = async () => {
            const query = { club_id: new mongoose.Types.ObjectId(club_id) };

            if (search) {
                query.table_number = { $regex: search, $options: "i" };
            }

            if (table_type_id) {
                query.table_type_id = new mongoose.Types.ObjectId(table_type_id);
            }

            if (status && status !== "all") {
                if (status === "Maintenance") {
                    query.status = "Maintenance";
                } else if (status === "Holding") {
                    query.status = "Holding";
                } else {
                    const clubTables = await BilliardTable.find({ club_id: new mongoose.Types.ObjectId(club_id) }).distinct('_id');
                    const playingBookings = await Booking.find({
                        table_id: { $in: clubTables },
                        status: "Playing"
                    });
                    const playingTableIds = playingBookings.map(b => b.table_id);

                    if (status === "In Use") {
                        query._id = { $in: playingTableIds };
                    } else if (status === "Available") {
                        if (query._id) {
                            query._id.$nin = playingTableIds;
                        } else {
                            query._id = { $nin: playingTableIds };
                        }
                        query.status = "Available";
                    }
                }
            }

            const skip = (page - 1) * limit;

            const tables = await BilliardTable.find(query)
                .populate("table_type_id", "name")
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ created_at: -1 });

            const total = await BilliardTable.countDocuments(query);

            const tableIds = tables.map(t => t._id);
            const activeBookings = await Booking.find({
                table_id: { $in: tableIds },
                status: { $in: ["Playing", "Booked", "Pending"] }
            })
                .populate("account_id", "fullname email phone")
                .sort({ created_at: -1 })
                .lean();

            const bookingMap = {};
            for (const b of activeBookings) {
                const tid = b.table_id.toString();
                if (!bookingMap[tid]) {
                    bookingMap[tid] = b;
                } else {
                    const priority = { Playing: 3, Booked: 2, Pending: 1 };
                    if ((priority[b.status] || 0) > (priority[bookingMap[tid].status] || 0)) {
                        bookingMap[tid] = b;
                    }
                }
            }

            const enrichedTables = tables.map(t => {
                const tableObj = t.toObject();
                const activeBooking = bookingMap[t._id.toString()] || null;
                tableObj.activeBooking = activeBooking;
                
                if (tableObj.status !== "Maintenance") {
                    if (activeBooking && activeBooking.status === "Playing") {
                        tableObj.status = "In Use";
                    }
                }
                
                return tableObj;
            });

            return {
                tables: enrichedTables,
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page)
            };
        };

        const getTableStatusCounts = async () => {
            const clubObjId = new mongoose.Types.ObjectId(club_id);

            const allTables = await BilliardTable.find({ club_id: clubObjId }).lean();
            const tableIds = allTables.map(t => t._id);

            const activeBookings = await Booking.find({
                table_id: { $in: tableIds },
                status: { $in: ["Playing", "Booked", "Pending"] }
            }).lean();

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
                inUse: 0,
                booked: 0,
                holding: 0,
                maintenance: 0
            };

            for (const table of allTables) {
                const tid = table._id.toString();
                const booking = bookingMap[tid];

                if (table.status === "Maintenance") {
                    result.maintenance++;
                } else if (booking && booking.status === "Playing") {
                    result.inUse++;
                } else {
                    result.available++;
                }
            }

            return result;
        };

        const [tableData, counts] = await Promise.all([
            getTables(),
            getTableStatusCounts()
        ]);

        return res.status(200).json({
            success: true,
            message: "Get billiard tables successfully",
            data: tableData.tables,
            pagination: {
                total: tableData.total,
                totalPages: tableData.totalPages,
                currentPage: tableData.currentPage,
                limit: parseInt(limit || 5, 10)
            },
            statusCounts: counts
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
                message: "Thieu ID ban"
            });
        }

        const table = await BilliardTable.findById(id).populate("table_type_id", "name");
        if (!table) return res.status(404).json({ success: false, message: "Không tìm thấy bàn!" });

        if (req.user?.role === "OWNER") {
            const isOwner = await checkOwnerAccess(table.club_id, req.user.accountId || req.user.id);
            if (!isOwner) return res.status(403).json({ success: false, message: "Bạn không có quyền xem bàn của quán khác!" });
        } else if (req.user?.role === "STAFF_CLUB" && req.user.club_id !== table.club_id.toString()) {
            return res.status(403).json({ success: false, message: "Nhân viên không có quyền xem bàn của quán khác!" });
        }

        return res.status(200).json({
            success: true,
            data: table
        });
    } catch (error) {
        console.error("Error in getBilliardTableById:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Loi server noi bo"
        });
    }
};

// --- HELPERS ---
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const extractCloudinaryPublicId = (url) => {
    if (!url || typeof url !== 'string') return null;
    try {
        const parts = url.split("/");
        return parts.slice(-2).join("/").replace(/\.[^/.]+$/, "");
    } catch (e) {
        return null;
    }
};

const deleteCloudinaryImages = async (urls) => {
    if (!urls || !Array.isArray(urls) || urls.length === 0) return;
    
    const deletePromises = urls.map(url => {
        const publicId = extractCloudinaryPublicId(url);
        if (publicId) {
            return cloudinary.uploader.destroy(publicId).catch(e => console.error(`Lỗi xóa ảnh Cloudinary ${publicId}:`, e));
        }
        return Promise.resolve();
    });
    
    await Promise.all(deletePromises);
};

const createBilliardTable = async (req, res) => {
    try {
        const { table_type_id, isActive } = req.body;
        const club_id = req.user?.club_id || req.query.club_id || req.body.club_id;
        let { table_number, price, description } = req.body;

        if (club_id && !(await canAccessClub(req, club_id))) {
            return res.status(403).json({
                success: false,
                message: "Ban khong co quyen them ban cho quan nay"
            });
        }

        if (!club_id) {
            return res.status(403).json({ success: false, message: "Không xác định được ID Quán (club_id). Vui lòng đăng nhập lại." });
        }

        if (!table_type_id || !table_number || price === undefined) {
            return res.status(400).json({ success: false, message: "Vui lòng nhập đầy đủ: Tên bàn, Loại bàn và Đơn giá!" });
        }

        table_number = table_number.toString().trim();
        if (!table_number) return res.status(400).json({ success: false, message: "Tên bàn không được để trống" });
        if (table_number.length > 50) return res.status(400).json({ success: false, message: "Tên bàn quá dài (tối đa 50 ký tự)" });

        price = Number(price);
        if (isNaN(price) || price <= 0) return res.status(400).json({ success: false, message: "Đơn giá phải là số lớn hơn 0" });

        if (description) {
            description = description.toString().trim();
            if (description.length > 500) return res.status(400).json({ success: false, message: "Mô tả quá dài (tối đa 500 ký tự)" });
        }

        if (!isValidObjectId(table_type_id)) {
            return res.status(400).json({ success: false, message: "ID loại bàn không hợp lệ" });
        }

        const typeExists = await TableType.findById(table_type_id).lean();
        if (!typeExists) return res.status(400).json({ success: false, message: "Loại bàn không tồn tại" });

        const existingTable = await BilliardTable.exists({ club_id, table_number });
        if (existingTable) {
            return res.status(409).json({ success: false, message: `Bàn "${table_number}" đã tồn tại trong cơ sở này!` });
        }

        const images = req.files ? req.files.map(f => f.path) : [];
        if (images.length > 5) {
            await deleteCloudinaryImages(images);
            return res.status(400).json({ success: false, message: "Chỉ cho phép tải lên tối đa 5 ảnh" });
        }

        const tableStatus = (isActive === "false" || isActive === false) ? "Maintenance" : "Available";

        const tableData = {
            club_id,
            table_type_id,
            table_number,
            price,
            description,
            images,
            status: tableStatus
        };

        const newTable = new BilliardTable(tableData);
        await newTable.save();

        return res.status(201).json({
            success: true,
            message: "Them ban bida moi thanh cong",
            data: newTable
        });
    } catch (error) {
        console.error("Error in createBilliardTable:", error);
        
        if (req.files && req.files.length > 0) {
            await deleteCloudinaryImages(req.files.map(f => f.path));
        }

        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: `Tên bàn "${req.body.table_number}" đã tồn tại trong quán. Vui lòng chọn tên khác!` });
        }
        return res.status(500).json({ success: false, message: error.message || "Lỗi server nội bộ" });
    }
};

const updateBilliardTable = async (req, res) => {
    try {
        const { id } = req.params;
        const club_id = req.user?.club_id || req.query.club_id || req.body.club_id;
        const { table_type_id, status, isActive } = req.body;
        let { table_number, price, description } = req.body;

        if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Thiếu hoặc sai ID bàn" });
        if (!club_id) return res.status(403).json({ success: false, message: "Không xác định được ID Quán." });

        if (req.user?.role === "OWNER") {
            const isOwner = await checkOwnerAccess(club_id, req.user.accountId || req.user.id);
            if (!isOwner) return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        const existing = await BilliardTable.findById(id);
        if (!existing) return res.status(404).json({ success: false, message: "Không tìm thấy bàn để cập nhật" });
        if (existing.club_id.toString() !== club_id) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền sửa bàn của quán khác!" });
        }

        const updateData = {};

        if (table_type_id) {
            if (!isValidObjectId(table_type_id)) return res.status(400).json({ success: false, message: "ID loại bàn không hợp lệ" });
            const typeExists = await TableType.exists({ _id: table_type_id });
            if (!typeExists) return res.status(400).json({ success: false, message: "Loại bàn không tồn tại" });
            updateData.table_type_id = table_type_id;
        }

        if (table_number !== undefined) {
            table_number = table_number.toString().trim();
            if (!table_number) return res.status(400).json({ success: false, message: "Tên bàn không được để trống" });
            if (table_number.length > 50) return res.status(400).json({ success: false, message: "Tên bàn quá dài (tối đa 50 ký tự)" });
            
            const tableWithSameNumber = await BilliardTable.exists({ club_id, table_number, _id: { $ne: id } });
            if (tableWithSameNumber) return res.status(409).json({ success: false, message: `Tên bàn "${table_number}" đã tồn tại trong quán!` });
            updateData.table_number = table_number;
        }

        if (price !== undefined) {
            price = Number(price);
            if (isNaN(price) || price <= 0) return res.status(400).json({ success: false, message: "Đơn giá phải là số lớn hơn 0" });
            updateData.price = price;
        }

        if (description !== undefined) {
            description = description.toString().trim();
            if (description.length > 500) return res.status(400).json({ success: false, message: "Mô tả quá dài" });
            updateData.description = description;
        }

        let tableStatus = existing.status;
        if (status) {
            if (!["Available", "Maintenance", "Holding"].includes(status)) {
                 return res.status(400).json({ success: false, message: "Trạng thái không hợp lệ" });
            }
            tableStatus = status;
        } else if (isActive !== undefined) {
            tableStatus = (isActive === "false" || isActive === false) ? "Maintenance" : "Available";
        }
        
        if (tableStatus === "Maintenance" && existing.status !== "Maintenance") {
            const activeBookings = await Booking.exists({
                table_id: id,
                status: { $in: ["Booked", "Playing"] }
            });
            if (activeBookings) return res.status(400).json({ success: false, message: "Không thể bảo trì bàn vì đang có lịch đặt hoặc đang được chơi." });
        }
        updateData.status = tableStatus;

        let currentImages = existing.images || [];
        let removedList = [];
        
        if (req.body.removedImages) {
            removedList = Array.isArray(req.body.removedImages) ? req.body.removedImages : [req.body.removedImages];
            removedList = removedList.filter(url => currentImages.includes(url));
            if (removedList.length > 0) {
                await deleteCloudinaryImages(removedList);
            }
        }

        const remainingImages = currentImages.filter(img => !removedList.includes(img));
        const newImages = req.files ? req.files.map(f => f.path) : [];
        updateData.images = [...remainingImages, ...newImages];
        
        if (updateData.images.length > 5) {
            if (newImages.length > 0) await deleteCloudinaryImages(newImages);
            return res.status(400).json({ success: false, message: "Bàn chỉ lưu tối đa 5 ảnh" });
        }

        const updatedTable = await BilliardTable.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate("table_type_id", "name");

        return res.status(200).json({
            success: true,
            message: "Cap nhat ban thanh cong",
            data: updatedTable
        });
    } catch (error) {
        console.error("Error in updateBilliardTable:", error);
        if (req.files && req.files.length > 0) await deleteCloudinaryImages(req.files.map(f => f.path));

        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: `Tên bàn "${req.body.table_number}" đã tồn tại!` });
        }
        return res.status(400).json({ success: false, message: error.message || "Lỗi cập nhật bàn" });
    }
};

const deleteBilliardTable = async (req, res) => {
    try {
        const { id } = req.params;
        const club_id = req.user?.club_id || req.query.club_id || req.body.club_id;

        if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Thiếu hoặc sai định dạng ID bàn" });
        if (!club_id) return res.status(403).json({ success: false, message: "Không xác định được ID Quán." });

        if (req.user?.role === "OWNER") {
            const isOwner = await checkOwnerAccess(club_id, req.user.accountId || req.user.id);
            if (!isOwner) return res.status(403).json({ success: false, message: "Bạn không có quyền thao tác trên quán này!" });
        }

        const table = await BilliardTable.findById(id);
        if (!table) return res.status(404).json({ success: false, message: "Không tìm thấy bàn!" });
        if (table.club_id.toString() !== club_id) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền xóa bàn của quán khác!" });
        }

        if (table.status === "In Use") {
            return res.status(400).json({ success: false, message: "Không thể xóa bàn đang được sử dụng!" });
        }

        const activeBookings = await Booking.exists({
            table_id: id,
            status: { $in: ["Booked", "Playing"] }
        });
        if (activeBookings) {
            return res.status(400).json({ success: false, message: "Không thể xóa bàn vì đang có lịch đặt hoặc đang được chơi." });
        }

        if (table.images && table.images.length > 0) {
            await deleteCloudinaryImages(table.images);
        }

        await BilliardTable.findByIdAndDelete(id);

        return res.status(200).json({ success: true, message: "Xóa bàn thành công" });

    } catch (error) {
        console.error("Error in deleteBilliardTable:", error);
        return res.status(500).json({ success: false, message: "Lỗi xóa bàn: " + error.message });
    }
};

const getTableTypes = async (req, res) => {
    try {
        const tableTypes = await TableType.find({});
        return res.status(200).json({
            success: true,
            data: tableTypes
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
    getTableTypes
};
