import { jsonFail, jsonMessage, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { PERMISSION_CODES } from "@/config/codes";
import { fieldErrors } from "@/schemas/enquiry.schema";
import { ownerChangeSchema } from "@/schemas/workflow.schema";
import { changeOwner } from "@/services/workflow.service";

export const runtime = "nodejs";

/**
 * POST /api/staff/enquiries/[id]/owner — claim, release, or reassign.
 *
 * ONE ENDPOINT FOR THREE OPERATIONS, because they are one operation: ownership moves
 * from A to B, where either may be nobody. Three endpoints would mean three
 * conditional updates, three history writers and three places for the concurrency
 * guard to be forgotten.
 *
 * THE PERMISSION FLOOR IS `enquiry.update.own`, NOT `enquiry.reassign`. A counsellor
 * claiming an unassigned enquiry is acting on their own ownership; moving an enquiry
 * between two other people needs `enquiry.reassign`. `changeOwner` decides which of
 * those a request actually is — from the stored owner, not from what the caller
 * says — because a request that merely CLAIMS to be a self-claim must not be trusted.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePermission(PERMISSION_CODES.ENQUIRY_UPDATE_OWN);
  if (!auth.ok) return jsonFail(auth.code, auth.message);

  const body = await readJson(req);
  if (!body.ok) return jsonFail(ERROR_CODES.VALIDATION_FAILED, body.message);

  const parsed = ownerChangeSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonFail(
      ERROR_CODES.VALIDATION_FAILED,
      "That ownership change is not valid.",
      fieldErrors(parsed.error),
    );
  }

  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The database is not reachable, so ownership was NOT changed. Please try again.",
    );
  }

  const result = await changeOwner(auth.data, params.id, parsed.data);

  if (!result.ok) return jsonFail(result.code, result.message);

  return jsonMessage(
    {
      self_claimed: "You are now the owner of this enquiry.",
      released_to_pool: "Released back to the unassigned pool.",
      reassigned: `Owner changed to ${result.data.ownerName ?? "Unassigned"}.`,
    }[result.data.reason],
  );
}
