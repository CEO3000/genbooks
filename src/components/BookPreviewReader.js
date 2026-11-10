"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const SERIF = "Georgia, 'Times New Roman', serif";

// Splits a raw paragraph-block's lines into runs (a label line or two, then
// a run of list items, etc.) instead of requiring every line in the block to
// be a list item before any of them count as one. A "**Part One:**" label
// immediately followed by its chapter list, with no blank line between them,
// is one markdown "paragraph" by blank-line splitting alone, but it is not
// one paragraph of prose, and forcing it through the paragraph path joined
// every chapter title into a single run-on sentence instead of a real list.
function splitMixedLines(lines) {
  const blocks = [];
  let run = [];
  let runIsList = null;
  for (const ln of lines) {
    const isList = /^\s*[-*+]\s+/.test(ln);
    if (runIsList === null) runIsList = isList;
    if (isList !== runIsList) {
      blocks.push({ isList: runIsList, lines: run });
      run = [];
      runIsList = isList;
    }
    run.push(ln);
  }
  if (run.length) blocks.push({ isList: runIsList, lines: run });
  return blocks.flatMap(({ isList, lines: ls }) =>
    isList
      ? ls.map((ln) => ({ type: "li", text: ln.replace(/^\s*[-*+]\s+/, "").trim() }))
      : [{ type: "p", text: ls.join(" ").replace(/\s+/g, " ") }]
  );
}

function parseBlocks(text) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .flatMap((raw) => {
      if (raw.startsWith("## ")) return [{ type: "h2", text: raw.slice(3).trim() }];
      if (raw.startsWith("# ")) return [{ type: "h1", text: raw.slice(2).trim() }];
      return splitMixedLines(raw.split("\n"));
    });
}

// Inline **bold** and *italic*, parsed into styled words up front so a
// paragraph can be split across pages mid-way without leaving an unpaired
// marker showing as a literal asterisk. Markers only count when they pair
// up within the paragraph; an odd one out stays a plain character.
function parseWords(text) {
  const boldPairs = (text.match(/\*\*/g) || []).length % 2 === 0;
  const italicPairs = (text.replace(/\*\*/g, "").match(/\*/g) || []).length % 2 === 0;
  let bold = false;
  let italic = false;
  const words = [];
  let word = [];
  const endWord = () => {
    if (word.length) words.push(word);
    word = [];
  };
  for (const token of text.split(/(\*\*|\*)/)) {
    if (token === "**" && boldPairs) { bold = !bold; continue; }
    if (token === "*" && italicPairs) { italic = !italic; continue; }
    for (const part of token.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) endWord();
      else word.push({ t: part, b: bold, i: italic });
    }
  }
  endWord();
  return words;
}

const normalize = (str) => String(str || "").trim().toLowerCase().replace(/\s+/g, " ");

// A book's opening as a reader expects it: title page, contents, then the
// text, each starting on a fresh page. Every block gets the global index of
// its first word, so the reader stays on the same passage when the window
// is resized and pages reflow (the title page alone sits before word 0).
function toReaderBlocks(text, front) {
  const blocks = [];
  let start = 0;
  const add = (type, str) => {
    const words = parseWords(str);
    blocks.push({ type, words, start });
    start += words.length;
  };
  const pageBreak = () => blocks.push({ type: "break", words: [], start });

  if (front.title) {
    blocks.push({ type: "titlepage", words: [], start: -1, title: front.title, subtitle: front.subtitle, author: front.author });
  }
  // About the Author and the Introduction, each on its own page(s). A
  // heading Gemini may have added itself is dropped so it isn't doubled.
  for (const [heading, body] of [["About the Author", front.aboutAuthor], ["Introduction", front.introduction]]) {
    if (!body) continue;
    add("h1", heading);
    let sectionBlocks = parseBlocks(body);
    if (sectionBlocks[0]?.type === "h1" && normalize(sectionBlocks[0].text) === normalize(heading)) sectionBlocks = sectionBlocks.slice(1);
    for (const block of sectionBlocks) add(block.type === "h1" ? "h2" : block.type, block.text);
    pageBreak();
  }
  if (front.chapters.length) {
    add("h1", "Contents");
    front.chapters.forEach((chapterTitle, k) => add("toc", `Chapter ${k + 1}: ${chapterTitle}`));
    pageBreak();
  }
  let body = parseBlocks(text);
  // Older previews open with the book's title, which the title page now shows.
  if (front.title && body[0]?.type === "h1" && normalize(body[0].text) === normalize(front.title)) body = body.slice(1);
  // Previews written before chapter planning existed have no chapter heading.
  if (front.chapters.length && body[0]?.type !== "h1") add("h1", `Chapter 1: ${front.chapters[0]}`);
  for (const block of body) add(block.type, block.text);
  blocks.push({ ...END_NOTE, start });
  return blocks;
}

