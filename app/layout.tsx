import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { Logo } from "@/components/Logo";
import { SearchLink } from "@/components/SearchLink";
import { SITE_NAME, STRAPLINE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  ),
  title: {
    default: `${SITE_NAME}: ${STRAPLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "A score out of 100 for any direct UK rail route, worked out from a year of National Rail punctuality data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo size={30} />
              <span className="flex flex-col leading-tight">
                <span className="font-semibold tracking-tight text-slate-900">
                  {SITE_NAME}
                </span>
                <span className="text-[11px] text-slate-500">{STRAPLINE}</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 sm:gap-5 text-sm font-medium text-slate-600">
              <SearchLink className="hidden sm:block hover:text-emerald-600 transition-colors" />
              <Link
                href="/leaderboard"
                className="hover:text-emerald-600 transition-colors"
              >
                Leaderboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200/80 px-4 py-5 text-center text-xs text-slate-400">
          <p>
            Scores come from National Rail&apos;s historical performance data.
          </p>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
