import { jsonFail, jsonMessage, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ERROR_CODES } from "@/lib/result";
import { PERMISSION_CODES } from "@/config/codes";
import { fieldErrors } from "@/schemas/enquiry.schema";
import { noteSchema } from "@/schemas/workflow.schema";
import { addNote } from "@/services/workflow.service";

export const runtime = "nodejs";

/**
 * POST /api/staff/enquiries/[id]/notes — append a note to the history.
 *
 * There is no PATCH and no DELETE for a note, and that is the design rather than an
 * unfinished feature. Notes are `EnquiryEvent` rows, the history is append-only, and
 * an editable audit trail is not an audit trail. A correction is a new note.
 *
 * `enquiry.note.create` is checked here AND in the service. The duplication is
 * deliberate: this endpoint is the door, and the service is reachable from anywhere
 * else that might later want to add a note.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePermission(PERMISSION_CODES.ENQUIRY_NOTE_CREATE, req);
  if (!auth.ok) return jsonFail(auth.code, auth.message);

  const body = await readJson(req);
  if (!body.ok) return jsonFail(ERROR_CODES.VALIDATION_FAILED, body.message);

  const parsed = noteSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonFail(
      ERROR_CODES.VALIDATION_FAILED,
      "That note could not be saved.",
      fieldErrors(parsed.error),
    );
  }

  try {
    await db();
  } catch {
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The database is not reachable, so your note was NOT saved. Please try again.",
    );
  }

  const result = await addNote(auth.data, params.id, parsed.data);

  if (!result.ok) return jsonFail(result.code, result.message);

  // Acknowledged only after the write is confirmed. A note the person believes is
  // recorded and is not is the silent data loss this system exists to prevent.
  return jsonMessage("Note added.");
}
