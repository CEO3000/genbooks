// Lets the sign-up form refuse a throwaway email address before the
// account is created (the blocklist is too large to ship to the browser).
import { isDisposableEmail } from "../../../lib/emailRules.js";

export async function POST(request) {
  const { email } = await request.json().catch(() => ({}));
  const valid = typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!valid) return Response.json({ ok: false, error: "Please enter a valid email address." });
  if (isDisposableEmail(email)) {
    return Response.json({ ok: false, error: "Please use a permanent email address, not a temporary one." });
  }
  return Response.json({ ok: true });
}
