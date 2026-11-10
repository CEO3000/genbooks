// Real free-preview generation: the opening pages of the book, written
// before the customer has paid for anything, to let them decide if they
// want to. Deliberately does not depend on a chapter outline (PLANNING
// only runs after payment) — it writes directly from the same premise/
// tone/promise fields the intake form already collects, the same way a
// human writer would draft an opening before an outline exists.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callGemini } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "house-rules");

function loadHouseRules() {
  const files = ["skill.md", "craft-nonfiction.md", "banned-tells.md", "prose-nlp.md"];
  return files
    .map((f) => `\n\n---\n# Source: ${f}\n---\n\n${readFileSync(join(RULES_DIR, f), "utf-8")}`)
    .join("");
}

export const PREVIEW_WORD_TARGET = 2000;

/**
 * @param {object} book - title, subtitle, genre, tone, reader, promise, bookDescription
 * @returns {Promise<string>}
 */
export async function generatePreviewDraft(book, callOpts = {}) {
  const houseRules = loadHouseRules();
  // The chapter plan is made at the start of the preview job (and reused
  // by the paid book), so the preview is the real opening of the real
  // Chapter 1. Older requests without a plan fall back to the book title.
  const first = Array.isArray(book.outline) ? book.outline[0] : null;
  const planNote = first
    ? `The book's chapter plan already exists. This is the opening of Chapter 1, "${first.title}".
Its job: ${first.purpose}
Planned opening hook: ${first.openingHook}`
    : "No chapter outline exists yet, so open strongly on your own judgment of what this book's first pages should do.";
  const heading = first ? `# Chapter 1: ${first.title}` : `# ${book.title}`;

  const prompt = `You are a professional book writer, drafting the opening pages of a non-fiction book
for a free preview a potential buyer reads before deciding whether to purchase the full book. This
is the actual opening of chapter one — not a summary, not a pitch, the real prose the finished book
will open with, following the "chapter numbers are for you, not the reader" and every other rule in
HOUSE RULES below.

${planNote}

BOOK
Title: ${book.title}
Subtitle: ${book.subtitle || ""}
Genre: ${book.genre}
Tone: ${book.tone}
Target reader: ${book.reader}
Promise: ${book.promise}
Description / premise: ${book.bookDescription}

Write approximately ${PREVIEW_WORD_TARGET} words. Open strong enough that a stranger deciding
whether to pay for the rest of this book wants to keep reading. Do not resolve anything or wrap up
with a summary — end at a natural, honest pausing point, not an artificial cliffhanger gimmick.
Start with the H1 heading in the exact form "${heading}", no preamble, no notes, no markdown
code fences.

HOUSE RULES
${houseRules}`;

  const { text } = await callGemini(prompt, { ...callOpts });
  return text.trim();
}
