// Shared by both real entry points into the Gemini pipeline: a paid
// Stripe checkout (stripe-webhook/route.js) and an authorized continue
// request, which includes the existing admin free-access bypass
// (generate/continue/route.js reuses the same isAdmin || isPaidOwner
// check the old flow already used). Kept in one place so both routes
// create/trigger a job identically instead of drifting apart.
import { adminDb } from "../firebaseAdmin.js";
import { createJob, getJob } from "./jobs.js";
import { triggerProcessing, kickWatchdog } from "./triggerProcessing.js";

// type: "book" (paid full generation, the default) or "preview" (the free
// excerpt, kicked off automatically right after a request is created).
export async function kickoffGenerationJob(requestId, book, request, type = "book") {
  const db = adminDb();
  const requestRef = db.doc(`requests/${requestId}`);

  // Stripe explicitly documents webhook delivery as at-least-once — the
  // same checkout.session.completed event can and does arrive more than
  // once on a slow response or transient failure. A double-click on
  // "Continue generating" is the same risk from the other entry point.
  // Without a guard, either one would create a second real generation
  // job for a book that was only ever paid for once, burning double the
  // real Gemini cost. The transaction makes "does a job already exist"
  // and "claim this book for a new job" atomic, so a duplicate delivery
  // loses the race and reuses the existing jobId instead of creating one.
  const { jobId, isNew } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    const existingJobId = snap.data()?.currentJobId;

    if (existingJobId) {
      const existingSnap = await tx.get(db.doc(`generationJobs/${existingJobId}`));
      const existingJob = existingSnap.exists ? existingSnap.data() : null;
      // Only reuse a job that's still actually running AND the same type.
      // A completed preview job sitting in currentJobId must NOT block a
      // later paid book job from being created — they are two separate
      // jobs by design, not one continuation. A dead job (failed/complete)
      // of the same type has nothing left to resume either.
      if (existingJob && existingJob.status === "running" && existingJob.type === type) {
        return { jobId: existingJobId, isNew: false };
      }
      // A finished job of the same type is never redone: pressing
      // "Continue" on an already delivered book must not pay Gemini to
      // write the whole thing a second time.
      if (existingJob && existingJob.status === "complete" && existingJob.type === type) {
        return { jobId: existingJobId, isNew: false };
      }
    }

    const totalChapters = type === "book"
      ? Math.max(8, Math.min(30, Math.round((book.wordCountTarget || 30000) / 2500)))
      : 0;
    const { jobId: newJobId } = await createJob({ bookId: requestId, userId: book.ownerId, totalChapters, type }, tx);

    // The customer-facing page (books/[id]/page.js) only watches the
    // requests/{id} doc — it has no way to discover generationJobs/{jobId}
    // otherwise. Set in the same transaction as job creation so no window
    // exists where a job exists but currentJobId doesn't point to it yet.
    tx.update(requestRef, { currentJobId: newJobId });
    return { jobId: newJobId, isNew: true };
  });

  if (!isNew) {
    // Reused an existing job. If it already finished or failed, there is
    // nothing to resume — return as-is rather than resurrecting a dead job.
    const existing = await getJob(jobId);
    if (!existing || existing.status !== "running") return jobId;
  }

  // After the response, so creating a request or acknowledging a Stripe
  // webhook isn't held up by the first step's claim. If this trigger is
  // lost, the watchdogs pick the job up (it is "running" with no lease).
  const { after } = await import("next/server");
  after(async () => {
    await triggerProcessing(jobId, request);
    await kickWatchdog(request);
  });
  return jobId;
}
