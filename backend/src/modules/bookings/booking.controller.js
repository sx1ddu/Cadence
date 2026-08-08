const bookingService = require("./booking.service");
const asyncHandler = require("../../utils/asyncHandler");

// Public: anyone can create a booking (bookers don't need an account)
const create = asyncHandler(async (req, res) => {
  const booking = await bookingService.createBooking(req.body);
  res.status(201).json({ success: true, data: { booking } });
});

// Public: lookup by booking uid, used by the post-booking confirmation page
const getPublic = asyncHandler(async (req, res) => {
  const booking = await bookingService.getPublicBooking(req.params.id);
  res.json({ success: true, data: { booking } });
});

// Public: the attendee cancels using the link from their confirmation email (no account needed)
const cancelPublic = asyncHandler(async (req, res) => {
  const booking = await bookingService.cancelBooking(req.params.id, { reason: req.body.reason });
  res.json({ success: true, data: { booking } });
});

// Authenticated: the host's own bookings dashboard
const listMine = asyncHandler(async (req, res) => {
  const { status, from, to } = req.query;
  const bookings = await bookingService.listMyBookings(req.dbUser.id, { status, from, to });
  res.json({ success: true, data: { bookings } });
});

const cancelMine = asyncHandler(async (req, res) => {
  const booking = await bookingService.cancelBookingAsHost(req.params.id, req.dbUser.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: { booking } });
});

const confirmMine = asyncHandler(async (req, res) => {
  const booking = await bookingService.confirmBooking(req.params.id, req.dbUser.id);
  res.json({ success: true, data: { booking } });
});

const rejectMine = asyncHandler(async (req, res) => {
  const booking = await bookingService.rejectBooking(req.params.id, req.dbUser.id, {
    reason: req.body.reason,
  });
  res.json({ success: true, data: { booking } });
});

module.exports = { create, getPublic, cancelPublic, listMine, cancelMine, confirmMine, rejectMine };
