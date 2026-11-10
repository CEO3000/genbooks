// Node port of the original Python build_pdf.py (reportlab -> pdfkit).
// Same A5 page size, same Times family, same justified/first-line-indent
// body style, same heading/quote/list/scene-break treatment, driven by the
// same blocks() parser used for EPUB so structure stays identical.
import PDFDocument from "pdfkit";
import { blocks } from "./markdown.js";

const MM = 2.8346456693; // points per mm
const PAGE = { width: 420.945, height: 595.276 }; // A5 in points (148mm x 210mm)
const MARGIN = { left: 18 * MM, right: 15 * MM, top: 16 * MM, bottom: 18 * MM };

function stripInline(text) {
  // pdfkit has no inline-markup renderer here; strip markdown emphasis
  // markers to plain text rather than leaving literal asterisks visible.
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * @param {object} meta - { title, subtitle, author }
 * @param {{title: string, text: string}[]} chapters
 * @returns {Promise<Buffer>}
 */
export async function buildPdf(meta, chapters) {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: MARGIN,
    info: { Title: meta.title, Author: meta.author },
    bufferPages: true,
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", resolve));

  const bodyWidth = PAGE.width - MARGIN.left - MARGIN.right;

  doc.y = MARGIN.top + 46 * MM;
  doc.font("Times-Bold").fontSize(27).text(meta.title, MARGIN.left, doc.y, { width: bodyWidth, align: "center" });
  doc.moveDown(1);
  if (meta.subtitle) {
    doc.font("Times-Roman").fontSize(14).text(meta.subtitle, MARGIN.left, doc.y, { width: bodyWidth, align: "center" });
    doc.moveDown(1.5);
  }
  doc.font("Times-Roman").fontSize(12).text(meta.author, MARGIN.left, doc.y, { width: bodyWidth, align: "center" });

  for (const ch of chapters) {
    doc.addPage();
    doc.font("Times-Bold").fontSize(17).text(ch.title, { align: "left", indent: 0 });
    doc.moveDown(0.9);

    let firstPara = true;
    for (const { kind, payload } of blocks(ch.text)) {
      if (kind === "h1") continue; // chapter title already drawn above
      if (kind === "break") {
        doc.font("Times-Roman").fontSize(10.5).text("* * *", { align: "center", indent: 0 });
        doc.moveDown(0.5);
        firstPara = true;
      } else if (kind.startsWith("h")) {
        const lvl = Math.min(parseInt(kind[1], 10) + 1, 3);
        if (lvl <= 2) doc.font("Times-Bold").fontSize(lvl === 1 ? 17 : 12);
        else doc.font("Times-Italic").fontSize(11);
        doc.moveDown(0.6);
        doc.text(stripInline(String(payload)), { indent: 0 });
        doc.moveDown(0.3);
        firstPara = true;
      } else if (kind === "quote") {
        doc.font("Times-Italic").fontSize(10.5).text(stripInline(String(payload)), { indent: 0, align: "justify" });
        doc.moveDown(0.4);
        firstPara = true;
      } else if (kind === "ul" || kind === "ol") {
        doc.font("Times-Roman").fontSize(10.5);
        payload.forEach((item, idx) => {
          const bullet = kind === "ol" ? `${idx + 1}. ` : "\u2022 ";
          doc.text(bullet + stripInline(item), { indent: 16 });
        });
        doc.moveDown(0.3);
        firstPara = true;
      } else {
        doc.font("Times-Roman").fontSize(10.5)
          .text(stripInline(String(payload)), { align: "justify", indent: firstPara ? 0 : 12, lineGap: 4.5 });
        firstPara = false;
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Times-Roman").fontSize(8.5)
      .text(String(i + 1), 0, PAGE.height - 10 * MM, { width: PAGE.width, align: "center" });
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}
