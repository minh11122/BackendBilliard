const axios = require("axios");
require("dotenv").config(); // load biến môi trường từ .env

const BREVO_API_KEY = process.env.BREVO_API_KEY; // lấy từ .env

const sendMail = async ({ to, subject, html }) => {
  try {
    const res = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Billard", email: "lem29140@gmail.com" },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("✅ Email sent via Brevo API", res.data);
    return { success: true, data: res.data };
  } catch (error) {
    console.error("❌ Send mail via API failed", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendMail };
