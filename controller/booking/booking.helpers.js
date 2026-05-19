const Notification = require("../../models/notification.model");

const HOLD_MINUTES_OVERRIDE = 2;
const PAYOS_EXPIRE_MINUTES = 2;

const notifyStaff = async (club_id, title, message, link = null) => {
  try {
    const Account = require("../../models/account.model");
    const staffs = await Account.find({ club_id, status: "ACTIVE" });
    if (staffs.length > 0) {
      const notifs = staffs.map((s) => ({
        account_id: s._id,
        title,
        message,
        link,
        is_read: false,
      }));
      await Notification.insertMany(notifs);
    }
  } catch (err) {
    console.error("Notify error:", err);
  }
};

const ensureInvoiceForBooking = async ({
  booking,
  bookingServices = [],
  tableCost,
  totalService,
  paymentMethod,
}) => {
  const Invoice = require("../../models/invoice.model");
  const InvoiceDetail = require("../../models/invoice_detail.model");

  if (!booking?._id) return null;

  const existing = await Invoice.findOne({ booking_id: booking._id }).lean();
  if (existing) return existing;

  const invoice_number = `INV-${String(booking._id).slice(-6)}-${Date.now()}`;
  const invoice_date = new Date();

  const invoice = await Invoice.create({
    booking_id: booking._id,
    table_cost: Number(tableCost || 0),
    total_service: Number(totalService || 0),
    carry_over_amount: Number(booking.carry_over_amount || 0),
    invoice_number,
    invoice_date,
    payment_method: paymentMethod,
    status: "Paid",
    note: "",
  });

  if (Array.isArray(bookingServices) && bookingServices.length > 0) {
    const details = bookingServices.map((bs) => ({
      invoice_id: invoice._id,
      booking_service_id: bs._id,
      unit_price: Number(bs.unit_price || 0),
      quantity: Number(bs.quantity || 0),
    }));
    await InvoiceDetail.insertMany(details);
  }

  return invoice;
};

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

module.exports = {
  HOLD_MINUTES_OVERRIDE,
  PAYOS_EXPIRE_MINUTES,
  notifyStaff,
  ensureInvoiceForBooking,
  timeToMinutes,
};
