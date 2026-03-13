require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Province = require('./models/province.model');
const District = require('./models/district.model');

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/billiard_db";

async function seedLocations() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    console.log("Fetching new 34 provinces & districts data from VietMap repo...");
    
    // We get the objects where keys are IDs and values are data
    const provRes = await axios.get('https://raw.githubusercontent.com/vietmap-company/vietnam_administrative_address/main/admin_new/province.json');
    const districtRes = await axios.get('https://raw.githubusercontent.com/vietmap-company/vietnam_administrative_address/main/admin_new/district.json').catch(() => null);
    const wardRes = await axios.get('https://raw.githubusercontent.com/vietmap-company/vietnam_administrative_address/main/admin_new/ward.json');
    
    let provincesData = provRes.data;
    let wardsData = wardRes.data;

    const provinces = Object.values(provincesData);
    const wards = Object.values(wardsData);

    console.log(`Found ${provinces.length} provinces and ${wards.length} wards/districts data.`);

    console.log("Clearing old Province and District collections...");
    await Province.deleteMany({});
    await District.deleteMany({});

    // 1. Insert Provinces
    const provinceDocs = provinces.map(p => ({
      code: String(p.code),
      name: p.name,
      slug: p.slug,
      name_with_type: p.name_with_type,
      type: p.type
    }));
    await Province.insertMany(provinceDocs);
    console.log(`✅ Inserted ${provinceDocs.length} Provinces`);

    // 2. Insert Communes (into Districts collection)
    const districtDocs = wards.map(w => ({
      code: String(w.code),
      name: w.name,
      slug: w.slug,
      name_with_type: w.name_with_type,
      type: w.type,
      province_code: String(w.parent_code)
    }));

    if (districtDocs.length > 0) {
      await District.insertMany(districtDocs);
      console.log(`✅ Inserted ${districtDocs.length} Districts (Communes)`);
    } else {
      console.log("⚠️ No communes found!");
    }

    console.log("🎉 Seeding completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
    if (error.response) console.error(error.response.data);
    process.exit(1);
  }
}

seedLocations();
