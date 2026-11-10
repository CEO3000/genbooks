// Uploads a finished book file (epub, pdf, front_cover, back_cover) into
// Firestore as base64 chunks, since Cloud Storage requires the paid Blaze
// plan and Firestore does not. Run locally by the operator using the
// Firebase Admin SDK, which bypasses the security rules that block
// unauthenticated clients from writing file content.
//
// Requires a local service-account.json (Firebase Console > Project
// Settings > Service Accounts > Generate new private key), gitignored.
//
// Usage:
//   node scripts/upload-delivery.mjs <requestId> <fileKey> <filePath> [mimeType]

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(readFileSync(new URL("../service-account.json", import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const DEFAULT_MIME = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  front_cover: "image/jpeg",
  back_cover: "image/jpeg",
  paperback_cover: "image/jpeg",
};

const CHUNK_BASE64_CHARS = 700_000; // comfortably under Firestore's 1 MiB doc limit

async function main() {
  const [requestId, fileKey, filePath, mimeTypeArg] = process.argv.slice(2);
  if (!requestId || !fileKey || !filePath) {
    console.error(
      "Usage: node scripts/upload-delivery.mjs <requestId> <fileKey> <filePath> [mimeType]"
    );
    process.exit(1);
  }

  const mimeType = mimeTypeArg || DEFAULT_MIME[fileKey] || "application/octet-stream";
  const raw = readFileSync(filePath);
  const base64 = raw.toString("base64");

  const chunks = [];
  for (let i = 0; i < base64.length; i += CHUNK_BASE64_CHARS) {
    chunks.push(base64.slice(i, i + CHUNK_BASE64_CHARS));
  }

  const fileDocRef = db.doc(`requests/${requestId}/files/${fileKey}`);
  await fileDocRef.set({
    mimeType,
    totalBytes: raw.length,
    chunkCount: chunks.length,
    uploadedAt: new Date().toISOString(),
  });

  // A previous upload of this fileKey may have had more chunks than this one
  // (e.g. a larger earlier draft). download.js reads every chunk doc it finds,
  // not just chunkCount, so a leftover chunk from a bigger prior upload gets
  // appended onto the current file and corrupts it. Clear old chunks first.
  const existingChunks = await fileDocRef.collection("chunks").listDocuments();
  for (const docRef of existingChunks) {
    if (Number(docRef.id) >= chunks.length) await docRef.delete();
  }

  for (let i = 0; i < chunks.length; i++) {
    await fileDocRef.collection("chunks").doc(String(i)).set({ index: i, data: chunks[i] });
    console.log(`Uploaded chunk ${i + 1}/${chunks.length}`);
  }

  await db.doc(`requests/${requestId}`).update({ [`filesReady.${fileKey}`]: true });

  console.log(`Done. ${fileKey} for request ${requestId}: ${raw.length} bytes in ${chunks.length} chunk(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
