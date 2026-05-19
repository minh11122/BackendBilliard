const Notification = require("../../models/notification.model");

const getNotifications = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({
      account_id: accountId,
    })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({
      account_id: accountId,
    });

    return res.json({
      message: "Lấy danh sách notification thành công",
      data: notifications,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      id,
      { is_read: true },
      { new: true },
    );

    if (!notification) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy notification" });
    }

    return res.json({
      message: "Đã đánh dấu đã đọc",
      data: notification,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    await Notification.updateMany(
      { account_id: accountId, is_read: false },
      { $set: { is_read: true } },
    );

    return res.json({
      message: "Đã đánh dấu tất cả là đã đọc",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndDelete(id);

    if (!notification) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy notification" });
    }

    return res.json({
      message: "Xóa notification thành công",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteAllNotifications = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    await Notification.deleteMany({ account_id: accountId });

    return res.json({
      message: "Đã xóa tất cả notification",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const countUnread = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const count = await Notification.countDocuments({
      account_id: accountId,
      is_read: false,
    });

    return res.json({
      unread: count,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  countUnread,
};
