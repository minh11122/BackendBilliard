const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    club_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Club ID là bắt buộc"],
      ref: "Club"
    },
    name: {
      type: String,
      required: [true, "Tên dịch vụ là bắt buộc"],
      trim: true,
      maxlength: [150, "Tên dịch vụ tối đa 150 ký tự"]
    },
    price: {
      type: Number,
      required: [true, "Giá dịch vụ là bắt buộc"],
      min: [0, "Giá không được âm"]
    },
    discount_percent: {
      type: Number,
      default: 0,
      min: [0, "Giảm giá không được âm"],
      max: [100, "Giảm giá tối đa 100%"]
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Mô tả tối đa 500 ký tự"],
      default: ""
    },
    status: {
      type: String,
      enum: {
        values: ["Active", "Inactive"],
        message: "Trạng thái phải là Active hoặc Inactive"
      },
      default: "Active"
    },
    created_at: {
      type: Date,
      default: Date.now
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account"
    }
  },
  {
    collection: "services",
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
  }
);

// Index tìm kiếm nhanh theo club_id + status
serviceSchema.index({ club_id: 1, status: 1 });
// Index unique tên dịch vụ trong cùng club (chỉ với Active)
serviceSchema.index({ club_id: 1, name: 1, status: 1 });

module.exports = mongoose.model("Service", serviceSchema);
