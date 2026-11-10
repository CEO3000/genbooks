import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/fakeFirestore.mjs";

// The job system talks to Firestore through adminDb(). Swap that one function for the in-memory stand-in.
let db;
mock.module(new URL("../src/lib/firebaseAdmin.js", import.meta.url).href, {
  exports: { adminDb: () => db },
});
const jobs = await import("../src/lib/ai/jobs.js");
const { STAGES, STAGE_BANDS, LEASE_MS, MAX_STEP_ATTEMPTS, retryDelayAfter, needsNudge, stageProgress } = jobs;

const iso = (ms) => new Date(ms).toISOString();
const newRunningJob = async () => {
  const { jobId } = await jobs.createJob({ bookId: "book1", userId: "user1", totalChapters: 10 });
  return jobId;
};

beforeEach(() => {
  db = createFakeDb();
});

// ---- pure helpers ----

test("retry delays grow with each failed attempt and stop growing at the last one", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(retryDelayAfter), [0, 0, 30_000, 120_000, 300_000, 900_000]);
  assert.equal(retryDelayAfter(50), 900_000);
});

test("a job needs a nudge only when it is running, has no live lease and its retry wait is over", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");
  assert.equal(needsNudge({ status: "running" }, now), true);
  assert.equal(needsNudge({ status: "complete" }, now), false);
  assert.equal(needsNudge({ status: "failed" }, now), false);
  assert.equal(needsNudge({ status: "running", lease: { expiresAt: iso(now + 1000) } }, now), false);
  assert.equal(needsNudge({ status: "running", lease: { expiresAt: iso(now - 1000) } }, now), true);
  assert.equal(needsNudge({ status: "running", retryAfter: iso(now + 1000) }, now), false);
  assert.equal(needsNudge({ status: "running", retryAfter: iso(now - 1000) }, now), true);
});

test("the lease outlasts the longest step the platform allows", () => {
  const platformMaxDurationMs = 300_000; // maxDuration in generate/process/route.js
  assert.ok(LEASE_MS > platformMaxDurationMs);
});

test("the retry schedule rides out roughly twenty minutes of provider trouble", () => {
  const total = [0, 1, 2, 3, 4, 5].map(retryDelayAfter).reduce((a, b) => a + b, 0);
  assert.ok(total >= 15 * 60_000 && total <= 25 * 60_000, `total wait was ${total / 60_000} minutes`);
});

test("book stages cover 0 to 100 in order, and progress is clamped inside a stage", () => {
  const order = [STAGES.VALIDATING, STAGES.PLANNING, STAGES.WRITING, STAGES.EDITING, STAGES.REVIEW, STAGES.COVER, STAGES.SAVING];
  assert.equal(STAGE_BANDS[order[0]][0], 0);
  assert.equal(STAGE_BANDS[order.at(-1)][1], 100);
  for (let i = 1; i < order.length; i++) assert.equal(STAGE_BANDS[order[i]][0], STAGE_BANDS[order[i - 1]][1]);
  assert.equal(stageProgress(STAGES.WRITING, 0), 15);
  assert.equal(stageProgress(STAGES.WRITING, 0.5), 45);
  assert.equal(stageProgress(STAGES.WRITING, 1), 75);
  assert.equal(stageProgress(STAGES.WRITING, 7), 75);
  assert.equal(stageProgress(STAGES.WRITING, -3), 15);
});

// ---- the lease: only one worker per job ----

test("a new job starts running at the first stage", async () => {
  const jobId = await newRunningJob();
  const job = await jobs.getJob(jobId);
  assert.equal(job.status, "running");
  assert.equal(job.stage, STAGES.VALIDATING);
  assert.equal(job.type, "book");
});

test("the first claim wins and a second one is refused while the lease is live", async () => {
  const jobId = await newRunningJob();
  const first = await jobs.claimStep(jobId);
  assert.equal(first.claimed, true);
  assert.equal(first.job.attempts, 1);
  const second = await jobs.claimStep(jobId);
  assert.deepEqual({ claimed: second.claimed, reason: second.reason }, { claimed: false, reason: "busy" });
});

test("many triggers at once still produce exactly one worker", async () => {
  const jobId = await newRunningJob();
  const results = await Promise.all(Array.from({ length: 8 }, () => jobs.claimStep(jobId)));
  assert.equal(results.filter((r) => r.claimed).length, 1);
  assert.equal(results.filter((r) => r.reason === "busy").length, 7);
});

test("a lease that ran out is taken over and the cut-off is recorded", async () => {
  const jobId = await newRunningJob();
  await jobs.claimStep(jobId);
  await db.doc(`generationJobs/${jobId}`).update({ lease: { expiresAt: iso(Date.now() - 1000) } });
  const retaken = await jobs.claimStep(jobId);
  assert.equal(retaken.claimed, true);
  assert.equal(retaken.job.attempts, 2);
  assert.match(retaken.job.lastError, /cut off/);
});

