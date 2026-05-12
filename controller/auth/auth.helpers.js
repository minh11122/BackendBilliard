const jwt = require("jsonwebtoken");

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim() : email;

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : value;

const buildAuthToken = (account, roleName) =>
  jwt.sign(
    {
      accountId: account._id,
      roleId: account.role_id._id,
      role: roleName,
      ...(account.club_id && { club_id: account.club_id }),
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

const buildLegacyGoogleAuthToken = (account) =>
  jwt.sign(
    { accountId: account._id, roleId: account.role_id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

module.exports = {
  normalizeEmail,
  normalizeString,
  buildAuthToken,
  buildLegacyGoogleAuthToken,
};
