const mongoose = require("mongoose");
const TransactionHistory = require("../models/transiction_history.model");
const Club = require("../models/club.model");

/**
 * Customer: lấy lịch sử giao dịch của chính tài khoản đang đăng nhập.
 */
const getMyTransferHistory = async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const accountObjectId = new mongoose.Types.ObjectId(accountId);

    const rows = await TransactionHistory.aggregate([
      { $match: { account_id: accountObjectId } },
      { $sort: { transaction_time: -1 } },

      {
        $lookup: {
          from: "bookings",
          localField: "booking_id",
          foreignField: "_id",
          as: "booking",
        },
      },
      { $unwind: { path: "$booking", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "billiard_tables",
          localField: "booking.table_id",
          foreignField: "_id",
          as: "table",
        },
      },
      { $unwind: { path: "$table", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "clubs",
          localField: "table.club_id",
          foreignField: "_id",
          as: "club",
        },
      },
      { $unwind: { path: "$club", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          order_code: 1,
          amount: 1,
          description: 1,
          transaction_type: 1,
          transaction_time: 1,
          status: 1,

          booking: {
            _id: "$booking._id",
            code_number: "$booking.code_number",
          },
          table: {
            _id: "$table._id",
            table_number: "$table.table_number",
          },
          club: {
            _id: "$club._id",
            name: "$club.name",
            address: "$club.address",
          },
        },
      },
    ]);

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getMyTransferHistory:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

/**
 * Owner / Staff-club: lấy lịch sử giao dịch của club
 * (bao gồm giao dịch booking + lệ phí tham gia giải đấu).
 */
const getClubTransferHistory = async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    const role = req.user?.role;
    const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;

    if (!accountId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!club_id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    if (role === "OWNER") {
      // Security: chỉ cho phép owner truy cập lịch sử của club mà họ sở hữu
      const ownedClub = await Club.findOne({ _id: club_id, account_id: accountId }).select("_id");
      if (!ownedClub) {
        return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập club này" });
      }
    }

    const clubObjectId = new mongoose.Types.ObjectId(club_id);

    const bookingRows = await TransactionHistory.aggregate([
      { $match: { booking_id: { $ne: null } } },

      {
        $lookup: {
          from: "bookings",
          localField: "booking_id",
          foreignField: "_id",
          as: "booking",
        },
      },
      { $unwind: "$booking" },

      {
        $lookup: {
          from: "billiard_tables",
          localField: "booking.table_id",
          foreignField: "_id",
          as: "table",
        },
      },
      { $unwind: "$table" },

      { $match: { "table.club_id": clubObjectId } },

      {
        $lookup: {
          from: "clubs",
          localField: "table.club_id",
          foreignField: "_id",
          as: "club",
        },
      },
      { $unwind: "$club" },

      {
        $lookup: {
          from: "accounts",
          localField: "account_id",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: { path: "$account", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          order_code: 1,
          amount: 1,
          description: 1,
          transaction_type: 1,
          transaction_time: 1,
          status: 1,
          tournament: null,

          player: {
            _id: "$account._id",
            fullname: "$account.fullname",
            email: "$account.email",
            phone: "$account.phone",
          },

          booking: {
            _id: "$booking._id",
            code_number: "$booking.code_number",
          },
          table: {
            _id: "$table._id",
            table_number: "$table.table_number",
          },
          club: {
            _id: "$club._id",
            name: "$club.name",
            address: "$club.address",
          },
        },
      },
    ]);

    const tournamentRows = await TransactionHistory.aggregate([
      { $match: { transaction_type: "TOURNAMENT_FEE" } },
      {
        $addFields: {
          tournament_id: {
            $convert: {
              input: { $arrayElemAt: [{ $split: ["$description", ":"] }, 1] },
              to: "objectId",
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $lookup: {
          from: "tournaments",
          localField: "tournament_id",
          foreignField: "_id",
          as: "tournament",
        },
      },
      { $unwind: { path: "$tournament", preserveNullAndEmptyArrays: false } },
      { $match: { "tournament.club_id": clubObjectId } },
      {
        $lookup: {
          from: "clubs",
          localField: "tournament.club_id",
          foreignField: "_id",
          as: "club",
        },
      },
      { $unwind: { path: "$club", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "accounts",
          localField: "account_id",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: { path: "$account", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          order_code: 1,
          amount: 1,
          description: 1,
          transaction_type: 1,
          transaction_time: 1,
          status: 1,
          player: {
            _id: "$account._id",
            fullname: "$account.fullname",
            email: "$account.email",
            phone: "$account.phone",
          },
          booking: null,
          table: null,
          tournament: {
            _id: "$tournament._id",
            name: "$tournament.name",
          },
          club: {
            _id: "$club._id",
            name: "$club.name",
            address: "$club.address",
          },
        },
      },
    ]);

    const rows = [...bookingRows, ...tournamentRows].sort(
      (a, b) =>
        new Date(b.transaction_time || 0).getTime() -
        new Date(a.transaction_time || 0).getTime()
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getClubTransferHistory:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

module.exports = {
  getMyTransferHistory,
  getClubTransferHistory,
};

