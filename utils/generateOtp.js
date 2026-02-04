function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 số
}

module.exports = {
    generateOtp
}
