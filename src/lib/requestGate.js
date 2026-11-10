// Helpers shared by the request routes. The free-preview rules themselves
// live in previewGate.js.

// The new pipeline produces epub + pdf (docx was removed by design —
// not a format offered to customers; cover generation is separate and
// back_cover/paperback_cover aren't built yet — see generateCover.js's
// generateBackCover). Requiring anything else here would mean no book
// the new pipeline delivers could ever count as "complete", permanently
// blocking every real customer after their first book. The old flow
// sets these same filesReady keys identically (scripts/upload-delivery.mjs),
// so this check is correct for both flows.
export function isRequestComplete(requestData) {
  const filesReady = requestData?.filesReady || {};
  return Boolean(filesReady.epub && filesReady.pdf);
}

export function getClientIp(request) {
  // Vercel's edge network sets x-forwarded-for with the real client IP
  // first in the chain; x-real-ip is a single-IP fallback some proxies
  // set instead. Neither is spoofable by the client on Vercel specifically
  // (Vercel overwrites these at its own edge, not passed through verbatim
  // from whatever the client sent), unlike trusting a client-submitted body.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
