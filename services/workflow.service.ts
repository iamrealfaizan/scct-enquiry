import mongoose, { type Types } from "mongoose";

import { PERMISSION_CODES } from "@/config/codes";
import type { Principal } from "@/lib/auth";
import { ERROR_CODES, fail, fromError, ok, type Result } from "@/lib/result";
import { Enquiry, EnquiryEvent, EnquiryStatus, FollowUp, StaffProfile } from "@/models";
import type {
  FollowUpInput,
  FollowUpOutcomeInput,
  NoteInput,
  OwnerChangeInput,
  StatusChangeInput,
} from "@/schemas/workflow.schema";

import { isAssignable } from "./assignment.service";
import { visibilityScope } from "./queue.service";

/**
 * THE WORKFLOW WRITE PATH — stage changes, notes, ownership, follow-ups.
 *
 * Four rules hold everywhere in this file, and they are the ones worth defending:
 *
 * ─── 1. EVERY UPDATE IS CONDITIONAL ────────────────────────────────────────────
 *
 * No write here reads a document, decides something, and then saves it. Each one is
 * a single `findOneAndUpdate` whose FILTER contains the value the caller believed
 * was current. If someone else changed it in between, the filter matches nothing,
 * zero documents are written, and the caller is told.
 *
 * The read-then-write alternative is the Excel failure in a nicer interface: two
 * counsellors open the same enquiry, both save, and the second silently erases the
 * first. The brief names "overwritten or lost records" as the risk SCCT is escaping,
 * so reproducing it would be the worst possible outcome.
 *
 * ─── 2. AUTHORIZATION IS CHECKED AGAINST THE STORED RECORD, NOT THE REQUEST ─────
 *
 * Ownership is read from the database inside the same query that performs the
 * write. A caller cannot claim to own something by saying so.
 *
 * ─── 3. HISTORY IS APPENDED FOR EVERY CHANGE, AND ONLY AFTER IT SUCCEEDED ───────
 *
 * An event is written after the update is confirmed, never before. A history entry
 * for a change that did not happen is worse than a missing one, because it is
 * evidence of something false.
 *
 * ─── 4. NOTHING IS EVER DELETED OR MERGED ──────────────────────────────────────
 *
 * Releasing an enquiry sets its owner to null; it does not remove the record of who
 * held it. Cancelling a follow-up marks it cancelled. `EnquiryEvent` has no update
 * or delete path at all.
 *
 * ─── NOT TRANSACTIONAL, STATED PLAINLY ─────────────────────────────────────────
 *
 * As in `enquiry.service.ts`: the update and its history event are two writes, and
 * the second could in principle fail after the first succeeded. The record itself is
 * never lost, the failure is logged rather than swallowed, and the enquiry's current
 * state remains correct — only its log would have a gap. Multi-document transactions
 * need a replica-set session and would make every write heavier for a gap this
 * narrow. Recorded in the handoff note as a pre-production change.
 */

// ─── Write authorization ─────────────────────────────────────────────────────

type WriteKind = "update" | "reassign";

/**
 * The filter that decides whether this caller may write to this enquiry.
 *
 * Returned as a FILTER FRAGMENT rather than a boolean, deliberately: it is combined
 * into the same conditional update that performs the write, so there is no window
 * between the check and the change and no second code path that could disagree with
 * the first.
 *
 * THE RULES:
 *   `enquiry.update.all` (manager, admin) — may update any enquiry they can see.
 *   `enquiry.update.own` (counsellor)     — may update an enquiry they own, and may
 *                                           CLAIM one from the unassigned pool.
 *   `enquiry.reassign`   (manager, admin) — may move ownership between any two
 *                                           people.
 *
 * WHY A COUNSELLOR MAY CLAIM AN UNASSIGNED ENQUIRY. Round-robin falls back to
 * Unassigned when nobody is eligible, so that state is expected rather than
 * exceptional. If only a manager could act on it, an enquiry could sit untouched
 * while the person who would have called is looking straight at it. A claim is
 * recorded as `self_claimed` in the history, so it is traceable rather than silent.
 * A counsellor still cannot hand an enquiry to somebody ELSE — that needs
 * `enquiry.reassign`.
 *
 * SCCT has not confirmed this rule (open question 11). It lives in one function so
 * their answer changes one place.
 */
