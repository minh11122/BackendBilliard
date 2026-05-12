module.exports = {
  ...require("./localAuth.controller"),
  ...require("./googleAuth.controller"),
  ...require("./profile.controller"),
  ...require("./notification.controller"),
};
