// Gated request creation. The client cannot write requests directly
// (firestore.rules), so every new book passes through here, where the
// free-preview rules (previewGate.js) can be enforced with a trustworthy
// IP and identity.
//
// A free preview needs a registered account with a confirmed email. A
// visitor whose email is not confirmed yet gets their request saved as
// "awaiting verification"; the preview starts from /api/requests/start-
// preview once they click the link in the confirmation email.
import { adminDb } from "../../../../lib/firebaseAdmin.js";
import { verifyFirebaseIdToken } from "../../../../lib/verifyFirebaseToken.js";
import { getClientIp } from "../../../../lib/requestGate.js";
import { verifyCaptcha } from "../../../../lib/captcha.js";
import { requestRejectReason, MIN_WORD_COUNT, MAX_WORD_COUNT } from "../../../../lib/requestValidation.js";
import { normalizeEmail, isDisposableEmail } from "../../../../lib/emailRules.js";
import {
  checkPreviewAllowed, supersedeUnstarted, startPreview, cleanDeviceId, IP_RETENTION_MS,
} from "../../../../lib/previewGate.js";

const REQUIRED_FIELDS = [
  "title", "subtitle", "authorName", "authorBio", "genre",
  "wordCountTarget", "reader", "promise", "tone", "bookDescription",
];

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
  const isAdmin = decoded.admin === true;
  if (!isAdmin && (decoded.firebase?.sign_in_provider === "anonymous" || !decoded.email)) {
    return Response.json(
      { error: "Please create a free account to get your preview.", code: "account-required" },
      { status: 401 }
    );
  }

  const body = await request.json();
  for (const field of REQUIRED_FIELDS) {
    if (!String(body[field] || "").trim()) {
      return Response.json({ error: `Missing required field: ${field}` }, { status: 400 });
    }
  }
  const wordCountTarget = Number(body.wordCountTarget);
  if (!wordCountTarget || wordCountTarget < MIN_WORD_COUNT || wordCountTarget > MAX_WORD_COUNT) {
    return Response.json(
      { error: `Please choose a target word count between ${MIN_WORD_COUNT.toLocaleString("en-GB")} and ${MAX_WORD_COUNT.toLocaleString("en-GB")}.` },
      { status: 400 }
    );
  }
  if (requestRejectReason(body)) {
    return Response.json(
      { error: "This doesn't look like a book request. Please describe your book in each field." },
      { status: 400 }
    );
  }
  if (body.hasOwnOutline && !String(body.chapterOutline || "").trim()) {
    return Response.json({ error: "chapterOutline is required when hasOwnOutline is set" }, { status: 400 });
  }
  if (!isAdmin && isDisposableEmail(decoded.email)) {
    return Response.json(
      { error: "Please use a permanent email address, not a temporary one.", code: "disposable-email" },
      { status: 400 }
    );
  }

  const db = adminDb();
  const ip = getClientIp(request);
  const deviceId = cleanDeviceId(body.deviceId);
  const emailNormalized = decoded.email ? normalizeEmail(decoded.email) : null;

  // Checked before the captcha so that a "this will replace your current
  // preview, continue?" answer can resubmit with the same captcha token.
  const gate = isAdmin
    ? { ok: true }
    : await checkPreviewAllowed({ db, uid: decoded.sub, ip, deviceId, emailNormalized, replaceExisting: body.replaceExisting === true });
  if (!gate.ok) {
    return Response.json({ error: gate.message, code: gate.code, existing: gate.existing || null }, { status: 403 });
  }

  if (!(await verifyCaptcha(body.captchaToken))) {
    return Response.json({ error: "Captcha verification failed. Please try again." }, { status: 400 });
  }

  await supersedeUnstarted(db, decoded.sub);

  const verified = isAdmin || decoded.email_verified === true;
  const now = new Date();
  const book = {
    title: body.title,
    subtitle: body.subtitle,
    authorName: body.authorName,
    authorBio: body.authorBio,
    genre: body.genre,
    reader: body.reader,
    promise: body.promise,
    tone: body.tone,
    wordCountTarget,
    hasOwnOutline: Boolean(body.hasOwnOutline),
    chapterOutline: body.chapterOutline || "",
    bookDescription: body.bookDescription,
    frontCoverDescription: body.frontCoverDescription || "",
    backCoverDescription: body.backCoverDescription || "",
    ownerId: decoded.sub,
    ownerEmail: decoded.email || null,
    ownerEmailNormalized: emailNormalized,
    creatorIp: ip,
    deviceId,
    ipExpiresAt: new Date(now.getTime() + IP_RETENTION_MS).toISOString(),
    replacesRequestId: gate.replaceId || null,
    status: verified ? "submitted" : "awaiting verification",
    progress: 0,
    paid: false,
    createdAt: now.toISOString(),
  };
  const ref = await db.collection("requests").add(book);

  if (verified) {
    await startPreview({ db, requestId: ref.id, request, ip, deviceId, replaceId: gate.replaceId || null });
  }

  return Response.json({ id: ref.id, awaitingVerification: !verified });
}
