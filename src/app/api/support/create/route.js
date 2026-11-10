// Gated support-ticket creation, same pattern as requests/create/route.js:
// the client writes nothing directly to Firestore, this is the one place
// a ticket gets created, using the Admin SDK.
import { adminDb } from "../../../../lib/firebaseAdmin.js";
import { verifyFirebaseIdToken } from "../../../../lib/verifyFirebaseToken.js";
import { getClientIp } from "../../../../lib/requestGate.js";
import { notifyAdmin } from "../../../../lib/notifyAdmin.js";
import { verifyCaptcha } from "../../../../lib/captcha.js";

const REQUIRED_FIELDS = ["name", "email", "subject", "message"];
const MAX_MESSAGE_LENGTH = 5000;

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Missing auth token" }, { status: 401 });

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(token);
  } catch (err) {
    return Response.json({ error: "Invalid auth token", detail: err.message }, { status: 401 });
  }

  const body = await request.json();
  if (!(await verifyCaptcha(body.captchaToken))) {
    return Response.json({ error: "Captcha verification failed. Please try again." }, { status: 400 });
  }
  for (const field of REQUIRED_FIELDS) {
    if (!String(body[field] || "").trim()) {
      return Response.json({ error: `Missing required field: ${field}` }, { status: 400 });
    }
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return Response.json({ error: "That doesn't look like a valid email address" }, { status: 400 });
  }

  const db = adminDb();

  // If a requestId was passed (the customer came from a specific book's
  // page), confirm it's real and actually theirs before attaching it —
  // otherwise a ticket could falsely claim to be about someone else's book.
  let requestId = null;
  if (body.requestId) {
    const reqSnap = await db.doc(`requests/${body.requestId}`).get();
    if (reqSnap.exists && reqSnap.data().ownerId === decoded.sub) {
      requestId = body.requestId;
    }
  }

  const ref = await db.collection("supportTickets").add({
    name: body.name.trim(),
    email: body.email.trim(),
    subject: body.subject.trim(),
    message: body.message.trim(),
    requestId,
    ownerId: decoded.sub,
    creatorIp: getClientIp(request),
    status: "open",
    adminNote: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // A failed notification must never fail the ticket itself — it's
  // already safely saved in Firestore regardless of whether this sends.
  const notification = await notifyAdmin({
    subject: `Genbooks support: ${body.subject.trim()}`,
    text: `From: ${body.name.trim()} <${body.email.trim()}>\n` +
      (requestId ? `About book: ${requestId}\n` : "") +
      `\n${body.message.trim()}\n\n---\nTicket: ${ref.id}`,
  });
  if (!notification.sent) {
    console.error("support ticket notification email not sent:", notification.reason);
  }

  return Response.json({ id: ref.id });
}
