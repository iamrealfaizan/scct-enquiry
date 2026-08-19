import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * FollowUp — a scheduled next action on an enquiry.
 *
 * Its own table because a follow-up is a noun with its own lifecycle: it is
 * scheduled for a date, then completed, missed, rescheduled or cancelled, and it
 * has an outcome. A single `nextFollowUpAt` date on Enquiry cannot represent a
 * follow-up that was scheduled and then MISSED — and "which follow-ups were
 * missed" is exactly the question a manager needs answered, since SCCT's
 * follow-up process is currently manual phone calls with no record.
 *
 * Relationship to `Enquiry.nextFollowUpAt`: this collection is authoritative.
 * That field is a maintained cache of the earliest scheduled follow-up, written
 * only by the follow-up service, so the staff queue can sort by urgency on one
 * index. If they ever disagree, this table wins.
 *
 * `assignedTo` refs StaffProfile — the person expected to make the call — and is
 * separate from `completedBy`, which refs User because it is an audit fact about
 * who actually acted. They are frequently different people, and flattening them
 * would hide exactly the reassignment cases worth seeing.
 *
 * Follow-up frequency and escalation rules are UNCONFIRMED (open question 7).
 * This table records what was scheduled and what happened; it does not enforce a
 * cadence, because SCCT has not defined one.
 */
export interface IFollowUp {
  _id: Types.ObjectId;

  // parent
  enquiry: Types.ObjectId;

  // domain
  assignedTo: Types.ObjectId | null;
  dueAt: Date;
  status: "scheduled" | "completed" | "missed" | "cancelled";

  outcome?: string;
  completedAt?: Date | null;
  completedBy?: Types.ObjectId | null;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const FollowUpSchema = new Schema<IFollowUp>(
  {
    // parent
    enquiry: { type: Schema.Types.ObjectId, ref: "Enquiry", required: true },

    // domain
    // Nullable for the same reason Enquiry.owner is: an unassigned enquiry can
    // still have a follow-up scheduled against it.
    assignedTo: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },

    dueAt: { type: Date, required: true },

    status: {
      type: String,
      enum: ["scheduled", "completed", "missed", "cancelled"],
      default: "scheduled",
    },

    // What happened on the call. Free text on purpose — a controlled outcome list
    // would be inventing SCCT process that is not confirmed (open question 6).
    outcome: { type: String, trim: true },

    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// The follow-up history of one enquiry.
FollowUpSchema.index({ enquiry: 1, dueAt: 1 }, { name: "followup_enquiry_due_idx" });

// "my outstanding follow-ups this week" — the counsellor's working view.
FollowUpSchema.index(
  { assignedTo: 1, status: 1, dueAt: 1 },
  { name: "followup_assignee_status_due_idx" },
);

// "what is overdue across the college" — the manager's view, and the number that
// must reconcile against stored records in the reporting screen.
FollowUpSchema.index({ status: 1, dueAt: 1 }, { name: "followup_status_due_idx" });

const FollowUp =
  (mongoose.models.FollowUp as Model<IFollowUp>) ??
  mongoose.model<IFollowUp>("FollowUp", FollowUpSchema);

export default FollowUp;
