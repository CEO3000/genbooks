import { createRemoteJWKSet, jwtVerify } from "jose";

// firebase-admin/auth's verifyIdToken pulls in jwks-rsa, which pulls in
// jose's ESM build via a plain require(), which conflicts with Vercel's
// bundler and crashes at runtime (both eagerly on import and lazily on
// call). Verifying the token by hand with jose directly, the same way
// Firebase's own token format is documented, sidesteps that broken
// dependency chain entirely, since jose itself is ESM-native and bundles
// fine when imported directly rather than through jwks-rsa's wrapper.
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

export async function verifyFirebaseIdToken(token) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  return payload;
}
