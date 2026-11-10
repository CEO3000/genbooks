// Who may start a free preview, decided before any Gemini money is spent.
// Every free preview needs a registered account with a confirmed email, and
// on top of that (site owner's rules, 2026-10-15):
// - one account per internet connection per week: another account that
//   started a preview in the last 7 days from the same IP, the same browser
//   (deviceId) or the same email in disguise (normalizeEmail) blocks it;
// - one unpaid preview per account at a time, replaceable once a week.
// Admin bypasses all of it. Paid books never count against anyone.
import { kickoffGenerationJob } from "./ai/kickoff.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// IPs and device ids are personal data (UK GDPR): kept only long enough to
// enforce the weekly limit, then erased by the sweeper.
export const IP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PIPELINE_ENABLED = process.env.GEMINI_PIPELINE_ENABLED === "true";

// When this request's free preview started. Requests from before this gate
// existed only have createdAt to go on.
export function previewTime(r) {
  if (r.previewStartedAt) return Date.parse(r.previewStartedAt);
  if (r.currentJobId || r.previewText) return Date.parse(r.createdAt);
  return null;
}

function day(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
}

export function cleanDeviceId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * @returns {Promise<{ok: true, replaceId?: string} | {ok: false, code: string, message: string, existing?: {id: string, title: string}}>}
 */
export async function checkPreviewAllowed({ db, uid, ip, deviceId, emailNormalized, excludeRequestId = null, replaceExisting = false }) {
  const weekAgo = Date.now() - WEEK_MS;

  const recentOtherAccounts = async (field, value) => {
    if (!value || value === "unknown") return [];
    const snap = await db.collection("requests").where(field, "==", value).get();
    return snap.docs
      .map((d) => d.data())
      .filter((r) => r.ownerId !== uid && (previewTime(r) ?? 0) > weekAgo);
  };
  const others = [
    ...(await recentOtherAccounts("creatorIp", ip)),
    ...(await recentOtherAccounts("previewIp", ip)),
    ...(await recentOtherAccounts("deviceId", deviceId)),
    ...(await recentOtherAccounts("ownerEmailNormalized", emailNormalized)),
  ];
  if (others.length) {
    const freeFrom = Math.max(...others.map(previewTime)) + WEEK_MS;
    return {
      ok: false,
      code: "one-account-per-week",
      message: `A free preview has already been made from this internet connection or device this week. Free previews are limited to one account per week, so you can start one from ${day(freeFrom)}.`,
    };
  }

  const ownSnap = await db.collection("requests").where("ownerId", "==", uid).get();
  const own = ownSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.id !== excludeRequestId);
  const active = own.find((r) => previewTime(r) !== null && !r.paid && !r.abandoned);
  if (!active) return { ok: true };

  const lastReplacement = own
    .filter((r) => r.abandoned && r.abandonedHadPreview && Date.parse(r.abandonedAt) > weekAgo)
    .sort((a, b) => Date.parse(b.abandonedAt) - Date.parse(a.abandonedAt))[0];
  const title = String(active.title || "your book").trim();
  if (lastReplacement) {
    return {
      ok: false,
      code: "replaced-this-week",
      message: `You have already started a new book this week. You can replace "${title}" from ${day(Date.parse(lastReplacement.abandonedAt) + WEEK_MS)}, or carry on with it now.`,
      existing: { id: active.id, title },
    };
  }
  if (!replaceExisting) {
    return {
      ok: false,
      code: "confirm-replace",
      message: `You already have a free preview for "${title}". Starting this book replaces it, and you can do that once a week.`,
      existing: { id: active.id, title },
    };
  }
  return { ok: true, replaceId: active.id };
}

// Submissions still waiting for an email confirmation never cost anything,
// so a newer one quietly supersedes them without using the weekly replacement.
export async function supersedeUnstarted(db, uid) {
  const snap = await db.collection("requests").where("ownerId", "==", uid).get();
  const now = new Date().toISOString();
  await Promise.all(
    snap.docs
      .filter((d) => previewTime(d.data()) === null && !d.data().abandoned && !d.data().paid)
      .map((d) => d.ref.update({ abandoned: true, abandonedAt: now, abandonedHadPreview: false, status: "replaced" }))
  );
}

/**
 * Starts the free preview once. Safe to call twice (the page's own check
 * and a manual retry): only the first call wins and kicks off the job.
 */
export async function startPreview({ db, requestId, request, ip, deviceId, replaceId = null }) {
  const ref = db.doc(`requests/${requestId}`);
  const won = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.previewStartedAt) return null;
    tx.update(ref, {
      previewStartedAt: new Date().toISOString(),
      status: "submitted",
      ...(ip && ip !== "unknown" ? { previewIp: ip } : {}),
      ...(deviceId && !data.deviceId ? { deviceId } : {}),
    });
    return data;
  });
  if (!won) return false;

  if (replaceId) {
    await db.doc(`requests/${replaceId}`).update({
      abandoned: true,
      abandonedAt: new Date().toISOString(),
      abandonedHadPreview: true,
      status: "replaced",
    });
  }
  if (PIPELINE_ENABLED) await kickoffGenerationJob(requestId, won, request, "preview");
  return true;
}
