"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuthUser } from "../../lib/useAuthUser";
import Turnstile from "../../components/Turnstile";
import Link from "next/link";

export default function SupportPage() {
  const { user, isAdmin } = useAuthUser();
  // Admin previously always landed on ticket management with no way to
  // reach the actual form (e.g. to test it, or to send a message as
  // themselves) - a real, reported dead end. A plain visitor never sees
  // this toggle at all, so nothing changes for them.
  //
  // Kept in the URL (?view=tickets), not plain component state - a real
  // reported bug had this reverting to Tickets on its own after
  // switching, most likely from useAuthUser's onAuthStateChanged firing
  // again (now fixed separately, see useAuthUser.js), but URL state is
  // structurally immune to that whole class of bug regardless of the
  // exact cause: a re-render can't reset what isn't component state, and
  // this also means reloading the page keeps the same view instead of
  // silently jumping to a different one every time.
  //
  // Defaults to "form": clicking "Support" is a request for help, not a
  // request to see admin's ticket queue - ticket management is the
  // secondary view here, reached deliberately via the toggle, not the
  // landing state.
  const [adminView, setAdminView] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "tickets"
      ? "tickets"
      : "form"
  );

  function selectView(v) {
    setAdminView(v);
    const url = new URL(window.location.href);
    if (v === "tickets") url.searchParams.set("view", "tickets");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }

  if (isAdmin) {
    const toggle = (
      <div className="flex gap-2">
        {[
          ["tickets", "Tickets"],
          ["form", "Send a message"],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => selectView(v)}
            className={`rounded-full px-4 py-1.5 text-xs ${adminView === v ? "btn-primary" : "btn-ghost"}`}
          >
            {label}
          </button>
        ))}
      </div>
    );
    return adminView === "tickets" ? <AdminTicketList user={user} topBar={toggle} /> : <SupportForm user={user} topBar={toggle} />;
  }

  return <SupportForm user={user} />;
}

function SupportForm({ user, topBar }) {
  const [requestId] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("requestId") : null
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [captchaToken, setCaptchaToken] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      setError("Please fill in every field.");
      return;
    }
    if (!captchaToken) {
      setError("Please complete the captcha.");
      return;
    }
    if (!user) {
      setError("Still setting things up, try again in a second.");
      return;
    }

    setSubmitting(true);
    try {
      // The route itself verifies captchaToken server-side now (the real
      // security boundary) — no separate pre-flight call needed.
      const idToken = await user.getIdToken();
      const res = await fetch("/api/support/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ name, email, subject, message, requestId, captchaToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "submit-failed");
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not send your message. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-24 text-center">
        {topBar && <div className="mb-10 text-left">{topBar}</div>}
        <p className="mono-label text-[var(--accent)]">Message sent</p>
        <h1 className="mt-2 text-2xl font-semibold">We&apos;ll get back to you soon</h1>
        <p className="mt-3 text-sm text-white/60">
          Thanks for reaching out. We read every message and reply as soon as we can.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-16">
      {topBar && <div className="mb-8">{topBar}</div>}
      <p className="mono-label">Support</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        <span className="gradient-text">Need help?</span> Tell us what&apos;s wrong.
      </h1>
      <p className="mt-3 text-white/60">
        Whether it&apos;s a problem with a book, a payment, or anything else, send us a message and
        we&apos;ll sort it out.
      </p>

      <form onSubmit={handleSubmit} className="glass mt-8 flex flex-col gap-5 p-6 sm:p-8">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="mono-label">Your name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="mono-label">Email (so we can reply)</span>
          <input type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="mono-label">Subject</span>
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="mono-label">Message</span>
          <textarea
            className="field min-h-32"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
          />
        </label>

        {requestId && (
          <p className="text-xs text-white/40">This message will be linked to your book, for context.</p>
        )}

        <Turnstile onToken={setCaptchaToken} />

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary px-5 py-3 text-sm">
          {submitting ? "Sending..." : "Send message"}
        </button>
        <p className="text-center text-xs text-white/40">
          We only use your details to reply to you.{" "}
          <Link href="/privacy" className="underline hover:text-white/70">Privacy policy</Link>
        </p>
      </form>
    </main>
  );
}

function AdminTicketList({ user, topBar }) {
  const [tickets, setTickets] = useState(null);
  const [filter, setFilter] = useState("open");
  const [resolving, setResolving] = useState(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "supportTickets"), where("status", "==", filter));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setTickets(rows);
      },
      () => setTickets([])
    );
    return unsub;
  }, [user, filter]);

  async function markResolved(ticketId) {
    setResolving(ticketId);
    try {
      const idToken = await user.getIdToken();
      await fetch("/api/support/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ ticketId }),
      });
    } finally {
      setResolving(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-16">
      {topBar && <div className="mb-8">{topBar}</div>}
      <p className="mono-label">Support</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Tickets</h1>

      <div className="mt-6 flex gap-2">
        {["open", "resolved"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-xs ${filter === f ? "btn-primary" : "btn-ghost"}`}
          >
            {f === "open" ? "Open" : "Resolved"}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {tickets === null && <p className="text-sm text-white/50">Loading...</p>}
        {tickets !== null && tickets.length === 0 && (
          <p className="text-sm text-white/50">No {filter} tickets.</p>
        )}
        {tickets?.map((t) => (
          <div key={t.id} className="glass p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">{t.subject}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {t.name} &lt;{t.email}&gt; &middot; {new Date(t.createdAt).toLocaleString()}
                  {t.requestId && ` · book ${t.requestId}`}
                </p>
              </div>
              {filter === "open" && (
                <button
                  onClick={() => markResolved(t.id)}
                  disabled={resolving === t.id}
                  className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
                >
                  {resolving === t.id ? "Marking..." : "Mark resolved"}
                </button>
              )}
            </div>
            <p className="mt-3 text-sm text-white/70 whitespace-pre-wrap">{t.message}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