function writeScope(
  principal: Principal,
  kind: WriteKind,
): Result<Record<string, unknown>> {
  const visible = visibilityScope(principal).filter;

  if (kind === "reassign") {
    if (!principal.permissions.includes(PERMISSION_CODES.ENQUIRY_REASSIGN)) {
      return fail(
        ERROR_CODES.FORBIDDEN,
        "Reassigning an enquiry to another person requires the \"enquiry.reassign\" permission.",
      );
    }
    return ok(visible);
  }

  if (principal.permissions.includes(PERMISSION_CODES.ENQUIRY_UPDATE_ALL)) {
    return ok(visible);
  }

  if (!principal.permissions.includes(PERMISSION_CODES.ENQUIRY_UPDATE_OWN)) {
    return fail(ERROR_CODES.FORBIDDEN, "This account cannot update enquiries.");
  }

  if (!principal.staffProfileId) {
    // No staff profile means no id `Enquiry.owner` could ever match, so "the ones I
    // own" is empty. Said explicitly rather than producing a filter that silently
    // matches nothing and reads as "that enquiry does not exist".
    return fail(
      ERROR_CODES.FORBIDDEN,
      "This account has no staff profile, so it cannot own or update enquiries.",
    );
  }

  return ok({
    $and: [
      visible,
      {
        $or: [
          { owner: new mongoose.Types.ObjectId(principal.staffProfileId) },
          // The claimable pool. See the note above.
          { owner: null },
        ],
      },
    ],
  });
}

/** `null` for Unassigned, an ObjectId otherwise. */
function ownerRefToId(value: string | null): Types.ObjectId | null {
  return value ? new mongoose.Types.ObjectId(value) : null;
}

/**
 * The message shown when a conditional update matched nothing.
 *
 * ONE MESSAGE FOR TWO CAUSES, and it has to be, because the failed match cannot
 * distinguish them: either the enquiry moved on since the caller loaded the page, or
 * it is not one they may write to. Guessing at which would sometimes be wrong, and a
 * confidently wrong explanation is worse than an honest ambiguous one. The wording
 * therefore tells them what to DO — reload — which is the right action either way.
 */
const CONFLICT_MESSAGE =
  "This enquiry changed while you were looking at it, or it is not yours to change. " +
  "Reload the page to see its current state — nothing was saved.";

// ─── Stage change ────────────────────────────────────────────────────────────

export async function changeStatus(
  principal: Principal,
  enquiryId: string,
  input: StatusChangeInput,
): Promise<Result<{ statusLabel: string }>> {
  try {
    if (!mongoose.Types.ObjectId.isValid(enquiryId)) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist.");
    }

    const scope = writeScope(principal, "update");
    if (!scope.ok) return scope;

    const [from, to] = await Promise.all([
      EnquiryStatus.findOne({ code: input.fromStatusCode }).select("_id label").lean(),
      EnquiryStatus.findOne({
        code: input.toStatusCode,
        isActive: true,
        isArchived: false,
      })
        .select("_id label")
        .lean(),
    ]);

    // The FROM status only has to exist — it may since have been deactivated, and
    // that is not the caller's fault. The TO status must be active: moving an
    // enquiry into a stage SCCT has retired would be a one-way trip.
    if (!from) {
      return fail(ERROR_CODES.VALIDATION_FAILED, "Unknown current stage.");
    }
    if (!to) {
      return fail(ERROR_CODES.VALIDATION_FAILED, "That stage is not available.");
    }

    if (String(from._id) === String(to._id)) {
      // Rejected rather than accepted as a no-op, so the history log never fills
      // with entries recording that nothing happened.
      return fail(ERROR_CODES.VALIDATION_FAILED, "That is already the current stage.");
    }

    /**
     * NO TRANSITION GRAPH, on purpose.
     *
     * SCCT's actual stages are unconfirmed (open question 1) and the definitions of
     * a successful, unsuccessful or closed outcome are open question 6. A hardcoded
     * graph would invent their process and then enforce it, which is a listed
     * critical failure — and it would block a real case, because a student who said
     * they were not proceeding does sometimes come back.
     *
     * Every move is recorded, so an unexpected one is visible rather than
     * impossible. When SCCT confirms their stages, a transition map becomes data on
     * `EnquiryStatus` rather than a code change.
     */
    const updated = await Enquiry.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(enquiryId),
        isArchived: false,
        // THE GUARD. The stage the caller was looking at must still be the stage on
        // the record.
        status: from._id,
        ...scope.data,
      },
      { $set: { status: to._id, updatedBy: new mongoose.Types.ObjectId(principal.userId) } },
      { new: true },
    )
      .select("_id")
      .lean();

    if (!updated) return fail(ERROR_CODES.CONFLICT, CONFLICT_MESSAGE);

    await appendEvent({
      enquiry: updated._id,
      type: "status_changed",
      fromStatus: from._id,
      toStatus: to._id,
      // The label AS IT READS NOW, snapshotted. Renaming the stage next year must
      // not rewrite what this history entry says happened.
      statusLabelAtEvent: to.label,
      note: input.note,
      detail: `Stage changed from "${from.label}" to "${to.label}".`,
      createdBy: principal.userId,
    });

    return ok({ statusLabel: to.label });
  } catch (err) {
    return fromError(err);
  }
}

