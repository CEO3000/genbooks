import { adminDb } from "../../../lib/firebaseAdmin";
import { verifyFirebaseIdToken } from "../../../lib/verifyFirebaseToken";
import { kickoffGenerationJob } from "../../../lib/ai/kickoff.js";

// Same gate as stripe-webhook/route.js: unset in production today, so this
// change doesn't affect the existing manual/agent-driven flow that every
// real book so far has gone through. See that file's own comment for why
// it must stay off until the Gemini billing wall is resolved.
const PIPELINE_ENABLED = process.env.GEMINI_PIPELINE_ENABLED === "true";

// Payment (or being the admin) only unlocks the ability to continue; this
// route is the explicit, separate signal that the reader actually wants
// the rest of the book written now. Nothing writes the full manuscript
// just because payment succeeded, only because this was called.
export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(token);
  } catch (err) {
    return Response.json({ error: "Invalid auth token", detail: err.message }, { status: 401 });
  }

  const { requestId } = await request.json();
  if (!requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 });
  }

  const ref = adminDb().doc(`requests/${requestId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return Response.json({ error: "Request not found" }, { status: 404 });
  }
  const data = snap.data();

  const isAdmin = decoded.admin === true;
  const isPaidOwner = decoded.sub === data.ownerId && data.paid === true;
  if (!isAdmin && !isPaidOwner) {
    return Response.json({ error: "Not authorized to continue this book" }, { status: 403 });
  }

  await ref.update({ continueRequested: true, continueRequestedAt: new Date().toISOString(), status: "writing" });

  // Admin gets the same free pass into the new pipeline that they already
  // get into the old one (isAdmin was already checked above) — no separate
  // "free for admin" logic needed here, it's the same authorization gate.
  if (PIPELINE_ENABLED) {
    await kickoffGenerationJob(requestId, data, request);
  }

  return Response.json({ ok: true });
}
