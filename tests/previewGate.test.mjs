import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/fakeFirestore.mjs";

process.env.GEMINI_PIPELINE_ENABLED = "true"; // read once when previewGate.js loads

const kickoffCalls = [];
mock.module(new URL("../src/lib/ai/kickoff.js", import.meta.url).href, {
  exports: { kickoffGenerationJob: async (...args) => kickoffCalls.push(args) },
});
const { checkPreviewAllowed, supersedeUnstarted, startPreview, previewTime, cleanDeviceId, IP_RETENTION_MS } =
  await import("../src/lib/previewGate.js");

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const DEVICE = "0f8fad5b-d9cb-469f-a165-70867728950e";
let db;

beforeEach(() => {
  db = createFakeDb();
  kickoffCalls.length = 0;
});

const ask = (overrides = {}) =>
  checkPreviewAllowed({ db, uid: "me", ip: "203.0.113.7", deviceId: DEVICE, emailNormalized: "me@example.org", ...overrides });

test("a first preview is allowed", async () => {
  assert.deepEqual(await ask(), { ok: true });
});

test("another account that started a preview from the same connection this week blocks it", async () => {
  await db.doc("requests/other").set({ ownerId: "someone", creatorIp: "203.0.113.7", previewStartedAt: ago(2 * DAY) });
  const result = await ask();
  assert.equal(result.ok, false);
  assert.equal(result.code, "one-account-per-week");
  assert.match(result.message, /one account per week/);
});

test("the same browser or the same email in disguise blocks it too", async () => {
  await db.doc("requests/a").set({ ownerId: "x", deviceId: DEVICE, previewStartedAt: ago(DAY) });
  assert.equal((await ask({ ip: "198.51.100.1" })).code, "one-account-per-week");

  db = createFakeDb();
  await db.doc("requests/b").set({ ownerId: "y", ownerEmailNormalized: "me@example.org", previewStartedAt: ago(DAY) });
  assert.equal((await ask({ ip: "198.51.100.1", deviceId: null })).code, "one-account-per-week");
});

test("after a week the same connection may start another preview", async () => {
  await db.doc("requests/old").set({ ownerId: "someone", creatorIp: "203.0.113.7", previewStartedAt: ago(8 * DAY) });
  assert.deepEqual(await ask(), { ok: true });
});

test("a connection only counts if it actually started a preview", async () => {
  // created but never confirmed, so no preview and no money spent
  await db.doc("requests/pending").set({ ownerId: "someone", creatorIp: "203.0.113.7", createdAt: ago(DAY) });
  assert.deepEqual(await ask(), { ok: true });
});

test("an unknown connection is never treated as 'the same connection'", async () => {
  await db.doc("requests/a").set({ ownerId: "x", creatorIp: "unknown", previewStartedAt: ago(DAY) });
  assert.deepEqual(await ask({ ip: "unknown" }), { ok: true });
});

test("an account's own unpaid preview must be confirmed before it is replaced", async () => {
  await db.doc("requests/mine").set({ ownerId: "me", title: "My first book", previewStartedAt: ago(3 * DAY), paid: false });
  const asked = await ask();
  assert.equal(asked.code, "confirm-replace");
  assert.equal(asked.existing.title, "My first book");

  const confirmed = await ask({ replaceExisting: true });
  assert.deepEqual(confirmed, { ok: true, replaceId: "mine" });
});

test("a paid book never counts against the account", async () => {
  await db.doc("requests/mine").set({ ownerId: "me", previewStartedAt: ago(3 * DAY), paid: true });
  assert.deepEqual(await ask(), { ok: true });
});

test("a preview can be replaced once a week, not twice", async () => {
  await db.doc("requests/old").set({
    ownerId: "me", abandoned: true, abandonedHadPreview: true, abandonedAt: ago(2 * DAY), previewStartedAt: ago(5 * DAY),
  });
  await db.doc("requests/current").set({ ownerId: "me", title: "Current", previewStartedAt: ago(DAY), paid: false });
  const result = await ask({ replaceExisting: true });
  assert.equal(result.code, "replaced-this-week");
});

test("the request being checked is left out of its own check", async () => {
  await db.doc("requests/self").set({ ownerId: "me", previewStartedAt: ago(DAY), paid: false });
  assert.deepEqual(await ask({ excludeRequestId: "self" }), { ok: true });
});

test("previewTime uses the start time, then falls back to the creation time for older requests", () => {
  assert.equal(previewTime({ previewStartedAt: "2026-10-01T00:00:00Z" }), Date.parse("2026-10-01T00:00:00Z"));
  assert.equal(previewTime({ currentJobId: "j", createdAt: "2026-09-01T00:00:00Z" }), Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(previewTime({ previewText: "x", createdAt: "2026-09-01T00:00:00Z" }), Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(previewTime({ createdAt: "2026-09-01T00:00:00Z" }), null);
});

test("only a well-formed browser id is accepted", () => {
  assert.equal(cleanDeviceId(DEVICE.toUpperCase()), DEVICE);
  assert.equal(cleanDeviceId("not-an-id"), null);
  assert.equal(cleanDeviceId(42), null);
  assert.equal(cleanDeviceId(undefined), null);
});

test("IP addresses and browser ids are kept for 90 days at most", () => {
  assert.equal(IP_RETENTION_MS, 90 * DAY);
});

test("requests still waiting for an email confirmation are quietly superseded, not counted", async () => {
  await db.doc("requests/waiting").set({ ownerId: "me", status: "awaiting verification", createdAt: ago(DAY) });
  await db.doc("requests/started").set({ ownerId: "me", previewStartedAt: ago(DAY), paid: false });
  await supersedeUnstarted(db, "me");
  assert.equal((await db.doc("requests/waiting").get()).data().abandoned, true);
  assert.equal((await db.doc("requests/started").get()).data().abandoned, undefined);
});

test("starting a preview twice starts it once, and the old preview is retired once", async () => {
  await db.doc("requests/new").set({ ownerId: "me", createdAt: ago(1000) });
  await db.doc("requests/old").set({ ownerId: "me", previewStartedAt: ago(3 * DAY), paid: false });

  const args = { db, requestId: "new", request: {}, ip: "203.0.113.7", deviceId: DEVICE, replaceId: "old" };
  const results = await Promise.all([startPreview(args), startPreview(args)]);

  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(kickoffCalls.length, 1);
  assert.equal(kickoffCalls[0][0], "new");
  assert.equal(kickoffCalls[0][3], "preview");
  const old = (await db.doc("requests/old").get()).data();
  assert.equal(old.abandoned, true);
  assert.equal(old.abandonedHadPreview, true);
  const fresh = (await db.doc("requests/new").get()).data();
  assert.equal(fresh.previewIp, "203.0.113.7");
  assert.equal(fresh.deviceId, DEVICE);
});
