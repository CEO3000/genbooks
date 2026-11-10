import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callGemini } from "../src/lib/ai/gemini.js";

// The Gemini client is the one place that talks to the provider, so a fake fetch is enough to exercise every outcome.
const enc = new TextEncoder();
const event = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const part = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] });

function sse(events, { splitAt = null } = {}) {
  const body = events.join("");
  const chunks = splitAt === null ? [body] : [body.slice(0, splitAt), body.slice(splitAt)];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

let calls;
const fakeFetch = (...responses) =>
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), signal: init.signal });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return typeof next === "function" ? next(init) : next.clone();
  });

beforeEach(() => {
  calls = [];
  process.env.GEMINI_API_KEY = "test-key";
});
afterEach(() => mock.restoreAll());

test("the streamed text is joined, progress is reported as it grows, and the last usage is reported", async () => {
  fakeFetch(sse([
    event({ ...part("Hello "), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } }),
    event({ ...part("world", { finishReason: "STOP" }), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }),
  ]));
  const seen = [];
  let usage;
  const { text } = await callGemini("write", { onText: (t) => seen.push(t), onUsage: (u) => (usage = u) });
  assert.equal(text, "Hello world");
  assert.deepEqual(seen, ["Hello ", "Hello world"]);
  assert.deepEqual(usage, { promptTokenCount: 10, candidatesTokenCount: 2 });
});

test("an event split across two network chunks, even in the middle of a line ending, is still read", async () => {
  const events = [event(part("one ")), event(part("two", { finishReason: "STOP" }))];
  const firstEnd = events[0].length - 1; // between the \r and the \n of the blank line
  fakeFetch(sse(events, { splitAt: firstEnd }));
  assert.equal((await callGemini("write")).text, "one two");
});

test("the model's private thinking is never returned as text", async () => {
  fakeFetch(sse([
    event({ candidates: [{ content: { parts: [{ text: "secret reasoning", thought: true }, { text: "The answer." }] }, finishReason: "STOP" }] }),
  ]));
  assert.equal((await callGemini("write")).text, "The answer.");
});

test("a response cut off by the token limit is refused, not saved as if it were complete", async () => {
  let usage;
  fakeFetch(sse([event({ ...part("A chapter that stops mid-sen", { finishReason: "MAX_TOKENS" }), usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 32768 } })]));
  await assert.rejects(callGemini("write", { onUsage: (u) => (usage = u) }), /ran out of output tokens/);
  assert.equal(usage.candidatesTokenCount, 32768, "a failed call is still billed, so its usage is still recorded");
});

test("a stream that ends without a finish reason is treated as a cut connection", async () => {
  fakeFetch(sse([event(part("half"))]));
  await assert.rejects(callGemini("write"), /ended without finishing/);
});

test("any finish reason other than STOP is an error", async () => {
  fakeFetch(sse([event(part("x", { finishReason: "SAFETY" }))]));
  await assert.rejects(callGemini("write"), /stopped early: SAFETY/);
});

test("a blocked prompt and an empty answer are errors", async () => {
  fakeFetch(sse([event({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })]));
  await assert.rejects(callGemini("write"), /blocked the prompt: PROHIBITED_CONTENT/);
  mock.restoreAll();
  fakeFetch(sse([event(part("   ", { finishReason: "STOP" }))]));
  await assert.rejects(callGemini("write"), /no text content/);
});

test("an error event inside the stream is surfaced", async () => {
  fakeFetch(sse([event({ error: { code: 500, message: "internal" } })]));
  await assert.rejects(callGemini("write"), /Gemini stream error/);
});

test("a busy service (503) is retried once, following the delay Google suggests", async () => {
  const busy = new Response(JSON.stringify({ error: { details: [{ retryDelay: "0s" }] } }), { status: 503 });
  fakeFetch(busy, sse([event(part("recovered", { finishReason: "STOP" }))]));
  assert.equal((await callGemini("write")).text, "recovered");
  assert.equal(calls.length, 2);
});

test("after two busy answers it gives up and says why, leaving longer waits to the job's own retry", async () => {
  fakeFetch(new Response(JSON.stringify({ error: { details: [{ retryDelay: "0s" }] } }), { status: 503 }));
  await assert.rejects(callGemini("write"), /Gemini API error 503/);
  assert.equal(calls.length, 2);
});

test("a rejected request (400) is not retried", async () => {
  fakeFetch(new Response("bad request", { status: 400 }));
  await assert.rejects(callGemini("write"), /Gemini API error 400/);
  assert.equal(calls.length, 1);
});

test("the request asks for room for the model's thinking and keeps the key out of the body", async () => {
  fakeFetch(sse([event(part("ok", { finishReason: "STOP" }))]));
  await callGemini("a prompt", { temperature: 0.4 });
  const [call] = calls;
  assert.match(call.url, /gemini-3\.1-pro-preview:streamGenerateContent\?alt=sse&key=test-key$/);
  assert.equal(call.body.generationConfig.maxOutputTokens, 32768);
  assert.equal(call.body.generationConfig.temperature, 0.4);
  assert.equal(call.body.contents[0].parts[0].text, "a prompt");
  assert.doesNotMatch(JSON.stringify(call.body), /test-key/);
});

test("the step's deadline aborts the call and its reason is what the caller sees", async () => {
  fakeFetch((init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
  const controller = new AbortController();
  const pending = callGemini("write", { signal: controller.signal });
  controller.abort(new Error("Step did not finish within 270s and was stopped"));
  await assert.rejects(pending, /Step did not finish within 270s/);
});

test("without an API key nothing is sent", async () => {
  delete process.env.GEMINI_API_KEY;
  fakeFetch(sse([]));
  await assert.rejects(callGemini("write"), /GEMINI_API_KEY is not set/);
  assert.equal(calls.length, 0);
});
