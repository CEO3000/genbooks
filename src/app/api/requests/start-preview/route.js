// Starts a free preview that was waiting for its owner to confirm their
// email. Called by the book page as soon as it sees the confirmation (it
// checks every few seconds while the visitor waits, and again whenever
// they come back). The weekly rules are checked again here, because time
// may have passed since the request was submitted.
import { adminDb } from "../../../../lib/firebaseAdmin.js";
import { verifyFirebaseIdToken } from "../../../../lib/verifyFirebaseToken.js";
import { getClientIp } from "../../../../lib/requestGate.js";
import { checkPreviewAllowed, startPreview, cleanDeviceId } from "../../../../lib/previewGate.js";

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

  const { requestId, deviceId: rawDeviceId } = await request.json().catch(() => ({}));
  if (!requestId) return Response.json({ error: "requestId is required" }, { status: 400 });

  const db = adminDb();
  const snap = await db.doc(`requests/${requestId}`).get();
  if (!snap.exists) return Response.json({ error: "Request not found" }, { status: 404 });
  const r = snap.data();
  if (!isAdmin && r.ownerId !== decoded.sub) return Response.json({ error: "Not your book" }, { status: 403 });

  if (r.previewStartedAt || r.currentJobId) return Response.json({ ok: true, alreadyStarted: true });
  if (r.abandoned) {
    return Response.json({ error: "This book was replaced by a newer one.", code: "replaced" }, { status: 409 });
  }
  if (!isAdmin && decoded.email_verified !== true) {
    return Response.json({ error: "Please confirm your email first.", code: "not-verified" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const deviceId = cleanDeviceId(rawDeviceId) || r.deviceId || null;
  const gate = isAdmin
    ? { ok: true }
    : await checkPreviewAllowed({
      db,
      uid: r.ownerId,
      ip,
      deviceId,
      emailNormalized: r.ownerEmailNormalized,
      excludeRequestId: requestId,
      replaceExisting: Boolean(r.replacesRequestId),
    });
  if (!gate.ok) {
    return Response.json({ error: gate.message, code: gate.code, existing: gate.existing || null }, { status: 403 });
  }

  await startPreview({ db, requestId, request, ip, deviceId, replaceId: gate.replaceId || null });
  return Response.json({ ok: true });
}
