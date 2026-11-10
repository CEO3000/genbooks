import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatePrice } from "../src/lib/pricing.js";
import { normalizeEmail, isDisposableEmail } from "../src/lib/emailRules.js";
import { requestRejectReason, MIN_WORD_COUNT, MAX_WORD_COUNT } from "../src/lib/requestValidation.js";
import { isRequestComplete, getClientIp } from "../src/lib/requestGate.js";
import { displayProgress, PREVIEW_STAGE_BANDS } from "../src/lib/progressDisplay.js";

// ---- pricing ----

test("the base band costs 7 pounds up to 30,000 words, then 2 pounds per started 10,000", () => {
  assert.equal(estimatePrice(5000), 7);
  assert.equal(estimatePrice(30000), 7);
  assert.equal(estimatePrice(30001), 9);
  assert.equal(estimatePrice(40000), 9);
  assert.equal(estimatePrice(40001), 11);
  assert.equal(estimatePrice(100000), 21);
  assert.equal(estimatePrice(undefined), 7);
});

// ---- email rules ----

test("one person's Gmail addresses collapse to one key", () => {
  assert.equal(normalizeEmail("n.ame+1@googlemail.com"), "name@gmail.com");
  assert.equal(normalizeEmail("N.A.M.E@Gmail.com"), "name@gmail.com");
});

test("other providers keep their dots but lose a plus tag", () => {
  assert.equal(normalizeEmail("first.last+news@example.org"), "first.last@example.org");
});

test("a missing address does not throw", () => {
  assert.equal(normalizeEmail(undefined), "@");
});

test("throwaway domains are refused, including subdomains of a listed domain", () => {
  assert.equal(isDisposableEmail("someone@mailinator.com"), true);
  assert.equal(isDisposableEmail("someone@x.mailinator.com"), true);
  assert.equal(isDisposableEmail("someone@gmail.com"), false);
  assert.equal(isDisposableEmail(""), false);
});

// ---- request validation ----

const goodBook = { wordCountTarget: 30000, title: "A short title", bookDescription: "What the book is about, in one honest sentence." };

test("a normal request is accepted", () => {
  assert.equal(requestRejectReason(goodBook), null);
});

test("the word count must be inside the allowed range", () => {
  assert.match(requestRejectReason({ ...goodBook, wordCountTarget: MIN_WORD_COUNT - 1 }), /at least/);
  assert.match(requestRejectReason({ ...goodBook, wordCountTarget: MAX_WORD_COUNT + 1 }), /at most/);
  assert.match(requestRejectReason({ ...goodBook, wordCountTarget: "lots" }), /at least/);
  assert.equal(requestRejectReason({ ...goodBook, wordCountTarget: MIN_WORD_COUNT }), null);
  assert.equal(requestRejectReason({ ...goodBook, wordCountTarget: MAX_WORD_COUNT }), null);
});

test("one long message pasted into three fields is spam, two is tolerated", () => {
  const pitch = "Buy this domain name today, a unique opportunity for your brand, limited time offer. ".repeat(3);
  const spam = { ...goodBook, title: pitch, bookDescription: pitch, promise: pitch, genre: pitch };
  assert.match(requestRejectReason(spam), /pasted/);
  const twice = { ...goodBook, bookDescription: pitch, promise: pitch };
  assert.equal(requestRejectReason(twice), null);
});

test("short repeated answers are not mistaken for spam", () => {
  assert.equal(requestRejectReason({ ...goodBook, title: "Yes", subtitle: "Yes", genre: "Yes", reader: "Yes" }), null);
});

// ---- request completion and client IP ----

test("a request is complete only when both the epub and the pdf are ready", () => {
  assert.equal(isRequestComplete({ filesReady: { epub: true, pdf: true } }), true);
  assert.equal(isRequestComplete({ filesReady: { epub: true } }), false);
  assert.equal(isRequestComplete({ filesReady: { pdf: true } }), false);
  assert.equal(isRequestComplete({}), false);
  assert.equal(isRequestComplete(undefined), false);
});

test("the client IP is the first address in x-forwarded-for, then x-real-ip, then unknown", () => {
  const req = (headers) => ({ headers: new Headers(headers) });
  assert.equal(getClientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(getClientIp(req({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(getClientIp(req({})), "unknown");
});

// ---- the progress number the visitor sees ----

const t0 = Date.parse("2026-10-15T10:00:00Z");
const previewJob = (stage, progress, stageStartedAt) => ({
  status: "running", type: "preview", stage, progress, stageStartedAt: new Date(stageStartedAt).toISOString(),
});

test("a finished, failed or full-book job shows its real progress unchanged", () => {
  assert.equal(displayProgress({ status: "complete", type: "preview", progress: 100 }, t0), 100);
  assert.equal(displayProgress({ status: "failed", type: "preview", progress: 40 }, t0), 40);
  assert.equal(displayProgress({ status: "running", type: "book", stage: "writing", progress: 30 }, t0), 30);
  assert.equal(displayProgress(null, t0), 0);
});

test("inside a preview stage the number climbs with time but never reaches the end of the stage", () => {
  const [from, to] = PREVIEW_STAGE_BANDS.planning;
  const job = (secondsIn) => displayProgress(previewJob("planning", from, t0), t0 + secondsIn * 1000);
  assert.equal(job(0), from);
  assert.ok(job(55) > job(0));
  assert.ok(job(300) > job(55));
  assert.ok(job(100000) <= to - 1);
});

test("the number never goes backwards across a whole preview, even a slow one", () => {
  const stages = ["planning", "drafting", "editing", "fixing", "saving"];
  let last = -1;
  let clock = t0;
  for (const stage of stages) {
    const [from] = PREVIEW_STAGE_BANDS[stage];
    const stageStart = clock;
    for (const seconds of [0, 20, 60, 120, 400, 1200]) {
      const shown = displayProgress(previewJob(stage, from, stageStart), stageStart + seconds * 1000);
      assert.ok(shown >= last, `${stage} at ${seconds}s showed ${shown} after ${last}`);
      last = shown;
    }
    clock += 1200 * 1000;
  }
});

test("the stage bands cover 0 to 100 without a gap or an overlap", () => {
  const bands = Object.values(PREVIEW_STAGE_BANDS);
  assert.equal(bands[0][0], 0);
  assert.equal(bands.at(-1)[1], 100);
  for (let i = 1; i < bands.length; i++) assert.equal(bands[i][0], bands[i - 1][1]);
});
