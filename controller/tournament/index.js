module.exports = {
  ...require("./tournamentCrud.controller"),
  ...require("./tournamentRegistration.controller"),
  ...require("./tournamentBracket.controller"),
  ...require("./tournamentMatch.controller"),
  ...require("./tournamentPayment.controller"),
};
