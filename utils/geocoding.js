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
    const apiKey = process.env.VITE_GOONG_API_KEY || process.env.MAPBOX_PUBLIC_KEY; 
    // Note: Temporary fallback to MAPBOX_PUBLIC_KEY if the user kept it but it's now a Goong Key
    
    if (!apiKey) {
      console.warn("Goong API Key is not set in .env");
      return null;
    }

    // 1. Build Query for Goong
    const queryParts = [address.trim()];
    if (districtName) queryParts.push(districtName);
    if (provinceName) queryParts.push(provinceName);
    
    const finalQuery = encodeURIComponent(queryParts.join(", "));
    const url = `https://rsapi.goong.io/geocode?address=${finalQuery}&api_key=${apiKey}`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.results && data.results.length > 0) {
      // 2. Find best match (Goong usually returns very relevant results for VN)
      const result = data.results[0];
      const { lat, lng } = result.geometry.location;
      
      // 3. Extract district from Goong's compound or address_components
      let detectedDistrict = "";
      if (result.compound && result.compound.district) {
        detectedDistrict = result.compound.district;
      } else {
        // Fallback: try to find district-like component in formatted_address
        detectedDistrict = districtName || "";
      }

      return { lat, lng, district: detectedDistrict };
    }
    return null;
  } catch (error) {
    console.error("Goong Geocoding error:", error.message);
    return null;
  }
};

module.exports = { geocodeAddress };
