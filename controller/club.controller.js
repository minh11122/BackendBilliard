const Club = require("../models/club.model");
const Image = require("../models/image.model");
const BilliardTable = require("../models/billiard_table.model");
const Feedback = require("../models/feedback.model");
const TableType = require("../models/table_type.model");
const { geocodeAddress } = require("../utils/geocoding");



// Lấy danh sách câu lạc bộ
const getAllClubs = async (req, res) => {
  try {
    const { keyword, price, tableType, rating } = req.query;

    const query = { status: "Approved" };

    if (keyword) {
      query.$or = [
        { name: { $regex: keyword, $options: "i" } },
        { address: { $regex: keyword, $options: "i" } },
      ];
    }

    const clubs = await Club.find(query).lean();

    // Lấy thêm điểm đánh giá trung bình & giá từ cho mỗi club, và ảnh bìa
    const result = await Promise.all(
      clubs.map(async (club) => {
        // Nếu thiếu tọa độ hoặc quận, cố gắng geocode 
        if (!club.lat || !club.lng || !club.district) {
          const geoData = await geocodeAddress(club.address);
          if (geoData) {
            club.lat = geoData.lat;
            club.lng = geoData.lng;
            club.district = geoData.district;
            // Cập nhật lại vào DB để lần sau không cần geocode nữa
            await Club.updateOne(
              { _id: club._id }, 
              { lat: geoData.lat, lng: geoData.lng, district: geoData.district }
            );
          }
        }

        // Lấy ảnh bìa
        const images = await Image.find({ club_id: club._id, image_type: "Banner" }).lean();
        club.avatar = images.length > 0 ? images[0].image_url : null;

        // Lấy danh sách loại bàn
        const tables = await BilliardTable.find({ club_id: club._id }).populate("table_type_id").lean();
        if (tables.length > 0) {
          club.priceFrom = Math.min(...tables.map((t) => t.price));
          const types = new Set();
          tables.forEach(t => {
             if (t.table_type_id && t.table_type_id.name) {
                 types.add(t.table_type_id.name);
             }
          });
          club.tableTypes = Array.from(types);
        } else {
          club.priceFrom = 0;
          club.tableTypes = [];
        }

        // Lấy rating
        // Lấy rating 
        const feedbacks = await Feedback.find({ club_id: club._id }).lean();
        
        if (feedbacks.length > 0) {
            const sum = feedbacks.reduce((acc, curr) => acc + (curr.rating || 0), 0);
            club.rating = parseFloat((sum / feedbacks.length).toFixed(1));
            club.reviewsCount = feedbacks.length;
        } else {
            club.rating = 0;
            club.reviewsCount = 0;
        }

        // Mock coordinates for demonstration based on names/addresses in Hanoi
        const mockCoords = {
          "Togetherly Billiards Club": { lat: 21.0365, lng: 105.7828 },
          "Royal Billiards Cầu Giấy": { lat: 21.0298, lng: 105.7845 },
          "Royal Billiards Đống Đa": { lat: 21.0112, lng: 105.8234 },
          "Royal Billiards Hai Bà Trưng": { lat: 20.9984, lng: 105.8532 },
          "Dragon Billiards Thanh Xuân": { lat: 20.9947, lng: 105.8118 },
          "Dragon Billiards Ba Đình": { lat: 21.0308, lng: 105.8282 },
          "Galaxy Billiards Hoàn Kiếm": { lat: 21.0238, lng: 105.8524 },
          "Victory Billiards Tây Hồ": { lat: 21.0625, lng: 105.8247 },
          "Pro Billiards Bắc Từ Liêm": { lat: 21.0658, lng: 105.7812 },
          "Champion Billiards Hoàng Mai": { lat: 20.9968, lng: 105.8427 }
        };

        const coords = mockCoords[club.name] || { lat: 21.0, lng: 105.8 };
        club.lat = club.lat || coords.lat;
        club.lng = club.lng || coords.lng;

        club.distance = null; // Distance will be calculated on frontend
        
        return club;
      })
    );

    res.status(200).json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách CLB:", error);
    res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

// Lấy chi tiết câu lạc bộ
const getClubById = async (req, res) => {
  try {
    const { id } = req.params;
    const club = await Club.findById(id).lean();

    if (!club) {
      return res.status(404).json({ success: false, message: "Không tìm thấy câu lạc bộ" });
    }

    // Lấy danh sách ảnh
    const images = await Image.find({ club_id: id }).lean();
    club.images = images;

    // Tự động trả lại bàn Holding đã hết hạn giữ chỗ
    await BilliardTable.updateMany(
      {
        club_id: id,
        status: "Holding",
        held_until: { $lte: new Date() }
      },
      {
        $set: { status: "Available", held_by: null, held_until: null }
      }
    );

    // Lấy danh sách bàn (sau khi đã cleanup)
    const tables = await BilliardTable.find({ club_id: id }).populate("table_type_id").lean();
    club.tables = tables;

    // Giá thấp nhất (Price từ)
    if (tables.length > 0) {
      club.priceFrom = Math.min(...tables.map((t) => t.price));
    } else {
      club.priceFrom = 0;
    }
    
    // Lấy rating thực tế cho detail (tuỳ chọn gộp aggregation)
    const feedbacks = await Feedback.find({ club_id: id }).populate("account_id").sort({ created_at: -1 }).lean();
    
    if (feedbacks.length > 0) {
        const sum = feedbacks.reduce((acc, curr) => acc + (curr.rating || 0), 0);
        club.rating = parseFloat((sum / feedbacks.length).toFixed(1));
        club.reviewsCount = feedbacks.length;
        club.feedbacks = feedbacks.map(f => ({
            id: f._id,
            rating: f.rating,
            comment: f.comment,
            reply: f.reply_content,
            created_at: f.created_at,
            user: f.account_id ? { name: f.account_id.fullname || f.account_id.username, avatar: f.account_id.avatar } : { name: "Người dùng ẩn danh" }
        }));
    } else {
        club.rating = 0;
        club.reviewsCount = 0;
    }

    res.status(200).json({ success: true, data: club });
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết CLB:", error);
    res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};



// Lấy danh sách câu lạc bộ của chủ quán (theo accountId)
const getClubsByAccount = async (req, res) => {
  try {
    // Lấy accountId từ token đã được middleware giải mã (JWT sign { accountId, roleId, role })
    const account_id = req.user?.accountId || req.query.account_id;

    if (!account_id) {
      return res.status(400).json({ success: false, message: "Không tìm thấy thông tin tài khoản (account_id)" });
    }

    const clubs = await Club.find({ account_id }).lean();

    // Lấy thêm ảnh bìa nếu cần thiết
    const result = await Promise.all(
      clubs.map(async (club) => {
        const images = await Image.find({ club_id: club._id, image_type: "Banner" }).lean();
        club.avatar = images.length > 0 ? images[0].image_url : null;
        return club;
      })
    );

    res.status(200).json({ 
      success: true, 
      message: "Lấy danh sách quán thành công",
      count: result.length, 
      data: result 
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách CLB của chủ quán:", error);
    res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

// Chủ quán đăng ký câu lạc bộ
//Duc
//4/3/2026
const registerClub = async (req, res) => {
  try {
    const { name, address, phone, tax_code, description, legalDocuments, opening_time, closing_time } = req.body;

    if (!req.user || !req.user.accountId) {
      return res.status(401).json({ success: false, message: "Không xác thực được người dùng" });
    }

    if (!name || !address || !phone || !tax_code) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ tên CLB, địa chỉ, số điện thoại và mã số thuế"
      });
    }

    const existingClub = await Club.findOne({ tax_code });
    if (existingClub) {
      return res.status(400).json({
        success: false,
        message: "Mã số thuế đã tồn tại"
      });
    }

    // Thử geocode địa chỉ ngay khi đăng ký
    let lat = 0;
    let lng = 0;
    let district = "";
    try {
      const geoData = await geocodeAddress(address);
      if (geoData) {
        lat = geoData.lat;
        lng = geoData.lng;
        district = geoData.district;
      }
    } catch (err) {
      console.warn("Lỗi geocode khi đăng ký:", err.message);
    }

    const club = await Club.create({
      account_id: req.user.accountId,
      name,
      address,
      phone,
      tax_code,
      lat,
      lng,
      district,
      description: description || "",
      opening_time: opening_time || "08:00",
      closing_time: closing_time || "23:30",
      status: "Pending"
    });

    if (Array.isArray(legalDocuments) && legalDocuments.length > 0) {
      const images = legalDocuments
        .filter((url) => !!url)
        .map((url) => ({
          club_id: club._id,
          image_url: url,
          image_type: "legal documents"
        }));

      if (images.length > 0) {
        await Image.insertMany(images);
      }
    }

    const createdClub = await Club.findById(club._id).lean();

    return res.status(201).json({
      success: true,
      message: "Đăng ký câu lạc bộ thành công, vui lòng chờ duyệt",
      data: createdClub
    });
  } catch (error) {
    console.error("Lỗi khi đăng ký CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};
module.exports = {
  registerClub,
  getAllClubs,
  getClubById,
  getClubsByAccount,
};
