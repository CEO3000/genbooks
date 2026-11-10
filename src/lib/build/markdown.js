// Node port of the markdown-to-blocks parser in
// the original Python build_book.py (blocks()/inline()).
// Kept behaviourally identical on purpose so EPUB/PDF output matches
// the existing Claude-pipeline books' structure exactly.

export function inlineHtml(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/_(.+?)_/g, "<em>$1</em>");
  out = out.replace(/`(.+?)`/g, "<code>$1</code>");
  return out;
}

export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** @returns {{kind: string, payload: string|string[]}[]} */
export function blocks(md) {
  const cleaned = md.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*$/gm, "");
  const result = [];
  for (const raw of cleaned.split(/\n\s*\n/)) {
    const chunk = raw.trim();
    if (!chunk) continue;

    if (/^((\*\s*){3,}|(#\s*){3,}|<hr\s*\/?>|\*\*\*|---)$/.test(chunk)) {
      result.push({ kind: "break", payload: null });
      continue;
    }
    const h = chunk.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      result.push({ kind: `h${h[1].length}`, payload: h[2].trim() });
      continue;
    }
    const lines = chunk.split("\n");
    if (lines.every((ln) => /^\s*>/.test(ln))) {
      const body = lines.map((ln) => ln.replace(/^\s*>\s?/, "")).join(" ");
      result.push({ kind: "quote", payload: body.trim() });
      continue;
    }
    if (lines.every((ln) => /^\s*[-*+]\s+/.test(ln))) {
      result.push({ kind: "ul", payload: lines.map((ln) => ln.replace(/^\s*[-*+]\s+/, "")) });
      continue;
    }
    if (lines.every((ln) => /^\s*\d+[.)]\s+/.test(ln))) {
      result.push({ kind: "ol", payload: lines.map((ln) => ln.replace(/^\s*\d+[.)]\s+/, "")) });
      continue;
    }
    result.push({ kind: "p", payload: lines.map((ln) => ln.trim()).join(" ") });
  }
  return result;
}

/** First level-1 heading in the text is the chapter title, matching load_chapters() in Python. */
export function extractTitle(text, fallback) {
  const m = text.match(/^#\s+(.*)$/m);
  return m ? m[1].trim() : fallback;
}
