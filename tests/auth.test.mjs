import { test, mock, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const PROJECT = "example-project";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT; // read once when the module loads
process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";

const { verifyFirebaseIdToken } = await import("../src/lib/verifyFirebaseToken.js");
const { verifyCaptcha } = await import("../src/lib/captcha.js");

let signingKey;
let otherKey;
const KID = "test-key-1";

before(async () => {
  signingKey = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(signingKey.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  // Google's public signing keys, replaced by ours.
  mock.method(globalThis, "fetch", async () => Response.json({ keys: [jwk] }, { headers: { "cache-control": "max-age=3600" } }));
});
afterEach(() => {});

const sign = (claims, { key = signingKey.privateKey, kid = KID, issuer = `https://securetoken.google.com/${PROJECT}`, audience = PROJECT, expiresIn = "1h" } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);

// ---- Firebase ID tokens ----

test("a valid token for this project is accepted and its claims are returned", async () => {
  const payload = await verifyFirebaseIdToken(await sign({ email: "a@example.org", admin: true }));
  assert.equal(payload.sub, "user-1");
  assert.equal(payload.email, "a@example.org");
  assert.equal(payload.admin, true);
});

test("a token for a different project is refused", async () => {
  await assert.rejects(verifyFirebaseIdToken(await sign({}, { audience: "someone-elses-project" })));
  await assert.rejects(verifyFirebaseIdToken(await sign({}, { issuer: "https://securetoken.google.com/someone-elses-project" })));
});

test("an expired token is refused", async () => {
  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(PROJECT)
    .setSubject("user-1")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(signingKey.privateKey);
  await assert.rejects(verifyFirebaseIdToken(expired), /exp/);
});

test("a token signed with some other key is refused, even with the right claims and key id", async () => {
  await assert.rejects(verifyFirebaseIdToken(await sign({}, { key: otherKey.privateKey })));
});

test("an unsigned token and plain garbage are refused", async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "user-1", aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` })}.`;
  await assert.rejects(verifyFirebaseIdToken(unsigned));
  await assert.rejects(verifyFirebaseIdToken("not a token"));
  await assert.rejects(verifyFirebaseIdToken(""));
});

// ---- the captcha check inside protected routes ----

const turnstile = (success) => {
  mock.restoreAll();
  const seen = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url: String(url), body: String(init.body) });
    return Response.json({ success });
  });
  return seen;
};

test("a missing token fails the captcha without asking anyone", async () => {
  const seen = turnstile(true);
  assert.equal(await verifyCaptcha(""), false);
  assert.equal(await verifyCaptcha(undefined), false);
  assert.equal(seen.length, 0);
});

test("a token is checked with Cloudflare, with the secret kept server-side", async () => {
  const seen = turnstile(true);
  assert.equal(await verifyCaptcha("visitor-token"), true);
  assert.match(seen[0].url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(seen[0].body, /secret=turnstile-secret/);
  assert.match(seen[0].body, /response=visitor-token/);
});

test("a token Cloudflare rejects fails the captcha", async () => {
  turnstile(false);
  assert.equal(await verifyCaptcha("bad-token"), false);
});

test("with no secret configured the captcha fails closed instead of letting everyone through", async () => {
  const seen = turnstile(true);
  const secret = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    assert.equal(await verifyCaptcha("visitor-token"), false);
    assert.equal(seen.length, 0);
  } finally {
    process.env.TURNSTILE_SECRET_KEY = secret;
  }
});
