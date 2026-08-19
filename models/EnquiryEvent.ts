import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * EnquiryEvent — the APPEND-ONLY history of everything that happened to an
 * enquiry. Notes live here too, as events of type `note`.
 *
 * WHY A SEPARATE COLLECTION rather than an array on Enquiry:
 *   1. Append-only becomes structural. Writes here are only ever inserts. In an
 *      array, every history write would be an UPDATE to the enquiry, and an
 *      update can overwrite.
 *   2. It grows without limit. An enquiry followed up for months accumulates
 *      dozens of events; embedding them bloats the document the queue reads on
 *      every page load.
 *   3. It is queryable on its own — "what did this counsellor do last week" is
 *      one query here and impossible inside an array.
 *
 * TWO DELIBERATE EXCEPTIONS to the shared-blocks rule (conventions §5.6):
 *
 *   - NO `updatedBy`. A row is never updated, so the field would always be null,
 *     and its presence would invite the question "so history can be edited?"
 *   - NO `isActive` / `isArchived`. An audit record that can be hidden is not an
 *     audit record. Archiving history would let someone remove the evidence of a
 *     change while leaving the change in place, which defeats the purpose.
 *
 * `statusLabelAtEvent` is the second half of the label-snapshot decision: the
 * status label as it read AT THAT MOMENT. Rename a stage later and the history
 * still describes what actually happened.
 */
export type EnquiryEventType =
  | "created"
  | "status_changed"
  | "owner_assigned"
  | "owner_changed"
  | "note_added"
  | "followup_scheduled"
  | "followup_completed"
  | "followup_missed"
  | "duplicate_flagged"
  | "duplicate_dismissed"
  | "duplicate_confirmed"
  | "exported";

export interface IEnquiryEvent {
  _id: Types.ObjectId;

  // parent
  enquiry: Types.ObjectId;

  // domain
  type: EnquiryEventType;

  fromStatus?: Types.ObjectId | null;
  toStatus?: Types.ObjectId | null;
  statusLabelAtEvent?: string;

  fromOwner?: Types.ObjectId | null;
  toOwner?: Types.ObjectId | null;

  note?: string;

  // Free-form detail for events that need context a ref cannot carry — for
  // example which field matched on a duplicate flag. Never contains contact
  // values.
  detail?: string;

  // audit — createdBy only. null means the actor was the public form or a
  // system process, which is itself meaningful.
  createdBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

const EnquiryEventSchema = new Schema<IEnquiryEvent>(
  {
    // parent
    enquiry: { type: Schema.Types.ObjectId, ref: "Enquiry", required: true },

    // domain
    type: {
      type: String,
      enum: [
        "created",
        "status_changed",
        "owner_assigned",
        "owner_changed",
        "note_added",
        "followup_scheduled",
        "followup_completed",
        "followup_missed",
        "duplicate_flagged",
        "duplicate_dismissed",
        "duplicate_confirmed",
        "exported",
      ],
      required: true,
    },

    fromStatus: { type: Schema.Types.ObjectId, ref: "EnquiryStatus", default: null },
    toStatus: { type: Schema.Types.ObjectId, ref: "EnquiryStatus", default: null },

    // Snapshot — see the note above.
    statusLabelAtEvent: { type: String, trim: true },

    fromOwner: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },
    toOwner: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },

    note: { type: String, trim: true },
    detail: { type: String, trim: true },

    // audit — no updatedBy, on purpose.
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

// The history timeline for one enquiry, newest first.
EnquiryEventSchema.index({ enquiry: 1, createdAt: -1 }, { name: "enquiryevent_enquiry_created_idx" });

// "what did this person do, and when" — activity reporting per staff account.
EnquiryEventSchema.index({ createdBy: 1, createdAt: -1 }, { name: "enquiryevent_actor_created_idx" });

// Filter a timeline or a report to one kind of change.
EnquiryEventSchema.index({ type: 1, createdAt: -1 }, { name: "enquiryevent_type_created_idx" });

const EnquiryEvent =
  (mongoose.models.EnquiryEvent as Model<IEnquiryEvent>) ??
  mongoose.model<IEnquiryEvent>("EnquiryEvent", EnquiryEventSchema);

export default EnquiryEvent;
