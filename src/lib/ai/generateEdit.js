// Real editing stage: the Gemini-pipeline equivalent of manuscript-editor.
// Runs a single consolidated revision pass over a drafted chapter (line
// quality, machine-voice tells, continuity against its own stated purpose)
// rather than the six separate passes the Claude Code workflow uses —
// simplified deliberately, since each pass here is a full extra Gemini
// call and there is no session-based back-and-forth to amortize it against.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callGemini } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRules(file) {
  return readFileSync(join(__dirname, "house-rules", file), "utf-8");
}

/**
 * @param {object} params
 * @param {object} params.chapterSpec - the outline entry this chapter was drafted from
 * @param {string} params.draftText - the chapter's current text
 * @returns {Promise<string>} the revised chapter text
 */
export async function generateEdit({ chapterSpec, draftText }, callOpts = {}) {
  const bannedTells = loadRules("banned-tells.md");
  const proseNlp = loadRules("prose-nlp.md");

  const prompt = `You are line-editing one chapter of a non-fiction book. Revise it against the rules
below. Preserve the author's real content, facts and structure — do not shorten it materially, do
not invent new claims, do not rewrite sentences that are already clean just to phrase them
differently. Fix only what's actually wrong: AI-voice tells, weak verbs, run-on or tangled
sentences, and check the chapter actually delivers on its stated purpose and closing type.

CHAPTER PURPOSE: ${chapterSpec.purpose}
CHAPTER TAKEAWAY: ${chapterSpec.takeaway}
CLOSING TYPE REQUIRED: ${chapterSpec.closingType}

RULES ON BANNED AI-VOICE TELLS
${bannedTells}

RULES ON SENTENCE-LEVEL PROSE QUALITY
${proseNlp}

Return ONLY the revised chapter text, no commentary, no markdown fences, no notes about what you
changed.

DRAFT TO REVISE:
${draftText}`;

  const { text } = await callGemini(prompt, { temperature: 0.4, ...callOpts });
  const revised = text.trim();
  if (!revised) throw new Error("generateEdit: Gemini returned empty revision");
  return revised;
}

// Targeted repair pass for hard-rule violations gate.js finds after a
// normal edit. Only used when the gate actually fails, since it costs an
// extra Gemini call — most chapters should pass the gate on the first try
// given the house rules are already in generateEdit's own prompt.
export async function fixViolations({ chapterSpec, draftText, violations }, callOpts = {}) {
  const bannedTells = loadRules("banned-tells.md");
  const list = violations
    .map((v) => `- ${v.type}: "${v.match}" in context: ...${v.context}...`)
    .join("\n");

  const prompt = `This chapter still has hard-rule violations after a revision pass. Fix ONLY the exact
spots listed below, using the repair guidance in the rules. Do not rewrite anything else in the
chapter, do not shorten it, do not change content that is not part of a listed violation.

CHAPTER PURPOSE: ${chapterSpec.purpose}

VIOLATIONS TO FIX
${list}

RULES (repair guidance is in section 1's table, banned phrase list is section 2)
${bannedTells}

Return ONLY the full corrected chapter text, no commentary, no markdown fences.

CHAPTER TEXT:
${draftText}`;

  const { text } = await callGemini(prompt, { temperature: 0.3, ...callOpts });
  const fixed = text.trim();
  if (!fixed) throw new Error("fixViolations: Gemini returned empty output");
  return fixed;
}
