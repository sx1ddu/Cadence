const transporter = require("../../config/mailer");
const env = require("../../config/env");
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

  let subject, html;

  switch (name) {
    case "verify-email": {
      ({ subject, html } = verifyEmailTemplate(data));
      break;
    }
    case "password-reset": {
      ({ subject, html } = passwordResetTemplate(data));
      break;
    }
    case "booking-confirmed": {
      ({ subject, html } = bookingConfirmedTemplate(data));
      break;
    }
    case "booking-pending": {
      ({ subject, html } = bookingPendingTemplate(data));
      break;
    }
    case "booking-cancelled": {
      ({ subject, html } = bookingCancelledTemplate(data));
      break;
    }
    case "booking-reminder": {
      ({ subject, html } = bookingReminderTemplate(data));
      break;
    }
    case "payment-confirmed": {
      ({ subject, html } = paymentConfirmedTemplate(data));
      break;
    }
    default:
      throw new Error(`Unknown email job type: ${name}`);
  }

  await transporter.sendMail({
    from: env.smtp.from,
    to: data.to,
    subject,
    html,
  });
}

module.exports = processEmailJob;
