"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header link to the search box. On the home page there is nowhere to
 * navigate to, so it puts the cursor in the first empty station field. */
export function SearchLink({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <Link
      href="/"
      className={className}
      onClick={(e) => {
        if (pathname !== "/") return;
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>("[data-station-input]");
        input?.scrollIntoView({ block: "center", behavior: "smooth" });
        input?.focus({ preventScroll: true });
      }}
    >
      Search
    </Link>
  );
}