// ─── Note ────────────────────────────────────────────────────────────────────

/**
 * Append a note.
 *
 * NO CONDITIONAL GUARD HERE, and that is correct rather than an omission: a note is
 * an insert into an append-only log. There is no existing value to overwrite, so
 * there is nothing for a stale screen to clobber. Two counsellors adding notes at
 * the same moment both succeed, which is the behaviour you want.
 *
 * The enquiry is still resolved through the write scope first, so a caller cannot
 * append to a record they may not touch.
 */
export async function addNote(
  principal: Principal,
  enquiryId: string,
  input: NoteInput,
): Promise<Result<{ id: string }>> {
  try {
    if (!mongoose.Types.ObjectId.isValid(enquiryId)) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist.");
    }

    if (!principal.permissions.includes(PERMISSION_CODES.ENQUIRY_NOTE_CREATE)) {
      return fail(ERROR_CODES.FORBIDDEN, "Adding a note requires the \"enquiry.note.create\" permission.");
    }

    const scope = writeScope(principal, "update");
    if (!scope.ok) return scope;

    const enquiry = await Enquiry.findOne({
      _id: new mongoose.Types.ObjectId(enquiryId),
      isArchived: false,
      ...scope.data,
    })
      .select("_id")
      .lean();

    if (!enquiry) return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist, or you cannot change it.");

    const event = await EnquiryEvent.create({
      enquiry: enquiry._id,
      type: "note_added",
      note: input.note,
      createdBy: new mongoose.Types.ObjectId(principal.userId),
    });

    // This one write IS the operation, so a failure here is a real failure and is
    // NOT swallowed the way an accompanying history event is elsewhere. Telling
    // someone their note was saved when it was not is exactly the silent data loss
    // this system exists to prevent.
    return ok({ id: String(event._id) });
  } catch (err) {
    return fromError(err);
  }
}

// ─── Ownership ───────────────────────────────────────────────────────────────

export type OwnerChangeReason =
  | "self_claimed"
  | "released_to_pool"
  | "reassigned";

