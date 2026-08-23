"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import type { NavItem } from "./nav-items";

/**
 * The sidebar's link list.
 *
 * THE ONLY REASON THIS IS A CLIENT COMPONENT is the active state: a server
 * component cannot read the current pathname or query string. It renders links and
 * nothing else — no fetching, no state, no effects — so the client cost is a few
 * hundred bytes rather than a bundle.
 *
 * ACTIVE STATE COMPARES THE QUERY STRING, NOT JUST THE PATH. Every nav item points
 * at `/staff` with different filters, so matching on pathname alone would light up
 * all five at once and tell the user nothing. Comparing the filter values means
 * "Unassigned" is highlighted exactly when the unassigned filter is applied —
 * including when the user got there through the filter bar rather than the link,
 * which is the behaviour that makes the sidebar trustworthy rather than decorative.
 *
 * The items themselves are passed in already filtered by permission, so this
 * component holds no authorization logic at all.
 */
export function SidebarNav({
  items,
  orientation = "vertical",
}: {
  items: NavItem[];
  /**
   * `horizontal` is the small-screen strip. A prop rather than a second component,
   * because the active-state logic is the part with the substance and duplicating
   * it is how the phone and the desktop end up disagreeing about which section you
   * are in.
   */
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function isActive(item: NavItem): boolean {
    if (item.comingSoon) return false;

    const [path, query = ""] = item.href.split("?");

    if (path !== pathname) return false;

    // A link with no filters — the plain queue — is active only when no filter is
    // set. Otherwise "Enquiry queue" would stay lit while looking at Overdue.
    const target = new URLSearchParams(query);
    if ([...target.keys()].length === 0) {
      return !searchParams.get("owner") && !searchParams.get("followup") && !searchParams.get("status");
    }

    for (const [key, value] of target.entries()) {
      if (searchParams.get(key) !== value) return false;
    }

    return true;
  }

  const isHorizontal = orientation === "horizontal";

  return (
    <nav
      className={isHorizontal ? "flex min-w-max items-center gap-1" : "space-y-0.5"}
      aria-label="Staff sections"
    >
      {items.map((item) => {
        if (item.comingSoon) {
          return (
            <span
              key={item.label}
              // `aria-disabled` and not just a visual grey: a screen reader user
              // needs to know this is present but unavailable, the same as a
              // sighted user reading the label beside it.
              aria-disabled="true"
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-primary-foreground/40",
                !isHorizontal && "justify-between",
                isHorizontal && "whitespace-nowrap",
              )}
            >
              {item.label}
              <span className="text-[10px] uppercase tracking-wide">soon</span>
            </span>
          );
        }

        const active = isActive(item);

        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              isHorizontal ? "whitespace-nowrap" : "block",
              active
                ? "bg-primary-foreground/15 font-medium text-primary-foreground"
                : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
