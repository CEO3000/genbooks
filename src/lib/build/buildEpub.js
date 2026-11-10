// Node port of build_epub() in the original Python build_book.py.
// Same CSS, same XHTML/OPF/NCX shape, so EPUBs produced by the Gemini
// pipeline match the existing Claude-pipeline books structurally.
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { blocks, inlineHtml, escapeHtml } from "./markdown.js";

const CSS = `@page { margin: 1em; }
body { margin: 0 5%; line-height: 1.5; text-align: justify; font-size: 1em; }
h1 { text-align: center; font-size: 1.6em; font-weight: normal; letter-spacing: 0.06em;
     margin: 2.5em 0 1.6em; page-break-before: always; }
h2 { font-size: 1.2em; margin: 1.8em 0 0.6em; text-align: left; }
h3 { font-size: 1.05em; margin: 1.4em 0 0.5em; text-align: left; }
p { margin: 0; text-indent: 1.2em; }
p.first, h1 + p, h2 + p, h3 + p, blockquote + p, .brk + p { text-indent: 0; }
p.brk { text-indent: 0; text-align: center; margin: 1.4em 0; letter-spacing: 0.5em; }
blockquote { margin: 1.2em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
ul, ol { margin: 1em 0 1em 1.4em; }
li { margin-bottom: 0.4em; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage h1 { page-break-before: avoid; font-size: 2.1em; margin-bottom: 0.3em; }
.titlepage .sub { font-size: 1.15em; font-style: italic; margin-bottom: 3em; }
.titlepage .author { font-size: 1.1em; letter-spacing: 0.14em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; height: auto; }
`;

function xhtml({ lang, title, etype, body }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${title}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body epub:type="${etype}">
${body}
</body></html>
`;
}

function blocksToXhtml(bl, skipFirstH1 = true) {
  const parts = [];
  let skipped = !skipFirstH1;
  for (const { kind, payload } of bl) {
    if (kind === "h1" && !skipped) {
      skipped = true;
      continue;
    }
    if (kind === "break") {
      parts.push('<p class="brk">* * *</p>');
    } else if (kind.startsWith("h")) {
      const lvl = Math.min(parseInt(kind[1], 10) + 1, 6);
      parts.push(`<h${lvl}>${inlineHtml(String(payload))}</h${lvl}>`);
    } else if (kind === "quote") {
      parts.push(`<blockquote><p>${inlineHtml(String(payload))}</p></blockquote>`);
    } else if (kind === "ul" || kind === "ol") {
      const items = payload.map((i) => `<li>${inlineHtml(i)}</li>`).join("");
      parts.push(`<${kind}>${items}</${kind}>`);
    } else {
      parts.push(`<p>${inlineHtml(String(payload))}</p>`);
    }
  }
  return parts.join("\n");
}

/**
 * @param {object} meta - { title, subtitle, author, lang, publisher, uuid }
 * @param {{title: string, text: string}[]} chapters
 * @param {Buffer|null} coverBuffer - raw image bytes, or null for no cover
 * @param {string} coverExt - e.g. ".jpg" (required if coverBuffer is set)
 * @returns {Promise<Buffer>}
 */
export async function buildEpub(meta, chapters, coverBuffer = null, coverExt = ".jpg") {
  const lang = meta.lang || "en";
  const bid = meta.uuid || randomUUID();
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const docs = [];

  const tp = `<div class="titlepage"><h1>${inlineHtml(meta.title)}</h1>` +
    (meta.subtitle ? `<p class="sub">${inlineHtml(meta.subtitle)}</p>` : "") +
    `<p class="author">${inlineHtml(meta.author)}</p></div>`;
  docs.push({ fn: "titlepage.xhtml", navTitle: "Title Page", content: xhtml({ lang, title: escapeHtml(meta.title), etype: "titlepage", body: tp }) });

  chapters.forEach((ch, idx) => {
    const n = idx + 1;
    const body = `<h1>${inlineHtml(ch.title)}</h1>\n` + blocksToXhtml(blocks(ch.text));
    docs.push({
      fn: `ch${String(n).padStart(2, "0")}.xhtml`,
      navTitle: ch.title,
      content: xhtml({ lang, title: escapeHtml(ch.title), etype: "chapter", body }),
    });
  });

  const navItems = docs.slice(1).map((d) => `      <li><a href="${d.fn}">${escapeHtml(d.navTitle)}</a></li>`).join("\n");
  const nav = `<nav epub:type="toc" id="toc" role="doc-toc"><h1>Contents</h1>\n    <ol>\n${navItems}\n    </ol></nav>`;
  docs.splice(1, 0, { fn: "nav.xhtml", navTitle: "Contents", content: xhtml({ lang, title: "Contents", etype: "frontmatter", body: nav }) });

  let coverItem = "", coverRef = "", coverMeta = "", coverName = null;
  if (coverBuffer) {
    const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" }[coverExt.toLowerCase()] || "image/jpeg";
    coverName = "cover" + coverExt;
    coverItem = `    <item id="cover-image" href="${coverName}" media-type="${mime}" properties="cover-image"/>\n` +
      `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>\n`;
    coverRef = `    <itemref idref="cover" linear="yes"/>\n`;
    coverMeta = `    <meta name="cover" content="cover-image"/>\n`;
    docs.unshift({
      fn: "cover.xhtml", navTitle: "Cover",
      content: xhtml({ lang, title: "Cover", etype: "cover", body: `<div class="cover"><img src="${coverName}" alt="Cover"/></div>` }),
    });
  }

  const manifest = coverItem + docs
    .filter((d) => d.fn !== "cover.xhtml")
    .map((d) => {
      const id = d.fn.replace(/\.xhtml$/, "");
      const props = d.fn === "nav.xhtml" ? ' properties="nav"' : "";
      return `    <item id="${id}" href="${d.fn}" media-type="application/xhtml+xml"${props}/>\n`;
    }).join("");
  const spine = coverRef + docs
    .filter((d) => d.fn !== "cover.xhtml")
    .map((d) => `    <itemref idref="${d.fn.replace(/\.xhtml$/, "")}"/>\n`).join("");

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"
         xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${bid}</dc:identifier>
    <dc:title id="t-main">${escapeHtml(meta.title)}</dc:title>
    <meta refines="#t-main" property="title-type">main</meta>
    ${meta.subtitle ? `<dc:title id="t-sub">${escapeHtml(meta.subtitle)}</dc:title>
    <meta refines="#t-sub" property="title-type">subtitle</meta>` : ""}
    <dc:creator>${escapeHtml(meta.author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:date>${now.slice(0, 10)}</dc:date>
    <dc:publisher>${escapeHtml(meta.publisher || meta.author)}</dc:publisher>
    <dc:rights>Copyright ${new Date().getFullYear()} ${escapeHtml(meta.author)}</dc:rights>
    <meta property="dcterms:modified">${now}</meta>
${coverMeta}  </metadata>
  <manifest>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifest}  </manifest>
  <spine toc="ncx">
${spine}  </spine>
</package>
`;

  const navPoints = docs.map((d, i) =>
    `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(d.navTitle)}</text>` +
    `</navLabel><content src="${d.fn}"/></navPoint>`
  ).join("\n");
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:${bid}"/></head>
  <docTitle><text>${escapeHtml(meta.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml",
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
    '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
    '</container>\n');
  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/toc.ncx", ncx);
  zip.file("OEBPS/style.css", CSS);
  for (const d of docs) zip.file("OEBPS/" + d.fn, d.content);
  if (coverBuffer && coverName) zip.file("OEBPS/" + coverName, coverBuffer);

  return zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip" });
}
