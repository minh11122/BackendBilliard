const Club = require("../../models/club.model");
const Image = require("../../models/image.model");
const Province = require("../../models/province.model");
const District = require("../../models/district.model");
const Notification = require("../../models/notification.model");
const Account = require("../../models/account.model");
const { findActiveSubscriptionForClub } = require("../../utils/subscription.util");
const Role = require("../../models/role.model");
const { geocodeAddress } = require("../../utils/geocoding");

const getClubsByAccount = async (req, res) => {
  try {
    const account_id = req.user?.accountId || req.query.account_id;

    if (!account_id) {
      return res.status(400).json({
        success: false,
        message: "Không tìm thấy thông tin tài khoản (account_id)",
      });
    }

    const clubs = await Club.find({ account_id }).lean();

    const result = await Promise.all(
      clubs.map(async (club) => {
        const clubImages = await Image.find({
          club_id: club._id,
          image_type: { $in: ["Avatar", "Banner"] },
        }).lean();

        const mainImage =
          clubImages.find((img) => img.image_type === "Avatar") ||
          clubImages.find((img) => img.image_type === "Banner");
        club.avatar = mainImage ? mainImage.image_url : null;

        let realPlanType = "free";
        const activeSub = await findActiveSubscriptionForClub(club._id, {
          populate: true
        });
        if (activeSub && activeSub.subscription_id) {
          const subName = activeSub.subscription_id.name.toLowerCase();
          if (subName.includes("basic")) realPlanType = "basic";
          if (subName.includes("pro")) realPlanType = "pro";
        }

        if (club.plan_type !== realPlanType) {
          await Club.updateOne(
            { _id: club._id },
            { $set: { plan_type: realPlanType } },
          );
          club.plan_type = realPlanType;
        }

        return club;
      }),
    );

    return res.status(200).json({
      success: true,
      message: "Lấy danh sách quán thành công",
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách CLB của chủ quán:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

const registerClub = async (req, res) => {
  try {
    const {
      name,
      address,
      phone,
      tax_code,
      description,
      legalDocuments,
      opening_time,
      closing_time,
      lat: frontendLat,
      lng: frontendLng,
      province_code,
      district_code,
      province_name,
      district_name,
      amenities,
    } = req.body;

    if (!req.user || !req.user.accountId) {
      return res.status(401).json({
        success: false,
        message: "Không xác thực được người dùng",
      });
    }

    if (!name || !address || !phone || !tax_code) {
      return res.status(400).json({
        success: false,
        message:
          "Vui lòng nhập đầy đủ tên CLB, địa chỉ, số điện thoại và mã số thuế",
      });
    }

    const existingClub = await Club.findOne({ tax_code });
    if (existingClub) {
      return res.status(400).json({
        success: false,
        message: "Mã số thuế đã tồn tại",
      });
    }

    let lat = frontendLat || 0;
    let lng = frontendLng || 0;
    let districtNameField = "";

    if (!lat || !lng) {
      try {
        const province = await Province.findOne({ code: province_code }).lean();
        const districtDoc = await District.findOne({
          code: district_code,
        }).lean();

        const geoData = await geocodeAddress(
          address,
          province ? province.name : "",
          districtDoc ? districtDoc.name_with_type || districtDoc.name : "",
        );

        if (geoData) {
          lat = geoData.lat;
          lng = geoData.lng;
          districtNameField = geoData.district;
        }
      } catch (err) {
        console.warn("Lỗi geocode khi đăng ký:", err.message);
      }
    } else {
      const districtDoc = await District.findOne({ code: district_code }).lean();
      districtNameField = districtDoc
        ? districtDoc.name_with_type || districtDoc.name
        : "";
    }

    const club = await Club.create({
      account_id: req.user.accountId,
      name,
      address,
      phone,
      tax_code,
      lat,
      lng,
      district: districtNameField,
      province_code,
      district_code,
      province_name,
      district_name,
      description: description || "",
      opening_time: opening_time || "08:00",
      closing_time: closing_time || "23:30",
      amenities: amenities || [],
      status: "Pending",
    });

    if (Array.isArray(legalDocuments) && legalDocuments.length > 0) {
      const images = legalDocuments
        .filter((url) => !!url)
        .map((url) => ({
          club_id: club._id,
          image_url: url,
          image_type: "legal documents",
        }));

      if (images.length > 0) {
        await Image.insertMany(images);
      }
    }

    const createdClub = await Club.findById(club._id).lean();

    const staffSystemRole = await Role.findOne({
      name: "STAFF_SYSTEM",
    }).lean();
    const staffAccounts = staffSystemRole
      ? await Account.find({
          role_id: staffSystemRole._id,
          status: "ACTIVE",
        }).lean()
      : [];

    if (staffAccounts && staffAccounts.length > 0) {
      const notifications = staffAccounts.map((staff) => ({
        account_id: staff._id,
        title: "CLB mới chờ duyệt!",
        message: `Câu lạc bộ ${createdClub.name || "mới"} vừa đăng ký và đang chờ bạn phê duyệt.`,
        is_read: false,
      }));
      await Notification.insertMany(notifications);
    }

    return res.status(201).json({
      success: true,
      message: "Đăng ký câu lạc bộ thành công, vui lòng chờ duyệt",
      data: createdClub,
    });
  } catch (error) {
    console.error("Lỗi khi đăng ký CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

const updateClub = async (req, res) => {
  try {
    const { id } = req.params;
    const account_id = req.user.accountId;
    const {
      name,
      address,
      phone,
      description,
      opening_time,
      closing_time,
      lat,
      lng,
      province_code,
      district_code,
      province_name,
      district_name,
      avatar,
      backgrounds,
      amenities,
      deposit_percentage,
      legalDocuments,
    } = req.body;

    const club = await Club.findOne({ _id: id, account_id });
    if (!club) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy câu lạc bộ hoặc bạn không có quyền sửa",
      });
    }

    if (name) club.name = name;
    if (address) club.address = address;
    if (phone) club.phone = phone;
    if (description) club.description = description;
    if (opening_time) club.opening_time = opening_time;
    if (closing_time) club.closing_time = closing_time;
    if (lat !== undefined) club.lat = lat;
    if (lng !== undefined) club.lng = lng;
    if (province_code) club.province_code = province_code;
    if (district_code) club.district_code = district_code;
    if (province_name) club.province_name = province_name;
    if (district_name) club.district_name = district_name;
    if (deposit_percentage !== undefined) {
      club.deposit_percentage = Number(deposit_percentage);
    }
    if (amenities !== undefined) {
      club.amenities = Array.isArray(amenities) ? amenities : [amenities];
    }

    if (province_code || district_code) {
      const districtDoc = await District.findOne({ code: district_code }).lean();
      if (districtDoc) {
        club.district = districtDoc.name_with_type || districtDoc.name;
      }
    }

    if (club.status === "Rejected") {
      club.status = "Pending";
      club.reject_reason = null;
    }

    await club.save();

    if (avatar) {
      await Image.deleteMany({ club_id: id, image_type: "Avatar" });
      await Image.create({
        club_id: id,
        image_url: avatar,
        image_type: "Avatar",
      });
    }

    if (Array.isArray(backgrounds)) {
      await Image.deleteMany({ club_id: id, image_type: "Background" });
      if (backgrounds.length > 0) {
        const bgImages = backgrounds.map((url) => ({
          club_id: id,
          image_url: url,
          image_type: "Background",
        }));
        await Image.insertMany(bgImages);
      }
    }

    if (Array.isArray(legalDocuments)) {
      await Image.deleteMany({ club_id: id, image_type: "legal documents" });
      if (legalDocuments.length > 0) {
        const legalImages = legalDocuments
          .filter((url) => !!url)
          .map((url) => ({
            club_id: id,
            image_url: url,
            image_type: "legal documents",
          }));

        if (legalImages.length > 0) {
          await Image.insertMany(legalImages);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật thông tin thành công",
      data: club,
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

const completeOnboarding = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;

    const club = await Club.findOne({ _id: id, account_id: accountId });
    if (!club) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy quán hoặc bạn không có quyền",
      });
    }

    let realPlanType = "free";
    const activeSub = await findActiveSubscriptionForClub(id, {
      populate: true
    });

    if (activeSub && activeSub.subscription_id) {
      const subName = activeSub.subscription_id.name.toLowerCase();
      if (subName.includes("basic")) realPlanType = "basic";
      if (subName.includes("pro")) realPlanType = "pro";
    }

    club.onboarding_completed = true;
    club.plan_type = realPlanType;
    await club.save();

    return res.status(200).json({
      success: true,
      message: "Hoàn tất thiết lập quán thành công",
      data: {
        onboarding_completed: club.onboarding_completed,
        plan_type: club.plan_type,
      },
    });
  } catch (error) {
    console.error("Lỗi completeOnboarding:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

module.exports = {
  getClubsByAccount,
  registerClub,
  updateClub,
  completeOnboarding,
};
