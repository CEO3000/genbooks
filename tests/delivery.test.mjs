import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/fakeFirestore.mjs";

let db;
mock.module(new URL("../src/lib/firebaseAdmin.js", import.meta.url).href, {
  exports: { adminDb: () => db },
});
const { saveDeliveryFile, getDeliveryFileBuffer } = await import("../src/lib/ai/saveDelivery.js");
const { selfOrigin } = await import("../src/lib/ai/triggerProcessing.js");

const bytes = (n, fill = 7) => Buffer.alloc(n, fill);
const chunkIds = () => db._paths("requests/r1/files/epub/chunks").map((p) => p.split("/").at(-1)).sort();

beforeEach(() => {
  db = createFakeDb({ "requests/r1": { ownerId: "u1" } });
});

// ---- finished books are stored as base64 chunks ----

test("a file larger than one chunk is split, recorded and put back together byte for byte", async () => {
  const original = Buffer.from(Array.from({ length: 1_000_000 }, (_, i) => (i * 31) % 256));
  const result = await saveDeliveryFile("r1", "epub", original, "application/epub+zip");
  assert.equal(result.chunkCount, 2); // 1,000,000 bytes is 1,333,336 base64 characters, 700,000 per chunk
  const file = (await db.doc("requests/r1/files/epub").get()).data();
  assert.equal(file.totalBytes, 1_000_000);
  assert.equal(file.chunkCount, 2);
  assert.equal(file.mimeType, "application/epub+zip");
  const back = await getDeliveryFileBuffer("r1", "epub");
  assert.ok(back.buffer.equals(original));
  assert.equal(back.mimeType, "application/epub+zip");
});

test("saving a file marks it ready on the request", async () => {
  await saveDeliveryFile("r1", "epub", bytes(10), "application/epub+zip");
  await saveDeliveryFile("r1", "pdf", bytes(10), "application/pdf");
  const request = (await db.doc("requests/r1").get()).data();
  assert.deepEqual(request.filesReady, { epub: true, pdf: true });
});

test("re-saving a smaller file leaves no chunk of the earlier, larger one behind", async () => {
  // The bug: the download reads every chunk it finds, so a leftover chunk was appended to the new file and corrupted it.
  await saveDeliveryFile("r1", "epub", bytes(1_000_000), "application/epub+zip");
  assert.deepEqual(chunkIds(), ["0", "1"]);
  const small = bytes(10, 9);
  await saveDeliveryFile("r1", "epub", small, "application/epub+zip");
  assert.deepEqual(chunkIds(), ["0"]);
  assert.ok((await getDeliveryFileBuffer("r1", "epub")).buffer.equals(small));
});

test("a file that was never saved reads back as nothing", async () => {
  assert.equal(await getDeliveryFileBuffer("r1", "front_cover"), null);
});

// ---- chapter drafts come back in book order ----

test("every draft of a job is read back in chapter order, whatever order it was saved in", async () => {
  db = createFakeDb();
  const jobs = await import("../src/lib/ai/jobs.js");
  for (const n of [3, 1, 2]) await jobs.saveChapterDraft("job1", n, { title: `Chapter ${n}`, text: "x", wordCount: 1 });
  assert.deepEqual((await jobs.getAllChapterDrafts("job1")).map((d) => d.number), [1, 2, 3]);
});

// ---- how the app reaches itself ----

function withEnv(env, fn) {
  const keys = ["VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  }
}
const requestFrom = (origin) => ({ headers: new Headers(origin ? { origin } : {}) });

test("in production the app calls itself on its public address, never on a protected deployment address", () => {
  // The bug: a deployment address answers 401 to server-to-server calls, so no job could pass its first step.
  const env = { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "books.example.com", VERCEL_URL: "app-abc123.vercel.app" };
  assert.equal(withEnv(env, () => selfOrigin(requestFrom("https://app-abc123.vercel.app"))), "https://books.example.com");
  assert.equal(withEnv(env, () => selfOrigin(null)), "https://books.example.com");
});

test("outside production it uses the caller's origin, then the deployment address, then localhost", () => {
  assert.equal(withEnv({ VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }, () => selfOrigin(requestFrom("https://caller.example"))), "https://caller.example");
  assert.equal(withEnv({ VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }, () => selfOrigin(requestFrom(null))), "https://x.vercel.app");
  assert.equal(withEnv({}, () => selfOrigin(null)), "http://localhost:3000");
});
