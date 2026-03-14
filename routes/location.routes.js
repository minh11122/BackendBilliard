const express = require("express");
const router = express.Router();
const locationController = require("../controller/location.controller");

router.get("/provinces", locationController.getProvinces);
router.get("/provinces/:provinceCode/districts", locationController.getDistrictsByProvince);

module.exports = router;
