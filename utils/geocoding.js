const axios = require('axios');

const geocodeAddress = async (address) => {
  try {
    const accessToken = process.env.MAPBOX_PUBLIC_KEY;
    if (!accessToken) {
      console.warn("MAPBOX_PUBLIC_KEY is not set in .env");
      return null;
    }

    const removeAccents = (str) => {
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    };

    const query = encodeURIComponent(address + ", Hanoi, Vietnam");
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${accessToken}&limit=1`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const [lng, lat] = feature.center;
      
      const hanoiDistricts = [
        "Ba Đình", "Hoàn Kiếm", "Tây Hồ", "Long Biên", "Cầu Giấy", "Đống Đa", 
        "Hai Bà Trưng", "Hoàng Mai", "Thanh Xuân", "Hà Đông", "Bắc Từ Liêm", 
        "Nam Từ Liêm", "Sơn Tây", "Ba Vì", "Chương Mỹ", "Đan Phượng", "Đông Anh", 
        "Gia Lâm", "Hoài Đức", "Mê Linh", "Mỹ Đức", "Phú Xuyên", "Phúc Thọ", 
        "Quốc Oai", "Sóc Sơn", "Thạch Thất", "Thanh Oai", "Thanh Trì", "Thường Tín", "Ứng Hòa"
      ];

      // Common mapping for specific wards/places that might miss parent district
      const localMapping = {
        "mễ trì": "Nam Từ Liêm",
        "giảng võ": "Ba Đình",
        "định công": "Hoàng Mai",
        "bách khoa": "Hai Bà Trưng",
        "láng hạ": "Đống Đa",
        "ngã tư sở": "Thanh Xuân",
        "dịch vọng": "Cầu Giấy",
        "nghĩa tân": "Cầu Giấy",
        "mỹ đình": "Nam Từ Liêm",
        "cửa nam": "Hoàn Kiếm"
      };

      // Extract district if possible
      let district = "";
      const context = feature.context || [];
      
      const allTextRaw = [feature.text, feature.place_name, ...context.map(c => c.text)];
      const allTextsNormalized = allTextRaw.map(t => removeAccents(t || ""));
      
      // 1. Try mapping known wards first
      for (const [ward, parent] of Object.entries(localMapping)) {
        if (allTextsNormalized.some(t => t.includes(removeAccents(ward)))) {
          district = parent;
          break;
        }
      }

      // 2. Try to find a direct match in any context part or feature text
      if (!district) {
        for (const d of hanoiDistricts) {
          const normalizedD = removeAccents(d);
          if (allTextsNormalized.some(t => t.includes(normalizedD))) {
            district = d;
            break;
          }
        }
      }

      // 3. Last fallback
      if (!district) {
        const districtObj = context.find(c => c.id.startsWith('district') || c.id.startsWith('place') || c.id.startsWith('locality'));
        if (districtObj) {
          district = districtObj.text;
        } else if (feature.place_type.includes('place')) {
          district = feature.text;
        }
      }

      return { lat, lng, district };
    }
    return null;
  } catch (error) {
    console.error("Geocoding error:", error.message);
    return null;
  }
};

module.exports = { geocodeAddress };
