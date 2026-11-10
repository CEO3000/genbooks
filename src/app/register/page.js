"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "../../lib/useAuthUser";
import { registerAccount, registrationErrorMessage } from "../../lib/registerAccount";
import Turnstile from "../../components/Turnstile";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const { user: authUser } = useAuthUser();
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("returnTo") || "/");
  }, []);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !email.trim() || !password) {
      setError("Full name, email and password are all required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!captchaToken) {
      setError("Please complete the captcha.");
      return;
    }
    if (authUser === undefined) {
      // Firebase auth state (including the anonymous bootstrap identity)
      // has not resolved yet. Submitting now risks reading a stale
      // auth.currentUser and creating a brand new account instead of
      // upgrading the visitor's existing anonymous one, orphaning
      // whatever request they already started.
      setError("Still setting up your session, please try again in a moment.");
      return;
    }

    setSubmitting(true);
    try {
      const captchaCheck = await fetch("/api/captcha/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: captchaToken }),
      });
      if (!captchaCheck.ok) throw new Error("captcha-failed");

      await registerAccount({ fullName, email, password });

      router.push(returnTo);
    } catch (err) {
      if (err.code === "auth/email-already-in-use" || err.code === "auth/credential-already-in-use") {
        setError(
          "An account with this email already exists. Sign in instead, or use \"Forgot password?\" on the sign-in page if you're not sure of the password."
        );
      } else if (err.message === "captcha-failed") {
        setError("Captcha verification failed. Please try again.");
      } else {
        setError(registrationErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="glass w-full p-8">
        <p className="mono-label">Create account</p>
        <h1 className="mt-2 text-xl font-semibold">
          <span className="gradient-text">Join</span> Genbooks
        </h1>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="mono-label">Full name</span>
            <input className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="mono-label">Email</span>
            <input
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="mono-label">Password</span>
            <input
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <Turnstile onToken={setCaptchaToken} />

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary px-4 py-2.5 text-sm">
            {submitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-white/40">
          We only use your details for your account and your books.{" "}
          <Link href="/privacy" className="underline hover:text-white/70">Privacy policy</Link>
        </p>

        <p className="mt-6 text-center text-sm text-white/50">
          Already have an account?{" "}
          <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="underline hover:text-white/80">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
