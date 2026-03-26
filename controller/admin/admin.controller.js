const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const Club = require("../../models/club.model");
const Subscription = require("../../models/subscription.model");
const SubscriptionAccount  = require("../../models/subcription_account.model");


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
// BAN account
const toggleBanAccount = async (req, res) => {
  try {
    const { id } = req.params;

    const account = await Account.findById(id);

    if (!account) {
      return res.status(404).json({ message: "Không tìm thấy account" });
    }

    account.status =
      account.status === "BANNED" ? "ACTIVE" : "BANNED";

    await account.save();

    res.json({
      message:
        account.status === "BANNED"
          ? "Đã ban account"
          : "Đã bỏ ban account",
      data: account,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE (soft delete)
const deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;

    const account = await Account.findByIdAndUpdate(
      id,
      { status: "DELETED" },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({ message: "Không tìm thấy account" });
    }

    res.json({
      message: "Đã xóa account",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createSubscription = async (req, res) => {
  try {
    const { name, price, description, discount_percent } = req.body;

    const newSub = new Subscription({
      name,
      price,
      description,
      discount_percent,
      created_at: new Date(),
      created_by: req.user?._id // nếu có auth
    });

    await newSub.save();

    return res.status(201).json({
      message: "Tạo gói thành công",
      data: newSub,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};

const getSubscriptionById = async (req, res) => {
  try {
    const { id } = req.params;

    const sub = await Subscription.findById(id);

    if (!sub) {
      return res.status(404).json({
        message: "Không tìm thấy gói",
      });
    }

    return res.json({
      message: "Lấy chi tiết gói thành công",
      data: sub,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};

const updateSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, description, discount_percent } = req.body;

    const updated = await Subscription.findByIdAndUpdate(
      id,
      {
        name,
        price,
        description,
        discount_percent,
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        message: "Không tìm thấy gói",
      });
    }

    return res.json({
      message: "Cập nhật gói thành công",
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};

const deleteSubscription = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Subscription.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        message: "Không tìm thấy gói",
      });
    }

    return res.json({
      message: "Xóa gói thành công",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};

const getRevenueWeb = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search = "",
      from,
      to,
      sortBy = "purchase_date",
      order = "desc",
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    const match = {};

    // filter theo thời gian
    if (from && to) {
      match.purchase_date = {
        $gte: from.includes("T") ? new Date(from) : new Date(`${from}T00:00:00.000+07:00`),
        $lte: to.includes("T") ? new Date(to) : new Date(`${to}T23:59:59.999+07:00`),
      };
    }

    const pipeline = [
      // join club
      {
        $lookup: {
          from: "clubs",
          localField: "club_id",
          foreignField: "_id",
          as: "club",
        },
      },
      { $unwind: "$club" },

      // join subscription
      {
        $lookup: {
          from: "subscriptions",
          localField: "subscription_id",
          foreignField: "_id",
          as: "subscription",
        },
      },
      { $unwind: "$subscription" },

      // search theo tên quán / gói
      {
        $match: {
          ...match,
          $or: [
            { "club.name": { $regex: search, $options: "i" } },
            { "subscription.name": { $regex: search, $options: "i" } },
          ],
        },
      },

      // sort
      {
        $sort: {
          [sortBy]: order === "asc" ? 1 : -1,
        },
      },

      // pagination
      { $skip: (page - 1) * limit },
      { $limit: limit },

      // output
      {
        $project: {
          _id: 1,
          club_name: "$club.name",
          subscription_name: "$subscription.name",

          purchase_price: 1,
          purchase_date: 1,
          expire_date: 1,
          status: 1,

          // full data nếu cần
          subscription_id: 1,
          club_id: 1,
          account_id: 1,
        },
      },
    ];

    const data = await SubscriptionAccount.aggregate(pipeline);

    const total = await SubscriptionAccount.countDocuments(match);

    return res.json({
      message: "Danh sách doanh thu web",
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getRevenueWebSummary = async (req, res) => {
  try {
    const { from, to } = req.query;

    const match = {};

    if (from && to) {
      match.purchase_date = {
        $gte: from.includes("T") ? new Date(from) : new Date(`${from}T00:00:00.000+07:00`),
        $lte: to.includes("T") ? new Date(to) : new Date(`${to}T23:59:59.999+07:00`),
      };
    }

    const result = await SubscriptionAccount.aggregate([
      { $match: match },

      {
        $group: {
          _id: null,
          total_revenue: { $sum: "$purchase_price" },
          total_orders: { $sum: 1 },
        },
      },
    ]);

    return res.json({
      message: "Tổng doanh thu web",
      data: result[0] || {
        total_revenue: 0,
        total_orders: 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server" });
  }
};

module.exports = {
  getAllAccountsForAdmin,
  getAllClubs,
  getAllSubscriptions,
  createSubscription,
  getSubscriptionById,
  updateSubscription,
  deleteSubscription,
  deleteAccount,
  toggleBanAccount,
  getRevenueWeb,
  getRevenueWebSummary
};