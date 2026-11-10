// The always-on watchdog, independent of anyone having a page open. While
// any book is unfinished it re-runs itself every HEARTBEAT_MS (each run
// schedules the next, with a lock in system/watchdog so only one loop is
// ever alive). It goes quiet when nothing is in progress, and is
// restarted by any new kickoff (kickWatchdog), the GitHub Actions schedule
// (.github/workflows/watchdog.yml, every 30 min) and Vercel's daily cron
// (vercel.json), which also revive it if a loop ever dies. It checks every
// book from submission to delivery:
//
// 1. Running jobs nobody is working on (a lost self-chain trigger, a
//    crashed instance, a retry whose wait has passed) are nudged. The
//    lease in jobs.js makes a nudge to a healthy job a harmless no-op.
// 2. New requests whose free preview job never got created are started.
// 3. Books the customer confirmed with "Continue generating all pages"
//    whose full-book job never got created are started. Payment alone
//    never starts a book.
//
// A job that keeps failing is given up on inside claimStep/recordStepFailure,
// which also emails the admin, so nothing here can loop forever.
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { after } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin.js";
import { triggerProcessing, selfOrigin } from "../../../../lib/ai/triggerProcessing.js";
import { kickoffGenerationJob } from "../../../../lib/ai/kickoff.js";
import { needsNudge } from "../../../../lib/ai/jobs.js";
import { sendDeliveryEmail } from "../../../../lib/deliveryEmail.js";

// Room for HEARTBEAT_MS of waiting plus the checks themselves.
export const maxDuration = 300;
const HEARTBEAT_MS = 4 * 60 * 1000;

const PIPELINE_ENABLED = process.env.GEMINI_PIPELINE_ENABLED === "true";
// Give the normal kickoff a moment before treating a missing job as lost.
const KICKOFF_GRACE_MS = 3 * 60 * 1000;
const PREVIEW_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request) {
  // Without CRON_SECRET, anyone who finds this URL could make it start
  // previews for old requests; refuse outright rather than run open.
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = adminDb();
  const now = Date.now();
  const report = { nudged: [], previewsStarted: [], booksStarted: [], emailsSent: [] };

  const running = await db.collection("generationJobs").where("status", "==", "running").get();
  for (const doc of running.docs) {
    if (needsNudge(doc.data(), now)) {
      await triggerProcessing(doc.id);
      report.nudged.push(doc.id);
    }
  }

  if (PIPELINE_ENABLED) {
    const since = new Date(now - PREVIEW_LOOKBACK_MS).toISOString();
    const recent = await db.collection("requests").where("createdAt", ">", since).get();
    for (const doc of recent.docs) {
      const r = doc.data();
      // Only previews that passed every rule and were approved to start
      // (previewStartedAt) but whose job was lost. Never one still waiting
      // for its owner to confirm their email.
      if (!r.previewStartedAt || r.currentJobId || r.previewText || r.abandoned) continue;
      if (now - Date.parse(r.previewStartedAt) < KICKOFF_GRACE_MS) continue;
      await kickoffGenerationJob(doc.id, r, null, "preview");
      report.previewsStarted.push(doc.id);
    }

    const paid = await db.collection("requests").where("paid", "==", true).get();
    for (const doc of paid.docs) {
      const r = doc.data();
      if (r.filesReady?.epub && r.filesReady?.pdf) {
        // Delivered by the pipeline, but the "your book is ready" email
        // never went out (or failed): send it now.
        if (r.deliveredAt && !r.deliveryEmailSentAt && !r.deliveryEmailSkipped) {
          const result = await sendDeliveryEmail(doc.id);
          if (result.sent) report.emailsSent.push(doc.id);
        }
        continue;
      }
      if (r.continueRequested !== true) continue;
      if (r.continueRequestedAt && now - Date.parse(r.continueRequestedAt) < KICKOFF_GRACE_MS) continue;
      if (r.currentJobId) {
        const current = (await db.doc(`generationJobs/${r.currentJobId}`).get()).data();
        // A book job exists (running, complete or failed): it is either in
        // hand or already escalated to the admin. Only a missing one is lost.
        if (current && current.type !== "preview") continue;
      }
      await kickoffGenerationJob(doc.id, r, null, "book");
      report.booksStarted.push(doc.id);
    }
  }

  // IP addresses and browser ids are kept only as long as the weekly
  // free-preview rule needs them (previewGate.js), then erased.
  const expired = await db.collection("requests").where("ipExpiresAt", "<", new Date(now).toISOString()).limit(200).get();
  for (const doc of expired.docs) {
    await doc.ref.update({
      creatorIp: FieldValue.delete(),
      previewIp: FieldValue.delete(),
      deviceId: FieldValue.delete(),
      ipExpiresAt: FieldValue.delete(),
    });
  }
  report.ipsErased = expired.size;

  if (report.nudged.length || report.previewsStarted.length || report.booksStarted.length || report.emailsSent.length || expired.size) {
    console.log("sweep:", JSON.stringify(report));
  }

  const workInProgress = running.size > 0 || report.previewsStarted.length > 0 || report.booksStarted.length > 0;
  let heartbeat = "idle";
  if (workInProgress) {
    const beat = new URL(request.url).searchParams.get("beat");
    const token = await claimHeartbeat(db, beat);
    if (token) {
      heartbeat = "scheduled";
      after(async () => {
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS));
        try {
          await fetch(`${selfOrigin(request)}/api/generate/sweep?beat=${token}`, {
            headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
            signal: AbortSignal.timeout(60_000),
          });
        } catch (err) {
          // The loop's lock expires on its own; the next kick restarts it.
          console.error("sweep heartbeat:", err.message);
        }
      });
    } else {
      heartbeat = "already-running";
    }
  }

  return Response.json({ checkedRunning: running.size, heartbeat, ...report });
}

// Only the loop that holds the lock (proved by the token it was handed)
// may schedule the next run; any other caller starts a loop only if the
// current one has missed its beat. Returns the next token, or null.
async function claimHeartbeat(db, beatToken) {
  const ref = db.doc("system/watchdog");
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const loopAlive = current && Date.parse(current.expiresAt) > Date.now();
    if (loopAlive && current.token !== beatToken) return null;
    const token = randomUUID();
    tx.set(ref, {
      token,
      expiresAt: new Date(Date.now() + HEARTBEAT_MS + 90_000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return token;
  });
}
