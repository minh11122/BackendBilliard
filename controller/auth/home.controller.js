const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const Account  = require("../../models/account.model");
const Role = require("../../models/role.model");
const Otp = require("../../models/otp.model");
const Notification = require("../../models/notification.model");

const Tournament = require("../../models/tournament.model");
const Club = require("../../models/club.model");
const Image = require("../../models/image.model");
const Feedback = require("../../models/feedback.model");
const Post = require("../../models/post.model");

const getLatestTournaments = async (req, res) => {
  try {
    const tournaments = await Tournament.find()
      .sort({ created_at: -1 }) // mới nhất
      .limit(3);

    res.status(200).json({
      success: true,
      data: tournaments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};

const getFeaturedClubs = async (req, res) => {
  try {
    const clubs = await Club.find({ status: "Approved", onboarding_completed: true })
      .sort({ created_at: -1 })
      .limit(4)
      .lean();

    const result = await Promise.all(
      clubs.map(async (club) => {
        // lấy ảnh từ bảng Image
        const clubImages = await Image.find({
          club_id: club._id,
          image_type: { $in: ["Avatar", "Banner"] },
        }).lean();

        const mainImage =
          clubImages.find((img) => img.image_type === "Avatar") ||
          clubImages.find((img) => img.image_type === "Banner");

        club.avatar = mainImage ? mainImage.image_url : null;

        return club;
      })
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Lỗi featured clubs:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};

const getTopFeedbacks = async (req, res) => {
  try {
    const feedbacks = await Feedback.find({ rating: 5 })
      .sort({ created_at: -1 })
      .limit(3)
      .populate("account_id", "full_name avatar") // lấy info user
      .lean();

    const result = feedbacks.map((fb) => ({
      _id: fb._id,
      rating: fb.rating,
      comment: fb.comment,
      created_at: fb.created_at,
      user_name: fb.account_id?.full_name || "Người dùng",
      user_avatar:
        fb.account_id?.avatar ||
        `https://i.pravatar.cc/150?u=${fb._id}`,
    }));

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Lỗi feedback:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};

const getLatestPosts = async (req, res) => {
  try {
    const posts = await Post.find({
      status: "Approved",
      published_at: { $ne: null },
    })
      .sort({ published_at: -1 })
      .limit(3)
      .populate("club_id", "name")
      .lean();

    const result = posts.map((post) => ({
      _id: post._id,
      title: post.title,
      content: post.content,
      image: post.image_url,
      published_at: post.published_at,
      club_name: post.club_id?.name || "CLB",
    }));

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Lỗi posts:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};

module.exports = {
  getLatestTournaments,
  getFeaturedClubs,
  getTopFeedbacks,
  getLatestPosts
};

