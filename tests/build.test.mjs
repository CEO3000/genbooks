import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { blocks, inlineHtml, escapeHtml, extractTitle } from "../src/lib/build/markdown.js";
import { buildEpub } from "../src/lib/build/buildEpub.js";
import { buildPdf } from "../src/lib/build/buildPdf.js";
import { copyrightPage, chapterOutlinePage, aboutAuthorPage, introductionPage } from "../src/lib/build/buildFrontMatter.js";

// ---- markdown blocks ----

test("markdown is split into headings, paragraphs, quotes, lists and scene breaks", () => {
  const md = [
    "# Chapter One", "",
    "A paragraph that",
    "wraps over two lines.", "",
    "> A quoted line", "> and its second line.", "",
    "- first", "- second", "",
    "1. one", "2) two", "",
    "* * *", "",
    "## A subheading",
  ].join("\n");
  assert.deepEqual(blocks(md), [
    { kind: "h1", payload: "Chapter One" },
    { kind: "p", payload: "A paragraph that wraps over two lines." },
    { kind: "quote", payload: "A quoted line and its second line." },
    { kind: "ul", payload: ["first", "second"] },
    { kind: "ol", payload: ["one", "two"] },
    { kind: "break", payload: null },
    { kind: "h2", payload: "A subheading" },
  ]);
});

test("html comments are dropped and blank chunks are skipped", () => {
  assert.deepEqual(blocks("<!-- note to self -->\n\n\n\nReal text."), [{ kind: "p", payload: "Real text." }]);
});

test("inline emphasis becomes markup and angle brackets are escaped first", () => {
  assert.equal(inlineHtml("**bold** and *italic* and `code`"), "<strong>bold</strong> and <em>italic</em> and <code>code</code>");
  assert.equal(inlineHtml("1 < 2 & 3 > 2"), "1 &lt; 2 &amp; 3 &gt; 2");
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
});

test("the chapter title is the first level-one heading, or the fallback", () => {
  assert.equal(extractTitle("Intro\n\n# The Real Title\n\ntext", "Fallback"), "The Real Title");
  assert.equal(extractTitle("no heading here", "Fallback"), "Fallback");
});

// ---- front matter ----

test("front matter pages have the expected titles and content", () => {
  const book = { title: "My Book", authorName: "A. Writer" };
  assert.match(copyrightPage(book).text, /Copyright \d{4} by A\. Writer/);
  assert.match(copyrightPage(book).text, /not a substitute for professional/);
  assert.equal(chapterOutlinePage([{ title: "Start" }, { title: "Finish" }]).text, "# Chapter Outline\n\n- Chapter 1: Start\n- Chapter 2: Finish\n");
  assert.equal(aboutAuthorPage("Bio.").title, "About The Author");
  assert.equal(introductionPage("Why.").text, "# Introduction\n\nWhy.\n");
});

// ---- EPUB ----

const meta = { title: "A <Tricky> Title & More", subtitle: "A subtitle", author: "A. Writer", lang: "en", uuid: "00000000-0000-4000-8000-000000000000" };
const chapters = [
  { title: "First", text: "# First\n\nOpening **words** here.\n\n- one\n- two" },
  { title: "Second", text: "# Second\n\nMore words.\n\n* * *\n\nAfter the break." },
];
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("the EPUB has the structure a reader requires", async () => {
  const epub = await buildEpub(meta, chapters);
  const zip = await JSZip.loadAsync(epub);

  const names = Object.keys(zip.files);
  assert.equal(names[0], "mimetype", "mimetype must be the first entry");
  assert.equal(await zip.file("mimetype").async("string"), "application/epub+zip");
  assert.equal(zip.files["mimetype"]._data.compressedSize, zip.files["mimetype"]._data.uncompressedSize, "mimetype must be stored, not compressed");
  assert.match(await zip.file("META-INF/container.xml").async("string"), /OEBPS\/content\.opf/);
  for (const name of ["OEBPS/content.opf", "OEBPS/toc.ncx", "OEBPS/nav.xhtml", "OEBPS/titlepage.xhtml", "OEBPS/ch01.xhtml", "OEBPS/ch02.xhtml", "OEBPS/style.css"]) {
    assert.ok(zip.file(name), `${name} is missing`);
  }
});

test("EPUB metadata is escaped and the contents list names every chapter", async () => {
  const zip = await JSZip.loadAsync(await buildEpub(meta, chapters));
  const opf = await zip.file("OEBPS/content.opf").async("string");
  assert.match(opf, /A &lt;Tricky&gt; Title &amp; More/);
  assert.match(opf, /urn:uuid:00000000-0000-4000-8000-000000000000/);
  assert.match(opf, /<dc:creator>A\. Writer<\/dc:creator>/);
  const nav = await zip.file("OEBPS/nav.xhtml").async("string");
  assert.match(nav, /ch01\.xhtml">First</);
  assert.match(nav, /ch02\.xhtml">Second</);
});

test("EPUB chapter text keeps its structure", async () => {
  const zip = await JSZip.loadAsync(await buildEpub(meta, chapters));
  const ch1 = await zip.file("OEBPS/ch01.xhtml").async("string");
  assert.match(ch1, /<h1>First<\/h1>/);
  assert.match(ch1, /<strong>words<\/strong>/);
  assert.match(ch1, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.equal((ch1.match(/<h1>/g) || []).length, 1, "the chapter heading is not printed twice");
  const ch2 = await zip.file("OEBPS/ch02.xhtml").async("string");
  assert.match(ch2, /<p class="brk">\* \* \*<\/p>/);
});

test("a cover image is packaged, declared and put first in reading order", async () => {
  const zip = await JSZip.loadAsync(await buildEpub(meta, chapters, PNG_1PX, ".png"));
  assert.ok(zip.file("OEBPS/cover.png"));
  assert.ok(zip.file("OEBPS/cover.xhtml"));
  const opf = await zip.file("OEBPS/content.opf").async("string");
  assert.match(opf, /properties="cover-image"/);
  assert.match(opf, /image\/png/);
  assert.ok(opf.indexOf('idref="cover"') < opf.indexOf('idref="titlepage"'));
});

test("without a cover nothing about a cover is declared", async () => {
  const zip = await JSZip.loadAsync(await buildEpub(meta, chapters));
  assert.equal(zip.file("OEBPS/cover.xhtml"), null);
  assert.doesNotMatch(await zip.file("OEBPS/content.opf").async("string"), /cover-image/);
});

// ---- PDF ----

test("the PDF is a real, multi-page document with the book's details", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ` + "Plain words follow. ".repeat(40)).join("\n\n");
  const pdf = await buildPdf(meta, [{ title: "Long chapter", text: `# Long chapter\n\n${long}` }, ...chapters]);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.subarray(-32).toString(), /%%EOF/);
  const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 5, `expected several pages, got ${pages}`);
});
