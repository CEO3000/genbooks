// Grants the admin custom claim to a registered user by email. That user
// must already exist (have registered through /register) before running
// this. Once granted, they get free access to every book's files, checked
// directly in the Firestore security rules via request.auth.token.admin.
//
// Usage:
//   node scripts/set-admin-claim.mjs <email>

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const serviceAccount = JSON.parse(readFileSync(new URL("../service-account.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: node scripts/set-admin-claim.mjs <email>");
    process.exit(1);
  }

  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { admin: true });
  console.log(`Granted admin claim to ${email} (uid: ${user.uid}).`);
  console.log("They must sign out and back in (or wait for their token to refresh) for it to take effect.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
