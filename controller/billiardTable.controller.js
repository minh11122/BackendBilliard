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
        const club_id = req.query.club_id || req.user?.club_id || req.body?.club_id;
        const { page = 1, limit = 5, search, table_type_id, status } = req.query;

        if (!club_id) {
            return res.status(400).json({
                success: false,
                message: "Khong xac dinh duoc club_id."
            });
        }

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
        if (!table) {
            return res.status(404).json({
                success: false,
                message: "Khong tim thay ban"
            });
        }

        if (!(await canAccessClub(req, table.club_id))) {
            return res.status(403).json({
                success: false,
                message: "Ban khong co quyen xem ban nay"
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
            message: error.message || "Loi server noi bo"
        });
    }
};

const createBilliardTable = async (req, res) => {
    try {
        const { table_type_id, table_number, price, description, isActive } = req.body;
        const club_id = req.body.club_id || req.query.club_id || req.user?.club_id;

        if (club_id && !(await canAccessClub(req, club_id))) {
            return res.status(403).json({
                success: false,
                message: "Ban khong co quyen them ban cho quan nay"
            });
        }

        if (!club_id) {
            return res.status(400).json({
                success: false,
                message: "Khong xac dinh duoc club_id."
            });
        }

        if (!table_type_id || !table_number || !price) {
            return res.status(400).json({
                success: false,
                message: "Vui long nhap day du ten ban, loai ban va don gia."
            });
        }

        const images = req.files ? req.files.map((file) => file.path) : [];
        const tableStatus = isActive === "false" ? "Maintenance" : "Available";

        const tableData = {
            club_id,
            table_type_id,
            table_number,
            price: Number(price),
            description,
            images,
            status: tableStatus
        };

        const newTable = await tableService.createTable(tableData);

        return res.status(201).json({
            success: true,
            message: "Them ban bida moi thanh cong",
            data: newTable
        });
    } catch (error) {
        console.error("Error in createBilliardTable:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `Ten ban "${req.body.table_number}" da ton tai trong quan.`
            });
        }

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "Loi server noi bo"
        });
    }
};

const updateBilliardTable = async (req, res) => {
    try {
        const { id } = req.params;
        const { table_type_id, table_number, price, description, isActive, status } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: "Thieu ID ban" });
        }

        const club_id = req.body.club_id || req.query.club_id || req.user?.club_id;

        if (club_id && !(await canAccessClub(req, club_id))) {
            return res.status(403).json({
                success: false,
                message: "Ban khong co quyen cap nhat ban cho quan nay"
            });
        }

        if (!club_id) {
            return res.status(400).json({
                success: false,
                message: "Khong xac dinh duoc club_id."
            });
        }

        if (!table_type_id || !table_number || !price) {
            return res.status(400).json({
                success: false,
                message: "Vui long nhap day du ten ban, loai ban va don gia."
            });
        }

        const existing = await BilliardTable.findOne({ _id: id, club_id }).populate("table_type_id", "name");
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Khong tim thay ban"
            });
        }

        const currentImages = existing.images || [];
        let removedList = [];
        const removedImages = req.body.removedImages;
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
        const tableStatus = status || (isActive === "false" ? "Maintenance" : "Available");

        if (tableStatus === "Maintenance") {
            const activeBookings = await Booking.countDocuments({
                table_id: id,
                status: { $in: ["Booked", "Playing"] }
            });
            if (activeBookings > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Khong the chuyen ban sang bao tri vi dang co lich dat hoac dang duoc choi."
                });
            }
        }

        const updateData = {
            club_id,
            table_type_id,
            table_number,
            price: Number(price),
            description,
            status: tableStatus,
            images: [...remainingImages, ...newImages]
        };

        const updatedTable = await tableService.updateTable(id, updateData);

        if (!updatedTable) {
            return res.status(404).json({ success: false, message: "Khong tim thay ban de cap nhat" });
        }

        return res.status(200).json({
            success: true,
            message: "Cap nhat ban thanh cong",
            data: updatedTable
        });
    } catch (error) {
        console.error("Error in updateBilliardTable:", error);

        if (error.code === 11000 || error.message.includes("ton tai")) {
            return res.status(409).json({
                success: false,
                message: `Ten ban "${req.body.table_number}" da ton tai trong quan.`
            });
        }

        const statusCode = error.statusCode || 400;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "Loi cap nhat ban"
        });
    }
};

const deleteBilliardTable = async (req, res) => {
    try {
        const { id } = req.params;
        const table = await BilliardTable.findById(id);
        if (!table) {
            return res.status(404).json({ success: false, message: "Khong tim thay ban" });
        }

        if (!(await canAccessClub(req, table.club_id))) {
            return res.status(403).json({
                success: false,
                message: "Ban khong co quyen xoa ban nay"
            });
        }

        const club_id = table.club_id;
        const activeBookings = await Booking.countDocuments({
            table_id: id,
            status: { $in: ["Booked", "Playing"] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({
                success: false,
                message: "Khong the xoa ban vi dang co lich dat hoac dang duoc choi."
            });
        }

        try {
            if (table.images && table.images.length > 0) {
                for (const url of table.images) {
                    const publicId = url.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, "");
                    await cloudinary.uploader.destroy(publicId);
                }
            }
        } catch (e) {
            console.error("Loi xoa anh khi delete ban:", e);
        }

        const deleted = await BilliardTable.findOneAndDelete({ _id: id, club_id });
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Khong tim thay ban" });
        }

        return res.status(200).json({
            success: true,
            message: "Xoa ban thanh cong"
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

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
