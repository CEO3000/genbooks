"use client";

import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../../lib/firebase";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      // Never reveal whether an email is registered. Report success either
      // way except for a genuinely malformed address, so this cannot be
      // used to check which emails have an account.
      if (err.code !== "auth/invalid-email") {
        setSent(true);
        setSubmitting(false);
        return;
      }
      setError("That doesn't look like a valid email address.");
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="glass w-full p-8">
        <p className="mono-label">Reset password</p>
        <h1 className="mt-2 text-xl font-semibold">
          Forgot your <span className="gradient-text">password?</span>
        </h1>

        {sent ? (
          <>
            <p className="mt-4 text-sm text-white/60">
              If an account exists for that email, a reset link is on its way. Check your inbox
              (and spam folder), open the link, and choose a new password.
            </p>
            <Link
              href="/login"
              className="btn-primary mt-6 inline-block w-full px-4 py-2.5 text-center text-sm"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-white/50">
              Enter the email you registered with and we'll send you a link to set a new password.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="mono-label">Email</span>
                <input
                  type="email"
                  className="field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

              <button type="submit" disabled={submitting} className="btn-primary px-4 py-2.5 text-sm">
                {submitting ? "Sending..." : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-white/50">
          <Link href="/login" className="underline hover:text-white/80">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
