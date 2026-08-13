const cron = require("node-cron");
const bookingRepo = require("../../modules/bookings/booking.repository");
const userRepo = require("../../modules/users/user.repository");
const { processReminderJob } = require("../processors/email.processor");

const SWEEP_WINDOW_MINUTES = 65; // slightly wider than the 60-minute lead time, so nothing slips through right at the boundary

/**
 * Runs every 15 minutes and looks for CONFIRMED bookings starting soon
 * that don't have a reminder recorded yet. This is a SAFETY NET, not the
 * primary reminder mechanism — booking.service.js's
 * scheduleReminderForBooking schedules a precise BullMQ delayed job at
 * confirmation time, which is the normal path. This sweep only matters
 * for the edge case where that didn't happen (e.g. Redis was briefly
 * unavailable at the moment of confirmation).
 *
 * Duplicate-send safety: this calls the EXACT SAME processReminderJob
 * function the BullMQ worker uses, which atomically claims
 * booking.reminder_sent_at (via bookingRepo.claimReminderSlot) before
 * sending anything. The SELECT below (findBookingsNeedingReminderSweep)
 * is only a fast pre-filter — it's the claim inside processReminderJob
 * that actually guarantees this sweep and the BullMQ delayed job can
 * never both send a reminder for the same booking, even if they run
 * within moments of each other.
 */
function startReminderSweep() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const dueBookings = await bookingRepo.findBookingsNeedingReminderSweep(SWEEP_WINDOW_MINUTES);
      let sentCount = 0;

      for (const booking of dueBookings) {
        const host = await userRepo.findById(booking.host_user_id);

        const claimedAndSent = await processReminderJob({
          bookingId: booking.id,
          title: booking.title,
          startTime: booking.start_time,
          attendee: {
            to: booking.attendee_email,
            recipientName: booking.attendee_name,
            timezone: booking.attendee_timezone,
          },
          host: host ? { to: host.email, recipientName: host.name, timezone: host.timezone } : null,
        });

        if (claimedAndSent) sentCount += 1;
      }

      if (sentCount > 0) {
        console.log(`[cron:reminder-sweep] sent reminders for ${sentCount} booking(s)`);
      }
    } catch (err) {
      console.error("[cron:reminder-sweep] failed:", err.message);
    }
  });

  console.log("[cron] reminder sweep scheduled (every 15 minutes)");
}

module.exports = { startReminderSweep };
