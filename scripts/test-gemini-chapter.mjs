// Manual test harness for generateChapter(). Run with:
//   node scripts/test-gemini-chapter.mjs
// Requires GEMINI_API_KEY in .env.local. Writes output to a local file for
// review rather than printing raw output — a full chapter is long.
import { readFileSync, writeFileSync } from "node:fs";

// No dotenv dependency in this project yet; parse .env.local directly
// rather than adding a new package for one script.
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
  for (const line of envText.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = process.env[match[1]] || match[2];
  }
} catch {
  // .env.local missing is fine, generateChapter will throw a clear error below
}

const { generateChapter } = await import("../src/lib/ai/generateChapter.js");

const book = {
  title: "You Were Never Supposed to Know This",
  subtitle: "The Hidden Psychology Behind Every Desire, Decision, and Purchase You've Ever Made",
  genre: "Psychology / Behavioural Science / Popular Non-Fiction",
  tone: "Mysterious, intimate, authoritative, as if confiding a secret. Each chapter plants a seed early and reveals it by the end, demonstrating the mechanism on the reader in real time using real, replicated psychological effects (never a false subliminal-command claim).",
  reader: "Someone who suspects they're being influenced but can't prove it, ready to understand, doesn't yet know how.",
  promise: "By the end, the reader understands the real mechanisms behind their own decisions and has a concrete method to interrupt automatic behavior.",
};

const chapterSpec = {
  number: 5,
  title: "The Room That Speaks Without Words",
  purpose: "Show how physical environment design (layout, lighting, sound, scent) shapes behavior below conscious awareness, using a real retail-environment example the reader can picture themselves inside.",
  openingHook: "A concrete sensory scene inside a store the reader has actually been in, before naming what's happening.",
  mainBeats: "Real environmental psychology research (Kotler's atmospherics concept is real and citable); the slowed pace of movement in a large retail space; sightline and lighting design; scent as a documented, measurable lever. Demonstrate at least one real effect live on the reader within the chapter's own text, not just describe it.",
  takeaway: "The reader can name three specific environmental cues the next time they're in a space designed to slow them down.",
  closingType: "A concrete instruction the reader can act on today",
  wordBudget: 1800,
};

const continuitySummary = `Chapter 1 established the "half second before you reach for it" as the book's central image, and the checkout-line/impulse-buy motif. Chapter 2 covered the basal ganglia / habit loop. Chapter 3 covered attention as "the first spell." Chapter 4 covered pre-conscious decision-making (the "decision before the decision"). The book's recurring structural device: plant a real psychological effect early in a chapter, name it explicitly by the chapter's end. No chapter has yet covered physical/retail environment design specifically.`;

const previousChapterEnding = `You already made a decision back there, and you are only now finding out you made it. That is chapter four's whole argument, and it will not be the last time this book shows you the same thing from a different angle. The next room you walk into was built by someone who already knows this. You are about to learn how to notice it while you are still standing in the doorway.`;

console.log("Calling Gemini 3.1 Pro to draft a real chapter (this will take a while for a full chapter)...");
const start = Date.now();
try {
  const chapter = await generateChapter({ book, chapterSpec, continuitySummary, previousChapterEnding });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const wordCount = chapter.trim().split(/\s+/).filter(Boolean).length;
  writeFileSync(new URL("../_test-gemini-ch05.md", import.meta.url), chapter, "utf-8");
  console.log(`Done in ${elapsed}s. ${wordCount} words. Saved to _test-gemini-ch05.md`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}
