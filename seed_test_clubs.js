const mongoose = require('mongoose');
require('dotenv').config();
const Club = require('./models/club.model');

async function seedTestData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    // Lấy 2 club bất kỳ để đổi state test
    const clubs = await Club.find().limit(2);
    
    if (clubs.length >= 2) {
      clubs[0].status = 'Pending';
      await clubs[0].save();
      console.log(`Updated club 1 (${clubs[0].name}) to Pending`);

      clubs[1].status = 'Rejected';
      clubs[1].reject_reason = 'Ảnh giấy phép kinh doanh bị mờ, vui lòng chụp lại rõ nét hơn.';
      await clubs[1].save();
      console.log(`Updated club 2 (${clubs[1].name}) to Rejected with reason`);
    } else {
      console.log("Not enough clubs to test");
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    mongoose.disconnect();
    console.log("Disconnected");
  }
}

seedTestData();
