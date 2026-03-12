const axios = require('axios');

async function findRepoStructure() {
  try {
    const res = await axios.get('https://api.github.com/repos/vietmap-company/vietnam_administrative_address/git/trees/main?recursive=1');
    const jsonFiles = res.data.tree.filter(item => item.path.endsWith('.json'));
    console.log(JSON.stringify(jsonFiles.map(f => f.path), null, 2));
  } catch (err) {
    console.error("Error fetching repo tree:", err.response ? err.response.status : err.message);
  }
}

findRepoStructure();
