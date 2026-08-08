/**
 * Plain functions that return { subject, html } for each auth-related
 * email. Deliberately not using a templating engine (Handlebars, EJS,
 * etc.) — for a handful of short emails, template literals are simpler
 * to read and debug than adding a new dependency and a template
 * compilation step.
 */

function verifyEmailTemplate({ name, verifyUrl }) {
  return {
    subject: "Verify your Cadence email address",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Welcome, ${escapeHtml(name)} 👋</h2>
        <p>Please confirm your email address to activate your Cadence account.</p>
        <p>
          <a href="${verifyUrl}"
             style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
            Verify email
          </a>
        </p>
        <p>Or paste this link into your browser:<br/>${verifyUrl}</p>
        <p style="color:#888;font-size:12px;">This link expires in 24 hours.</p>
      </div>
    `,
  };
}

function passwordResetTemplate({ name, resetUrl }) {
  return {
    subject: "Reset your Cadence password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${escapeHtml(name)},</h2>
        <p>We received a request to reset your password. If this wasn't you, you can ignore this email.</p>
        <p>
          <a href="${resetUrl}"
             style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
            Reset password
          </a>
        </p>
        <p>Or paste this link into your browser:<br/>${resetUrl}</p>
        <p style="color:#888;font-size:12px;">This link expires in 1 hour.</p>
      </div>
    `,
  };
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { verifyEmailTemplate, passwordResetTemplate };
