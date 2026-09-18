import Link from "next/link";

/*
 * Site footer — on every page so the Privacy Policy is always one click away.
 * Bottom padding clears the fixed MobileTabBar (<lg).
 */
export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-6 pb-24 text-center text-caption text-text-secondary lg:pb-6">
      <span>© {new Date().getFullYear()} ShuttleRank</span>
      <span aria-hidden className="mx-2">·</span>
      <Link href="/privacy" className="underline-offset-2 hover:underline">
        Privacy Policy
      </Link>
    </footer>
  );
}
