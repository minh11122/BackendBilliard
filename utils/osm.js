// utils/osm.js
const axios = require("axios");

/**
 * Lấy ma trận khoảng cách và thời gian từ một điểm gốc đến nhiều điểm đích
 * chỉ bằng MỘT lần gọi API.
 * @param {object} from - Tọa độ gốc { lat, lng }
 * @param {array} toShops - Mảng các shop có tọa độ [{ gps: { coordinates: [lng, lat] } }, ...]
 * @returns {object} - { distances: [[]], durations: [[]] }
 */
const getOSMMatrix = async (from, toShops) => {
  try {
    // Định dạng lại tọa độ cho URL: {lng},{lat};{lng},{lat};...
    // Tọa độ đầu tiên (index 0) là của user
    const coordinates = [
      `${from.lng},${from.lat}`,
      ...toShops.map(shop => `${shop.gps.coordinates[0]},${shop.gps.coordinates[1]}`)
    ].join(';');

    // sources=0 nghĩa là tính từ điểm đầu tiên (user) đến các điểm còn lại
    const url = `http://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0&annotations=distance,duration`;
    const res = await axios.get(url);
    if (res.data && res.data.code === "Ok") {
      // res.data.distances[0] là mảng khoảng cách từ user đến các shop
      // res.data.durations[0] là mảng thời gian từ user đến các shop
      return {
        distances: res.data.distances[0],
        durations: res.data.durations[0]
      };
    }
    return null;
  } catch (err) {
    console.error("Error fetching OSM matrix:", err.message);
    return null;
  }
};

module.exports = { getOSMMatrix };