import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The landing page — a signpost, not a marketing site.
 *
 * Recreating SCCT's public website is explicitly out of scope. This exists so that
 * a reviewer opening the deployed URL knows what they are looking at and can reach
 * both surfaces without being handed a list of paths.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Technical trial build
      </p>

      <h1 className="mt-2 text-3xl font-semibold tracking-tight">SCCT Enquiry System</h1>

      <p className="mt-4 text-sm text-muted-foreground">
        A structured system of record for admissions enquiries: capture, validate, check for
        duplicates, store, assign an owner, follow up, and keep a traceable history.
      </p>

      <p className="mt-4 text-sm text-muted-foreground">
        This is a demonstration build with <strong className="font-medium">synthetic data only</strong>.
        It is not SCCT&apos;s live website, and it is not a CRM.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/enquire">Public enquiry form</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Staff sign in</Link>
        </Button>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Demo staff logins are documented in the repository README and are marked demo-only.
      </p>
    </main>
  );
}