test("a claim waits while a scheduled retry delay has not passed", async () => {
  const jobId = await newRunningJob();
  await db.doc(`generationJobs/${jobId}`).update({ retryAfter: iso(Date.now() + 60_000) });
  const result = await jobs.claimStep(jobId);
  assert.deepEqual({ claimed: result.claimed, reason: result.reason }, { claimed: false, reason: "waiting" });
});

test("finished, failed and missing jobs cannot be claimed", async () => {
  const jobId = await newRunningJob();
  await db.doc(`generationJobs/${jobId}`).update({ status: "complete" });
  assert.equal((await jobs.claimStep(jobId)).reason, "complete");
  await db.doc(`generationJobs/${jobId}`).update({ status: "failed" });
  assert.equal((await jobs.claimStep(jobId)).reason, "failed");
  assert.equal((await jobs.claimStep("does-not-exist")).reason, "not-found");
});

// ---- retry budget ----

test("finishing a step releases the lease and resets the attempt count", async () => {
  const jobId = await newRunningJob();
  await jobs.claimStep(jobId);
  await jobs.finishStep(jobId);
  const job = await jobs.getJob(jobId);
  assert.equal(job.lease, null);
  assert.equal(job.attempts, 0);
});

test("a failed step schedules the next attempt with the right delay", async () => {
  const jobId = await newRunningJob();
  const { job } = await jobs.claimStep(jobId);
  const delay = await jobs.recordStepFailure(job, new Error("Gemini API error 503"));
  assert.equal(delay, retryDelayAfter(1));
  const stored = await jobs.getJob(jobId);
  assert.equal(stored.status, "running");
  assert.equal(stored.lease, null);
  assert.equal(stored.retrying, true);
  assert.match(stored.lastError, /503/);
});

test("a permanent error fails the job at once, without using the retry budget", async () => {
  const jobId = await newRunningJob();
  const { job } = await jobs.claimStep(jobId);
  const delay = await jobs.recordStepFailure(job, new Error("Refusing to write a full book that has not been paid for"), { permanent: true });
  assert.equal(delay, null);
  const stored = await jobs.getJob(jobId);
  assert.equal(stored.status, "failed");
  assert.equal(stored.stage, STAGES.FAILED);
});

test("a step that keeps failing is given up on after the attempt budget, and the claim says so", async () => {
  const jobId = await newRunningJob();
  for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
    const { claimed, job } = await jobs.claimStep(jobId);
    assert.equal(claimed, true, `attempt ${attempt}`);
    if (attempt < MAX_STEP_ATTEMPTS) {
      await jobs.recordStepFailure(job, new Error("still failing"));
      // skip the real wait between attempts; its length is covered by the retry-delay test above
      await db.doc(`generationJobs/${jobId}`).update({ retryAfter: null });
    } else {
      assert.equal(await jobs.recordStepFailure(job, new Error("still failing")), null);
    }
  }
  const stored = await jobs.getJob(jobId);
  assert.equal(stored.status, "failed");
  assert.match(stored.error, /still failing/);
});

test("a lease that keeps expiring without a record ends in failure, not an endless loop", async () => {
  const jobId = await newRunningJob();
  let last;
  for (let i = 0; i <= MAX_STEP_ATTEMPTS; i++) {
    await db.doc(`generationJobs/${jobId}`).update({ lease: { expiresAt: iso(Date.now() - 1000) }, retryAfter: null, attempts: i });
    last = await jobs.claimStep(jobId);
  }
  assert.equal(last.claimed, false);
  assert.equal(last.reason, "gave-up");
  assert.equal((await jobs.getJob(jobId)).status, "failed");
});

// ---- the data a step leaves behind ----

test("chapter drafts are stored one per document and read back by number", async () => {
  const jobId = await newRunningJob();
  await jobs.saveChapterDraft(jobId, 2, { title: "Second", text: "two", wordCount: 1 });
  await jobs.saveChapterDraft(jobId, 1, { title: "First", text: "one", wordCount: 1 });
  assert.equal((await jobs.getChapterDraft(jobId, 1)).title, "First");
  assert.equal(await jobs.getChapterDraft(jobId, 9), null);
});

test("a retried chapter replaces its continuity note instead of adding a second one", async () => {
  const jobId = await newRunningJob();
  let job = await jobs.getJob(jobId);
  let notes = await jobs.appendContinuityNote(jobId, job, { number: 1, title: "A", purpose: "p", takeaway: "t" });
  job = await jobs.getJob(jobId);
  notes = await jobs.appendContinuityNote(jobId, job, { number: 1, title: "A again", purpose: "p", takeaway: "t" });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "A again");
});
