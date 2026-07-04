import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  ),
  title: {
    default: "Route Score — How reliable is your commute, really?",
    template: "%s · Route Score",
  },
  description:
    "A data-driven performance score for any UK rail route. One number, out of 100, built from a year of real punctuality data.",
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
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white font-bold text-sm tracking-tight group-hover:bg-emerald-600 transition-colors">
                RS
              </span>
              <span className="font-semibold tracking-tight text-slate-900">
                Route Score
              </span>
            </Link>
            <span className="text-xs text-slate-400 hidden sm:block">
              UK rail performance, one number
            </span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200/80 py-6 text-center text-xs text-slate-400">
          <p>
            Built on National Rail historical service performance data. Not a
            journey planner.
          </p>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
