import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-white/40 sm:flex-row">
        <p>&copy; {new Date().getFullYear()} Genbooks</p>
        <nav className="flex gap-5">
          <Link href="/privacy" className="hover:text-white/80">Privacy policy</Link>
          <Link href="/support" className="hover:text-white/80">Support</Link>
        </nav>
      </div>
    </footer>
  );
}
