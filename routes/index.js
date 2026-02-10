const express = require('express');
const router = express.Router();
const Comment = require("../models/comment.model");
const Account = require("../models/account.model");
router.get('/test', (req, res) => {
  res.json({ status: 'ok' });
});
router.get("/", async (req, res) => {
  try {
    const comments = await Account.find();
    res.json({
      total: comments.length,
      data: comments
    });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching comments",
      error: error.message
    });
  }
});

module.exports = router;