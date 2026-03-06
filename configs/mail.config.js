const axios = require("axios");
require("dotenv").config(); 

const BREVO_API_KEY = process.env.BREVO_API_KEY; 

const sendMail = async ({ to, subject, html }) => {
  try {
    const res = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Billard", email: "minhlthe173541@fpt.edu.vn" },
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
