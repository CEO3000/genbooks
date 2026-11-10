// Real planning stage: asks Gemini for a structured chapter-by-chapter
// outline (the equivalent of book-writer's 03-outline.md), saved to
// Firestore so the WRITING stage has real per-chapter specs to draft
// against instead of nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callGemini } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSkill() {
  return readFileSync(join(__dirname, "house-rules", "skill.md"), "utf-8");
}

/**
 * @param {object} book - full request doc: title, subtitle, genre, tone, reader, promise,
 *   wordCountTarget, hasOwnOutline, chapterOutline (raw author-supplied text, may be empty)
 * @returns {Promise<{title: string, purpose: string, openingHook: string, mainBeats: string,
 *   takeaway: string, closingType: string, wordBudget: number}[]>}
 */
export async function generateOutline(book, callOpts = {}) {
  const skill = loadSkill();
  const authorOutline = book.hasOwnOutline && book.chapterOutline
    ? `The author already supplied this chapter list — use these exact titles and this exact order, do not invent different ones:\n${book.chapterOutline}`
    : "No author outline was supplied — design a logical chapter architecture yourself, per the house rules below.";

  const targetWords = book.wordCountTarget || 30000;
  const estimatedChapters = Math.max(8, Math.min(30, Math.round(targetWords / 2500)));

  const prompt = `You are planning the chapter architecture for a non-fiction book, following the house
rules below. ${authorOutline}

BOOK
Title: ${book.title}
Subtitle: ${book.subtitle || ""}
Genre: ${book.genre}
Tone: ${book.tone}
Target reader: ${book.reader}
Promise: ${book.promise}
Target total word count: ${targetWords} (roughly ${estimatedChapters} chapters)

Return ONLY a JSON array, no markdown fences, no commentary, one object per chapter, in this exact
shape:
[{"number": 1, "title": "...", "purpose": "one sentence naming what changes", "openingHook": "...",
"mainBeats": "...", "takeaway": "...", "closingType": "one of: question raised / reversal /
revelation / threat / decision / arrival / dread / forward pointer / conceded limit / concrete
instruction", "wordBudget": 1800}]

Word budgets must sum to approximately ${targetWords}. Closing types must not repeat back to back
(per the house rule below). Every chapter needs a clear purpose distinct from every other chapter's.

HOUSE RULES
${skill}`;

  const { text } = await callGemini(prompt, { temperature: 0.7, ...callOpts });

  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "");
  let outline;
  try {
    outline = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`generateOutline: Gemini did not return valid JSON. Raw output (first 500 chars): ${cleaned.slice(0, 500)}`);
  }
  if (!Array.isArray(outline) || outline.length === 0) {
    throw new Error("generateOutline: parsed result is not a non-empty array");
  }
  return outline;
}
