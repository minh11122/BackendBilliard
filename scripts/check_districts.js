const mongoose = require('mongoose');
const Club = require('../models/club.model');
require('dotenv').config();

async function checkDistricts() {
  try {
    const MONGO_URI = process.env.MONGODB_ALATAS_URL || process.env.MONGODB_URL;
    await mongoose.connect(MONGO_URI);
    const clubs = await Club.find({ status: 'Approved' });
    console.log('--- Approved Clubs District Status ---');
    clubs.forEach(c => {
      console.log(`${c.name.padEnd(30)} | ${c.district || 'MISSING'}`);
    });
    console.log('--- End of List ---');
    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkDistricts();
