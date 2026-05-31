const Club = require("../../models/club.model");

// Convert HH:MM to minutes
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};


// VALIDATE NAME (3-100 ký tự)
const validateName = (name) => {
  if (!name) {
    return { valid: false, message: "Tên CLB không được để trống" };
  }
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 100) {
    return { valid: false, message: "Tên CLB phải từ 3-100 ký tự" };
  }
  return { valid: true, value: trimmed };
};

// VALIDATE ADDRESS (5-255 ký tự)
const validateAddress = (address) => {
  if (!address) {
    return { valid: false, message: "Địa chỉ không được để trống" };
  }
  const trimmed = address.trim();
  if (trimmed.length < 5 || trimmed.length > 255) {
    return { valid: false, message: "Địa chỉ phải từ 5-255 ký tự" };
  }
  return { valid: true, value: trimmed };
};

// VALIDATE PHONE (SĐT Việt Nam)
const validatePhone = (phone) => {
  if (!phone) {
    return { valid: false, message: "Số điện thoại không được để trống" };
  }
  const phoneRegex = /^(0\d{9}|\+84\d{9})$/;
  const cleanPhone = phone.trim().replace(/\s+/g, "");

  if (!phoneRegex.test(cleanPhone)) {
    return {
      valid: false,
      message: "Số điện thoại không hợp lệ (phải là 10 chữ số bắt đầu từ 0 hoặc +84)"
    };
  }
  return { valid: true, value: cleanPhone };
};

// VALIDATE TAX CODE (10-13 chữ số)
const validateTaxCode = (taxCode) => {
  if (!taxCode) {
    return { valid: false, message: "Mã số thuế không được để trống" };
  }
  const taxCodeRegex = /^\d{10,13}$/;
  const trimmed = taxCode.trim();

  if (!taxCodeRegex.test(trimmed)) {
    return {
      valid: false,
      message: "Mã số thuế không hợp lệ (phải là 10-13 chữ số)"
    };
  }
  return { valid: true, value: trimmed };
};

// VALIDATE DESCRIPTION (optional, max 1000)
const validateDescription = (description) => {
  if (!description) {
    return { valid: true, value: "" };
  }
  const trimmed = description.trim();
  if (trimmed.length > 1000) {
    return { valid: false, message: "Mô tả không quá 1000 ký tự" };
  }
  return { valid: true, value: trimmed };
};

// VALIDATE TIMES (format HH:MM + opening < closing)
const validateTimes = (openingTime, closingTime) => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

  if (openingTime && !timeRegex.test(openingTime)) {
    return { valid: false, message: "Giờ mở cửa không hợp lệ (format: HH:MM)" };
  }

  if (closingTime && !timeRegex.test(closingTime)) {
    return { valid: false, message: "Giờ đóng cửa không hợp lệ (format: HH:MM)" };
  }

  // So sánh thời gian
  if (openingTime && closingTime) {
    const openingMinutes = timeToMinutes(openingTime);
    const closingMinutes = timeToMinutes(closingTime);

    if (closingMinutes <= openingMinutes) {
      return { valid: false, message: "Giờ đóng cửa phải sau giờ mở cửa" };
    }
  }

  return { valid: true };
};

// VALIDATE AMENITIES (allows custom amenities)
const validateAmenities = (amenities) => {
  if (!amenities) {
    return { valid: true, value: [] };
  }

  if (!Array.isArray(amenities)) {
    return { valid: false, message: "Tiện ích phải là mảng" };
  }

  const cleaned = [];
  for (const item of amenities) {
    if (typeof item !== "string") {
      return { valid: false, message: "Mỗi tiện ích phải là chuỗi văn bản" };
    }
    const trimmed = item.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      return { valid: false, message: "Mỗi tiện ích phải từ 2 đến 50 ký tự" };
    }
    cleaned.push(trimmed);
  }

  return { valid: true, value: cleaned };
};

// VALIDATE LEGAL DOCUMENTS (array of URLs, max 10)
const validateLegalDocuments = (legalDocuments) => {
  if (!legalDocuments) {
    return { valid: true, value: [] };
  }

  if (!Array.isArray(legalDocuments)) {
    return { valid: false, message: "Tài liệu pháp lý phải là mảng" };
  }

  if (legalDocuments.length > 10) {
    return { valid: false, message: "Tối đa 10 tài liệu pháp lý" };
  }

  const urlRegex = /^https?:\/\/.+/;
  const invalidUrls = legalDocuments.filter(url => url && !urlRegex.test(url));

  if (invalidUrls.length > 0) {
    return { valid: false, message: "URL tài liệu không hợp lệ (phải bắt đầu từ http:// hoặc https://)" };
  }

  return { valid: true, value: legalDocuments.filter(url => !!url) };
};

const canAccessClub = async (req, clubId) => {
  if (!clubId || !req.user) return false;
  if (req.user.role === "STAFF_CLUB") return String(req.user.club_id) === String(clubId);
  if (req.user.role === "OWNER") {
      const ownedClub = await Club.findOne({ _id: clubId, account_id: req.user.accountId }).select("_id").lean();
      return !!ownedClub;
  }
  return false;
};

module.exports = {
  timeToMinutes,
  validateName,
  validateAddress,
  validatePhone,
  validateTaxCode,
  validateDescription,
  validateTimes,
  validateAmenities,
  validateLegalDocuments,
  canAccessClub,
};

