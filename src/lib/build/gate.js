// Mechanical hard-rule gate, ported from the two "hard" (zero-tolerance)
// sections of the house rules' banned-tells.md:
// section 1 (the em dash family) and the literal-phrase entries of
// section 2 (machine-voice words/phrases). Also carries the placeholder/
// VERIFY-marker check from the original Python build_book.py's
// own BLOCKERS list, and the word-count-vs-budget hard rule from
// prose-nlp.md ("more than 20 percent off budget").
//
// The Claude-pipeline books get this same enforcement from tools/qc.py and
// build_book.py's gate(), run by a human-supervised agent. This pipeline
// has no human in the loop, so nothing mechanically checks a Gemini
// chapter against these hard rules unless this gate runs — it must not be
// skipped. Section 2's structural-cliché patterns ("It is not just X, it
// is Y" and similar) and every "soft" rule in banned-tells.md need a
// judgment read, not a regex, and are deliberately not checked here.

const DASH_VIOLATIONS = [
  { name: "em dash", re: /[\u2014\u2015\u2012]/g }, // em dash, horizontal bar, figure dash
  { name: "en dash used as a dash", re: /(?<![0-9])\u2013(?![0-9])/g },
  { name: "triple hyphen", re: /---/g },
  { name: "double hyphen between words", re: /(?<=[A-Za-z0-9])--(?=[A-Za-z0-9])|(?<=[A-Za-z0-9,])[ \t]--[ \t](?=[A-Za-z0-9])/g },
  { name: "spaced hyphen used as a dash", re: /(?<=\w)[ \t]+-[ \t]+(?=\w)/g },
];

const MARKER_VIOLATIONS = [
  { name: "unresolved VERIFY/CHECK marker", re: /\[(VERIFY|CHECK)[^\]]*\]/gi },
  { name: "TODO marker", re: /\bTODO\b/g },
  { name: "placeholder brackets", re: /\[(INSERT|TK|XXX)[^\]]*\]/gi },
];

// Literal phrase/word entries only, from banned-tells.md section 2 — the
// mechanically-checkable subset (multi-word structural patterns and
// judgment calls are left out on purpose, see file header).
// Nouns/verbs the source doc marks "(figurative)" or "(as a verb/filler)"
// are deliberately left out here: literal use is legal per the house
// rule, and a regex can't tell figurative from literal (confirmed by a
// real false positive on "toolkit" in an already-shipped, human-approved
// chapter during testing — landscape, crucible, journey, arsenal, roadmap,
// superpower, navigate, curate, amplify, illuminate, leverage (as a verb),
// and boast (as filler) carry the same sense-ambiguity risk and are
// excluded for the same reason).
const BANNED_PHRASES = [
  "delve", "tapestry", "realm", "testament to", "treasure trove", "myriad", "plethora",
  "game changer", "cornerstone", "beacon", "symphony", "mosaic", "paradigm shift", "deep dive",
  "goldmine", "secret sauce", "north star",
  "unlock", "unleash", "elevate", "harness", "embark", "foster", "delve into",
  "dive into", "supercharge", "revolutionize", "revolutionise", "empower", "demystify",
  "underscore", "underscores", "underscoring", "showcase", "showcasing",
  "seamless", "robust", "vibrant", "pivotal", "unparalleled", "cutting edge", "holistic",
  "transformative", "invaluable", "meticulous", "bespoke", "unwavering",
  "it is important to note", "it is worth noting", "it should be noted",
  "in today's fast paced world", "in the modern era", "at the end of the day",
  "when it comes to", "more than ever", "now more than ever", "here is the thing",
  "let us dive in", "let us explore", "needless to say",
  "in this chapter, we will", "as we have seen",
];
const BANNED_PHRASE_RE = new RegExp(`\\b(${BANNED_PHRASES.map(escapeRegex).join("|")})\\b`, "gi");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextAround(text, index, len) {
  return text.slice(Math.max(0, index - 30), index + len + 30).replace(/\s+/g, " ").trim();
}

/**
 * @param {string} text
 * @returns {{type: string, match: string, context: string}[]}
 */
export function findHardViolations(text) {
  const violations = [];
  for (const { name, re } of [...DASH_VIOLATIONS, ...MARKER_VIOLATIONS]) {
    for (const m of text.matchAll(re)) {
      violations.push({ type: name, match: m[0], context: contextAround(text, m.index, m[0].length) });
    }
  }
  for (const m of text.matchAll(BANNED_PHRASE_RE)) {
    violations.push({ type: "banned machine-voice phrase", match: m[0], context: contextAround(text, m.index, m[0].length) });
  }
  return violations;
}

/**
 * @param {number} actualWords
 * @param {number} budgetWords
 * @returns {boolean} true if more than 20% off budget (hard failure per prose-nlp.md)
 */
export function wordCountOffBudget(actualWords, budgetWords) {
  if (!budgetWords) return false;
  return Math.abs(actualWords - budgetWords) / budgetWords > 0.2;
}
