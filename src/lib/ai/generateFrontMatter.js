// Real front-matter content: the two pieces that genuinely need writing,
// not templating. Copyright and Chapter Outline are pure templates (see
// buildFrontMatter.js) since they're boilerplate/mechanical; About The
// Author and the Introduction both need real composition from the
// customer's own submitted bio and the book's own premise, per
// the house publishing notes' front-
// matter spec (About The Author: "third person, one line of relevant
// credibility, one line of humanity, one line of where to find them.
// Short." Introduction: "makes the case for the book, the promise, why
// it is worth the reader's time, before the reader is handed its
// mechanics.").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callGemini } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSkill() {
  return readFileSync(join(__dirname, "house-rules", "skill.md"), "utf-8");
}

/**
 * @param {object} book - title, subtitle, authorName, authorBio, genre, tone, reader, promise
 * @param {{title:string, purpose:string}[]} outline
 * @returns {Promise<{aboutAuthor: string, introduction: string}>}
 */
export async function generateFrontMatter(book, outline, callOpts = {}) {
  const skill = loadSkill();
  const chapterList = outline.map((c) => `- ${c.title}: ${c.purpose}`).join("\n");

  const prompt = `Write two pieces of real front matter for this non-fiction book, following the house
rules below. Do not invent anything about the author beyond what their own bio says. Never mention
chapter numbers, an outline, or anything about how this book was produced.

BOOK
Title: ${book.title}
Subtitle: ${book.subtitle || ""}
Genre: ${book.genre || "Non-fiction"}
Tone: ${book.tone || ""}
Target reader: ${book.reader || ""}
Promise: ${book.promise || ""}

AUTHOR
Name: ${book.authorName}
Their own bio, as submitted (rewrite this into the About The Author shape below, do not add facts
that aren't in it): ${book.authorBio}

WHAT THIS BOOK COVERS (for the introduction's own context, do not list these as "chapters" or name
numbers)
${chapterList}

Return ONLY a JSON object, no markdown fences, no commentary, in this exact shape:
{
  "aboutAuthor": "Third person. One line of relevant credibility, one line of humanity, one line of
    where to find them if the bio mentions anywhere to find them. Short, a lead-in, not a full
    biography.",
  "introduction": "600 to 1200 words. Makes the case for the book: the promise, why it is worth the
    reader's time, before the reader is handed its mechanics. Standard introduction prose, may use
    ## subheadings if that fits the house rules below."
}

HOUSE RULES
${skill}`;

  const { text } = await callGemini(prompt, { temperature: 0.8, ...callOpts });
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "");

  let result;
  try {
    result = JSON.parse(cleaned);
  } catch {
    throw new Error(`generateFrontMatter: Gemini did not return valid JSON. Raw output (first 500 chars): ${cleaned.slice(0, 500)}`);
  }
  if (!result.aboutAuthor || !result.introduction) {
    throw new Error("generateFrontMatter: missing aboutAuthor or introduction in Gemini's response");
  }
  return result;
}
