import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "../components/Nav";
import Footer from "../components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Genbooks",
  description: "Request a book. We write, edit and design it.",
};

// Next.js App Router does not add a viewport meta tag automatically -
// without this explicit export, no <meta name="viewport"> ships at all,
// and real mobile browsers fall back to rendering a wide desktop-style
// layout that then gets scaled to fit the screen, which is what made the
// Turnstile captcha (and everything else) look wrong-sized/out of frame
// on a real phone. Site-wide fix, not specific to any one page.
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
