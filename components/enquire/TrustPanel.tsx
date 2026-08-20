import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * The reassurance panel beside the public enquiry form.
 *
 * WHAT THIS IS ACTUALLY FOR. The person filling in the form is often a parent
 * handing over their child's phone number to a website. The decision they are
 * making is not "which programme" — it is "is this safe and will anyone actually
 * call". A bare form answers neither, and the cost of not answering them is
 * abandoned enquiries, which is the one thing this system cannot recover from: an
 * enquiry never submitted leaves no trace anywhere.
 *
 * EVERY CLAIM HERE IS TRUE OF THE BUILT SYSTEM, and that is a constraint rather
 * than a style note:
 *
 *   · "a counsellor will follow up" — round-robin assigns an owner on capture, and
 *     falls back to the unassigned pool which staff can see and claim.
 *   · "your reference number" — a real, stable, sequential id is returned and shown.
 *   · "only used to contact you about this enquiry" — no marketing, no third party,
 *     nothing in the codebase does anything else with it.
 *   · "submit once per programme" — the documented duplicate rule: same person,
 *     different programme, is a separate enquiry and is NOT flagged.
 *
 * NO RESPONSE-TIME PROMISE. "We will call within 24 hours" would be inventing a
 * commitment SCCT has not made — follow-up cadence is open question 7, and their
 * process today is manual phone calls. Promising a timescale on their behalf would
 * be exactly the kind of invented client fact this project forbids.
 */
export function TrustPanel() {
  return (
    <Card className="p-6 lg:sticky lg:top-8">
      <h2 className="text-sm font-semibold">What happens next</h2>

      <ol className="mt-4 space-y-4">
        {[
          {
            title: "Your enquiry is recorded",
            body: "You get a reference number on screen straight away. Keep it — you can quote it to the admissions office.",
          },
          {
            title: "It is assigned to a counsellor",
            body: "Enquiries are shared out across the admissions team, so yours has someone responsible for it rather than sitting in an inbox.",
          },
          {
            title: "Someone from the team calls you",
            body: "Follow-up is a phone call from the admissions team on the number you give below.",
          },
        ].map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            >
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <Separator className="mt-6" />

      <div className="mt-6 space-y-2.5">
        {[
          "Your details are used only so the admissions team can contact you about this enquiry.",
          "Interested in more than one programme? Submit the form once for each — they are tracked separately, not treated as duplicates.",
          "Nothing is saved until the form confirms it. If something goes wrong you will be told, and your answers are kept so you can try again.",
        ].map((line) => (
          <p key={line} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            <span>{line}</span>
          </p>
        ))}
      </div>
    </Card>
  );
}
