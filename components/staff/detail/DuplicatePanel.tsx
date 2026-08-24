import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import type { DuplicateLink } from "@/services/queue.service";

/**
 * Possible-duplicate links for one enquiry.
 *
 * THE WORDING IS LOAD-BEARING. Nothing here says "duplicate" as a fact — it says
 * "possible", and it states in the panel that nothing has been merged or deleted.
 * The approved rule is that a same-programme repeat is FLAGGED AND STORED, never
 * resolved automatically, and a UI that implied otherwise would misrepresent what
 * the system did to a record.
 *
 * DIRECTION IS SHOWN, because it decides which record is the original. `enquiry` is
 * always the newer of a pair and `duplicateOf` the earlier one; a staff member
 * looking at the earlier record needs to know a later one may duplicate it, which
 * is a different sentence from the reverse.
 *
 * DISMISSED AND CONFIRMED FLAGS STAY VISIBLE, greyed rather than removed. A
 * dismissal is a decision someone made and the next person deserves to see it — and
 * hiding it would mean the same pair looks unreviewed forever.
 */
export function DuplicatePanel({ duplicates }: { duplicates: DuplicateLink[] }) {
  if (duplicates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No possible duplicates flagged for this enquiry.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Flagged for a human to review. <strong className="font-medium">Nothing has been merged
        or deleted</strong> — both records are stored in full.
      </p>

      <ul className="space-y-2">
        {duplicates.map((link) => (
          <li
            key={link.id}
            className={`rounded-md border p-3 ${
              link.reviewStatus === "flagged" ? "" : "opacity-60"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/staff/${link.otherEnquiryId}`}
                className="font-mono text-xs font-medium underline underline-offset-2"
              >
                {link.otherEnquiryNumber}
              </Link>

              <Badge variant={link.reviewStatus === "flagged" ? "outline" : "secondary"}>
                {link.reviewStatus === "flagged"
                  ? "Awaiting review"
                  : link.reviewStatus === "dismissed"
                    ? "Dismissed — not a duplicate"
                    : "Confirmed duplicate"}
              </Badge>
            </div>

            <p className="mt-1 text-sm">
              {link.direction === "may_duplicate"
                ? "This enquiry may duplicate the earlier one above"
                : "The later enquiry above may duplicate this one"}
              , matched on{" "}
              <strong className="font-medium">
                {link.matchedOn === "both" ? "phone and email" : link.matchedOn}
              </strong>{" "}
              with the same programme.
            </p>

            {link.reviewedAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Reviewed {formatDate(link.reviewedAt)}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Reviewing a flag needs the{" "}
        <code className="font-mono">duplicate.review</code> permission and is part of the next
        milestone.
      </p>
    </div>
  );
}
