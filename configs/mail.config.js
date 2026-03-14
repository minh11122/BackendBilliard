const nodemailer = require("nodemailer");
require("dotenv").config(); // load biến môi trường từ .env

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendMail = async ({ to, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: `"Billiard System" <${process.env.EMAIL_USERNAME}>`, // sender address
      to, // list of receivers (can be comma separated string or array)
      subject, // Subject line
      html, // html body
    });
    console.log("✅ Email sent: ", info.messageId);
    return { success: true, data: info };
  } catch (error) {
    console.error("❌ Send mail failed", error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendMail };
