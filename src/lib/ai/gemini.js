// Thin Gemini API client. Server-side only — GEMINI_API_KEY must never be
// exposed to the browser. Kept isolated behind this one file so the rest of
// the codebase calls generateChapter()/etc. rather than the provider
// directly, per the house rule that provider-specific code stays out of the
// UI and payment logic (this mirrors the existing pattern already used for
// Firebase in firebaseAdmin.js).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-3.1-pro-preview";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Two quick attempts here for a transient blip; anything longer-lived is
// handled one level up by the job's own step retry with real backoff
// (jobs.js), which can wait minutes between attempts without holding a
// function open.
const MAX_ATTEMPTS = 2;
const MAX_BACKOFF_MS = 5000;

// Thinking tokens count against maxOutputTokens on Gemini 3.x, and the
// model can spend 8k+ of them before writing a word, so the old 8192 cap
// produced a 277-word "2,000 word" preview cut off mid-sentence. This is a
// ceiling, not a target: billing is per token actually generated.
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

// The stream is silent while the model thinks, so this has to cover a
// long think; it exists to catch a connection that has genuinely hung.
const IDLE_TIMEOUT_MS = 150_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Google's own quota/rate-limit errors carry a RetryInfo.retryDelay hint
// (e.g. "17s") in the error body's details array.
function retryDelayMs(errorBody) {
  const match = errorBody.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!match) return null;
  return Math.min(Number(match[1]) * 1000, MAX_BACKOFF_MS);
}

/**
 * Streams the response so callers can report real progress while it is
 * written (onText receives the full text so far, after every chunk).
 * signal aborts the call, used for the job step's hard deadline.
 */
export async function callGemini(
  prompt,
  { temperature = 0.9, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, signal, onText, onUsage } = {}
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const idle = new AbortController();
    let idleTimer = setTimeout(() => idle.abort(new Error("Gemini connection stalled (no data for 150s)")), IDLE_TIMEOUT_MS);
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idle.abort(new Error("Gemini connection stalled (no data for 150s)")), IDLE_TIMEOUT_MS);
    };
    const combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;

    try {
      const res = await fetch(`${API_BASE}/${MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens },
        }),
        signal: combined,
      });

      if (res.ok) return await readStream(res, { onText, onUsage, onChunk: resetIdle });

      const body = await res.text();
      lastError = new Error(`Gemini API error ${res.status}: ${body.slice(0, 1000)}`);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(retryDelayMs(body) ?? 2000);
    } catch (err) {
      // An aborted call surfaces the abort reason, not a generic AbortError.
      if (combined.aborted) throw combined.reason instanceof Error ? combined.reason : new Error(String(combined.reason));
      throw err;
    } finally {
      clearTimeout(idleTimer);
    }
  }
  throw lastError;
}

async function readStream(res, { onText, onUsage, onChunk }) {
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason = null;
  // Every chunk carries the running token totals; the last one seen is
  // what was billed, including for a call that failed or was aborted.
  let usage = null;
  try {
    return await readEvents();
  } finally {
    if (usage && onUsage) await onUsage(usage);
  }

  async function readEvents() {

  const handleEvent = (event) => {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.error) throw new Error(`Gemini stream error: ${JSON.stringify(data.error).slice(0, 1000)}`);
      if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
      if (data.usageMetadata) usage = data.usageMetadata;
      const candidate = data.candidates?.[0];
      const piece = (candidate?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join("");
      if (piece) {
        text += piece;
        onText?.(text);
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
    }
  };

  for await (const chunk of res.body) {
    onChunk();
    // SSE events are separated by a blank line; Gemini uses \r\n line
    // endings, normalized on the whole buffer so a \r\n split across two
    // network chunks is still caught.
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      handleEvent(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) handleEvent(buffer);

  // Never hand back a silently truncated text as if it were complete.
  if (finishReason === "MAX_TOKENS") throw new Error("Gemini ran out of output tokens before finishing (response truncated)");
  if (!finishReason) throw new Error("Gemini stream ended without finishing (connection cut off)");
  if (finishReason !== "STOP") throw new Error(`Gemini stopped early: ${finishReason}`);
  if (!text.trim()) throw new Error("Gemini returned no text content");
  return { text };
  }
}
