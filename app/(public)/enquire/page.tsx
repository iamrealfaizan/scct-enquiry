import type { Metadata } from "next";

import { EnquireForm } from "@/components/enquire/EnquireForm";

/**
 * A thin wrapper. All real code lives in `components/enquire/`.
 *
 * `noindex` is deliberate: this is a demonstration surface for a technical trial,
 * not SCCT's live enquiry page, and it must not be discoverable as though it were.
 */
export const metadata: Metadata = {
  title: "Enquire — SCCT Admissions (demo)",
  description:
    "Demonstration enquiry form for the SCCT digital admissions foundation technical trial.",
  robots: { index: false, follow: false },
};

export default function EnquirePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <div className="mb-8 rounded-lg border border-dashed bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          <strong className="font-medium">Demonstration only.</strong> This is a technical-trial
          build, not SCCT&apos;s live website. Please do not submit real personal details.
        </p>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Enquire about a programme
      </h1>

      <p className="mt-2 text-sm text-muted-foreground">
        Tell us how to reach you and which programme you are interested in. Someone from the
        admissions team will follow up.
      </p>

      <div className="mt-8">
        <EnquireForm />
      </div>
    </main>
  );
}
