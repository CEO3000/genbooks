// generationJobs/{jobId} — the real, backend-controlled progress state the
// PDF spec asks for. The frontend only ever reads this document; it never
// writes progress itself. Every write here comes from the processing route,
// which is the one place progress is allowed to change.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebaseAdmin.js";
import { PREVIEW_STAGE_BANDS } from "../progressDisplay.js";

export const STAGES = {
  VALIDATING: "validating",
  PLANNING: "planning",
  WRITING: "writing",
  EDITING: "editing",
  REVIEW: "review",
  COVER: "cover",
  SAVING: "saving",
  COMPLETE: "complete",
  FAILED: "failed",
};

// Coarse progress bands per stage, so the bar moves smoothly within a
// stage (e.g. writing climbs per-chapter) instead of jumping only at
// stage boundaries. Matches the same "no frozen bar" principle already
// established in the house craft rules, now enforced structurally instead
// of relying on an agent to remember to post checkpoints.
export const STAGE_BANDS = {
  [STAGES.VALIDATING]: [0, 5],
  [STAGES.PLANNING]: [5, 15],
  [STAGES.WRITING]: [15, 75],
  [STAGES.EDITING]: [75, 88],
  [STAGES.REVIEW]: [88, 92],
  [STAGES.COVER]: [92, 96],
  [STAGES.SAVING]: [96, 100],
};

// A separate, much shorter stage machine for the free preview (one
// excerpt, not a whole book) — its own job, its own 0-100% run, shown
// through the exact same generic job-progress UI as a full book job.
// Once it completes, the request's currentJobId later gets replaced by a
// real book job when/if the customer pays, so the two never overlap.
export const PREVIEW_STAGES = {
  PLANNING: "planning",
  DRAFTING: "drafting",
  EDITING: "editing",
  FIXING: "fixing",
  SAVING: "saving",
  COMPLETE: "complete",
  FAILED: "failed",
};
// The bands live in progressDisplay.js, shared with the page that shows them.
export { PREVIEW_STAGE_BANDS };

// ---- Step leases and automatic retry (the pipeline's own watchdog) ----
//
// Every unit of work runs under a lease: claimStep() atomically marks the
// job as being worked on until lease.expiresAt. While a lease is live, any
// other trigger (the self-chain, the page's stall check, the scheduled
// sweeper) is a harmless no-op, so a job can never fork into two parallel
// chains paying for the same Gemini work twice. A step that dies without
// releasing its lease (platform crash, hard timeout) simply lets the lease
// run out, and the next watchdog nudge reclaims it as a new attempt.

// process/route.js's maxDuration is 300s, so no step can outlive this.
export const LEASE_MS = 330_000;
export const MAX_STEP_ATTEMPTS = 6;
// Wait before the next attempt, indexed by how many attempts have failed
// so far. Spread over ~20 minutes so a Gemini outage is ridden out rather
// than failing a customer's book in the first few seconds of it.
const RETRY_DELAYS_MS = [0, 0, 30_000, 120_000, 300_000, 900_000];

export function retryDelayAfter(failedAttempts) {
  return RETRY_DELAYS_MS[Math.min(failedAttempts, RETRY_DELAYS_MS.length - 1)];
}

// A job is waiting for a nudge when nobody holds a live lease and any
// scheduled retry delay has passed.
export function needsNudge(job, now = Date.now()) {
  if (job.status !== "running") return false;
  if (job.lease && Date.parse(job.lease.expiresAt) > now) return false;
  if (job.retryAfter && Date.parse(job.retryAfter) > now) return false;
  return true;
}

/**
 * Atomically claims the job's next step. Returns { claimed: true, job } or
 * { claimed: false, reason }. When the attempt budget for the current step
 * is exhausted, the job is failed here and reason is "gave-up".
 */
