"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuthUser } from "../lib/useAuthUser";
import { registerAccount, registrationErrorMessage } from "../lib/registerAccount";
import { getDeviceId } from "../lib/deviceId";
import Turnstile from "../components/Turnstile";
import Link from "next/link";

const WORDS_PER_PAGE_ESTIMATE = 250;
const MIN_WORD_COUNT = 5000;
const MAX_WORD_COUNT = 100000;

const initialForm = {
  title: "",
  subtitle: "",
  authorName: "",
  authorBio: "",
  genre: "",
  reader: "",
  promise: "",
  tone: "",
  wordCountTarget: "",
  hasOwnOutline: false,
  chapterOutline: "",
  bookDescription: "",
  frontCoverDescription: "",
  backCoverDescription: "",
};

const REQUIRED_FIELDS = [
  ["title", "A title is required."],
  ["subtitle", "A subtitle is required."],
  ["authorName", "The author name to print on the book is required."],
  ["authorBio", "A short author bio for the book's interior is required."],
  ["genre", "A genre or category is required."],
  ["wordCountTarget", "A target word count is required."],
  ["reader", "Who the book is for is required."],
  ["promise", "What the book promises the reader is required."],
  ["tone", "A tone or voice is required."],
  ["bookDescription", "A book description is required."],
];

