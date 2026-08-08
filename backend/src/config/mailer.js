/**
 * Nodemailer transport, configured once and reused everywhere.
 * Actual sending happens inside a BullMQ worker (see jobs/processors/email.processor.js)
 * so a slow/flaky SMTP server never blocks an HTTP request.
 */
const nodemailer = require("nodemailer");
const env = require("../config/env");

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure, // true for port 465, false for 587/25
  auth: env.smtp.user
    ? {
        user: env.smtp.user,
        pass: env.smtp.password,
      }
    : undefined,
});

module.exports = transporter;
