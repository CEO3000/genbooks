// Sends a real notification email to the site owner when something needs
// their attention (a new support ticket, for now), via the real
// support@genbooks.example mailbox's own SMTP, rather than a separate email
// service — no new account, and it sends and receives from the same
// address, since Zoho's free plan already gives us a real mailbox.
import nodemailer from "nodemailer";

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.ZOHO_SMTP_HOST || "smtp.zoho.eu";
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_PASSWORD;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    host, port: 465, secure: true, auth: { user, pass },
  });
  return transporter;
}

// Never throws: a failed email must never fail the action that triggered
// it (saving a support ticket, delivering a book). Callers check `sent`.
export async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  const from = process.env.ZOHO_SMTP_USER;
  if (!t || !from) return { sent: false, reason: "ZOHO_SMTP_USER or ZOHO_SMTP_PASSWORD not set" };
  if (!to) return { sent: false, reason: "no recipient" };
  try {
    await t.sendMail({ from: `Genbooks <${from}>`, to, subject, text, ...(html ? { html } : {}) });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: String(err.message || err) };
  }
}

export async function notifyAdmin({ subject, text }) {
  return sendEmail({ to: process.env.SUPPORT_NOTIFY_TO || process.env.ZOHO_SMTP_USER, subject, text });
}
