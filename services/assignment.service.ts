import type { Types } from "mongoose";

import { Sequence, StaffProfile } from "@/models";

/**
 * Round-robin owner assignment.
 *
 * WHY A SEQUENCE AND NOT "least loaded" OR RANDOM. Least-loaded needs a count
 * query per assignment and still ties; random clusters visibly on small numbers.
 * A cursor is one atomic operation and is trivially explainable — and evenness
 * over a day is what SCCT actually needs, not perfect balance per hour.
 *
 * WHY THE CURSOR IS INCREMENTED HERE AND NOT IN A SAVE HOOK. It is not tied to
 * saving any one document; two enquiries created in the same request would need
 * two positions.
 *
 * `findOneAndUpdate` + `$inc` is atomic at the document level, so two simultaneous
 * submissions cannot receive the same position. `countDocuments()` would give both
 * the same answer.
 */

const CURSOR_KEY = "assignmentCursor";

export type Assignment = {
  owner: Types.ObjectId | null;
  /** Why the outcome was what it was — written into the history event. */
  reason: "round_robin" | "self_assigned" | "no_eligible_staff";
  eligibleCount: number;
};

/**
 * Pick the next owner.
 *
 * Returns `owner: null` — Unassigned — when no eligible staff exist. That is a
 * real state, not a failure: the submission must never be rejected because the
 * college has nobody in the rota today, and no ineligible owner may be silently
 * chosen. The enquiry is stored, visible in the unassigned queue, and the reason
 * is recorded in its history.
 */
export async function assignNextOwner(): Promise<Assignment> {
  // Sorted by _id so the rotation order is stable between calls. Without a sort,
  // Mongo's natural order can change and the cursor would jump around — still
  // even over time, but impossible to demonstrate or reason about.
  const eligible = await StaffProfile.find({
    eligibleForAssignment: true,
    isActive: true,
    isArchived: false,
  })
    .select("_id")
    .sort({ _id: 1 })
    .lean();

  if (eligible.length === 0) {
    return { owner: null, reason: "no_eligible_staff", eligibleCount: 0 };
  }

  const cursor = await Sequence.findOneAndUpdate(
    { _id: CURSOR_KEY },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  );

  // The cursor grows forever and is never reset; the modulo maps it onto whoever
  // is eligible right now. So adding or removing a counsellor changes the rotation
  // from that point on without corrupting it or needing a migration.
  const index = (cursor.value - 1) % eligible.length;

  return {
    owner: eligible[index]._id,
    reason: "round_robin",
    eligibleCount: eligible.length,
  };
}

/**
 * Confirm a staff member may own enquiries, for manual assignment and reassignment.
 *
 * Manual reassignment is checked against the same eligibility rule as automatic
 * assignment — otherwise the queue could be pointed at someone who is not in the
 * rota, and "why is this enquiry assigned to a person on leave" becomes
 * unanswerable.
 */
export async function isAssignable(staffProfile: Types.ObjectId): Promise<boolean> {
  return (
    (await StaffProfile.countDocuments({
      _id: staffProfile,
      eligibleForAssignment: true,
      isActive: true,
      isArchived: false,
    })) === 1
  );
}
