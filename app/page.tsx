import Link from "next/link";

import { DemoNotice, Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";

/**
 * The landing page — a signpost, not a marketing site.
 *
 * Recreating SCCT's public website is explicitly out of scope. This exists so that
 * a reviewer opening the deployed URL knows what they are looking at and can reach
 * both surfaces without being handed a list of paths.
 *
 * The slice is spelled out because "what did you actually build" is the first
 * question the defence asks, and the answer should be on the first screen rather
 * than in a document.
 */
export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <Wordmark />
          <Link
            href="/login"
            className="text-xs text-primary-foreground/70 underline underline-offset-2 hover:text-primary-foreground"
          >
            Staff sign-in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
        <DemoNotice className="mb-10">
          Technical-trial build with{" "}
          <strong className="font-semibold text-foreground">synthetic data only</strong>. Not
          SCCT&apos;s live website, and not a CRM.
        </DemoNotice>

        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          An admissions enquiry system of record
        </h1>

        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          A genuine enquiry enters the system, keeps the context needed to understand it, moves
          through a usable admissions workflow, and leaves traceable evidence of what happened.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/enquire">Public enquiry form</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Staff sign-in</Link>
          </Button>
        </div>

        {/* The critical slice, named. Each step is built and demonstrable — this is
            a description of the system, not a roadmap. */}
        <div className="mt-16 border-t pt-10">
          <h2 className="text-sm font-semibold">The slice that was built</h2>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Capture & validate",
                body: "One public form. Validated on the client and again on the server, with a stable reference number returned only after the write is confirmed.",
              },
              {
                title: "Duplicates & retries",
                body: "Same person and programme is flagged for a human, never merged or deleted. A retried submission resolves to the original record.",
              },
              {
                title: "Ownership & follow-up",
                body: "Round-robin assignment across eligible staff, falling back to an unassigned pool. Stages, notes and scheduled follow-ups.",
              },
              {
                title: "Traceable history",
                body: "Every change appended to a log that cannot be edited, archived or removed. Concurrent edits are refused, not silently overwritten.",
              },
            ].map((item) => (
              <div key={item.title}>
                <h3 className="text-sm font-medium">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* <p className="mt-12 text-xs text-muted-foreground">
          Demo staff logins are shown on the sign-in page and documented in the repository README.
          They are synthetic and marked demo-only.
        </p> */}
      </main>
    </div>
  );
}
