const axios = require('axios');

/**
 * Geocode an address to get coordinates and administrative context.
 * @param {string} address The user-entered address
 * @param {string} province Optional province name for context
 * @param {string} district Optional district name for context
 * @returns {Object|null} { lat, lng, district }
 */
/**
 * Geocode an address with administrative context biasing and result verification.
 * @param {string} address The user-entered address
 * @param {string} provinceName Optional province name for context
 * @param {string} districtName Optional district name for context
 * @returns {Object|null} { lat, lng, district }
 */
const geocodeAddress = async (address, provinceName = "", districtName = "") => {
  try {
    const accessToken = process.env.MAPBOX_PUBLIC_KEY;
    if (!accessToken) {
      console.warn("MAPBOX_PUBLIC_KEY is not set in .env");
      return null;
    }

    // 1. Normalize Address: Remove redundant country/province names if already typed
    let cleanAddress = address.trim();
    const vnSuffix = ", Vietnam";
    if (cleanAddress.toLowerCase().endsWith(vnSuffix.toLowerCase())) {
      cleanAddress = cleanAddress.substring(0, cleanAddress.length - vnSuffix.length).trim();
    }
    
    // 2. Step 1: Get proximity bias by geocoding the region center
    let proximity = "";
    if (provinceName) {
      const regionQuery = encodeURIComponent(`${districtName || ""}, ${provinceName}, Vietnam`);
      const regionUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${regionQuery}.json?access_token=${accessToken}&limit=1&types=region,place,locality&country=VN`;
      
      try {
        const regionRes = await axios.get(regionUrl);
        if (regionRes.data.features && regionRes.data.features.length > 0) {
          const [rlng, rlat] = regionRes.data.features[0].center;
          proximity = `&proximity=${rlng},${rlat}`;
        }
      } catch (e) {
        console.warn("Proximity fetch failed:", e.message);
      }
    }

    // 3. Step 2: Build final query
    // We prioritize [Street], [District], [Province] order
    const queryParts = [cleanAddress];
    if (districtName && !cleanAddress.toLowerCase().includes(districtName.toLowerCase())) {
        queryParts.push(districtName);
    }
    if (provinceName && !cleanAddress.toLowerCase().includes(provinceName.toLowerCase())) {
        queryParts.push(provinceName);
    }
    queryParts.push("Vietnam");

    const finalQuery = encodeURIComponent(queryParts.join(", "));
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${finalQuery}.json?access_token=${accessToken}&limit=5&country=VN&language=vi${proximity}`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.features && data.features.length > 0) {
      // 4. Verify results: If we have multiple results, find one that actually belongs to the province
      let bestFeature = data.features[0];
      
      if (provinceName) {
        const normalizedProvince = provinceName.toLowerCase().replace(/^(tinh|thanh pho)\s+/i, "").trim();
        const matchingFeature = data.features.find(f => {
           const context = f.context || [];
           return context.some(c => c.text.toLowerCase().includes(normalizedProvince)) || 
                  f.place_name.toLowerCase().includes(normalizedProvince);
        });
        if (matchingFeature) bestFeature = matchingFeature;
      }

      const [lng, lat] = bestFeature.center;
      
      // Extract district/locality from context
      let detectedDistrict = "";
      const context = bestFeature.context || [];
      
      const districtObj = context.find(c => 
        c.id.startsWith('district') || 
        c.id.startsWith('place') || 
        c.id.startsWith('locality')
      );

      if (districtObj) {
        detectedDistrict = districtObj.text;
      } else if (bestFeature.place_type.includes('place')) {
        detectedDistrict = bestFeature.text;
      } else {
        detectedDistrict = districtName || "";
      }

      return { lat, lng, district: detectedDistrict };
    }
    return null;
  } catch (error) {
    console.error("Geocoding error:", error.message);
    return null;
  }
};

module.exports = { geocodeAddress };
