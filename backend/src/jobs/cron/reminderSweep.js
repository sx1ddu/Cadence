const cron = require("node-cron");
const bookingRepo = require("../../modules/bookings/booking.repository");
const userRepo = require("../../modules/users/user.repository");
const emailQueue = require("../queues/email.queue");

const SWEEP_WINDOW_MINUTES = 65; // slightly wider than the 60-minute lead time, so nothing slips through right at the boundary

/**
 * Runs every 15 minutes and looks for CONFIRMED bookings starting soon
 * that don't have a reminder recorded yet. This is a SAFETY NET, not the
 * primary reminder mechanism — booking.service.js's
 * scheduleReminderForBooking schedules a precise BullMQ delayed job at
 * confirmation time, which is the normal path. This sweep only matters
 * for the edge case where that didn't happen (e.g. Redis was briefly
 * unavailable at the moment of confirmation) — belt and suspenders.
 */
function startReminderSweep() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const dueBookings = await bookingRepo.findBookingsNeedingReminderSweep(SWEEP_WINDOW_MINUTES);

      for (const booking of dueBookings) {
        const host = await userRepo.findById(booking.host_user_id);

        await emailQueue.add("booking-reminder", {
          to: booking.attendee_email,
          recipientName: booking.attendee_name,
          title: booking.title,
          startTime: booking.start_time,
          timezone: booking.attendee_timezone,
        });

        if (host) {
          await emailQueue.add("booking-reminder", {
            to: host.email,
            recipientName: host.name,
            title: booking.title,
            startTime: booking.start_time,
            timezone: host.timezone,
          });
        }

        await bookingRepo.markReminderSent(booking.id);
      }

      if (dueBookings.length > 0) {
        console.log(`[cron:reminder-sweep] queued reminders for ${dueBookings.length} booking(s)`);
      }
    } catch (err) {
      console.error("[cron:reminder-sweep] failed:", err.message);
    }
  });

  console.log("[cron] reminder sweep scheduled (every 15 minutes)");
}

module.exports = { startReminderSweep };
