"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuthUser } from "../../lib/useAuthUser";
import Link from "next/link";

export default function BooksPage() {
  const { user, isRegistered } = useAuthUser();
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isRegistered || !user) return;
    // firestore.rules only allows a request to be read by its own owner
    // (or admin) — a collection query with no where clause can't be
    // proven to satisfy that per-document rule, so Firestore rejects the
    // whole query outright rather than silently filtering it, which
    // otherwise left this page stuck on "Loading..." forever with no
    // error surfaced at all.
    const q = query(collection(db, "requests"), where("ownerId", "==", user.uid), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("Could not load your books. Please try again.")
    );
    return unsub;
  }, [isRegistered, user]);

  if (user !== undefined && !isRegistered) {
    return (
      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
        <div className="glass w-full p-10">
          <p className="mono-label">Sign in required</p>
          <h1 className="mt-3 text-2xl font-semibold">Your library is private.</h1>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/login" className="btn-primary px-5 py-3 text-sm">
              Sign in
            </Link>
            <Link href="/register" className="btn-ghost px-5 py-3 text-sm">
              Create account
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <div className="mb-8">
        <p className="mono-label">Your library</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          <span className="gradient-text">My Books</span>
        </h1>
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : requests === null ? (
        <p className="text-sm text-white/40">Loading...</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-white/40">No books yet.</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {requests?.map((r) => (
          <li key={r.id}>
            <Link href={`/books/${r.id}`} className="glass glass-hover flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-medium">{r.title || "Untitled"}</p>
                <p className="text-xs text-white/40">{r.authorName}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/40">{r.progress ?? 0}%</span>
                <span className="mono-label rounded-full border border-white/10 px-3 py-1 text-[var(--accent)]">
                  {r.status || "submitted"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
