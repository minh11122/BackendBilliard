const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const bcrypt = require("bcryptjs");
const { canAccessClub } = require("./club.helpers");


const getActiveStaffClub = async (req, res) => {
    try {
        //Lấy club_id do chủ quán chọn từ query URL (?club_id=...)
        const { club_id } = req.query;
        const ownerAccountId = req.user.accountId;

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền hoặc không tìm thấy quán này" });
        }

        const staffList = await Account.find({
            club_id: club_id,
            status: { $in: ["ACTIVE"] }
        }).select("-password_hash").sort({ created_at: -1 });

        res.json({ message: "Lấy danh sách nhân viên quán thành công", data: staffList });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getBannedStaffClub = async (req, res) => {
    try {
        const { club_id } = req.query;
        const ownerAccountId = req.user.accountId;

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền truy cập quán này" });
        }

        const bannedStaffList = await Account.find({
            club_id: club_id,
            status: "BANNED"
        }).select("-password_hash").sort({ updated_at: -1 });

        res.json({ message: "Lấy danh sách nhân viên quán bị cấm thành công", data: bannedStaffList });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createStaffClub = async (req, res) => {
    try {
        // 🔥 THAY ĐỔI Ở ĐÂY: Frontend phải gửi club_id (quán đang chọn) trong body
        const { club_id, fullname, email, phone, password } = req.body;
        const ownerAccountId = req.user.accountId;

        if (!(await canAccessClub(req, club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền thêm nhân viên cho quán này" });
        }

        if (!fullname || !email || !password) {
            return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin" });
        }

        if (fullname.trim().length < 2 || fullname.trim().length > 50) {
            return res.status(400).json({ message: "Họ tên phải từ 2 đến 50 ký tự" });
        }

        if (phone && phone.trim() !== "") {
            if (!/^0[35789]\d{8}$/.test(phone.trim())) {
                return res.status(400).json({ message: "Số điện thoại không hợp lệ (phải là 10 số theo định dạng Việt Nam)" });
            }
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).+$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ message: "Mật khẩu phải bao gồm chữ hoa, chữ thường và ký tự đặc biệt" });
        }

        const orConditions = [{ email }];
        if (phone && phone.trim() !== "") {
            orConditions.push({ phone: phone.trim() });
        }

        const existingAccount = await Account.findOne({ $or: orConditions });
        if (existingAccount) {
            return res.status(400).json({ message: "Email hoặc Số điện thoại đã được sử dụng" });
        }

        // 🔥 THAY ĐỔI Ở ĐÂY: Tìm chính xác Role STAFF_CLUB
        const role = await Role.findOne({ name: "STAFF_CLUB" });
        if (!role) {
            return res.status(500).json({ message: "Hệ thống chưa thiết lập Role STAFF_CLUB" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newStaff = await Account.create({
            fullname,
            email,
            phone: phone || null,
            password_hash: hashedPassword,
            provider: "local",
            status: "ACTIVE",
            role_id: role._id, // Gắn role STAFF_CLUB
            club_id: club_id,  // Gắn nhân viên vào đúng quán chủ đang chọn
        });

        const staffObj = newStaff.toObject();
        delete staffObj.password_hash;

        res.status(201).json({ message: "Thêm nhân viên quán thành công", data: staffObj });
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({ message: `${field === "email" ? "Email" : "Số điện thoại"} đã tồn tại` });
        }
        res.status(500).json({ message: error.message });
    }
};

//Banned nhân viên quán
const banStaffClub = async (req, res) => {
    try {
        const { id } = req.params;
        const ownerAccountId = req.user.accountId;

        const staffToBan = await Account.findById(id);
        if (!staffToBan) return res.status(404).json({ message: "Không tìm thấy nhân viên" });

        if (!(await canAccessClub(req, staffToBan.club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền thao tác trên nhân viên này" });
        }

        staffToBan.status = "BANNED";
        await staffToBan.save();

        res.json({ message: "Đã cấm (Ban) nhân viên quán thành công", data: staffToBan });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

//Unbanned nhân viên quán
const unbanStaffClub = async (req, res) => {
    try {
        const { id } = req.params;
        const ownerAccountId = req.user.accountId;

        const staffToUnban = await Account.findById(id);
        if (!staffToUnban || staffToUnban.status !== "BANNED") {
            return res.status(404).json({ message: "Không tìm thấy nhân viên trong danh sách bị cấm" });
        }

        if (!(await canAccessClub(req, staffToUnban.club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền thao tác trên nhân viên này" });
        }

        staffToUnban.status = "ACTIVE";
        await staffToUnban.save();

        res.json({ message: "Đã hủy cấm (Unban) nhân viên quán thành công", data: staffToUnban });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

//Xem chi tiết 1 nhân viên quán
const getStaffClubById = async (req, res) => {
    try {
        const { id } = req.params;
        const ownerAccountId = req.user.accountId;

        // Tìm nhân viên (loại bỏ trường password_hash để bảo mật)
        const staff = await Account.findById(id).select("-password_hash");

        if (!staff) {
            return res.status(404).json({ message: "Không tìm thấy nhân viên" });
        }

        // Kiểm tra quyền sở hữu của chủ quán đối với nhân viên này
        if (!(await canAccessClub(req, staff.club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền xem thông tin nhân viên này" });
        }

        res.json({ message: "Lấy thông tin nhân viên thành công", data: staff });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

//Cập nhật thông tin nhân viên quán
const updateStaffClub = async (req, res) => {
    try {
        const { id } = req.params;
        // Không cho phép đổi email để tránh lằng nhằng việc login/trùng lặp
        const { fullname, phone, password, status } = req.body;
        const ownerAccountId = req.user.accountId;

        const staff = await Account.findById(id);
        if (!staff) {
            return res.status(404).json({ message: "Không tìm thấy nhân viên" });
        }

        // Kiểm tra quyền sở hữu
        if (!(await canAccessClub(req, staff.club_id))) {
            return res.status(403).json({ message: "Bạn không có quyền cập nhật thông tin nhân viên này" });
        }

        // Cập nhật các trường thông tin nếu có gửi lên
        if (fullname) {
            if (fullname.trim().length < 2 || fullname.trim().length > 50) {
                return res.status(400).json({ message: "Họ tên phải từ 2 đến 50 ký tự" });
            }
            staff.fullname = fullname;
        }

        // Xử lý phone (nếu chuỗi rỗng thì chuyển thành null, nếu có thì gán vào)
        if (phone !== undefined) {
            if (phone !== "" && phone !== null) {
                if (!/^0[35789]\d{8}$/.test(phone.trim())) {
                    return res.status(400).json({ message: "Số điện thoại không hợp lệ (phải là 10 số theo định dạng Việt Nam)" });
                }
                staff.phone = phone.trim();
            } else {
                staff.phone = null;
            }
        }

        if (status) staff.status = status;

        // Nếu chủ quán muốn đổi mật khẩu cho nhân viên
        if (password) {
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).+$/;
            if (!passwordRegex.test(password)) {
                return res.status(400).json({ message: "Mật khẩu phải bao gồm chữ hoa, chữ thường và ký tự đặc biệt" });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            staff.password_hash = hashedPassword;
        }

        await staff.save();

        const staffObj = staff.toObject();
        delete staffObj.password_hash;

        res.json({ message: "Cập nhật thông tin nhân viên thành công", data: staffObj });
    } catch (error) {
        // Bắt lỗi trùng số điện thoại nếu user đổi sang SĐT của người khác
        if (error.code === 11000) {
            return res.status(400).json({ message: "Số điện thoại này đã được sử dụng" });
        }
        res.status(500).json({ message: error.message });
    }
};
module.exports = {
    getActiveStaffClub,
    getBannedStaffClub,
    createStaffClub,
    banStaffClub,
    unbanStaffClub,
    getStaffClubById,
    updateStaffClub
};