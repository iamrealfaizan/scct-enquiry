import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/brand/Wordmark";
import { LoginForm } from "@/components/login/LoginForm";
import { Card } from "@/components/ui/card";
import { currentPrincipal } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Staff sign-in — SCCT Admissions (demo)",
  robots: { index: false, follow: false },
};

/**
 * Where to send someone after they sign in, taken from `?next=` and VALIDATED.
 *
 * An unchecked value here is an open redirect: a link to
 * `/login?next=https://evil.example` starts on this domain, which is what makes it
 * convincing, and ends somewhere else. Only a path beginning with a single `/` is
 * accepted, which rejects absolute URLs and the protocol-relative `//host` form
 * that looks like a path but is not.
 *
 * Middleware sets this parameter, but that is not why it is validated — anyone can
 * type a URL, so the check has to live where the value is used.
 */
function safeNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) return "/staff";
  if (!value.startsWith("/")) return "/staff";
  if (value.startsWith("//")) return "/staff";

  return value;
}

/**
 * The seeded demo accounts, listed on screen.
 *
 * WHY THEY ARE ON THE PAGE AT ALL. A reviewer opening the deployed link needs a way
 * in, and "the logins are in the README" is friction at exactly the wrong moment.
 * They are labelled demo-only and every one of them is synthetic — the `.local`
 * domain is reserved and can never resolve, so none of these addresses can reach a
 * real inbox.
 *
 * THE PASSWORD IS NOT HERE. It comes from `DEMO_PASSWORD` in the environment, so it
 * is not in source control and not on the page. A committed or rendered password is
 * a secret in public even when the account is synthetic.
 *
 * The list is duplicated from the seed rather than read from the database, on
 * purpose: this page must render before any session exists and must not query the
 * user collection to do it. The roles are what differ, and they are stable.
 */
const DEMO_ACCOUNTS = [
  { email: "counsellor1@demo.scct-enquiry.local", role: "Counsellor", sees: "own + unassigned" },
  { email: "manager1@demo.scct-enquiry.local", role: "Manager", sees: "everything, can reassign" },
  { email: "admin1@demo.scct-enquiry.local", role: "Administrator", sees: "everything + config" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string | string[] };
}) {
  // A real session check, not the cookie-presence one middleware does. Someone
  // already signed in has no business on this page, and rendering the form for
  // them invites a second, pointless sign-in.
  const principal = await currentPrincipal();
  if (principal) redirect("/staff");

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-2">
      {/* ── Brand panel ─────────────────────────────────────────────────────────
          Second in the DOM on mobile via `order`, so a phone user reaches the form
          without scrolling past a panel of explanation. On a laptop it reads first,
          left to right, which is where it belongs. */}
      <div className="order-2 flex flex-col justify-between bg-primary p-8 text-primary-foreground lg:order-1 lg:p-12">
        <Wordmark />

        <div className="mt-10 lg:mt-0">
          <h2 className="text-2xl font-semibold tracking-tight lg:text-3xl">
            The admissions enquiry system of record
          </h2>

          <p className="mt-4 max-w-md text-sm leading-relaxed text-primary-foreground/80">
            Every enquiry captured once, owned by someone, followed up on a date, and traceable
            afterwards — instead of scattered across spreadsheets that overwrite each other.
          </p>

          <ul className="mt-8 space-y-2.5 text-sm text-primary-foreground/80">
            {[
              "Duplicate enquiries are flagged, never merged or deleted",
              "Ownership assigned automatically, reassignable by a manager",
              "Every change appended to a history nobody can edit",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden="true" className="text-success">
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <Card className="mt-10 border-primary-foreground/20 bg-primary-foreground/5 p-4 text-primary-foreground shadow-none">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-foreground/70">
            Demo accounts — synthetic, demo-only
          </p>

          <ul className="mt-3 space-y-2">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email} className="text-xs">
                <span className="font-mono text-primary-foreground">{account.email}</span>
                <span className="block text-primary-foreground/60">
                  {account.role} — sees {account.sees}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-primary-foreground/60">
            Password is set per deployment via <span className="font-mono">DEMO_PASSWORD</span> and
            is deliberately not shown here.
          </p>
        </Card>
      </div>

      {/* ── Form panel ──────────────────────────────────────────────────────── */}
      <div className="order-1 flex items-center justify-center p-6 lg:order-2 lg:p-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Staff sign-in</h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to see the admissions enquiry queue.
          </p>

          <div className="mt-8">
            <LoginForm next={safeNext(searchParams.next)} />
          </div>

          <p className="mt-8 text-xs text-muted-foreground">
            Demonstration build for a technical trial. Every account and every enquiry in this
            system is synthetic — it is not SCCT&apos;s live system.
          </p>
        </div>
      </div>
    </main>
  );
}
