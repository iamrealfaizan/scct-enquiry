import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DemoNotice, Wordmark } from "@/components/brand/Wordmark";
import { SignOutButton } from "@/components/staff/SignOutButton";
import { SidebarNav } from "@/components/staff/shell/SidebarNav";
import { NAV_ITEMS } from "@/components/staff/shell/nav-items";
import { can, currentPrincipal } from "@/lib/auth";

/**
 * The authenticated shell around every staff page.
 *
 * THIS IS A REAL GUARD, unlike middleware's cookie check: it verifies the session
 * cookie's signature and reads the principal out of it. A layout is the right place
 * for it because it runs for every page beneath it, so a new staff page cannot be
 * added unprotected by forgetting a line.
 *
 * IT IS STILL NOT THE ONLY GUARD. Every route handler behind these pages checks the
 * session and its own permission code independently (conventions §10). A page guard
 * protects the page; it says nothing about an API endpoint someone reaches with
 * `curl`.
 *
 * ─── LAYOUT ────────────────────────────────────────────────────────────────────
 *
 * Navy sidebar on large screens, navy header plus a horizontally scrolling nav
 * strip on small ones.
 *
 * NO DRAWER, DELIBERATELY. A slide-out menu needs open/closed state, a focus trap,
 * an escape handler and a scroll lock — real work, and a real client bundle, for six
 * links. A scrolling strip is always visible, needs no JavaScript at all, and on a
 * phone it is fewer taps. The only client code in this shell is the active-state
 * comparison in `SidebarNav` and the sign-out button.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentPrincipal();

  // `redirect` rather than an error page: an expired session is the ordinary case
  // here, not an exceptional one. Eight hours is one working day, so staff meet
  // this every morning.
  if (!principal) redirect("/login?next=/staff");

  // Filtered here, in the server component that already holds the principal, so
  // the client component receives no permission logic and no permission list.
  const items = NAV_ITEMS.filter((item) => !item.permission || can(principal, item.permission));

  const identity = (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-primary-foreground">
        {principal.displayName}
      </p>
      <p className="truncate text-xs text-primary-foreground/60">
        {/* Role codes, not a friendly label. The staff-facing label lives on the
            Role row; showing the code here keeps this shell from needing a
            database read on every page render. */}
        {principal.roleCodes.join(", ") || "no role assigned"}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      {/* ── Sidebar, large screens ──────────────────────────────────────────── */}
      <aside className="hidden bg-primary text-primary-foreground lg:flex lg:h-screen lg:flex-col lg:sticky lg:top-0">
        <div className="px-5 py-5">
          <Wordmark />
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          {/* `useSearchParams` in the nav makes it a dynamic read; the boundary
              keeps the rest of the shell from waiting on it. */}
          <Suspense fallback={<div className="h-40" />}>
            <SidebarNav items={items} />
          </Suspense>
        </div>

        <div className="space-y-3 border-t border-primary-foreground/15 px-5 py-4">
          {identity}
          <SignOutButton />
        </div>
      </aside>

      {/* ── Header, small screens ───────────────────────────────────────────── */}
      <header className="bg-primary text-primary-foreground lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Wordmark showSubtitle={false} />
          <div className="flex items-center gap-3">
            {identity}
            <SignOutButton />
          </div>
        </div>

        <div className="overflow-x-auto border-t border-primary-foreground/15 px-2 py-2">
          <Suspense fallback={<div className="h-9" />}>
            <SidebarNav items={items} orientation="horizontal" />
          </Suspense>
        </div>
      </header>

      <div className="min-w-0">
        <div className="px-4 pt-4 lg:px-8">
          <DemoNotice>
            Synthetic data only. Not SCCT&apos;s live system, and no real student or parent
            details appear anywhere in it.
          </DemoNotice>
        </div>

        {children}
      </div>
    </div>
  );
}
