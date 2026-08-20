import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import type { SubmissionReceipt } from "./types";

/**
 * The acknowledgement.
 *
 * THE REFERENCE NUMBER IS THE HERO ELEMENT, and that is the whole point of the
 * screen. It is proof to the submitter that a record exists — as opposed to a form
 * that said "thanks" and did nothing, which is indistinguishable from success right
 * up until nobody calls. Large, monospaced and selectable so it can be read aloud
 * over a phone or copied into a message.
 *
 * IT IS ONLY REACHED AFTER THE DATABASE CONFIRMED THE WRITE. The API does not
 * return success before the store acknowledges, so this screen cannot appear for an
 * enquiry that was not saved.
 *
 * THE WORDING IS IDENTICAL WHETHER OR NOT A DUPLICATE WAS FLAGGED INTERNALLY. This
 * component could not tell the difference — the API does not send it. Disclosing a
 * duplicate here would let anyone test whether a given phone number has enquired
 * before, against contact data belonging in part to minors.
 *
 * NO RESPONSE-TIME PROMISE. SCCT's follow-up cadence is unconfirmed (open question
 * 7), so committing them to a timescale would be inventing a client fact.
 */
export function EnquireSuccess({ receipt }: { receipt: SubmissionReceipt }) {
  return (
    <Card role="status" className="p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-lg text-success-foreground"
        >
          ✓
        </span>
        <h2 className="text-lg font-semibold">Enquiry received</h2>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{receipt.message}</p>

      <div className="mt-6 rounded-lg border bg-muted/40 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Your reference number
        </p>
        {/* `select-all` so one tap or click grabs the whole thing — this number gets
            read out on the phone and pasted into messages. */}
        <p className="tabular mt-2 select-all font-mono text-2xl font-semibold tracking-tight sm:text-3xl">
          {receipt.enquiryNumber}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Please keep this. Quote it if you contact the admissions office about this enquiry.
        </p>
      </div>

      <Separator className="mt-6" />

      <div className="mt-6">
        <p className="text-sm font-medium">What happens now</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your enquiry has been assigned to the admissions team, and someone will call you on the
          number you gave. If you are interested in another programme as well, submit the form again
          for that one — the two are tracked separately.
        </p>
      </div>
    </Card>
  );
}
