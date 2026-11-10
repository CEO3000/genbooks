// Real server-side captcha verification, called from inside the routes
// that actually need protecting (requests/create, support/create), not
// as a separate pre-flight check the client can just skip. A standalone
// /api/captcha/verify call produces no token the protected route then
// validates, so nothing previously stopped a request straight to those
// routes from bypassing the captcha entirely — this closes that gap.
export async function verifyCaptcha(token) {
  if (!token) return false;

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const result = await res.json();
  return Boolean(result.success);
}
