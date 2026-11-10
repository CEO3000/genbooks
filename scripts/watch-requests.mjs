// Real-time listener for pending genbooks.uk work, replacing periodic polling.
// Watches Firestore directly (onSnapshot), so it costs nothing while idle and
// reacts the instant a request needs preview generation or full generation,
// instead of waiting for a fixed interval to come around.
//
// Usage: node scripts/watch-requests.mjs
// Prints one line per new pending-work event to stdout, meant to be wrapped
// by the Monitor tool so each line becomes an immediate notification.

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(readFileSync(new URL("../service-account.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const signaled = new Set(); // requestId:kind already reported, don't repeat
let isFirstSnapshot = true;

function needsPreview(data) {
  return data.status === "submitted" && !data.previewText;
}

function needsFullGen(data) {
  return data.continueRequested === true && data.status !== "ready";
}

db.collection("requests").onSnapshot(
  (snap) => {
    snap.docChanges().forEach((change) => {
      const data = change.doc.data();
      const id = change.doc.id;

      if (needsPreview(data)) {
        const key = `${id}:preview`;
        if (!signaled.has(key)) {
          signaled.add(key);
          if (!isFirstSnapshot) {
            console.log(`PENDING_PREVIEW ${id} "${data.title || "Untitled"}"`);
          }
        }
      }

      if (needsFullGen(data)) {
        const key = `${id}:fullgen`;
        if (!signaled.has(key)) {
          signaled.add(key);
          if (!isFirstSnapshot) {
            console.log(`PENDING_FULLGEN ${id} "${data.title || "Untitled"}"`);
          }
        }
      }

      // Once a request clears a pending condition (preview published, or
      // generation reaches ready), allow it to be re-signaled if it somehow
      // becomes pending again later (e.g. a second continue click on a retry).
      if (!needsPreview(data)) signaled.delete(`${id}:preview`);
      if (!needsFullGen(data)) signaled.delete(`${id}:fullgen`);
    });

    if (isFirstSnapshot) {
      isFirstSnapshot = false;
      console.log("LISTENER_READY watching requests collection");
    }
  },
  (err) => {
    console.error("LISTENER_ERROR", err.message);
    process.exit(1);
  }
);
