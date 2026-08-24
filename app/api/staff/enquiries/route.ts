import { jsonFail, jsonPaginated } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { PERMISSION_CODES } from "@/config/codes";
import { parseQueueQuery } from "@/schemas/queue.schema";
import { listEnquiries } from "@/services/queue.service";

export const runtime = "nodejs";

/**
 * GET /api/staff/enquiries — the enquiry queue as data.
 *
 * WHY THIS EXISTS WHEN THE QUEUE PAGE READS MONGO DIRECTLY. Three reasons, none of
 * them "consistency for its own sake":
 *
 *   1. The CSV/Excel export is defined against this endpoint's contract. An export
 *      that reimplemented the query would drift from the screen it claims to
 *      export, and "the spreadsheet does not match the queue" is the exact
 *      complaint this system exists to end.
 *   2. It is the documented seam for the v2 Google Sheets sync (conventions §15) —
 *      one HTTP contract to read against rather than a database connection.
 *   3. It is directly testable as a function, which is how the permission and
 *      scoping behaviour is proven rather than asserted.
 *
 * THE PERMISSION CHECKED IS `enquiry.view.own`, NOT `view.all`. Every member of
 * staff may read a queue; WHAT that queue contains is decided by
 * `queue.service.ts`, which builds the visibility scope from the same permission
 * list. Checking `view.all` here would lock counsellors out of their own enquiries;
 * checking nothing would leave the scoping as the only line between a counsellor
 * and every record in the college.
 *
 * `requirePermission` runs BEFORE anything else, including the database connection.
 * An unauthenticated caller must not be able to make this endpoint do work.
 */
export async function GET(req: Request) {
  const auth = await requirePermission(PERMISSION_CODES.ENQUIRY_VIEW_OWN);

  if (!auth.ok) return jsonFail(auth.code, auth.message);

  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The enquiry queue is unavailable right now. Please try again.",
    );
  }

  // Parsed from the URL with the same schema the queue page uses, so the API and
  // the screen cannot disagree about what a filter means.
  const query = parseQueueQuery(new URL(req.url).searchParams);

  const result = await listEnquiries(auth.data, query);

  if (!result.ok) return jsonFail(result.code, result.message);

  return jsonPaginated(
    result.data.rows,
    result.data.page,
    result.data.limit,
    result.data.total,
  );
}
