// Server-side equivalent of scripts/upload-delivery.mjs, callable directly
// from the generation route instead of requiring a manual operator run.
// Same chunking size and same stale-chunk cleanup fix (a previous, larger
// upload of the same fileKey used to leave extra chunk docs behind, which
// download.js reads regardless of chunkCount and which corrupted re-uploads
// — see scripts/upload-delivery.mjs's own comment on this).
import { adminDb } from "../firebaseAdmin.js";

const CHUNK_BASE64_CHARS = 700_000; // comfortably under Firestore's 1 MiB doc limit

export async function saveDeliveryFile(requestId, fileKey, buffer, mimeType) {
  const db = adminDb();
  const base64 = buffer.toString("base64");

  const chunks = [];
  for (let i = 0; i < base64.length; i += CHUNK_BASE64_CHARS) {
    chunks.push(base64.slice(i, i + CHUNK_BASE64_CHARS));
  }

  const fileDocRef = db.doc(`requests/${requestId}/files/${fileKey}`);
  await fileDocRef.set({
    mimeType,
    totalBytes: buffer.length,
    chunkCount: chunks.length,
    uploadedAt: new Date().toISOString(),
  });

  const existingChunks = await fileDocRef.collection("chunks").listDocuments();
  for (const docRef of existingChunks) {
    if (Number(docRef.id) >= chunks.length) await docRef.delete();
  }

  for (let i = 0; i < chunks.length; i++) {
    await fileDocRef.collection("chunks").doc(String(i)).set({ index: i, data: chunks[i] });
  }

  await db.doc(`requests/${requestId}`).update({ [`filesReady.${fileKey}`]: true });

  return { fileKey, bytes: buffer.length, chunkCount: chunks.length };
}

// Server-side mirror of the client-side reassembly in src/lib/download.js,
// used when a later stage (SAVING embedding the cover into the EPUB) needs
// bytes an earlier stage (COVER) already saved.
export async function getDeliveryFileBuffer(requestId, fileKey) {
  const db = adminDb();
  const fileDoc = await db.doc(`requests/${requestId}/files/${fileKey}`).get();
  if (!fileDoc.exists) return null;
  const chunksSnap = await db.collection(`requests/${requestId}/files/${fileKey}/chunks`).orderBy("index").get();
  const base64 = chunksSnap.docs.map((d) => d.data().data).join("");
  return { buffer: Buffer.from(base64, "base64"), mimeType: fileDoc.data().mimeType };
}
