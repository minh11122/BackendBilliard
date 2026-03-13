const axios = require('axios');

async function testStructure() {
    try {
        console.log("Checking Ward 001...");
        const res = await axios.get('https://raw.githubusercontent.com/vietmap-company/vietnam_administrative_address/main/admin_new/ward.json');
        const wards = Object.values(res.data);
        console.log("Total Wards:", wards.length);
        console.log("Sample Ward:", wards[0]);
        
        // Find if any ward has a path that includes 3 levels
        const threeLevels = wards.find(w => w.path_with_type.split(',').length >= 3);
        console.log("Found 3 levels sample:", threeLevels ? threeLevels.path_with_type : "Not found");
    } catch (err) {
        console.error(err.message);
    }
}

testStructure();
