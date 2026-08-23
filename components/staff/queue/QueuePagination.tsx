import Link from "next/link";

import { Button } from "@/components/ui/button";
import { queueQueryToSearch, type QueueQuery } from "@/schemas/queue.schema";

/**
 * Pagination — links, so a page is a URL like every other piece of queue state.
 *
 * THE COUNT IS SHOWN AS "x–y of z", not just a page number. The management view's
 * figures have to reconcile against stored records, and a queue that says "42
 * enquiries" next to a filter is the thing a manager checks that claim against.
 *
 * PREVIOUS/NEXT ONLY, no numbered pages. A numbered control needs either a window
 * calculation or a row of thirty links, and neither earns its place in a queue whose
 * whole design assumes you filter rather than browse.
 */
export function QueuePagination({
  query,
  page,
  limit,
  total,
  totalPages,
}: {
  query: QueueQuery;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}) {
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Showing <strong className="font-medium text-foreground">{first}–{last}</strong> of{" "}
        <strong className="font-medium text-foreground">{total}</strong>{" "}
        {total === 1 ? "enquiry" : "enquiries"}
        {totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </p>

      {totalPages > 1 && (
        <div className="flex gap-2">
          {/* Disabled as a non-link rather than a greyed-out link: an anchor that
              looks disabled but still navigates is worse than no control. */}
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/staff${queueQueryToSearch(query, { page: page - 1 })}`}>
                ← Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              ← Previous
            </Button>
          )}

          {page < totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/staff${queueQueryToSearch(query, { page: page + 1 })}`}>Next →</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next →
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
