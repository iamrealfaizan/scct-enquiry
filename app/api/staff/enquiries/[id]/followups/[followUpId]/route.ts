import { jsonFail, jsonMessage, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { PERMISSION_CODES } from "@/config/codes";
import { fieldErrors } from "@/schemas/enquiry.schema";
import { followUpOutcomeSchema } from "@/schemas/workflow.schema";
import { recordFollowUpOutcome } from "@/services/workflow.service";

export const runtime = "nodejs";

/**
 * PATCH /api/staff/enquiries/[id]/followups/[followUpId] — record what happened.
 *
 * PATCH, not POST: this resolves an existing follow-up rather than creating anything.
 *
 * `missed` IS SETTABLE BY A PERSON, deliberately. Nothing in this system runs on a
 * schedule — there is no cron, no worker, and adding one for a trial would be a
 * dependency to defend. So "the call did not happen" has to be recordable by the
 * human who knows it did not, or a follow-up sits `scheduled` forever and the overdue
 * figure a manager reads means nothing.
 *
 * The service guards on `status: "scheduled"`, so an already-resolved follow-up
 * cannot be quietly re-marked — which would change that same figure with no trace of
 * the earlier outcome.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; followUpId: string } },
) {
  const auth = await requirePermission(PERMISSION_CODES.ENQUIRY_UPDATE_OWN);
  if (!auth.ok) return jsonFail(auth.code, auth.message);

  const body = await readJson(req);
  if (!body.ok) return jsonFail(ERROR_CODES.VALIDATION_FAILED, body.message);

  const parsed = followUpOutcomeSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonFail(
      ERROR_CODES.VALIDATION_FAILED,
      "That follow-up outcome is not valid.",
      fieldErrors(parsed.error),
    );
  }

  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The database is not reachable, so nothing was recorded. Please try again.",
    );
  }

  const result = await recordFollowUpOutcome(
    auth.data,
    params.id,
    params.followUpId,
    parsed.data,
  );

  if (!result.ok) return jsonFail(result.code, result.message);

  return jsonMessage(`Follow-up marked ${result.data.status}.`);
}
