module.exports = {
  ...require("./customerBooking.controller"),
  ...require("./staffBooking.controller"),
  ...require("./bookingPayment.controller"),
  ...require("./bookingService.controller"),
};
