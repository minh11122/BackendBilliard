const Club = require("../../models/club.model");
const Image = require("../../models/image.model");
const BilliardTable = require("../../models/billiard_table.model");
const Feedback = require("../../models/feedback.model");
const Province = require("../../models/province.model");
const District = require("../../models/district.model");
const Booking = require("../../models/booking.model");
const { findActiveSubscriptionForClub } = require("../subscription/subscription.helpers");
const { geocodeAddress } = require("../../utils/geocoding");
const { timeToMinutes } = require("./club.helpers");

const getAllClubs = async (req, res) => {
  try {
    const { keyword, province_code, district_code } = req.query || {};
    const query = { status: "Approved", onboarding_completed: true };

    if (keyword) {
      query.$or = [
        { name: { $regex: keyword, $options: "i" } },
        { address: { $regex: keyword, $options: "i" } },
      ];
    }

    if (province_code) query.province_code = province_code;
    if (district_code) query.district_code = district_code;

    const clubs = await Club.find(query).lean();

    const result = await Promise.all(
      clubs.map(async (club) => {
        if (club.province_code) {
          const province = await Province.findOne({
            code: club.province_code,
          }).lean();
          club.province_name = province ? province.name : null;
        }

        if (club.district_code) {
          const districtDoc = await District.findOne({
            code: club.district_code,
          }).lean();
          club.district_name = districtDoc
            ? districtDoc.name_with_type || districtDoc.name
            : null;
        }

        if (!club.lat || !club.lng) {
          const province = club.province_code
            ? await Province.findOne({ code: club.province_code }).lean()
            : null;
          const districtDoc = club.district_code
            ? await District.findOne({ code: club.district_code }).lean()
            : null;

          const geoData = await geocodeAddress(
            club.address,
            province ? province.name : "",
            districtDoc ? districtDoc.name_with_type || districtDoc.name : "",
          );

          if (geoData) {
            club.lat = geoData.lat;
            club.lng = geoData.lng;
            club.district = geoData.district;
            await Club.updateOne(
              { _id: club._id },
              {
                lat: geoData.lat,
                lng: geoData.lng,
                district: geoData.district,
              },
            );
          }
        }

        const clubImages = await Image.find({
          club_id: club._id,
          image_type: { $in: ["Avatar", "Banner"] },
        }).lean();

        const mainImage =
          clubImages.find((img) => img.image_type === "Avatar") ||
          clubImages.find((img) => img.image_type === "Banner");
        club.avatar = mainImage ? mainImage.image_url : null;

        const tables = await BilliardTable.find({ club_id: club._id })
          .populate("table_type_id")
          .lean();
        if (tables.length > 0) {
          club.priceFrom = Math.min(...tables.map((t) => t.price));
          const types = new Set();
          tables.forEach((t) => {
            if (t.table_type_id && t.table_type_id.name) {
              types.add(t.table_type_id.name);
            }
          });
          club.tableTypes = Array.from(types);
        } else {
          club.priceFrom = 0;
          club.tableTypes = [];
        }

        const feedbacks = await Feedback.find({ club_id: club._id }).lean();
        if (feedbacks.length > 0) {
          const sum = feedbacks.reduce(
            (acc, curr) => acc + (curr.rating || 0),
            0,
          );
          club.rating = parseFloat((sum / feedbacks.length).toFixed(1));
          club.reviewsCount = feedbacks.length;
        } else {
          club.rating = 0;
          club.reviewsCount = 0;
        }

        club.distance = null;

        return club;
      }),
    );

    return res
      .status(200)
      .json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

const getClubById = async (req, res) => {
  try {
    const { id } = req.params || {};
    const { play_date, startTime, duration } = req.query || {};

    const club = await Club.findById(id).lean();

    if (!club) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy câu lạc bộ" });
    }

    const images = await Image.find({ club_id: id }).lean();
    club.images = images;

    if (club.province_code) {
      const province = await Province.findOne({
        code: club.province_code,
      }).lean();
      club.province_name = province ? province.name : null;
    }

    if (club.district_code) {
      const districtDoc = await District.findOne({
        code: club.district_code,
      }).lean();
      club.district_name = districtDoc
        ? districtDoc.name_with_type || districtDoc.name
        : null;
    }

    await BilliardTable.updateMany(
      {
        club_id: id,
        status: "Holding",
        held_until: { $lte: new Date() },
      },
      {
        $set: { status: "Available", held_by: null, held_until: null },
      },
    );

    const tables = await BilliardTable.find({ club_id: id })
      .populate("table_type_id")
      .lean();

    if (play_date && startTime) {
      const reqStartMin = timeToMinutes(startTime);
      const reqDuration = parseInt(duration) || 2;
      const reqEndMin = reqStartMin + reqDuration * 60;

      const targetDate = new Date(play_date);
      targetDate.setHours(0, 0, 0, 0);

      const prevDay = new Date(targetDate);
      prevDay.setDate(prevDay.getDate() - 1);

      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      for (const table of tables) {
        if (table.status === "Maintenance") continue;

        const bookings = await Booking.find({
          table_id: table._id,
          play_date: { $gte: prevDay, $lt: nextDay },
          status: { $in: ["Pending", "Booked", "Playing"] },
        }).lean();

        let isOccupied = false;
        let isHolding = false;

        for (const b of bookings) {
          const bDate = new Date(b.play_date);
          bDate.setHours(0, 0, 0, 0);

          let bStart = timeToMinutes(b.start_time);
          let bEnd = timeToMinutes(b.end_time);

          if (bDate < targetDate) {
            if (bEnd <= bStart && reqStartMin < bEnd) {
              if (b.status === "Booked" || b.status === "Playing") {
                isOccupied = true;
              } else {
                isHolding = true;
              }
            }
            continue;
          }

          if (bEnd <= bStart) bEnd += 24 * 60;

          if (bStart < reqEndMin && bEnd > reqStartMin) {
            if (b.status === "Booked" || b.status === "Playing") {
              isOccupied = true;
            } else {
              isHolding = true;
            }
          }

          if (isOccupied) break;
        }

        if (isOccupied) table.status = "Holding";
        else if (isHolding) table.status = "Holding";
        else table.status = "Available";
      }
    }

    club.tables = tables;
    club.priceFrom =
      tables.length > 0 ? Math.min(...tables.map((t) => t.price)) : 0;

    const activeSub = await findActiveSubscriptionForClub(id, {
      populate: true
    });
    if (activeSub && activeSub.subscription_id) {
      club.subscription_name = activeSub.subscription_id.name;
    }

    const feedbacks = await Feedback.find({ club_id: id })
      .populate("account_id")
      .sort({ created_at: -1 })
      .lean();

    if (feedbacks.length > 0) {
      const sum = feedbacks.reduce((acc, curr) => acc + (curr.rating || 0), 0);
      club.rating = parseFloat((sum / feedbacks.length).toFixed(1));
      club.reviewsCount = feedbacks.length;
      club.feedbacks = feedbacks.map((f) => ({
        id: f._id,
        rating: f.rating,
        comment: f.comment,
        reply: f.reply_content,
        created_at: f.created_at,
        user: f.account_id
          ? {
              name: f.account_id.fullname || f.account_id.username,
              avatar: f.account_id.avatar,
            }
          : { name: "Người dùng ẩn danh" },
      }));
    } else {
      club.rating = 0;
      club.reviewsCount = 0;
    }

    return res.status(200).json({ success: true, data: club });
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

module.exports = {
  getAllClubs,
  getClubById,
};