// The preview never runs past this many pages on any screen. Smaller
// screens fit less per page, so they reach the cap sooner.
const MAX_PAGES = 15;
const END_NOTE = { type: "endnote", words: parseWords("End of the free preview"), isStart: true, isEnd: true };
const SENTENCE_END = /[.!?]["'”’)\]]*$/;

function endsSentence(word) {
  return SENTENCE_END.test(word[word.length - 1].t);
}

// Keeps a paragraph piece only up to its last complete sentence, or
// returns null when it has none.
function cutToLastSentence(piece, before = piece.words.length) {
  let keep = before;
  while (keep > 0 && !endsSentence(piece.words[keep - 1])) keep--;
  return keep === 0 ? null : { ...piece, words: piece.words.slice(0, keep), isEnd: true };
}

// Past the cap, the last page ends on a whole sentence (never on a
// heading) with the end note under it, trimmed until both fit the frame.
function capPages(pages, measure, maxHeight) {
  if (pages.length <= MAX_PAGES) return pages;
  const kept = pages.slice(0, MAX_PAGES);
  const last = kept[MAX_PAGES - 1];
  let pieces = last.pieces.filter((p) => p.type !== "endnote");

  const fitsWithNote = (list) => {
    measure.replaceChildren(...[...list, END_NOTE].map(pieceElement));
    const note = measure.lastElementChild;
    return note.offsetTop + note.offsetHeight <= maxHeight;
  };
  const dropTail = (replacement) => {
    pieces = replacement ? [...pieces.slice(0, -1), replacement] : pieces.slice(0, -1);
  };

  while (pieces.length) {
    const tail = pieces[pieces.length - 1];
    if (tail.type === "h1" || tail.type === "h2") { dropTail(); continue; }
    if (tail.type === "p" && !tail.isEnd && !endsSentence(tail.words[tail.words.length - 1])) {
      dropTail(cutToLastSentence(tail));
      continue;
    }
    if (fitsWithNote(pieces)) break;
    dropTail(tail.type === "p" ? cutToLastSentence(tail, tail.words.length - 1) : null);
  }
  measure.replaceChildren();
  kept[MAX_PAGES - 1] = { ...last, pieces: [...pieces, { ...END_NOTE, start: last.start }] };
  return kept;
}

const TITLE_PAGE_CLASS = "flex h-full flex-col items-center justify-center px-2 text-center";

function titlePageLines(piece) {
  return [
    { className: "text-2xl sm:text-4xl font-semibold uppercase tracking-wide leading-tight", style: { color: "#e4e5ee" }, text: piece.title },
    piece.subtitle && { className: "mt-4 text-base sm:text-xl italic", style: { color: "#c9cad4" }, text: piece.subtitle },
    piece.author && { className: "mt-12 text-sm sm:text-base uppercase tracking-[0.2em]", style: { color: "#9a9cb0" }, text: piece.author },
  ].filter(Boolean);
}

// Words back into runs of identically styled text, spaces included.
function toSegments(words) {
  const segments = [];
  const add = (t, b, i) => {
    const last = segments[segments.length - 1];
    if (last && last.b === b && last.i === i) last.t += t;
    else segments.push({ t, b, i });
  };
  words.forEach((parts, k) => {
    if (k > 0) {
      const prev = words[k - 1][words[k - 1].length - 1];
      add(" ", prev.b && parts[0].b, prev.i && parts[0].i);
    }
    for (const p of parts) add(p.t, p.b, p.i);
  });
  return segments;
}

// One description of each block's look, shared by what is shown and by
// the hidden copy used to measure pages, so the two can never disagree.
function blockLook(piece) {
  if (piece.type === "h1") {
    return {
      tag: "h3",
      className: "mb-5 text-center text-lg sm:text-xl font-semibold uppercase tracking-wide",
      style: { fontFamily: SERIF, color: "#e4e5ee" },
    };
  }
  if (piece.type === "h2") {
    return {
      tag: "h4",
      className: "mb-4 mt-7 text-base font-semibold",
      style: { fontFamily: SERIF, color: "#e4e5ee" },
    };
  }
  if (piece.type === "endnote") {
    return { tag: "p", className: "mono-label mt-10 text-center", style: {} };
  }
  if (piece.type === "toc") {
    return {
      tag: "p",
      className: "text-[15px] sm:text-base leading-7 sm:leading-8",
      style: { fontFamily: SERIF, color: "#c9cad4", marginBottom: "0.35em", paddingLeft: "1.5em", textIndent: "-1.5em", textRendering: "optimizeLegibility" },
    };
  }
  if (piece.type === "li") {
    return {
      tag: "p",
      className: "text-[15px] sm:text-base leading-7 sm:leading-8",
      style: { fontFamily: SERIF, color: "#c9cad4", marginBottom: "0.4em", textRendering: "optimizeLegibility" },
      prefix: "• ",
    };
  }
  return {
    tag: "p",
    // A paragraph that carries on over the page break is justified right to
    // its last line, the way a printed book's page ends.
    className: `text-[15px] sm:text-base leading-7 sm:leading-8 text-left sm:text-justify ${piece.isEnd ? "" : "sm:[text-align-last:justify]"}`,
    style: {
      fontFamily: SERIF,
      color: "#c9cad4",
      textIndent: piece.isStart ? "1.5em" : "0",
      marginBottom: "0.9em",
      overflowWrap: "break-word",
      textRendering: "optimizeLegibility",
    },
  };
}

function Piece({ piece }) {
  if (piece.type === "titlepage") {
    return (
      <div className={TITLE_PAGE_CLASS} style={{ fontFamily: SERIF }}>
        {titlePageLines(piece).map((line, k) => (
          <p key={k} className={line.className} style={line.style}>{line.text}</p>
        ))}
      </div>
    );
  }
  const { tag: Tag, className, style, prefix } = blockLook(piece);
  return (
    <Tag className={className} style={style}>
      {prefix}
      {toSegments(piece.words).map((s, k) => {
        let node = s.t;
        if (s.i) node = <em>{node}</em>;
        if (s.b) node = <strong>{node}</strong>;
        return <span key={k}>{node}</span>;
      })}
    </Tag>
  );
}

function pieceElement(piece) {
  if (piece.type === "titlepage") {
    const el = document.createElement("div");
    el.className = TITLE_PAGE_CLASS;
    el.style.fontFamily = SERIF;
    for (const line of titlePageLines(piece)) {
      const p = document.createElement("p");
      p.className = line.className;
      Object.assign(p.style, line.style);
      p.textContent = line.text;
      el.append(p);
    }
    return el;
  }
  const { tag, className, style, prefix } = blockLook(piece);
  const el = document.createElement(tag);
  el.className = className;
  Object.assign(el.style, style);
  if (prefix) el.append(prefix);
  for (const s of toSegments(piece.words)) {
    let node = document.createTextNode(s.t);
    if (s.i) { const em = document.createElement("em"); em.append(node); node = em; }
    if (s.b) { const strong = document.createElement("strong"); strong.append(node); node = strong; }
    const span = document.createElement("span");
    span.append(node);
    el.append(span);
  }
  return el;
}

const HEADING_ROOM_PROBE = { type: "p", words: [[{ t: "x", b: false, i: false }]], isStart: true, isEnd: true };

// Fills each page with exactly as much text as fits the reader's real page
// frame, measured in the browser, rather than a fixed word count that
// overflows a short screen (a scrollbar inside the page, text running off
// its bottom edge). A paragraph that doesn't fit continues on the next
// page; a heading is never left alone at the bottom of a page.
function paginateToFit(blocks, measure, maxHeight) {
  const pages = [];
  let current = [];

  const fits = (pieces) => {
    measure.replaceChildren(...pieces.map(pieceElement));
    const last = measure.lastElementChild;
    return !last || last.offsetTop + last.offsetHeight <= maxHeight;
  };
  const pushPage = () => {
    if (current.length) pages.push({ pieces: current, start: current[0].start });
    current = [];
  };

  for (const block of blocks) {
    if (block.type === "break") {
      pushPage();
      continue;
    }
    if (block.type === "titlepage") {
      pushPage();
      current.push(block);
      pushPage();
      continue;
    }
    if (block.type === "h1" || block.type === "h2") {
      if (current.length && !fits([...current, block, HEADING_ROOM_PROBE])) pushPage();
      current.push(block);
      continue;
    }
    if (block.type === "endnote") {
      if (!current.length || fits([...current, block])) current.push(block);
      continue;
    }
    if (block.type === "li" || block.type === "toc") {
      if (current.length && !fits([...current, block])) pushPage();
      current.push(block);
      continue;
    }

    let offset = 0;
    while (offset < block.words.length) {
      const rest = block.words.length - offset;
      const piece = (n) => ({
        type: "p",
        words: block.words.slice(offset, offset + n),
        isStart: offset === 0,
        isEnd: offset + n === block.words.length,
        start: block.start + offset,
      });
      if (fits([...current, piece(rest)])) {
        current.push(piece(rest));
        break;
      }
      // Largest number of this paragraph's remaining words that still fits.
      let lo = 0;
      let hi = rest - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits([...current, piece(mid)])) lo = mid;
        else hi = mid - 1;
      }
      // A frame too small for even one word still has to make progress.
      const take = lo === 0 && current.length === 0 ? 1 : lo;
      if (take > 0) current.push(piece(take));
      pushPage();
      offset += take;
    }
  }
  pushPage();
  measure.replaceChildren();
  return pages;
}