export default function Home() {
  const router = useRouter();
  const { user, isRegistered } = useAuthUser();
  const [form, setForm] = useState(initialForm);
  // Free previews need an account; a visitor creates one (or signs in)
  // right here when they press Generate, without losing the form.
  const [accountMode, setAccountMode] = useState("create");
  const [account, setAccount] = useState({ fullName: "", email: "", password: "" });
  const [accountDone, setAccountDone] = useState(false);
  const signedIn = isRegistered || accountDone;
  // Set when the server says this book would replace the visitor's current
  // free preview, so they can confirm or keep the old one.
  const [replaceOffer, setReplaceOffer] = useState(null);
  const [blockedBook, setBlockedBook] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const estimatedPages = useMemo(() => {
    const words = Number(form.wordCountTarget);
    if (!words || words <= 0) return null;
    return Math.round(words / WORDS_PER_PAGE_ESTIMATE);
  }, [form.wordCountTarget]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e, { replaceExisting = false } = {}) {
    e.preventDefault();
    setError(null);
    setReplaceOffer(null);
    setBlockedBook(null);
    if (!user) {
      setError("Still setting things up, try again in a second.");
      return;
    }
    for (const [field, message] of REQUIRED_FIELDS) {
      if (!String(form[field]).trim()) {
        setError(message);
        return;
      }
    }
    if (form.hasOwnOutline && !form.chapterOutline.trim()) {
      setError("Paste your chapter outline, or uncheck that box and we will design one.");
      return;
    }
    if (Number(form.wordCountTarget) < MIN_WORD_COUNT) {
      setError(`Please choose a target of at least ${MIN_WORD_COUNT.toLocaleString()} words.`);
      return;
    }
    if (Number(form.wordCountTarget) > MAX_WORD_COUNT) {
      setError(`We do not currently generate books above ${MAX_WORD_COUNT.toLocaleString()} words. Please lower your target word count.`);
      return;
    }
    if (!signedIn) {
      if (accountMode === "create" && !account.fullName.trim()) {
        setError("Please enter your full name.");
        return;
      }
      if (!account.email.trim() || !account.password) {
        setError("Please enter your email and a password.");
        return;
      }
      if (accountMode === "create" && account.password.length < 8) {
        setError("Please choose a password of at least 8 characters.");
        return;
      }
    }
    if (!captchaToken) {
      setError("Please complete the captcha.");
      return;
    }
    setSubmitting(true);
    try {
      // Checked on auth itself rather than the hook's state, which can lag
      // a moment behind a just-created account.
      if (!auth.currentUser || auth.currentUser.isAnonymous) {
        try {
          if (accountMode === "create") await registerAccount(account);
          else await signInWithEmailAndPassword(auth, account.email.trim(), account.password);
          setAccountDone(true);
        } catch (err) {
          throw new Error(
            accountMode === "create"
              ? registrationErrorMessage(err)
              : "That email and password don't match an account. Check them, or choose \"I need a new account\"."
          );
        }
      }
      const idToken = await auth.currentUser.getIdToken(true);
      const res = await fetch("/api/requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ ...form, captchaToken, deviceId: getDeviceId(), replaceExisting }),
      });
      const data = await res.json();
      if (res.status === 403 && data.code === "confirm-replace") {
        setReplaceOffer({ ...data.existing, message: data.error });
        return;
      }
      if (data.existing) setBlockedBook(data.existing);
      if (!res.ok) throw new Error(data.error || "Something went wrong submitting your request. Please try again.");
      router.push(`/books/${data.id}`);
    } catch (err) {
      setError(err.message || "Something went wrong submitting your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="mb-10">
        <p className="mono-label">Book request</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          <span className="gradient-text">Request</span> a book.
        </h1>
        <p className="mt-3 text-white/60">
          Tell us who it is for, what it should promise the reader, and how it should feel. You
          get the first pages free to read. Continuing past that unlocks the full book for a small
          one-time fee.
        </p>
        <Link href="/books" className="mt-3 inline-block text-sm text-white/50 underline hover:text-white/80">
          My Books
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="glass flex flex-col gap-6 p-6 sm:p-8">
        <Field label="Book title" required>
          <input className="field" value={form.title} onChange={(e) => update("title", e.target.value)} />
        </Field>

        <Field label="Subtitle" required>
          <input className="field" value={form.subtitle} onChange={(e) => update("subtitle", e.target.value)} />
        </Field>

        <Field label="Author name (printed on the cover)" required>
          <input
            className="field"
            placeholder="Exactly as it should appear on the cover"
            value={form.authorName}
            onChange={(e) => update("authorName", e.target.value)}
          />
        </Field>

        <Field label="About the author (used inside the book, never on the cover)" required>
          <textarea
            className="field min-h-20"
            placeholder="A short bio for the book's own about-the-author page"
            value={form.authorBio}
            onChange={(e) => update("authorBio", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Genre / category" required>
            <input
              className="field"
              placeholder="e.g. memoir, self-help, romance"
              value={form.genre}
              onChange={(e) => update("genre", e.target.value)}
            />
          </Field>
          <Field label="Target word count" required>
            <input
              type="number"
              min={MIN_WORD_COUNT}
              max={MAX_WORD_COUNT}
              className="field"
              placeholder="e.g. 30000"
              value={form.wordCountTarget}
              onChange={(e) => update("wordCountTarget", e.target.value)}
            />
            {Number(form.wordCountTarget) > MAX_WORD_COUNT ? (
              <span className="text-xs text-[var(--danger)]">
                Maximum is {MAX_WORD_COUNT.toLocaleString()} words. We cannot generate a longer book than that.
              </span>
            ) : (
              estimatedPages && <span className="text-xs text-white/40">≈ {estimatedPages} printed pages</span>
            )}
          </Field>
        </div>

        <Field label="Who is this book for?" required>
          <textarea className="field min-h-20" value={form.reader} onChange={(e) => update("reader", e.target.value)} />
        </Field>

        <Field label="What should the book promise the reader by the end?" required>
          <textarea
            className="field min-h-20"
            value={form.promise}
            onChange={(e) => update("promise", e.target.value)}
          />
        </Field>

        <Field label="Tone / voice" required>
          <input
            className="field"
            placeholder="e.g. warm and direct, literary, plainspoken"
            value={form.tone}
            onChange={(e) => update("tone", e.target.value)}
          />
        </Field>

        <Field label="Book description / premise" required>
          <textarea
            className="field min-h-28"
            value={form.bookDescription}
            onChange={(e) => update("bookDescription", e.target.value)}
          />
        </Field>

        <div>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={form.hasOwnOutline}
              onChange={(e) => update("hasOwnOutline", e.target.checked)}
            />
            I am providing my own chapter outline
          </label>
          {form.hasOwnOutline && (
            <textarea
              className="field mt-3 min-h-32"
              placeholder="One chapter title per line, in order"
              value={form.chapterOutline}
              onChange={(e) => update("chapterOutline", e.target.value)}
            />
          )}
        </div>

        <Field label="Front cover description">
          <textarea
            className="field min-h-20"
            placeholder="Leave blank and our designer will choose and build the cover automatically"
            value={form.frontCoverDescription}
            onChange={(e) => update("frontCoverDescription", e.target.value)}
          />
        </Field>

        <Field label="Back cover description">
          <textarea
            className="field min-h-20"
            placeholder="Leave blank and our designer will write and build it automatically"
            value={form.backCoverDescription}
            onChange={(e) => update("backCoverDescription", e.target.value)}
          />
        </Field>

        {signedIn ? (
          <p className="text-sm text-white/50">
            Signed in as <span className="text-white/80">{auth.currentUser?.email || user?.email}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <div>
              <p className="mono-label">Your free account</p>
              <p className="mt-1.5 text-sm text-white/60">
                Free previews need an account. We&apos;ll email you a link to confirm your address, and your
                preview starts as soon as you click it. We only use your email for your account and your books (
                <Link href="/privacy" className="underline hover:text-white/80">privacy policy</Link>).
              </p>
            </div>
            {accountMode === "create" && (
              <Field label="Your full name" required>
                <input
                  className="field"
                  autoComplete="name"
                  value={account.fullName}
                  onChange={(e) => setAccount((a) => ({ ...a, fullName: e.target.value }))}
                />
              </Field>
            )}
            <Field label="Email" required>
              <input
                type="email"
                className="field"
                autoComplete="email"
                value={account.email}
                onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))}
              />
            </Field>
            <Field label="Password" required>
              <input
                type="password"
                className="field"
                autoComplete={accountMode === "create" ? "new-password" : "current-password"}
                placeholder={accountMode === "create" ? "At least 8 characters" : ""}
                value={account.password}
                onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))}
              />
            </Field>
            <button
              type="button"
              onClick={() => setAccountMode((m) => (m === "create" ? "signin" : "create"))}
              className="self-start text-sm text-white/50 underline hover:text-white/80"
            >
              {accountMode === "create" ? "I already have an account" : "I need a new account"}
            </button>
          </div>
        )}

        <Turnstile onToken={setCaptchaToken} />

        {error && (
          <p className="text-sm text-[var(--danger)]">
            {error}
            {blockedBook && (
              <>
                {" "}
                <Link href={`/books/${blockedBook.id}`} className="underline">
                  Go to &quot;{blockedBook.title}&quot;
                </Link>
              </>
            )}
          </p>
        )}

        {replaceOffer && (
          <div className="rounded-xl border border-white/15 bg-white/[0.03] p-4 text-sm">
            <p className="text-white/80">{replaceOffer.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={(e) => handleSubmit(e, { replaceExisting: true })}
                className="btn-primary px-4 py-2 text-xs"
              >
                Replace it with this book
              </button>
              <Link href={`/books/${replaceOffer.id}`} className="btn-ghost px-4 py-2 text-xs">
                Keep &quot;{replaceOffer.title}&quot;
              </Link>
            </div>
          </div>
        )}

        <button type="submit" disabled={submitting || !user} className="btn-primary px-5 py-3 text-sm">
          {submitting ? "Generating..." : "Generate my free preview"}
        </button>
      </form>
    </main>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="mono-label">
        {label} {required && <span className="text-[var(--danger)]">*</span>}
      </span>
      {children}
    </label>
  );
}
