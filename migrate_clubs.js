require('dotenv').config();
const mongoose = require('mongoose');
const Club = require('./models/club.model');
const Province = require('./models/province.model');
const District = require('./models/district.model');

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/billiard_db";

async function migrateClubs() {
  try {
    console.log("Connecting to MongoDB for migration...");
    await mongoose.connect(MONGO_URI);
    
    const hanoi = await Province.findOne({ name: /Hà Nội/i });
    if (!hanoi) {
      console.error("Hanoi province not found. Run seed_locations.js first!");
      process.exit(1);
    }

    const clubs = await Club.find({ district: { $exists: true, $ne: "" } });
    console.log(`Found ${clubs.length} clubs to migrate.`);

    for (const club of clubs) {
      // Try to find matching district (commune) in Hanoi
      // Note: In the old data, 'district' might be "Ba Đình", "Cầu Giấy", etc.
      // But in the new 2025 structure, these are either gone or renamed.
      // For now, we'll try to match name loosely or default to a safe value.
      
      const district = await District.findOne({ 
        province_code: hanoi.code,
        name: new RegExp(club.district, 'i')
      });

      if (district) {
        club.province_code = hanoi.code;
        club.district_code = district.code;
        await club.save();
        console.log(`✅ Migrated ${club.name}: ${club.district} -> ${district.name} (${district.code})`);
      } else {
        // Default to Hanoi but set district_code to null or a generic one if not found
        club.province_code = hanoi.code;
        console.log(`⚠️ Partial migration for ${club.name}: District '${club.district}' not found in 2025 schema.`);
        await club.save();
      }
    }

    console.log("🎉 Migration completed!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  }
}

migrateClubs();
