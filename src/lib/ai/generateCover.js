// Real cover stage: calls Gemini's native image-generation endpoint
// directly (responseModalities: ["TEXT","IMAGE"]) rather than the
// Claude-pipeline approach (an HTML/CSS artboard rendered via Artifacts),
// since there is no browser available in a serverless function to render
// one. This produces the front (ebook) cover only — back cover and the
// full paperback wrap need real trim-size/spine-width math tied to the
// PDF's actual page count, which is not built yet (see generateBackCover
// below, which throws rather than fakes it).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function loadRules() {
  return readFileSync(join(__dirname, "house-rules", "cover-design.md"), "utf-8");
}

/**
 * @param {object} book - title, subtitle, genre, tone, reader, promise
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
export async function generateFrontCover(book, { signal } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const rules = loadRules();
  const prompt = `Design a professional non-fiction ebook front cover, portrait orientation, 1600x2560
pixels (5:8 ratio), full bleed, no mockup device frame, no blank margins.

BOOK
Title: ${book.title}
Subtitle: ${book.subtitle || ""}
Author: ${book.authorName || ""}
Genre: ${book.genre || "Non-fiction"}
Tone: ${book.tone || ""}
Target reader: ${book.reader || ""}
Promise: ${book.promise || ""}

Render the title (and subtitle, if given) directly on the cover, legible at thumbnail size, in a
typeface and composition that fits the genre and tone above. Follow the house cover-design
principles below: pick a genuinely fitting visual language for this specific book rather than a
generic default, and do not just apply a decorative texture over a placeholder layout — get the
actual composition right first.

HOUSE COVER-DESIGN RULES
${rules}`;

  const res = await fetch(`${API_BASE}/${IMAGE_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini image API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) throw new Error("Gemini returned no image data for the cover");

  return {
    buffer: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}

// Back cover / full paperback wrap needs real trim-size and spine-width
// math derived from the PDF's actual page count (KDP spine width depends
// on paper type and page count), which SAVING doesn't expose yet. Throwing
// here rather than shipping a cover with a guessed spine width.
export async function generateBackCover() {
  throw new Error(
    "generateBackCover is not implemented yet: needs real page-count-derived spine width from " +
    "the SAVING stage's PDF output before it can build a correct KDP paperback wrap."
  );
}
