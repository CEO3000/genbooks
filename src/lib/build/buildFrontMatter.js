// Pure-template front matter: no Gemini call, since this is boilerplate/
// mechanical content, not prose that needs composing (About The Author
// and the Introduction do need real composition — see
// generateFrontMatter.js). Order and content follow
// the house publishing notes' front-
// matter spec exactly.

/**
 * @param {object} book - title, authorName
 * @returns {{title: string, text: string}}
 */
export function copyrightPage(book) {
  const year = new Date().getFullYear();
  // Always includes the general-information disclaimer: the house publishing notes
  // says to skip it only when the intake identifies the author as a
  // licensed practitioner in the book's own subject field, which isn't a
  // field the intake form collects yet — defaulting to including it is the
  // safe simplification (an unnecessary disclaimer costs nothing; a
  // missing one on a real advice book is a real liability gap).
  const text = `# Copyright

${book.title}

Copyright ${year} by ${book.authorName}

All rights reserved. No part of this publication may be reproduced, distributed, or transmitted in
any form or by any means, including photocopying, recording, or other electronic or mechanical
methods, without the prior written permission of the author, except in the case of brief quotations
embodied in critical reviews and certain other noncommercial uses permitted by copyright law.

This book is for general informational purposes only and is not a substitute for professional
medical, legal, or financial advice. Consult a qualified professional for guidance specific to your
own situation.

No ISBN has been assigned to this edition.

First edition.
`;
  return { title: "Copyright", text };
}

/**
 * @param {{title: string}[]} chapters - the FINAL saved chapter drafts, not the planning outline,
 *   since the house publishing notes warns these can drift during writing.
 * @returns {{title: string, text: string}}
 */
export function chapterOutlinePage(chapters) {
  // One markdown list, `- ` prefix, no blank line between entries — the
  // stylesheet gives every first-in-block paragraph no indent and every
  // later one an indent, so writing this as separate paragraphs renders
  // visibly broken (chapter one flush left, everything else indented).
  const items = chapters.map((c, i) => `- Chapter ${i + 1}: ${c.title}`).join("\n");
  const text = `# Chapter Outline\n\n${items}\n`;
  return { title: "Chapter Outline", text };
}

/**
 * @param {string} aboutAuthor
 * @returns {{title: string, text: string}}
 */
export function aboutAuthorPage(aboutAuthor) {
  return { title: "About The Author", text: `# About The Author\n\n${aboutAuthor}\n` };
}

/**
 * @param {string} introduction
 * @returns {{title: string, text: string}}
 */
export function introductionPage(introduction) {
  return { title: "Introduction", text: `# Introduction\n\n${introduction}\n` };
}
