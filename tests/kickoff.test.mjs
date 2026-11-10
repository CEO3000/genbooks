import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/fakeFirestore.mjs";

let db;
const afterCallbacks = [];
const triggered = [];

mock.module(new URL("../src/lib/firebaseAdmin.js", import.meta.url).href, {
  exports: { adminDb: () => db },
});
// `after` only exists inside a request; here it just records what would run after the response.
mock.module("next/server", { exports: { after: (fn) => afterCallbacks.push(fn) } });
mock.module(new URL("../src/lib/ai/triggerProcessing.js", import.meta.url).href, {
  exports: {
    triggerProcessing: async (jobId) => triggered.push(["process", jobId]),
    kickWatchdog: async () => triggered.push(["watchdog"]),
    selfOrigin: () => "http://localhost:3000",
  },
});
const { kickoffGenerationJob } = await import("../src/lib/ai/kickoff.js");

const book = { ownerId: "user1", wordCountTarget: 30000 };
const jobCount = () => db._paths("generationJobs").length;

beforeEach(() => {
  db = createFakeDb({ "requests/r1": { ownerId: "user1", paid: true } });
  afterCallbacks.length = 0;
  triggered.length = 0;
});

test("the same paid book started twice (a repeated Stripe webhook) makes one job", async () => {
  const [a, b] = await Promise.all([
    kickoffGenerationJob("r1", book, null, "book"),
    kickoffGenerationJob("r1", book, null, "book"),
  ]);
  assert.equal(a, b);
  assert.equal(jobCount(), 1);
  assert.equal((await db.doc("requests/r1").get()).data().currentJobId, a);
});

test("many simultaneous starts still make one job", async () => {
  const ids = await Promise.all(Array.from({ length: 6 }, () => kickoffGenerationJob("r1", book, null, "book")));
  assert.equal(new Set(ids).size, 1);
  assert.equal(jobCount(), 1);
});

test("only the call that created the job schedules work", async () => {
  await kickoffGenerationJob("r1", book, null, "book");
  assert.equal(afterCallbacks.length, 1);
  await kickoffGenerationJob("r1", book, null, "book");
  assert.equal(afterCallbacks.length, 2); // the job is still running, so a repeat may nudge it; it creates nothing
  assert.equal(jobCount(), 1);
  await afterCallbacks[0]();
  assert.deepEqual(triggered.map((t) => t[0]), ["process", "watchdog"]);
});

test("a finished book is never written a second time", async () => {
  const jobId = await kickoffGenerationJob("r1", book, null, "book");
  await db.doc(`generationJobs/${jobId}`).update({ status: "complete" });
  afterCallbacks.length = 0;
  const again = await kickoffGenerationJob("r1", book, null, "book");
  assert.equal(again, jobId);
  assert.equal(jobCount(), 1);
  assert.equal(afterCallbacks.length, 0, "nothing is scheduled for a job that is already complete");
});

test("a failed book job is replaced by a new one, because there is nothing left to resume", async () => {
  const jobId = await kickoffGenerationJob("r1", book, null, "book");
  await db.doc(`generationJobs/${jobId}`).update({ status: "failed" });
  const next = await kickoffGenerationJob("r1", book, null, "book");
  assert.notEqual(next, jobId);
  assert.equal(jobCount(), 2);
});

test("a finished free preview does not block the paid book that follows it", async () => {
  const previewId = await kickoffGenerationJob("r1", book, null, "preview");
  await db.doc(`generationJobs/${previewId}`).update({ status: "complete" });
  const bookId = await kickoffGenerationJob("r1", book, null, "book");
  assert.notEqual(bookId, previewId);
  assert.equal(jobCount(), 2);
  assert.equal((await db.doc("requests/r1").get()).data().currentJobId, bookId);
});

test("a preview plans no chapters, and a book plans one per 2,500 words between 8 and 30", async () => {
  const chaptersFor = async (words, type = "book") => {
    db = createFakeDb({ "requests/r1": { ownerId: "user1" } });
    const id = await kickoffGenerationJob("r1", { ownerId: "user1", wordCountTarget: words }, null, type);
    return (await db.doc(`generationJobs/${id}`).get()).data().totalChapters;
  };
  assert.equal(await chaptersFor(30000, "preview"), 0);
  assert.equal(await chaptersFor(5000), 8);
  assert.equal(await chaptersFor(30000), 12);
  assert.equal(await chaptersFor(100000), 30);
  assert.equal(await chaptersFor(undefined), 12);
});
