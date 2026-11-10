"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../lib/firebase";
import Turnstile from "../../components/Turnstile";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("returnTo") || "/");
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (!captchaToken) {
      setError("Please complete the captcha.");
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

      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.push(returnTo);
    } catch (err) {
      if (err.message === "captcha-failed") {
        setError("Captcha verification failed. Please try again.");
      } else if (err.code === "auth/invalid-credential") {
        setError("Incorrect email or password.");
      } else {
        setError("Could not sign in. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="glass w-full p-8">
        <p className="mono-label">Sign in</p>
        <h1 className="mt-2 text-xl font-semibold">
          Welcome <span className="gradient-text">back</span>
        </h1>

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

          <label className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="mono-label">Password</span>
              <Link href="/forgot-password" className="text-xs text-white/50 hover:text-white/80">
                Forgot password?
              </Link>
            </div>
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
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/50">
          No account yet?{" "}
          <Link href={`/register?returnTo=${encodeURIComponent(returnTo)}`} className="underline hover:text-white/80">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
