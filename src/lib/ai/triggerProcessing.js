// Asks /api/generate/process to claim and run the job's next step. That
// route only acknowledges (it does the work after responding), so this
// returns within a second or two rather than waiting for the step itself.
// Safe to call any number of times: claimStep()'s lease makes every call
// beyond the first a no-op while a step is genuinely in progress.

// Vercel's per-deployment URLs (VERCEL_URL) sit behind Vercel's deployment
// protection and answer 401 to server-to-server calls (confirmed live),
// which silently broke every self-chained step, the sweeper, and the
// Stripe-webhook kickoff (Stripe sends no Origin header). Production must
// reach itself through its public domain instead.
export function selfOrigin(request) {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return request?.headers?.get("origin") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
}

/** @returns {Promise<boolean>} whether the process route was reached */
export async function triggerProcessing(jobId, request = null) {
  const url = `${selfOrigin(request)}/api/generate/process`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return true;
      console.error(`triggerProcessing ${jobId}: ${url} answered ${res.status}`);
    } catch (err) {
      console.error(`triggerProcessing ${jobId}: ${err.message}`);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  // Left for the watchdogs (the book page's stall check and the scheduled
  // sweeper), which find any running job nobody is working on.
  return false;
}

// Makes sure the sweeper's self-repeating check (generate/sweep/route.js)
// is alive whenever new work starts. A no-op if it is already running.
export async function kickWatchdog(request = null) {
  if (!process.env.CRON_SECRET) return;
  try {
    await fetch(`${selfOrigin(request)}/api/generate/sweep`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    console.error("kickWatchdog:", err.message);
  }
}
