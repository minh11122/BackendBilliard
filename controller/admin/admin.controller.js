const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const Club = require("../../models/club.model");
const Subscription = require("../../models/subscription.model");

// ADMIN - lấy danh sách account (trừ ADMIN)
const getAllAccountsForAdmin = async (req, res) => {
  try {
    const adminRole = await Role.findOne({ name: "ADMIN" });

    const {
      page = 1,
      limit = 10,
      search,
      role,
      status,
      sortBy = "created_at",
      order = "desc",
    } = req.query;

    const query = {
      role_id: { $ne: adminRole._id },
      status: { $ne: "DELETED" },
    };

    // search
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: "i" } },
        { fullname: { $regex: search, $options: "i" } },
      ];
    }

    // filter role
    if (role && role !== "ALL") {
      const roleDoc = await Role.findOne({ name: role });
      if (roleDoc) query.role_id = roleDoc._id;
    }

    // filter status
    if (status && status !== "ALL") {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const accounts = await Account.find(query)
      .populate("role_id", "name")
      .select("-password_hash")
      .sort({ [sortBy]: order === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Account.countDocuments(query);

    res.json({
      message: "Lấy danh sách account thành công",
      data: accounts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAllClubs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      sortBy = "created_at",
      order = "desc",
    } = req.query;

    const query = {};

    // search theo tên + địa chỉ
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
      ];
    }

    // filter status
    if (status && status !== "ALL") {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const clubs = await Club.find(query)
      .populate({
        path: "account_id",
        select: "fullname email phone",
      })
      .sort({ [sortBy]: order === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Club.countDocuments(query);

    res.json({
      message: "Lấy danh sách club thành công",
      data: clubs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const getAllSubscriptions = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search = "",
      sortBy = "created_at",
      order = "desc",
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    // 🔍 Search
    const query = {};
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    // 🔃 Sort
    const sort = {
      [sortBy]: order === "asc" ? 1 : -1,
    };

    // 📊 Count total
    const total = await Subscription.countDocuments(query);

    // 📦 Data
    const data = await Subscription.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      message: "Lấy danh sách gói thành công",
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};


module.exports = {
  getAllAccountsForAdmin,
  getAllClubs,
  getAllSubscriptions,
};