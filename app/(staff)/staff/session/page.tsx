import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { currentPrincipal } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My access — SCCT Admissions (demo)",
  robots: { index: false, follow: false },
};

/**
 * What the current session actually resolved to.
 *
 * WHY THIS PAGE EARNS ITS PLACE. RBAC always eventually produces the question "why
 * can this person not do that", and the answer is either "their role does not grant
 * it" or "their session predates the change". Both are visible here in one screen,
 * which is faster than reading the roles collection and much faster than guessing.
 *
 * It shows the caller their OWN session only. There is no way to inspect anyone
 * else's from here, so it needs no permission of its own.
 *
 * A static segment sitting beside `[id]`. Next matches static before dynamic, and a
 * 24-character hex enquiry id can never be the string "session", so the two cannot
 * collide.
 */
export default async function SessionPage() {
  const principal = await currentPrincipal();

  // The layout guarantees this; narrowing rather than asserting, because a layout
  // is not a guarantee the compiler knows about.
  if (!principal) return null;

  return (
    <main className="max-w-3xl px-4 py-6 lg:px-8">
      <Link
        href="/staff"
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        ← Back to the queue
      </Link>

      <h1 className="mt-4 text-xl font-semibold tracking-tight">My access</h1>

      <p className="mt-2 text-sm text-muted-foreground">
        Everything this session was granted, exactly as the server sees it.
      </p>

      <Card asChild><dl className="mt-8 grid gap-6 p-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Account
          </dt>
          <dd className="mt-1 text-sm">{principal.email}</dd>
        </div>

        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Roles
          </dt>
          <dd className="mt-1 text-sm">{principal.roleCodes.join(", ") || "—"}</dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Staff profile
          </dt>
          <dd className="mt-1 text-sm">
            {/* Two different identities: the account that ACTS, and the person who
                OWNS admissions work. Enquiry ownership refs the latter. */}
            {principal.staffProfileId ? (
              <span className="font-mono text-xs">{principal.staffProfileId}</span>
            ) : (
              <span className="text-muted-foreground">
                None — this account cannot own enquiries, and sees only the unassigned pool
              </span>
            )}
          </dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Permissions resolved at sign-in
          </dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {principal.permissions.length === 0 ? (
              <span className="text-sm text-muted-foreground">None</span>
            ) : (
              principal.permissions.map((code) => (
                <Badge key={code} variant="secondary" className="font-mono">
                  {code}
                </Badge>
              ))
            )}
          </dd>
        </div>
      </dl></Card>

      <p className="mt-6 text-xs text-muted-foreground">
        These permissions were resolved once, at sign-in, and travel in the session cookie. A role
        change therefore takes effect at the next sign-in, or within eight hours when the session
        expires — a documented limitation, not an oversight.
      </p>
    </main>
  );
}
