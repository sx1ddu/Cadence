const transporter = require("../../config/mailer");
const env = require("../../config/env");
const bookingRepo = require("../../modules/bookings/booking.repository");
const { verifyEmailTemplate, passwordResetTemplate } = require("../../templates/emails/authEmails");
const {
  bookingConfirmedTemplate,
  bookingPendingTemplate,
  bookingCancelledTemplate,
  bookingReminderTemplate,
  paymentConfirmedTemplate,
} = require("../../templates/emails/bookingEmails");

/**
 * Maps a job's `name` to the template it should render, then sends it.
 * Called by the worker in jobs/workers/index.js — never called directly
 * from request handlers.
 */
async function processEmailJob(job) {
  const { name, data } = job;

  // booking-reminder is special-cased: it's the only job type that can
  // ALSO be triggered by the node-cron backup sweep (see
  // jobs/cron/reminderSweep.js), so both paths share this exact same
  // atomic claim — see bookingRepo.claimReminderSlot's docstring for why
  // this is what actually prevents duplicate reminder emails, not just a
  // reminder_sent_at flag set after the fact.
  if (name === "booking-reminder") {
    return processReminderJob(data);
  }

  const { subject, html } = renderTemplate(name, data);

  await transporter.sendMail({
    from: env.smtp.from,
    to: data.to,
    subject,
    html,
  });
}

async function processReminderJob(data) {
  const claimed = await bookingRepo.claimReminderSlot(data.bookingId);
  if (!claimed) {
    // Someone else (the cron sweep, or — in theory — a re-delivered
    // BullMQ job) already sent this booking's reminder. Do nothing.
    return false;
  }

  const recipients = [data.attendee, data.host].filter(Boolean);
  for (const recipient of recipients) {
    const { subject, html } = bookingReminderTemplate({
      recipientName: recipient.recipientName,
      title: data.title,
      startTime: data.startTime,
      timezone: recipient.timezone,
    });
    await transporter.sendMail({ from: env.smtp.from, to: recipient.to, subject, html });
  }
  return true;
}

function renderTemplate(name, data) {
  switch (name) {
    case "verify-email":
      return verifyEmailTemplate(data);
    case "password-reset":
      return passwordResetTemplate(data);
    case "booking-confirmed":
      return bookingConfirmedTemplate(data);
    case "booking-pending":
      return bookingPendingTemplate(data);
    case "booking-cancelled":
      return bookingCancelledTemplate(data);
    case "payment-confirmed":
      return paymentConfirmedTemplate(data);
    default:
      throw new Error(`Unknown email job type: ${name}`);
  }
}

module.exports = processEmailJob;
module.exports.processReminderJob = processReminderJob;
