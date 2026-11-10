// Checks that a submitted request is a real book request before any money
// is spent on it. Used when the request is created, and again before its
// free preview is generated (which covers requests that came in before
// this check existed).

export const MIN_WORD_COUNT = 5000;
export const MAX_WORD_COUNT = 100000;

const FREE_TEXT_FIELDS = [
  "title", "subtitle", "authorName", "authorBio", "genre", "reader", "promise",
  "tone", "bookDescription", "chapterOutline", "frontCoverDescription", "backCoverDescription",
];
// Long enough that no two genuine answers would ever match by chance.
const PASTED_BLOCK_MIN_CHARS = 150;
const PASTED_BLOCK_MAX_FIELDS = 2;

/** @returns {string|null} why the request is not a real book request */
export function requestRejectReason(book) {
  const words = Number(book.wordCountTarget);
  if (!words || words < MIN_WORD_COUNT) return `wordCountTarget must be at least ${MIN_WORD_COUNT}`;
  if (words > MAX_WORD_COUNT) return `wordCountTarget must be at most ${MAX_WORD_COUNT}`;

  // Spam bots paste one sales message into every box of the form (seen
  // live: a domain-reseller pitch in six separate fields).
  const counts = new Map();
  for (const field of FREE_TEXT_FIELDS) {
    const value = String(book[field] || "").trim().replace(/\s+/g, " ");
    if (value.length < PASTED_BLOCK_MIN_CHARS) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  if ([...counts.values()].some((n) => n > PASTED_BLOCK_MAX_FIELDS)) {
    return "the same text was pasted into several different fields";
  }
  return null;
}
