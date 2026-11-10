// Assembles the real house craft rules into a single prompt and calls
// Gemini to draft one chapter. This is the first ported "agent equivalent":
// book-writer's actual behavior, minus the Claude Code Agent/Skill
// mechanism it normally runs on, reimplemented as a prompt-construction
// function a backend job can call directly.
//
// Wired into the WRITING stage of src/app/api/generate/process/route.js.
// scripts/test-gemini-chapter.mjs is still there as a standalone manual
// test harness if this needs testing in isolation from the full pipeline.

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

/**
 * @param {object} book - { title, subtitle, genre, tone, reader, promise }
 * @param {object} chapterSpec - { number, title, purpose, openingHook, mainBeats, takeaway, closingType, wordBudget }
 * @param {string} continuitySummary - relevant facts/names/promises/loops from 04-continuity.md so far
 * @param {string} previousChapterEnding - last ~300 words of the prior chapter, for a seamless seam
 */
export async function generateChapter({ book, chapterSpec, continuitySummary, previousChapterEnding }, callOpts = {}) {
  const houseRules = loadHouseRules();

  const prompt = `You are a professional book writer. Everything below the line marked "HOUSE RULES" is
the actual, binding craft system for this book — not background reading, the literal rules this
chapter must follow, including the no-em-dash rule, the NLP engagement patterns, the banned machine-
voice vocabulary, and the "chapter numbers are for you, not the reader" rule (do not write "as
chapter N showed" anywhere in the prose).

BOOK CONTEXT
Title: ${book.title}
Subtitle: ${book.subtitle}
Genre: ${book.genre}
Tone: ${book.tone}
Target reader: ${book.reader}
Promise: ${book.promise}

CHAPTER TO WRITE
Chapter ${chapterSpec.number}: ${chapterSpec.title}
Purpose: ${chapterSpec.purpose}
Opening hook: ${chapterSpec.openingHook}
Main beats: ${chapterSpec.mainBeats}
Key takeaway: ${chapterSpec.takeaway}
Closing type: ${chapterSpec.closingType}
Word budget: ${chapterSpec.wordBudget} (stay within 20% of this)

CONTINUITY SO FAR (facts, names, open loops, promises already made — do not contradict these, and do
not invent a callback to earlier chapter content that is not listed here)
${continuitySummary}

END OF PREVIOUS CHAPTER (match this seam, do not repeat it)
${previousChapterEnding}

Write ONLY the chapter itself, starting with the H1 heading in the exact form "# Chapter ${chapterSpec.number}: ${chapterSpec.title}", no preamble, no notes, no markdown code fences.

HOUSE RULES
${houseRules}`;

  const { text } = await callGemini(prompt, { ...callOpts });
  return text.trim();
}
