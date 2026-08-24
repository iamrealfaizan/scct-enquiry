import { jsonFail, jsonOk, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { PERMISSION_CODES } from "@/config/codes";
import { fieldErrors } from "@/schemas/enquiry.schema";
import { followUpSchema } from "@/schemas/workflow.schema";
import { scheduleFollowUp } from "@/services/workflow.service";

export const runtime = "nodejs";

/**
 * POST /api/staff/enquiries/[id]/followups — schedule the next call.
 *
 * SCCT's follow-up process is manual phone calls with no record, and their cadence
 * and escalation rules are unconfirmed (open question 7). So this endpoint records
 * what was scheduled and nothing more: it does not enforce a frequency, chase
 * anything, or send a reminder. Inventing a cadence would be inventing SCCT process.
 *
 * Scheduling is an INSERT, so several follow-ups can exist for one enquiry — the
 * history of what was planned is kept, not overwritten. `Enquiry.nextFollowUpAt` is
 * recomputed from the collection afterwards, never assigned from the row just
 * written.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePermission(PERMISSION_CODES.ENQUIRY_UPDATE_OWN, req);
  if (!auth.ok) return jsonFail(auth.code, auth.message);

  const body = await readJson(req);
  if (!body.ok) return jsonFail(ERROR_CODES.VALIDATION_FAILED, body.message);

  const parsed = followUpSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonFail(
      ERROR_CODES.VALIDATION_FAILED,
      "That follow-up could not be scheduled.",
      fieldErrors(parsed.error),
    );
  }

  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The database is not reachable, so nothing was scheduled. Please try again.",
    );
  }

  const result = await scheduleFollowUp(auth.data, params.id, parsed.data);

  if (!result.ok) return jsonFail(result.code, result.message);

  return jsonOk(result.data, 201);
}
