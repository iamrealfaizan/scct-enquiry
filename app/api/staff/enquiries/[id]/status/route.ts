import { jsonFail, jsonMessage, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { PERMISSION_CODES } from "@/config/codes";
import { fieldErrors } from "@/schemas/enquiry.schema";
import { statusChangeSchema } from "@/schemas/workflow.schema";
import { changeStatus } from "@/services/workflow.service";

export const runtime = "nodejs";

/**
 * POST /api/staff/enquiries/[id]/status — move an enquiry to another stage.
 *
 * THE PERMISSION CHECKED HERE IS THE FLOOR, NOT THE WHOLE RULE.
 * `enquiry.update.own` gets a caller through the door; whether they may touch THIS
 * enquiry is decided inside `changeStatus`, against the stored record, in the same
 * query that performs the write. A manager's `enquiry.update.all` is read there too.
 *
 * Splitting it this way means the handler cannot accidentally become the only check:
 * it does not know enough to be one, and it is written so that it obviously does not.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePermission(PERMISSION_CODES.ENQUIRY_UPDATE_OWN, req);
  if (!auth.ok) return jsonFail(auth.code, auth.message);

  const body = await readJson(req);
  if (!body.ok) return jsonFail(ERROR_CODES.VALIDATION_FAILED, body.message);

  const parsed = statusChangeSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonFail(
      ERROR_CODES.VALIDATION_FAILED,
      "That stage change is not valid.",
      fieldErrors(parsed.error),
    );
  }

  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The database is not reachable, so nothing was changed. Please try again.",
    );
  }

  const result = await changeStatus(auth.data, params.id, parsed.data);

  if (!result.ok) return jsonFail(result.code, result.message);

  return jsonMessage(`Stage changed to "${result.data.statusLabel}".`);
}
