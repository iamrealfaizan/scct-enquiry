import type { SubmissionReceipt } from "./types";

/**
 * The acknowledgement.
 *
 * Shows the enquiry number, because a reference the person can quote is the whole
 * value of a stable identifier — and because it is proof to the submitter that a
 * record exists rather than a form that said "thanks" and did nothing.
 *
 * The wording is identical whether or not a duplicate was flagged internally. This
 * component could not tell the difference: the API does not send it.
 */
export function EnquireSuccess({ receipt }: { receipt: SubmissionReceipt }) {
  return (
    <div role="status" className="rounded-lg border bg-muted/40 p-6">
      <h2 className="text-lg font-semibold">Enquiry received</h2>

      <p className="mt-2 text-sm text-muted-foreground">{receipt.message}</p>

      <dl className="mt-4">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
          Your reference number
        </dt>
        <dd className="mt-1 font-mono text-base font-medium">{receipt.enquiryNumber}</dd>
      </dl>

      <p className="mt-4 text-xs text-muted-foreground">
        Please keep this reference. Quote it if you contact the admissions office about this enquiry.
      </p>
    </div>
  );
}
