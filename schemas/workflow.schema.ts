import { z } from "zod";

/**
 * The four workflow writes: stage change, note, ownership, follow-up.
 *
 * EVERY ONE CARRIES THE VALUE THE CALLER BELIEVED WAS CURRENT — `fromStatusCode`,
 * `fromOwnerId`. That is not redundant information the server could look up itself;
 * it is the concurrency control. The service turns it into a conditional update, so
 * a caller acting on a stale screen is REJECTED rather than silently overwriting
 * whoever got there first.
 *
 * This is the specific failure SCCT is leaving Excel to escape: the brief describes
 * records being overwritten or lost. Reproducing that in a nicer interface would be
 * the most embarrassing possible outcome, so the protection is in the contract
 * rather than in the UI's good intentions.
 *
 * `.strict()` everywhere. A write endpoint that ignores unexpected fields is one
 * refactor away from spreading a caller-supplied `owner` into an update.
 */

const trimmed = z.string().trim();

/** A 24-character hex ObjectId, or the literal `null` meaning Unassigned. */
const ownerRef = z.union([z.string().regex(/^[a-f\d]{24}$/i), z.null()]);

export const statusChangeSchema = z
  .object({
    /**
     * The stage the caller could see when they decided to act. The service rejects
     * the write if the enquiry has moved on since.
     */
    fromStatusCode: trimmed.min(1).max(40),
    toStatusCode: trimmed.min(1).max(40),

    /**
     * Optional note recorded WITH the stage change, rather than as a separate
     * event. "Why did this move to Not proceeding" is the question a stage change
     * always raises, and answering it in the same action means the reason cannot
     * drift away from the change it explains.
     */
    note: trimmed.max(2000).optional(),
  })
  .strict();

export const noteSchema = z
  .object({
    // A minimum of 2 characters, so an accidental keypress does not become a
    // permanent entry in an append-only log that has no delete.
    note: trimmed.min(2, "Write a note before saving.").max(2000),
  })
  .strict();

export const ownerChangeSchema = z
  .object({
    /** Who the caller believed owned it. `null` means they saw it as Unassigned. */
    fromOwnerId: ownerRef,
    /** `null` releases it back to the unassigned pool. */
    toOwnerId: ownerRef,
    note: trimmed.max(2000).optional(),
  })
  .strict();

export const followUpSchema = z
  .object({
    /**
     * A date-time, validated as parseable and then bounded.
     *
     * THE BOUNDS ARE THE POINT. A follow-up in the past is almost always a typo in
     * the year, and it would land straight in the overdue list as though someone
     * had missed it. Ten years out is the other typo. Neither is worth a stored
     * record, and both are the kind of thing that quietly corrupts the one figure
     * a manager acts on.
     */
    dueAt: trimmed.refine((value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return false;

      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const tenYears = now + 10 * 365 * 24 * 60 * 60 * 1000;

      // A day's grace in the past, so scheduling "this morning" late in the day is
      // not rejected for being a few hours behind the clock.
      return date.getTime() > oneDayAgo && date.getTime() < tenYears;
    }, "Choose a follow-up date within the next ten years."),

    /**
     * Who should make the call. Omitted means the enquiry's current owner, which is
     * the overwhelmingly common case and should not need saying.
     */
    assignedToId: ownerRef.optional(),

    note: trimmed.max(2000).optional(),
  })
  .strict();

export const followUpOutcomeSchema = z
  .object({
    // `missed` is settable by a person on purpose. Nothing in this system runs on a
    // schedule, so "the call did not happen" has to be recordable by the human who
    // knows it did not happen — otherwise the follow-up sits as `scheduled` forever
    // and the overdue figure means nothing.
    status: z.enum(["completed", "missed", "cancelled"]),
    outcome: trimmed.max(1000).optional(),
  })
  .strict();

export type StatusChangeInput = z.output<typeof statusChangeSchema>;
export type NoteInput = z.output<typeof noteSchema>;
export type OwnerChangeInput = z.output<typeof ownerChangeSchema>;
export type FollowUpInput = z.output<typeof followUpSchema>;
export type FollowUpOutcomeInput = z.output<typeof followUpOutcomeSchema>;
