const Post = require("../models/post.model");
const Club = require("../models/club.model");
const Account = require("../models/account.model");
const Role = require("../models/role.model");
const Notification = require("../models/notification.model");

//customer get approved posts
//Duc
exports.getApprovedPosts = async (req, res) => {
  try {
    const posts = await Post.find({ status: "Approved" })
      .populate("club_id", "name address");

    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Owner create post
//Duc
exports.createPost = async (req, res) => {
  try {
    const ownerAccountId = req.user?.accountId;
    const club_id =
      req.user?.club_id || req.body?.club_id || req.query?.club_id;

    if (!ownerAccountId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!club_id) {
      return res.status(400).json({ message: "Thiếu club_id" });
    }

    // Security: chỉ cho owner tạo bài đăng cho đúng quán thuộc sở hữu
    const ownedClub = await Club.findOne({ _id: club_id, account_id: ownerAccountId }).select("_id name");
    if (!ownedClub) {
      return res.status(403).json({ message: "Bạn không có quyền thao tác bài đăng cho CLB này" });
    }

    const post = new Post({
      club_id,
      title: req.body.title,
      content: req.body.content,
      image_url: req.body.image_url,
      status: "Pending"
    });

    await post.save();

    const staffSystemRole = await Role.findOne({ name: "STAFF_SYSTEM" }).lean();
    const staffAccounts = staffSystemRole
      ? await Account.find({
          role_id: staffSystemRole._id,
          status: "ACTIVE",
        }).lean()
      : [];

    if (staffAccounts.length > 0) {
      await Notification.insertMany(
        staffAccounts.map((staff) => ({
          account_id: staff._id,
          title: "Bai post moi cho duyet!",
          message: `CLB ${ownedClub.name || "moi"} vua dang bai viet moi va dang cho ban phe duyet.`,
          is_read: false,
        }))
      );
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET OWN POSTS
//Duc
exports.getMyPosts = async (req, res) => {
  try {
    const ownerAccountId = req.user?.accountId;
    const club_id = req.user?.club_id || req.query?.club_id;

    if (!ownerAccountId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!club_id) {
      return res.status(400).json({ message: "Thiếu club_id" });
    }

    const ownedClub = await Club.findOne({ _id: club_id, account_id: ownerAccountId }).select("_id");
    if (!ownedClub) {
      return res.status(403).json({ message: "Bạn không có quyền xem bài đăng của CLB này" });
    }

    const posts = await Post.find({ club_id });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Owner UPDATE
//Duc
exports.updatePost = async (req, res) => {
  try {
    const ownerAccountId = req.user?.accountId;
    const club_id =
      req.user?.club_id || req.body?.club_id || req.query?.club_id;

    if (!ownerAccountId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!club_id) {
      return res.status(400).json({ message: "Thiếu club_id" });
    }

    const ownedClub = await Club.findOne({ _id: club_id, account_id: ownerAccountId }).select("_id");
    if (!ownedClub) {
      return res.status(403).json({ message: "Bạn không có quyền cập nhật bài đăng của CLB này" });
    }

    const { club_id: _ignoredClubId, ...restBody } = req.body || {};
    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, club_id },
      {
        ...restBody,
        status: "Pending" // update lại phải duyệt lại
      },
      { new: true }
    );

    if (!post) return res.status(404).json({ message: "Post not found" });

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// owner DELETE
//Duc
exports.deletePost = async (req, res) => {
  try {
    const ownerAccountId = req.user?.accountId;
    const club_id = req.user?.club_id || req.query?.club_id || req.body?.club_id;

    if (!ownerAccountId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!club_id) {
      return res.status(400).json({ message: "Thiếu club_id" });
    }

    const ownedClub = await Club.findOne({ _id: club_id, account_id: ownerAccountId }).select("_id");
    if (!ownedClub) {
      return res.status(403).json({ message: "Bạn không có quyền xóa bài đăng của CLB này" });
    }

    const post = await Post.findOneAndDelete({
      _id: req.params.id,
      club_id
    });

    if (!post) return res.status(404).json({ message: "Post not found" });

    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ================= STAFF =================

// staff GET PENDING POSTS
exports.getPendingPosts = async (req, res) => {
  try {
    const posts = await Post.find({ status: "Pending" })
      .populate("club_id", "name");

    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// staff APPROVE or REJECT
exports.reviewPost = async (req, res) => {
  try {
    const { action, reason } = req.body;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const updateData = {};

    if (action === "approve") {
      updateData.status = "Approved";
      updateData.published_at = new Date();
      updateData.rejected_reason = null;
    }

    if (action === "reject") {
      updateData.status = "Rejected";
      updateData.rejected_reason = reason || "No reason provided";
    }

    const post = await Post.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
