// Admin-only: mark a support ticket resolved, optionally with a note.
// Same defense-in-depth pattern as the rest of this project — even a
// trusted admin action goes through the Admin SDK server-side rather than
// a direct client write, so firestore.rules can refuse all client writes
// to supportTickets unconditionally.
import { adminDb } from "../../../../lib/firebaseAdmin.js";
import { verifyFirebaseIdToken } from "../../../../lib/verifyFirebaseToken.js";

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
  if (decoded.admin !== true) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const { ticketId, adminNote } = await request.json();
  if (!ticketId) return Response.json({ error: "ticketId required" }, { status: 400 });

  const db = adminDb();
  const ref = db.doc(`supportTickets/${ticketId}`);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ error: "Ticket not found" }, { status: 404 });

  await ref.update({
    status: "resolved",
    adminNote: adminNote || snap.data().adminNote || "",
    updatedAt: new Date().toISOString(),
  });

  return Response.json({ ok: true });
}
