import Link from "next/link";
import { displayProgress } from "../lib/progressDisplay";

// The live progress bar on a book's page. It follows whichever generation
// job is current (the free preview, then the full book), and disappears
// once that job has finished: the preview card or the downloads take over
// from there, and a full bar next to "Buy full book" read as if the whole
// book were done.
export default function JobProgressCard({ job, request, requestId, now, customerEmail }) {
  if (job?.status === "complete") return null;

  const running = job?.status === "running";
  const failed = job?.status === "failed";
  // Books from before the automated pipeline have no job; their progress
  // lives on the request itself.
  const progress = job ? displayProgress(job, now) : (request.progress ?? 0);
  const label = failed ? "Something went wrong" : (job?.message || request.status || "submitted");
  const elapsedSeconds = running && job.startedAt ? Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 1000)) : 0;
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const isFullBook = job && job.type !== "preview";

  return (
    <div className="glass mt-8 p-6">
      <div className="flex items-center justify-between text-sm">
        <span className={`mono-label ${failed ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>{label}</span>
        <span className="text-white/50 tabular-nums">{Math.floor(progress)}%</span>
      </div>
      <div className={`progress-track mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ${running ? "is-live" : ""}`}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            // A sliver even at 0%, so the live shimmer has something to run along.
            width: `${running ? Math.max(progress, 2) : progress}%`,
            background: failed ? "var(--danger)" : "linear-gradient(90deg, var(--accent), var(--accent-3), var(--accent-2))",
          }}
        />
      </div>
      {running && (
        <div className="mt-3 flex items-center justify-between gap-4 text-xs text-white/40">
          <span>
            {job.retrying
              ? "Hit a temporary problem, retrying automatically. Nothing is lost."
              : "Working on it now. This page updates live."}
          </span>
          <span className="shrink-0 tabular-nums">{elapsed}</span>
        </div>
      )}
      {running && isFullBook && (
        <p className="mt-4 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] px-4 py-3 text-sm text-white/75">
          You don&apos;t need to wait on this page. We&apos;ll email a download link to{" "}
          {customerEmail ? <span className="text-white">{customerEmail}</span> : "your email address"} as soon as
          your book is ready.
        </p>
      )}
      {failed && (
        <p className="mt-3 text-xs text-white/50">
          Generation hit a problem and stopped after several automatic retries. Nothing was lost, and we
          have already been notified.{" "}
          <Link href={`/support?requestId=${requestId}`} className="underline hover:text-white/80">
            Contact support
          </Link>{" "}
          if you would like an update.
        </p>
      )}
    </div>
  );
}
