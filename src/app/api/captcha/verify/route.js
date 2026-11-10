// Used for immediate inline UI feedback only (e.g. showing an error the
// moment a captcha fails) — NOT the actual security boundary. The routes
// that matter (requests/create, support/create) verify the token
// themselves via lib/captcha.js as part of the same protected request,
// since a separate pre-flight call like this one produces nothing the
// protected route can check, and could simply be skipped by a direct call.
import { verifyCaptcha } from "../../../../lib/captcha.js";

export async function POST(request) {
  const { token } = await request.json();
  if (!token) {
    return Response.json({ ok: false, error: "Missing captcha token" }, { status: 400 });
  }

  const ok = await verifyCaptcha(token);
  if (!ok) {
    return Response.json({ ok: false, error: "Captcha failed" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
