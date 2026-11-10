"use client";

import { useEffect, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { auth } from "../lib/firebase";
import { getDeviceId } from "../lib/deviceId";

// Shown on a book that is waiting for its owner to confirm their email.
// Checks every few seconds whether the link has been clicked (in this
// browser or any other device) and starts the free preview by itself the
// moment it has, so the visitor never has to come back and press anything.
export default function VerifyEmailCard({ requestId, email }) {
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function check() {
      const current = auth.currentUser;
      if (stopped || !current) return;
      try {
        await current.reload();
        if (!auth.currentUser?.emailVerified) return;
        const token = await auth.currentUser.getIdToken(true);
        const res = await fetch("/api/requests/start-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ requestId, deviceId: getDeviceId() }),
        });
        stopped = true;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Could not start your preview. Please refresh the page.");
        }
        // On success the book's own live data switches this card to progress.
      } catch {
        // Offline for a moment; the next check tries again.
      }
    }
    const first = setTimeout(check, 0);
    const timer = setInterval(check, 4000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [requestId]);

  async function resend() {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setNotice("Sent again. It can take a minute to arrive, and may land in spam.");
    } catch (err) {
      setNotice(
        err.code === "auth/too-many-requests"
          ? "We've just sent one. Please wait a minute before asking again."
          : "Could not send the email. Please try again in a moment."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="glass mt-8 p-6 text-center sm:p-8">
      <p className="mono-label text-[var(--accent)]">One last step</p>
      <h2 className="mt-2 text-xl font-semibold">Confirm your email to start your free preview</h2>
      <p className="mt-3 text-sm text-white/60">
        We sent a link to {email ? <span className="text-white">{email}</span> : "your email address"}. Click it
        and your preview starts by itself. If you can&apos;t see it, check your spam folder.
      </p>
      <button onClick={resend} disabled={sending} className="btn-ghost mt-5 px-4 py-2 text-xs">
        {sending ? "Sending..." : "Send the email again"}
      </button>
      {notice && <p className="mt-3 text-xs text-white/50">{notice}</p>}
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
