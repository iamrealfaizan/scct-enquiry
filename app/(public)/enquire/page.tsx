import type { Metadata } from "next";
import Link from "next/link";

import { DemoNotice, Wordmark } from "@/components/brand/Wordmark";
import { EnquireForm } from "@/components/enquire/EnquireForm";
import { TrustPanel } from "@/components/enquire/TrustPanel";

/**
 * A thin wrapper. All real code lives in `components/enquire/`.
 *
 * `noindex` is deliberate: this is a demonstration surface for a technical trial,
 * not SCCT's live enquiry page, and it must not be discoverable as though it were.
 * That matters more now that the page carries SCCT's colours, not less.
 *
 * TWO PANELS, ONE SUBMISSION. The reassurance panel and the form sit side by side
 * on a laptop and stack on a phone — reassurance first, since that is the question
 * being answered before anyone starts typing. It is still one page and one POST:
 * the form's idempotency key is generated once per mount, and splitting this into
 * steps would put that protection at risk for a form of nine fields.
 */
export const metadata: Metadata = {
  title: "Enquire — SCCT Admissions (demo)",
  description:
    "Demonstration enquiry form for the SCCT digital admissions foundation technical trial.",
  robots: { index: false, follow: false },
};

export default function EnquirePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="rounded-md">
            <Wordmark />
          </Link>

          <Link
            href="/login"
            className="text-xs text-primary-foreground/70 underline underline-offset-2 hover:text-primary-foreground"
          >
            Staff sign-in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <DemoNotice className="mb-8">
          This is a technical-trial build, not SCCT&apos;s live website.{" "}
          <strong className="font-semibold text-foreground">
            Please do not submit real personal details.
          </strong>
        </DemoNotice>

        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Enquire about a programme
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Tell us how to reach you and which programme you are interested in. Someone from the
            admissions team will follow up by phone.
          </p>
        </div>

        {/* The form leads on wide screens and the panel supports it; on a phone the
            panel comes first, because "is this safe and will anyone call" is the
            question that decides whether the form gets filled in at all. */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="order-2 lg:order-1">
            <EnquireForm />
          </div>

          <div className="order-1 lg:order-2">
            <TrustPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
