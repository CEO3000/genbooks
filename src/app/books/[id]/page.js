"use client";

import { use, useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { downloadDeliveryFile } from "../../../lib/download";
import { estimatePrice } from "../../../lib/pricing";
import { useAuthUser } from "../../../lib/useAuthUser";
import BookPreviewReader from "../../../components/BookPreviewReader";
import JobProgressCard from "../../../components/JobProgressCard";
import VerifyEmailCard from "../../../components/VerifyEmailCard";
import Link from "next/link";

// Always shown once a book is delivered, "Not ready" until they land -
// every book eventually gets all three of these. DOCX is deliberately
// not offered to customers at all, even for older books that happen to
// have one — not a format the business wants to expose.
const CORE_FILE_LABELS = {
  epub: "EPUB",
  pdf: "PDF",
  front_cover: "Front cover (JPG)",
};

// Only shown once actually ready. The new automated pipeline doesn't
// build these yet (no page-count-derived spine width for a paperback
// wrap) - showing a permanent "Not ready" row for something that will
// never become ready looks broken to a real customer. Older, manually
// delivered books do sometimes have these, so they still show up once set.
const OPTIONAL_FILE_LABELS = {
  back_cover: "Back cover (JPG)",
  paperback_cover: "Paperback wrap cover (JPG)",
};

export default function RequestDetailPage({ params }) {
  const { id } = use(params);
  const { user, isAdmin, isRegistered } = useAuthUser();
  // undefined = not loaded yet, null = confirmed not found (a real book's
  // own doc snapshot always resolves to an object) — using the same value
  // for both previously meant a bad or deleted book id showed an infinite
  // "Loading..." spinner forever instead of a real not-found message.
  const [request, setRequest] = useState(undefined);
  const [job, setJob] = useState(null);
  const [files, setFiles] = useState({});
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    // A doc that genuinely doesn't exist resolves with exists()===false;
    // one that exists but isn't this user's own book is denied by
    // firestore.rules instead, which fires the error callback, not the
    // success one — without handling it, request stayed undefined forever
    // (an infinite "Loading..." spinner) for anyone opening a book id
    // that isn't theirs, instead of a clear not-found message.
    const unsub = onSnapshot(
      doc(db, "requests", id),
      (snap) => setRequest(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => setRequest(null)
    );
    return unsub;
  }, [id, user]);

  // The Gemini pipeline (when enabled) writes its real, backend-controlled
  // progress to a separate generationJobs/{jobId} doc, not to requests/{id}
  // directly — requests/{id}.currentJobId (set by kickoff.js) is how this
  // page finds it. Old-flow requests never get currentJobId set, so this
  // subscription simply never activates for them, no behavior change.
  useEffect(() => {
    if (!user || !request?.currentJobId) return;
    const unsub = onSnapshot(doc(db, "generationJobs", request.currentJobId), (snap) => {
      setJob(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return unsub;
  }, [user, request?.currentJobId]);

  // Ticks once a second while a job is running: drives the elapsed-time
  // display and this page's own stall check below.
  const jobRunning = job?.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!jobRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobRunning]);

  // The page's own watchdog, alongside the scheduled server sweeper: while
  // someone is watching, a job that nobody is working on (lease expired,
  // or no lease and nothing has moved for a while) gets nudged at once
  // instead of waiting for the next sweep. Harmless if the server is in
  // fact busy, since the process route only claims a step with no live
  // lease.
  const lastNudge = useRef(0);
  useEffect(() => {
    if (!jobRunning) return;
    const leaseExpired = job.lease && Date.parse(job.lease.expiresAt) < now;
    const waitingOnRetry = job.retryAfter && Date.parse(job.retryAfter) > now;
    const idle = !job.lease && !waitingOnRetry && now - Date.parse(job.updatedAt) > 20_000;
    if (!(leaseExpired || idle) || now - lastNudge.current < 30_000) return;
    lastNudge.current = now;
    fetch("/api/generate/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    }).catch(() => {});
  }, [jobRunning, job, now]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "requests", id, "files"), (snap) => {
      const next = {};
      snap.docs.forEach((d) => {
        next[d.id] = d.data();
      });
      setFiles(next);
    });
    return unsub;
  }, [id, user]);

  const canContinue = Boolean(isAdmin || request?.paid);
  const continueRequested = Boolean(request?.continueRequested);

  async function actuallyDownload(key) {
    setError(null);
    setDownloading(key);
    try {
      await downloadDeliveryFile(id, key, (request?.title || "book").replace(/[^a-z0-9]+/gi, "-"));
    } catch (err) {
      setError(`Could not download ${CORE_FILE_LABELS[key] || OPTIONAL_FILE_LABELS[key] || key}. Please try again.`);
    } finally {
      setDownloading(null);
    }
  }

  async function handleCheckout() {
    setError(null);
    setCheckingOut(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "checkout-failed");
      window.location.href = data.url;
    } catch (err) {
      setError(
        err.message === "Payments are not connected yet."
          ? "Payments are not connected yet. Please check back soon."
          : "Could not start checkout. Please try again."
      );
      setCheckingOut(false);
    }
  }

  async function handleContinueGenerating() {
    setError(null);
    setCheckingOut(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: id }),
      });
      if (!res.ok) throw new Error("continue-failed");
    } catch {
      setError("Could not start full generation. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  if (user === undefined || request === undefined) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="text-sm text-white/50">Loading...</p>
        <Link href="/books" className="mt-4 inline-block text-sm text-white/70 underline">
          Back to My Books
        </Link>
      </main>
    );
  }

  if (request === null) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="mono-label">Not found</p>
        <h1 className="mt-2 text-xl font-semibold">This book doesn&apos;t exist, or you don&apos;t have access to it.</h1>
        <Link href="/books" className="mt-4 inline-block text-sm text-white/70 underline">
          Back to My Books
        </Link>
      </main>
    );
  }

  const price = estimatePrice(request.wordCountTarget);
  const filesReady = request.filesReady || {};
  const hasPreview = Boolean(request.previewText);
  const awaitingVerification = request.status === "awaiting verification" && !request.previewStartedAt && !request.abandoned;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <Link href="/books" className="text-sm text-white/50 hover:text-white transition-colors">
        ← My Books
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{request.title || "Untitled"}</h1>
      <p className="mt-1 text-sm text-white/50">Requested by {request.authorName}</p>
      {request.abandoned && (
        <p className="mt-3 text-sm text-white/50">You replaced this book with a newer one. Its preview stays here to read.</p>
      )}

      {awaitingVerification ? (
        <VerifyEmailCard requestId={id} email={request.ownerEmail || user?.email || ""} />
      ) : (
        <JobProgressCard
          job={job}
          request={request}
          requestId={id}
          now={now}
          customerEmail={user?.email || ""}
        />
      )}

      {hasPreview && (
        <div className="glass glass-hover mt-6 flex items-center justify-between px-6 py-4">
          <div>
            <p className="mono-label">Free preview</p>
            <p className="mt-0.5 text-sm text-white/50">Read the first pages before you decide</p>
          </div>
          <button onClick={() => setPreviewOpen(true)} className="btn-primary px-5 py-2.5 text-sm">
            Read preview
          </button>
        </div>
      )}

      <BookPreviewReader
        text={request.previewText || ""}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={request.title}
        subtitle={request.subtitle}
        author={request.authorName}
        aboutAuthor={request.aboutAuthor}
        introduction={request.introduction}
        chapters={Array.isArray(request.outline) ? request.outline.map((c) => c.title) : []}
      />

      {!continueRequested && !awaitingVerification && (
        <div className="glass mt-6 p-8 text-center">
          {!hasPreview ? (
            <>
              <p className="mono-label">{job?.status === "failed" ? "Preview hit a problem" : "Your free preview"}</p>
              <p className="mt-2 text-sm text-white/60">
                {job?.status === "failed" ? (
                  <>
                    Something went wrong generating your preview, and we have been notified.{" "}
                    <Link href={`/support?requestId=${id}`} className="underline hover:text-white/80">
                      Contact support
                    </Link>{" "}
                    if you would like an update.
                  </>
                ) : (
                  "Your preview will be ready in 4-6 minutes."
                )}
              </p>
            </>
          ) : !isRegistered ? (
            <>
              <p className="mono-label">Like what you read?</p>
              <h2 className="mt-2 text-xl font-semibold">
                <span className="gradient-text">Create a free account</span> to continue.
              </h2>
              <p className="mt-2 text-sm text-white/60">
                Your progress on this book stays exactly as it is, nothing is lost.
              </p>
              <Link
                href={`/register?returnTo=${encodeURIComponent(`/books/${id}`)}`}
                className="btn-primary mt-6 inline-block px-5 py-3 text-sm"
              >
                Create free account
              </Link>
            </>
          ) : !canContinue ? (
            <>
              <p className="mono-label">Continue this book</p>
              <h2 className="mt-2 text-xl font-semibold">
                Generate the full book for <span className="gradient-text">£{price.toFixed(2)}</span>
              </h2>
              <p className="mt-2 text-sm text-white/60">
                One-time payment. We write, edit and design the rest, covers included.
              </p>
              <button
                onClick={handleCheckout}
                disabled={checkingOut}
                className="btn-primary mt-6 px-5 py-3 text-sm disabled:opacity-60"
              >
                {checkingOut ? "Redirecting..." : `Buy full book for £${price.toFixed(2)}`}
              </button>
            </>
          ) : (
            <>
              <p className="mono-label">{isAdmin ? "Admin: free access" : "Payment received"}</p>
              <h2 className="mt-2 text-xl font-semibold">
                <span className="gradient-text">Ready to generate</span> the rest of the book.
              </h2>
              <p className="mt-2 text-sm text-white/60">
                Nothing more is written until you confirm. Writing usually takes 30 minutes to 2 hours,
                depending on length, and you don&apos;t need to stay on this page: we&apos;ll email you a
                download link as soon as your book is ready.
              </p>
              <button
                onClick={handleContinueGenerating}
                disabled={checkingOut}
                className="btn-primary mt-6 px-5 py-3 text-sm disabled:opacity-60"
              >
                {checkingOut ? "Starting..." : "Continue generating all pages"}
              </button>
            </>
          )}
        </div>
      )}

      {continueRequested && (
        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="mono-label">Deliverables</h2>
            {isAdmin && (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                admin: free access
              </span>
            )}
          </div>

          <ul className="mt-3 flex flex-col gap-2">
            {[
              ...Object.keys(CORE_FILE_LABELS),
              ...Object.keys(OPTIONAL_FILE_LABELS).filter((key) => filesReady[key]),
            ].map((key) => {
              const label = CORE_FILE_LABELS[key] || OPTIONAL_FILE_LABELS[key];
              const ready = Boolean(filesReady[key]);
              return (
                <li key={key} className="glass glass-hover flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span
                      className="status-dot h-1.5 w-1.5 rounded-full"
                      style={{ background: ready ? "var(--accent)" : "var(--text-dim)" }}
                    />
                    <span className="text-sm">{label}</span>
                  </div>
                  {!ready ? (
                    <span className="text-xs text-white/30">Not ready</span>
                  ) : (
                    <button
                      onClick={() => actuallyDownload(key)}
                      disabled={downloading === key}
                      className="btn-primary px-4 py-1.5 text-xs"
                    >
                      {downloading === key ? "Preparing..." : "Download"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </main>
  );
}
