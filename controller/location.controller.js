const Province = require("../models/province.model");
const District = require("../models/district.model");

const getProvinces = async (req, res) => {
  try {
    const provinces = await Province.find().sort({ name: 1 });
    res.status(200).json(provinces);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDistrictsByProvince = async (req, res) => {
  try {
    const { provinceCode } = req.params;
    // Lọc bỏ các đơn vị là 'Xã' (xa) theo yêu cầu người dùng
    const districts = await District.find({ 
      province_code: provinceCode,
      type: { $ne: 'xa' } 
    }).sort({ name: 1 });
    res.status(200).json(districts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProvinces,
  getDistrictsByProvince,
};
