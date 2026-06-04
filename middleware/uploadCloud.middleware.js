const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../configs/cloudinary.config");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "billiard_app",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
  },
});

const fileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("Chỉ hỗ trợ tải lên file ảnh!"), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // limit 5MB for Cloudinary uploads
});

module.exports = upload;