function pageContaining(pages, wordIndex) {
  let found = 0;
  pages.forEach((p, k) => {
    if (p.start <= wordIndex && p.start > pages[found].start) found = k;
  });
  return found;
}

// Full-screen reading overlay, the way online book previews (Kindle Cloud
// Reader, Google Books) work. The page frame is a fixed box: its size comes
// only from the screen, never from the text, and pages are cut to fit it.
export default function BookPreviewReader({ text, open, onClose, title, subtitle, author, aboutAuthor, introduction, chapters }) {
  // Mounted fresh on every open, so it always starts on page one.
  if (!open || !text?.trim()) return null;
  return (
    <ReaderOverlay
      text={text}
      onClose={onClose}
      title={String(title || "").trim()}
      subtitle={String(subtitle || "").trim()}
      author={String(author || "").trim()}
      aboutAuthor={String(aboutAuthor || "").trim()}
      introduction={String(introduction || "").trim()}
      chaptersKey={(chapters || []).map((c) => String(c).trim()).filter(Boolean).join("\n")}
    />
  );
}

// chaptersKey is the chapter titles joined into one string, so the
// pagination below only re-runs when they actually change, not every time
// the parent page re-renders with a fresh array.
function ReaderOverlay({ text, onClose, title, subtitle, author, aboutAuthor, introduction, chaptersKey }) {
  const blocks = useMemo(
    () => toReaderBlocks(text, { title, subtitle, author, aboutAuthor, introduction, chapters: chaptersKey ? chaptersKey.split("\n") : [] }),
    [text, title, subtitle, author, aboutAuthor, introduction, chaptersKey]
  );
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(0);
  const boxRef = useRef(null);
  const measureRef = useRef(null);
  // First word of the page being read, kept across re-pagination.
  const anchorWord = useRef(-1);

  useEffect(() => {
    if (pages[page]) anchorWord.current = pages[page].start;
  }, [page, pages]);

  // Re-measures whenever the frame's size changes (window resize, phone
  // rotation). ResizeObserver also fires once as soon as it starts.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    let lastSize = "";
    const observer = new ResizeObserver(() => {
      const size = `${box.clientWidth}x${box.clientHeight}`;
      if (size === lastSize || box.clientHeight === 0) return;
      lastSize = size;
      const next = capPages(paginateToFit(blocks, measure, box.clientHeight), measure, box.clientHeight);
      setPages(next);
      setPage(pageContaining(next, anchorWord.current));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [blocks]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setPage((p) => Math.min(Math.max(pages.length - 1, 0), p + 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose, pages.length]);

  const lastPage = Math.max(pages.length - 1, 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#101119" }}>
      <div className="flex items-center justify-between border-b border-white/10 px-5 sm:px-8 py-3 sm:py-4 shrink-0">
        <span className="mono-label">Free preview</span>
        <button
          onClick={onClose}
          className="btn-ghost px-3 py-1.5 sm:px-4 sm:py-2 text-xs"
          aria-label="Close preview"
        >
          Close ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-5 sm:px-8 py-6 sm:py-10">
        <div ref={boxRef} className="relative mx-auto flow-root h-full w-full max-w-2xl overflow-hidden antialiased">
          {pages[page]?.pieces.map((piece, k) => (
            <Piece key={`${page}-${k}`} piece={piece} />
          ))}
          <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0" />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 px-5 sm:px-8 py-3 sm:py-4 shrink-0">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="btn-ghost px-3 py-2 sm:px-4 text-xs sm:text-sm disabled:opacity-30"
        >
          ← Previous
        </button>
        <span className="mono-label">
          Page {pages.length ? page + 1 : 1} of {pages.length || 1}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
          disabled={page >= lastPage}
          className="btn-ghost px-3 py-2 sm:px-4 text-xs sm:text-sm disabled:opacity-30"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
