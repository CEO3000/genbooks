"use client";

import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuthUser } from "../lib/useAuthUser";

export default function Nav() {
  const { user, isRegistered } = useAuthUser();

  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#05060a]/70 backdrop-blur-lg">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-1.5 px-3 py-3 sm:gap-2 sm:px-6 sm:py-4">
        <Link href="/" className="shrink-0 text-sm sm:text-lg font-semibold tracking-tight">
          <span className="gradient-text">GEN</span>
          <span className="text-white/90">BOOKS</span>
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-6 text-xs sm:text-sm text-white/70">
          {isRegistered && (
            <Link href="/books" className="hover:text-white transition-colors">
              My Books
            </Link>
          )}
          <Link href="/support" className="hover:text-white transition-colors">
            Support
          </Link>
          {isRegistered ? (
            <button onClick={() => signOut(auth)} className="btn-ghost px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs">
              Sign out
            </button>
          ) : (
            <>
              <Link href="/login" className="shrink-0 hover:text-white transition-colors">
                Sign in
              </Link>
              <Link
                href="/register"
                className="btn-primary shrink-0 px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs whitespace-nowrap"
              >
                <span className="sm:hidden">Sign up</span>
                <span className="hidden sm:inline">Create account</span>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