export async function changeOwner(
  principal: Principal,
  enquiryId: string,
  input: OwnerChangeInput,
): Promise<Result<{ reason: OwnerChangeReason; ownerName: string | null }>> {
  try {
    if (!mongoose.Types.ObjectId.isValid(enquiryId)) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist.");
    }

    const fromOwner = ownerRefToId(input.fromOwnerId);
    const toOwner = ownerRefToId(input.toOwnerId);

    if (String(fromOwner) === String(toOwner)) {
      return fail(ERROR_CODES.VALIDATION_FAILED, "That is already the current owner.");
    }

    const isSelfClaim =
      input.fromOwnerId === null && input.toOwnerId === principal.staffProfileId;

    const isRelease =
      input.toOwnerId === null && input.fromOwnerId === principal.staffProfileId;

    // A claim or a release is the caller acting on their own ownership, which
    // `update.own` covers. Anything else moves an enquiry between other people and
    // needs `enquiry.reassign`.
    const kind: WriteKind = isSelfClaim || isRelease ? "update" : "reassign";

    const scope = writeScope(principal, kind);
    if (!scope.ok) return scope;

    /**
     * The incoming owner is checked against the SAME eligibility rule round-robin
     * uses. Otherwise the queue could be pointed at someone on leave, and "why is
     * this assigned to a person who is not in the rota" becomes unanswerable.
     */
    if (toOwner && !(await isAssignable(toOwner))) {
      return fail(
        ERROR_CODES.VALIDATION_FAILED,
        "That staff member is not currently eligible to own enquiries.",
      );
    }

    const updated = await Enquiry.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(enquiryId),
        isArchived: false,
        // THE GUARD. Two managers assigning the same unassigned enquiry to two
        // different counsellors: the first wins, the second is told, and nobody's
        // change disappears.
        owner: fromOwner,
        ...scope.data,
      },
      { $set: { owner: toOwner, updatedBy: new mongoose.Types.ObjectId(principal.userId) } },
      { new: true },
    )
      .select("_id")
      .lean();

    if (!updated) return fail(ERROR_CODES.CONFLICT, CONFLICT_MESSAGE);

    const reason: OwnerChangeReason = isSelfClaim
      ? "self_claimed"
      : isRelease
        ? "released_to_pool"
        : "reassigned";

    const [fromName, toName] = await Promise.all([staffName(fromOwner), staffName(toOwner)]);

    await appendEvent({
      enquiry: updated._id,
      // `owner_assigned` when it had nobody, `owner_changed` when it moved between
      // people. Two event types because they are genuinely different questions when
      // reading a history back.
      type: fromOwner === null ? "owner_assigned" : "owner_changed",
      fromOwner,
      toOwner,
      note: input.note,
      detail: {
        self_claimed: `Claimed from the unassigned pool by ${toName ?? "themselves"}.`,
        released_to_pool: `Released back to the unassigned pool by ${fromName ?? "the previous owner"}.`,
        reassigned: `Owner changed from ${fromName ?? "Unassigned"} to ${toName ?? "Unassigned"}.`,
      }[reason],
      createdBy: principal.userId,
    });

    return ok({ reason, ownerName: toName });
  } catch (err) {
    return fromError(err);
  }
}

// ─── Follow-ups ──────────────────────────────────────────────────────────────

export async function scheduleFollowUp(
  principal: Principal,
  enquiryId: string,
  input: FollowUpInput,
): Promise<Result<{ id: string; dueAt: string }>> {
  try {
    if (!mongoose.Types.ObjectId.isValid(enquiryId)) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist.");
    }

    const scope = writeScope(principal, "update");
    if (!scope.ok) return scope;

    const enquiry = await Enquiry.findOne({
      _id: new mongoose.Types.ObjectId(enquiryId),
      isArchived: false,
      ...scope.data,
    })
      .select("_id owner")
      .lean();

    if (!enquiry) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist, or you cannot change it.");
    }

    // Defaults to the enquiry's current owner — the common case, and it must not
    // need saying. `null` stays null: an unassigned enquiry can carry a scheduled
    // follow-up, which is how the unassigned pool stays visible in the overdue view
    // instead of falling out of it.
    const assignedTo =
      input.assignedToId === undefined
        ? (enquiry.owner as Types.ObjectId | null)
        : ownerRefToId(input.assignedToId);

    if (assignedTo && !(await isAssignable(assignedTo))) {
      return fail(
        ERROR_CODES.VALIDATION_FAILED,
        "That staff member is not currently eligible to take follow-ups.",
      );
    }

    const followUp = await FollowUp.create({
      enquiry: enquiry._id,
      assignedTo,
      dueAt: new Date(input.dueAt),
      status: "scheduled",
      createdBy: new mongoose.Types.ObjectId(principal.userId),
    });

    // The cache on Enquiry is refreshed FROM this collection, never set to the value
    // just written. See the note on the function.
    await refreshNextFollowUpCache(enquiry._id);

    await appendEvent({
      enquiry: enquiry._id,
      type: "followup_scheduled",
      note: input.note,
      detail: `Follow-up scheduled for ${followUp.dueAt.toISOString()}.`,
      createdBy: principal.userId,
    });

    return ok({ id: String(followUp._id), dueAt: followUp.dueAt.toISOString() });
  } catch (err) {
    return fromError(err);
  }
}

