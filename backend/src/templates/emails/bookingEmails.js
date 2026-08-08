const dayjs = require("../../utils/dayjs");

function formatWhen(startTime, timezone) {
  return dayjs(startTime).tz(timezone).format("dddd, MMMM D, YYYY [at] h:mm A z");
}

function escapeHtml(str = "") {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bookingConfirmedTemplate({ recipientName, title, startTime, timezone, hostName, attendeeName }) {
  return {
    subject: `Confirmed: ${title} with ${escapeHtml(hostName)}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Booking confirmed ✅</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p><strong>${escapeHtml(title)}</strong> between ${escapeHtml(hostName)} and ${escapeHtml(attendeeName)} is confirmed for:</p>
        <p style="font-size:16px;"><strong>${formatWhen(startTime, timezone)}</strong></p>
      </div>
    `,
  };
}

function bookingPendingTemplate({ recipientName, title, startTime, timezone, hostName, attendeeName }) {
  return {
    subject: `Pending confirmation: ${title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Booking request received ⏳</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p><strong>${escapeHtml(title)}</strong> between ${escapeHtml(hostName)} and ${escapeHtml(attendeeName)} has been requested for:</p>
        <p style="font-size:16px;"><strong>${formatWhen(startTime, timezone)}</strong></p>
        <p>This booking is awaiting confirmation from ${escapeHtml(hostName)}. You'll get another email once it's confirmed.</p>
      </div>
    `,
  };
}

function bookingCancelledTemplate({ recipientName, title, startTime, timezone, reason }) {
  return {
    subject: `Cancelled: ${title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Booking cancelled</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p><strong>${escapeHtml(title)}</strong>, originally scheduled for:</p>
        <p style="font-size:16px;"><strong>${formatWhen(startTime, timezone)}</strong></p>
        <p>has been cancelled.${reason ? ` Reason: ${escapeHtml(reason)}` : ""}</p>
      </div>
    `,
  };
}

function bookingReminderTemplate({ recipientName, title, startTime, timezone }) {
  return {
    subject: `Reminder: ${title} is coming up`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Upcoming meeting reminder ⏰</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p>This is a reminder that <strong>${escapeHtml(title)}</strong> is coming up on:</p>
        <p style="font-size:16px;"><strong>${formatWhen(startTime, timezone)}</strong></p>
      </div>
    `,
  };
}

module.exports = {
  bookingConfirmedTemplate,
  bookingPendingTemplate,
  bookingCancelledTemplate,
  bookingReminderTemplate,
};