export async function claimStep(jobId) {
  const db = adminDb();
  const ref = db.doc(`generationJobs/${jobId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { claimed: false, reason: "not-found" };
    const job = snap.data();
    const now = Date.now();
    if (job.status !== "running") return { claimed: false, reason: job.status };
    if (job.lease && Date.parse(job.lease.expiresAt) > now) return { claimed: false, reason: "busy" };
    if (job.retryAfter && Date.parse(job.retryAfter) > now) return { claimed: false, reason: "waiting" };

    // A lease still present here expired without being released: the
    // previous attempt was killed mid-step and never got to record why.
    const lastError = job.lease
      ? "The previous attempt was cut off by the server before it finished"
      : job.lastError || null;
    const attempts = (job.attempts || 0) + 1;
    const nowIso = new Date(now).toISOString();

    if (attempts > MAX_STEP_ATTEMPTS) {
      tx.update(ref, {
        status: "failed",
        stage: STAGES.FAILED,
        error: lastError || "This step kept failing after every automatic retry",
        lease: null,
        updatedAt: nowIso,
      });
      return { claimed: false, reason: "gave-up", job: { jobId, ...job, error: lastError } };
    }

    tx.update(ref, {
      lease: { expiresAt: new Date(now + LEASE_MS).toISOString() },
      attempts,
      lastError,
      retryAfter: null,
      updatedAt: nowIso,
    });
    return { claimed: true, job: { jobId, ...job, attempts, lastError } };
  });
}

// The step finished cleanly: release the lease and reset the attempt
// counter, since attempts are counted per step, not per job.
export async function finishStep(jobId) {
  await updateJob(jobId, { lease: null, attempts: 0, lastError: null, retrying: false });
}

/**
 * The step threw. Releases the lease and schedules the next attempt, or
 * fails the job for good once the attempt budget is spent. Returns the
 * delay before the next attempt, or null if the job was failed.
 */
export async function recordStepFailure(job, error, { permanent = false } = {}) {
  const message = String(error?.message || error).slice(0, 2000);
  if (permanent || job.attempts >= MAX_STEP_ATTEMPTS) {
    await updateJob(job.jobId, { status: "failed", stage: STAGES.FAILED, error: message, lease: null, retrying: false });
    return null;
  }
  const delay = retryDelayAfter(job.attempts);
  await updateJob(job.jobId, {
    lease: null,
    lastError: message,
    retrying: true,
    retryAfter: delay > 0 ? new Date(Date.now() + delay).toISOString() : null,
  });
  return delay;
}

// tx is optional — pass a Firestore transaction to make job creation part
// of a larger atomic operation (see kickoff.js, which needs "does a job
// already exist for this book" and "create one" to be atomic together).
export async function createJob({ bookId, userId, totalChapters, type = "book" }, tx = null) {
  const db = adminDb();
  const ref = db.collection("generationJobs").doc();
  const job = {
    bookId,
    userId,
    type,
    status: "running",
    stage: type === "preview" ? PREVIEW_STAGES.PLANNING : STAGES.VALIDATING,
    progress: 0,
    currentChapter: 0,
    currentEditChapter: 0,
    totalChapters,
    outline: null,
    continuityNotes: [],
    message: type === "preview" ? "Planning your chapters" : "Validating request",
    error: null,
    startedAt: new Date().toISOString(),
    stageStartedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  if (tx) tx.set(ref, job);
  else await ref.set(job);
  return { jobId: ref.id, ...job };
}

export async function updateJob(jobId, patch) {
  const db = adminDb();
  const now = new Date().toISOString();
  // stageStartedAt lets the page move the bar smoothly within a stage
  // (progressDisplay.js).
  await db.doc(`generationJobs/${jobId}`).update({ ...patch, ...(patch.stage ? { stageStartedAt: now } : {}), updatedAt: now });
}

export async function getJob(jobId) {
  const db = adminDb();
  const snap = await db.doc(`generationJobs/${jobId}`).get();
  if (!snap.exists) return null;
  return { jobId: snap.id, ...snap.data() };
}

export function stageProgress(stage, fraction /* 0..1 within the stage */) {
  const [lo, hi] = STAGE_BANDS[stage] || [0, 100];
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, fraction)));
}

export function previewStageProgress(stage, fraction) {
  const [lo, hi] = PREVIEW_STAGE_BANDS[stage] || [0, 100];
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, fraction)));
}

// Real spend per job, from the token counts Gemini itself reports, so the
// cost of every preview and book can be read straight off its job doc.
// Rates: Gemini 3.1 Pro paid tier for prompts under 200k tokens, and
// Gemini 3 Pro Image at 1K/2K (ai.google.dev/gemini-api/docs/pricing,
// checked October 2026). Thinking tokens are billed as output.
const USD_PER_M_INPUT = 2;
const USD_PER_M_OUTPUT = 12;
const USD_PER_IMAGE = 0.134;

export async function recordUsage(jobId, { promptTokenCount = 0, candidatesTokenCount = 0, thoughtsTokenCount = 0, images = 0 } = {}) {
  const costUsd =
    (promptTokenCount * USD_PER_M_INPUT + (candidatesTokenCount + thoughtsTokenCount) * USD_PER_M_OUTPUT) / 1e6 +
    images * USD_PER_IMAGE;
  await adminDb().doc(`generationJobs/${jobId}`).update({
    "usage.inputTokens": FieldValue.increment(promptTokenCount),
    "usage.outputTokens": FieldValue.increment(candidatesTokenCount),
    "usage.thinkingTokens": FieldValue.increment(thoughtsTokenCount),
    "usage.images": FieldValue.increment(images),
    "usage.costUsd": FieldValue.increment(costUsd),
  });
}

export async function failJob(jobId, error) {
  await updateJob(jobId, { status: "failed", stage: STAGES.FAILED, error: String(error?.message || error), lease: null });
}

// Outline is small (specs, not prose) so it lives directly on the job doc.
export async function saveOutline(jobId, outline) {
  await updateJob(jobId, { outline });
}

// About-the-author and the introduction are both well under Firestore's
// per-field size concerns (a few hundred to ~1500 words each), so they
// live directly on the job doc too rather than needing a subcollection.
export async function saveFrontMatter(jobId, { aboutAuthor, introduction }) {
  await updateJob(jobId, { aboutAuthor, introduction });
}

// Chapter drafts are prose and can get large across a whole book, so each
// one is its own subcollection doc rather than growing the job doc toward
// Firestore's 1MB document limit.
export async function saveChapterDraft(jobId, number, { title, text, wordCount }) {
  const db = adminDb();
  await db.doc(`generationJobs/${jobId}/chapters/${number}`).set({
    number, title, text, wordCount, savedAt: new Date().toISOString(),
  });
}

export async function getChapterDraft(jobId, number) {
  const db = adminDb();
  const snap = await db.doc(`generationJobs/${jobId}/chapters/${number}`).get();
  return snap.exists ? snap.data() : null;
}

export async function getAllChapterDrafts(jobId) {
  const db = adminDb();
  const snap = await db.collection(`generationJobs/${jobId}/chapters`).orderBy("number").get();
  return snap.docs.map((d) => d.data());
}

// Continuity is kept as short per-chapter notes (purpose + takeaway, not
// full prose) so the running summary fed back into later prompts stays
// small instead of re-feeding entire earlier chapters to Gemini.
export async function appendContinuityNote(jobId, job, note) {
  // Replaces rather than duplicates, since a retried chapter appends again.
  const notes = [...(job.continuityNotes || []).filter((n) => n.number !== note.number), note];
  await updateJob(jobId, { continuityNotes: notes });
  return notes;
}