export async function recordFollowUpOutcome(
  principal: Principal,
  enquiryId: string,
  followUpId: string,
  input: FollowUpOutcomeInput,
): Promise<Result<{ status: string }>> {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(enquiryId) ||
      !mongoose.Types.ObjectId.isValid(followUpId)
    ) {
      return fail(ERROR_CODES.NOT_FOUND, "That follow-up does not exist.");
    }

    const scope = writeScope(principal, "update");
    if (!scope.ok) return scope;

    const enquiry = await Enquiry.findOne({
      _id: new mongoose.Types.ObjectId(enquiryId),
      isArchived: false,
      ...scope.data,
    })
      .select("_id")
      .lean();

    if (!enquiry) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist, or you cannot change it.");
    }

    /**
     * Guarded on `status: "scheduled"`, so only an OPEN follow-up can be resolved.
     *
     * This is what stops a completed call being quietly re-marked as missed — which
     * would change the one figure a manager reads without leaving any trace that the
     * earlier outcome ever existed.
     */
    const updated = await FollowUp.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(followUpId),
        enquiry: enquiry._id,
        status: "scheduled",
        isArchived: false,
      },
      {
        $set: {
          status: input.status,
          outcome: input.outcome,
          // Recorded for every outcome, not just completion: when a follow-up was
          // marked missed is as much a fact as when one was made.
          completedAt: new Date(),
          completedBy: new mongoose.Types.ObjectId(principal.userId),
          updatedBy: new mongoose.Types.ObjectId(principal.userId),
        },
      },
      { new: true },
    )
      .select("_id status dueAt")
      .lean();

    if (!updated) {
      return fail(
        ERROR_CODES.CONFLICT,
        "That follow-up has already been resolved, or it belongs to another enquiry. Nothing was saved.",
      );
    }

    await refreshNextFollowUpCache(enquiry._id);

    await appendEvent({
      enquiry: enquiry._id,
      type:
        input.status === "completed"
          ? "followup_completed"
          : input.status === "missed"
            ? "followup_missed"
            : // A cancelled follow-up is not a missed one, and the log must not
              // claim a call was missed when it was called off on purpose.
              "followup_scheduled",
      note: input.outcome,
      detail:
        input.status === "cancelled"
          ? `Follow-up due ${updated.dueAt.toISOString()} was cancelled.`
          : `Follow-up due ${updated.dueAt.toISOString()} marked ${input.status}.`,
      createdBy: principal.userId,
    });

    return ok({ status: input.status });
  } catch (err) {
    return fromError(err);
  }
}

/**
 * Recompute `Enquiry.nextFollowUpAt` from the FollowUp collection.
 *
 * DERIVED, NEVER ASSIGNED FROM THE WRITE THAT JUST HAPPENED. Setting the cache to
 * the follow-up just created would be wrong the moment an EARLIER one already
 * existed, and completing a follow-up would have to guess at what the next one is.
 * Reading the earliest open follow-up back cannot drift, and it makes the rule
 * "FollowUp is authoritative, the field is a cache" true rather than aspirational.
 *
 * The cache exists only so the queue can sort and filter urgency on one index
 * instead of joining on every page load.
 */
export async function refreshNextFollowUpCache(enquiry: Types.ObjectId): Promise<void> {
  const next = await FollowUp.findOne({
    enquiry,
    status: "scheduled",
    isArchived: false,
  })
    .select("dueAt")
    .sort({ dueAt: 1 })
    .lean();

  await Enquiry.updateOne(
    { _id: enquiry },
    { $set: { nextFollowUpAt: next ? next.dueAt : null } },
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

/**
 * Append one history event.
 *
 * FAILURES ARE LOGGED, NOT THROWN — for the accompanying events only. The change
 * itself is already confirmed stored at this point, and turning a successful update
 * into an error the caller retries would risk applying it twice. The gap is narrow,
 * visible in the log, and recorded in the handoff note. `addNote` is the deliberate
 * exception: there, the event IS the operation, so a failure is reported.
 */
async function appendEvent(event: {
  enquiry: Types.ObjectId;
  type: string;
  fromStatus?: Types.ObjectId | null;
  toStatus?: Types.ObjectId | null;
  statusLabelAtEvent?: string;
  fromOwner?: Types.ObjectId | null;
  toOwner?: Types.ObjectId | null;
  note?: string;
  detail?: string;
  createdBy: string;
}): Promise<void> {
  try {
    await EnquiryEvent.create({
      ...event,
      createdBy: new mongoose.Types.ObjectId(event.createdBy),
    });
  } catch (err) {
    console.error("[workflow.service] history event failed", event.type, err);
  }
}

async function staffName(id: Types.ObjectId | null): Promise<string | null> {
  if (!id) return null;

  const staff = await StaffProfile.findById(id).select("firstName lastName").lean();
  return staff ? `${staff.firstName} ${staff.lastName ?? ""}`.trim() : null;
}
