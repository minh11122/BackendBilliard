const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Club = require('../models/club.model');
const { geocodeAddress } = require('../utils/geocoding');

dotenv.config();

async function updateExistingClubs() {
  try {
    const MONGO_URI = process.env.MONGODB_ALATAS_URL || process.env.MONGODB_URL;
    if (!MONGO_URI) {
      console.error("MONGO_URI not found");
      return;
    }

    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const clubs = await Club.find({ status: "Approved" });
    console.log(`Found ${clubs.length} clubs to update`);

    for (const club of clubs) {
      console.log(`Geocoding address for: ${club.name} - ${club.address}`);
      const geo = await geocodeAddress(club.address);
      if (geo) {
        await Club.updateOne({ _id: club._id }, { $set: { lat: geo.lat, lng: geo.lng, district: geo.district } });
        console.log(`Updated ${club.name} with ${geo.lat}, ${geo.lng}, ${geo.district}`);
      } else {
        console.warn(`Could not geocode address for: ${club.name}`);
      }
      // Sleep a bit to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    console.log("Finished updating clubs");
    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

updateExistingClubs();
