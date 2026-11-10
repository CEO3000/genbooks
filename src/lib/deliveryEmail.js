// "Your book is ready" email to the customer, with a button to their book
// page (downloads stay behind sign-in there; files live in Firestore, not
// at public URLs). Sent by the pipeline the moment a book is delivered,
// and re-tried by the sweeper if that send was lost, so every delivered
// book gets exactly one email.
import { adminDb } from "./firebaseAdmin.js";
import { sendEmail, notifyAdmin } from "./notifyAdmin.js";

const SITE = "https://genbooks.uk";
// Stops the pipeline and the sweeper sending the same email twice.
const CLAIM_MS = 10 * 60 * 1000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function deliveryEmailContent({ title, firstName, link }) {
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const subject = `Your book "${title}" is ready`;
  const text = [
    greeting,
    "",
    `Your book "${title}" is ready. Download the EPUB, PDF and cover from your book page:`,
    "",
    link,
    "",
    "Sign in with this email address if asked.",
    "",
    "Any questions? Just reply to this email.",
    "The Genbooks team",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2430">
  <p style="font-size:13px;letter-spacing:2px;color:#0f766e;margin:0 0 24px;font-weight:bold">GENBOOKS</p>
  <p style="font-size:16px;margin:0 0 16px">${escapeHtml(greeting)}</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 28px">Your book <strong>${escapeHtml(title)}</strong> is ready. Download the EPUB, PDF and cover from your book page.</p>
  <a href="${link}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:999px">Download your book</a>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:28px 0 0">Sign in with this email address if asked. If the button doesn't work, copy this link into your browser:<br><a href="${link}" style="color:#0f766e">${link}</a></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:24px 0 0">Any questions? Just reply to this email.<br>The Genbooks team</p>
</div>`;
  return { subject, text, html };
}

export async function sendDeliveryEmail(requestId) {
  const db = adminDb();
  const ref = db.doc(`requests/${requestId}`);
  const book = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.deliveryEmailSentAt || data.deliveryEmailSkipped) return null;
    if (data.deliveryEmailClaimedAt && Date.now() - Date.parse(data.deliveryEmailClaimedAt) < CLAIM_MS) return null;
    tx.update(ref, { deliveryEmailClaimedAt: new Date().toISOString() });
    return data;
  });
  if (!book) return { sent: false, reason: "already sent or being sent" };

  const link = `${SITE}/books/${requestId}`;
  const profile = (await db.doc(`users/${book.ownerId}`).get()).data() || {};
  // The address typed at checkout first, then the account's own (confirmed)
  // email, then the profile copy.
  const to = book.customerEmail || book.ownerEmail || profile.email;
  if (!to) {
    await ref.update({ deliveryEmailSkipped: "no customer email on file" });
    await notifyAdmin({
      subject: `Genbooks: book delivered, but no customer email to send it to - "${book.title}"`,
      text: `The book is ready but there is no email address on file for its owner.\n\n${link}`,
    });
    return { sent: false, reason: "no customer email on file" };
  }

  const firstName = String(profile.fullName || "").trim().split(/\s+/)[0] || "";
  const result = await sendEmail({ to, ...deliveryEmailContent({ title: String(book.title || "").trim(), firstName, link }) });
  if (result.sent) {
    await ref.update({ deliveryEmailSentAt: new Date().toISOString(), deliveryEmailTo: to });
    return result;
  }
  await ref.update({ deliveryEmailLastError: result.reason });
  if (!book.deliveryEmailFailAlerted) {
    await ref.update({ deliveryEmailFailAlerted: true });
    await notifyAdmin({
      subject: `Genbooks: could not email the customer their finished book - "${book.title}"`,
      text: `Sending to ${to} failed: ${result.reason}\nIt will be retried automatically.\n\n${link}`,
    });
  }
  return result;
}
