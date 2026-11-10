// Sets the free preview text (first ~10 pages) shown on a request's page
// before purchase. Stored as a plain field on the request document, not
// gated by the paid/adminUnlocked rule, since previews are meant to be free.
//
// Usage:
//   node scripts/set-preview.mjs <requestId> <textFilePath>

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(readFileSync(new URL("../service-account.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  const [requestId, textPath] = process.argv.slice(2);
  if (!requestId || !textPath) {
    console.error("Usage: node scripts/set-preview.mjs <requestId> <textFilePath>");
    process.exit(1);
  }

  const previewText = readFileSync(textPath, "utf-8");
  await db.doc(`requests/${requestId}`).update({ previewText });
  console.log(`Preview set for ${requestId}: ${previewText.length} characters.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
