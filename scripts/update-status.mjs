// Updates a request's status and progress percentage so the live progress
// bar on its page moves. Run locally by the operator during book
// generation, using the Admin SDK since client writes to requests are
// blocked by the security rules.
//
// Usage:
//   node scripts/update-status.mjs <requestId> <status> <progress>

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(readFileSync(new URL("../service-account.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  const [requestId, status, progressArg] = process.argv.slice(2);
  if (!requestId || !status) {
    console.error("Usage: node scripts/update-status.mjs <requestId> <status> <progress>");
    process.exit(1);
  }

  const update = { status };
  if (progressArg !== undefined) update.progress = Number(progressArg);

  await db.doc(`requests/${requestId}`).update(update);
  console.log(`Updated ${requestId}: status=${status}${progressArg ? `, progress=${progressArg}%` : ""}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
