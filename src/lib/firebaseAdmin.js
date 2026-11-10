import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not set");
  return JSON.parse(raw);
}

function adminApp() {
  return getApps().length ? getApps()[0] : initializeApp({ credential: cert(getServiceAccount()) });
}

export function adminDb() {
  return getFirestore(adminApp());
}

// Deliberately no adminAuth() export here. firebase-admin/auth pulls in
// jwks-rsa, which pulls in jose's ESM build via a plain require(), which
// conflicts with Vercel's bundler and crashes at runtime, eagerly on a
// static import and lazily on a dynamic one alike. Verify Firebase ID
// tokens with ../lib/verifyFirebaseToken.js instead, which uses jose
// directly and sidesteps the broken dependency chain entirely.
