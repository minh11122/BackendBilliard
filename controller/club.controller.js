const Club = require("../models/club.model");
const Image = require("../models/image.model");
const BilliardTable = require("../models/billiard_table.model");
const Feedback = require("../models/feedback.model");
const TableType = require("../models/table_type.model");
const Province = require("../models/province.model");
const District = require("../models/district.model");
const Booking = require("../models/booking.model");
const Tournament = require("../models/tournament.model");
const { geocodeAddress } = require("../utils/geocoding");



// Lấy danh sách câu lạc bộ
const getAllClubs = async (req, res) => {
  try {
    const { keyword, price, tableType, rating, province_code, district_code } = req.query;

    const query = { status: "Approved" };

    if (keyword) {
      query.$or = [
        { name: { $regex: keyword, $options: "i" } },
        { address: { $regex: keyword, $options: "i" } },
      ];
    }

    if (province_code) {
      query.province_code = province_code;
    }

    if (district_code) {
      query.district_code = district_code;
    }

    const clubs = await Club.find(query).lean();

    // Lấy thêm điểm đánh giá trung bình & giá từ cho mỗi club, và ảnh bìa
    const result = await Promise.all(
      clubs.map(async (club) => {
        // Lấy tên Tỉnh và Quận/Huyện/Xã
        if (club.province_code) {
          const province = await Province.findOne({ code: club.province_code }).lean();
          club.province_name = province ? province.name : null;
        }
        if (club.district_code) {
          const districtDoc = await District.findOne({ code: club.district_code }).lean();
          club.district_name = districtDoc ? (districtDoc.name_with_type || districtDoc.name) : null;
        }

        // Nếu thiếu tọa độ, cố gắng geocode (chỉ ưu tiên dùng data đã lưu)
        if (!club.lat || !club.lng) {
          const province = club.province_code ? await Province.findOne({ code: club.province_code }).lean() : null;
          const districtDoc = club.district_code ? await District.findOne({ code: club.district_code }).lean() : null;
          
          const geoData = await geocodeAddress(
            club.address, 
            province ? province.name : "", 
            districtDoc ? (districtDoc.name_with_type || districtDoc.name) : ""
          );

          if (geoData) {
            club.lat = geoData.lat;
            club.lng = geoData.lng;
            club.district = geoData.district; // Update the old district field too
            // Update DB once
            await Club.updateOne({ _id: club._id }, { lat: geoData.lat, lng: geoData.lng, district: geoData.district });
          }
        }

        // Lấy ảnh bìa (Ưu tiên Avatar, sau đó đến Banner)
        const clubImages = await Image.find({ 
          club_id: club._id, 
          image_type: { $in: ["Avatar", "Banner"] } 
        }).lean();
        
        const mainImage = clubImages.find(img => img.image_type === "Avatar") || 
                          clubImages.find(img => img.image_type === "Banner");
                          
        club.avatar = mainImage ? mainImage.image_url : null;

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
        const feedbacks = await Feedback.find({ club_id: club._id }).lean();
        
        if (feedbacks.length > 0) {
            const sum = feedbacks.reduce((acc, curr) => acc + (curr.rating || 0), 0);
            club.rating = parseFloat((sum / feedbacks.length).toFixed(1));
            club.reviewsCount = feedbacks.length;
        } else {
            club.rating = 0;
            club.reviewsCount = 0;
        }

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

// Helper to compare times "HH:mm"
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

// Lấy chi tiết câu lạc bộ
const getClubById = async (req, res) => {
  try {
    const { id } = req.params;
    const { play_date, startTime, duration } = req.query;
    
    const club = await Club.findById(id).lean();

    if (!club) {
      return res.status(404).json({ success: false, message: "Không tìm thấy câu lạc bộ" });
    }

    // Lấy danh sách ảnh
    const images = await Image.find({ club_id: id }).lean();
    club.images = images;

    // Lấy tên Tỉnh và Quận/Huyện/Xã
    if (club.province_code) {
      const province = await Province.findOne({ code: club.province_code }).lean();
      club.province_name = province ? province.name : null;
    }
    if (club.district_code) {
      const districtDoc = await District.findOne({ code: club.district_code }).lean();
      club.district_name = districtDoc ? (districtDoc.name_with_type || districtDoc.name) : null;
    }

    // Tự động trả lại bàn Holding đã hết hạn giữ chỗ (Cleanup chung)
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

    // Lấy danh sách bàn
    const tables = await BilliardTable.find({ club_id: id }).populate("table_type_id").lean();
    
    // Nếu có query thời gian, tính toán trạng thái khả dụng thực tế
    if (play_date && startTime) {
      const Booking = require("../models/booking.model");
      
      const openMin = timeToMinutes(club.opening_time || "08:00");
      const is24h = club.opening_time === "00:00" && club.closing_time === "00:00";
      
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

        // Fetch bookings from target date AND previous day (spill-over check)
        const bookings = await Booking.find({
          table_id: table._id,
          play_date: { $gte: prevDay, $lt: nextDay },
          status: { $in: ["Pending", "Booked", "Playing"] }
        }).lean();

        let isOccupied = false;
        let isHolding = false;

        for (const b of bookings) {
          const bDate = new Date(b.play_date);
          bDate.setHours(0, 0, 0, 0);
          
          let bStart = timeToMinutes(b.start_time);
          let bEnd = timeToMinutes(b.end_time);

          // Normalize times relative to targetDate
          if (bDate < targetDate) {
             // If booking started yesterday, shift its times by -1440 minutes relative to today's midnight?
             // Actually, it's easier to think: does yesterday's booking end after 24:00?
             // If yesterday's end < yesterday's start, it cross midnight.
             if (bEnd <= bStart) {
                // It ends today at bEnd minutes past midnight.
                // Current query time is [reqStartMin, reqEndMin] relative to today's midnight.
                // Overlap if: reqStartMin < bEnd
                if (reqStartMin < bEnd) {
                   if (b.status === "Booked" || b.status === "Playing") isOccupied = true;
                   else isHolding = true;
                }
             }
             continue; // Done with yesterday's booking
          }

          // Case: Booking is today
          // Does today's booking cross midnight into tomorrow?
          if (bEnd <= bStart) bEnd += 24 * 60;

          // Standard overlap check today
          if (bStart < reqEndMin && bEnd > reqStartMin) {
            if (b.status === "Booked" || b.status === "Playing") isOccupied = true;
            else isHolding = true;
          }
          
          if (isOccupied) break;
        }

        if (isOccupied) table.status = "Holding";
        else if (isHolding) table.status = "Holding";
        else table.status = "Available";
      }
    }

    club.tables = tables;

    // Giá thấp nhất (Price từ)
    if (tables.length > 0) {
      club.priceFrom = Math.min(...tables.map((t) => t.price));
    } else {
      club.priceFrom = 0;
    }
    
    // Lấy rating thực tế cho detail
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
      district_name
    } = req.body;

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

    // Determine final coordinates and district name
    let lat = frontendLat || 0;
    let lng = frontendLng || 0;
    let districtNameField = "";

    // Only geocode if coordinates are missing
    if (!lat || !lng) {
      try {
        const province = await Province.findOne({ code: province_code }).lean();
        const districtDoc = await District.findOne({ code: district_code }).lean();

        const geoData = await geocodeAddress(
          address, 
          province ? province.name : "", 
          districtDoc ? (districtDoc.name_with_type || districtDoc.name) : ""
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
        // If we have coordinates but no district text, try to get it for backward compatibility
        const districtDoc = await District.findOne({ code: district_code }).lean();
        districtNameField = districtDoc ? (districtDoc.name_with_type || districtDoc.name) : "";
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
// Cập nhật thông tin câu lạc bộ
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
      avatar, // Single URL
      backgrounds // Array of URLs
    } = req.body;

    const club = await Club.findOne({ _id: id, account_id });
    if (!club) {
      return res.status(404).json({ success: false, message: "Không tìm thấy câu lạc bộ hoặc bạn không có quyền sửa" });
    }

    // Cập nhật các trường cơ bản
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

    // Map district name for backward compatibility if codes change
    if (province_code || district_code) {
      const districtDoc = await District.findOne({ code: district_code }).lean();
      if (districtDoc) {
        club.district = districtDoc.name_with_type || districtDoc.name;
      }
    }

    await club.save();

    // Xử lý ảnh Avatar (Chỉ giữ 1 cái mới nhất)
    if (avatar) {
      await Image.deleteMany({ club_id: id, image_type: "Avatar" });
      await Image.create({
        club_id: id,
        image_url: avatar,
        image_type: "Avatar"
      });
    }

    // Xử lý ảnh Background (Nhiều ảnh)
    if (Array.isArray(backgrounds)) {
      // Ở đây ta đơn giản là ghi đè toàn bộ list background cũ bằng list mới
      // Nếu muốn phức tạp hơn (xóa từng cái) thì cần logic khác, nhưng ghi đè là an toàn nhất từ frontend truyền xuống
      await Image.deleteMany({ club_id: id, image_type: "Background" });
      if (backgrounds.length > 0) {
        const bgImages = backgrounds.map(url => ({
          club_id: id,
          image_url: url,
          image_type: "Background"
        }));
        await Image.insertMany(bgImages);
      }
    }

    res.status(200).json({ success: true, message: "Cập nhật thông tin thành công", data: club });
  } catch (error) {
    console.error("Lỗi khi cập nhật CLB:", error);
    res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

// Lấy thống kê cho câu lạc bộ
const getClubStatistics = async (req, res) => {
  try {
    const { month, year } = req.query;
    
    // Lấy club_id quản lý của staff/owner
    let club_id;
    if (req.user.role === "STAFF_CLUB") {
       club_id = req.user.club_id;
    } else if (req.user.role === "OWNER") {
       // Tạm thời lấy club đầu tiên của Owner nếu họ gọi API chung. (Tuỳ logic)
       const club = await Club.findOne({ account_id: req.user.accountId }).lean();
       if (!club) {
         return res.status(404).json({ success: false, message: "Chủ quán chưa có câu lạc bộ" });
       }
       club_id = club._id;
    } else {
       return res.status(403).json({ success: false, message: "Không có quyền truy cập" });
    }

    const currentClub = await Club.findById(club_id).lean();
    if (!currentClub) {
        return res.status(404).json({ success: false, message: "Không tìm thấy câu lạc bộ" });
    }

    // Prepare date range if month and year are provided
    let dateFilter = {};
    if (month && year) {
       const startDate = new Date(year, month - 1, 1);
       const endDate = new Date(year, month, 0, 23, 59, 59, 999); // last day of month
       dateFilter = { $gte: startDate, $lte: endDate };
    }

    // 1. Lấy danh sách bàn thuộc club
    const tables = await BilliardTable.find({ club_id: club_id }).lean();
    const tableIds = tables.map(t => t._id);

    // 2. Booking Stats
    const bookingQuery = { table_id: { $in: tableIds } };
    if (dateFilter.$gte) bookingQuery.created_at = dateFilter;
    
    const bookings = await Booking.find(bookingQuery).lean();
    
    const totalBookings = bookings.length;
    // Doanh thu chỉ tính các booking Completed
    const completedBookings = bookings.filter(b => b.status === "Completed");
    const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.total_bill || 0), 0);

    // 3. Review Stats
    const feedbackQuery = { club_id: club_id };
    if (dateFilter.$gte) feedbackQuery.created_at = dateFilter;
    
    const feedbacks = await Feedback.find(feedbackQuery)
        .populate("account_id", "fullname username avatar")
        .sort({ created_at: -1 })
        .lean();

    // 4. Tournament Stats (Ongoing or in requested month)
    const tourQuery = { club_id: club_id };
    if (dateFilter.$gte) tourQuery.start_time = dateFilter; // Simplify logic just check if starts in that month.
    const tournaments = await Tournament.find(tourQuery).lean();

    res.status(200).json({
      success: true,
      data: {
          clubName: currentClub.name,
          totalBookings,
          totalRevenue,
          feedbacks: feedbacks.map(f => ({
             id: f._id,
             rating: f.rating,
             comment: f.comment,
             reply: f.reply_content,
             created_at: f.created_at,
             user: f.account_id ? { name: f.account_id.fullname || f.account_id.username, avatar: f.account_id.avatar } : { name: "Ẩn danh" }
          })),
          tournaments: tournaments.map(t => ({
             id: t._id,
             name: t.name,
             start_time: t.start_time,
             status: t.status,
             fee: t.fee,
             max_players: t.max_players
          }))
      }
    });

  } catch (error) {
    console.error("Lỗi lấy thống kê CLB:", error);
    res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

module.exports = {
  registerClub,
  getAllClubs,
  getClubById,
  getClubsByAccount,
  updateClub,
  getClubStatistics
};
