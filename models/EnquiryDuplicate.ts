import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * EnquiryDuplicate — the junction table linking an enquiry to a possible
 * duplicate of itself (conventions §5.7).
 *
 * A junction rather than an array of refs on Enquiry, because THE RELATIONSHIP
 * CARRIES DATA: which field matched, when it was detected, and — the important
 * one — whether a manager reviewed and dismissed it.
 *
 * Without a review state, a dismissed false positive reappears as a warning
 * forever, and staff learn to ignore the flag. A flag nobody trusts is worse than
 * no flag at all.
 *
 * THE APPROVED DUPLICATE RULE, which this table implements:
 *   same phone/email + SAME programme      -> flag as possible duplicate (a row here)
 *   same phone/email + DIFFERENT programme -> allowed, no row, separate enquiry
 *   repeated technical retry               -> suppressed earlier by idempotencyKey
 *   never silently delete or auto-merge    -> nothing in this table deletes anything
 *
 * NO CONTACT VALUES ARE STORED HERE. `matchedOn` records WHICH field matched, not
 * what the value was. The value already exists on both enquiries, and duplicating
 * a phone number into a third collection would widen the exposure of personal data
 * for no benefit.
 *
 * Direction: `enquiry` is the NEWER record, `duplicateOf` the earlier one it may
 * duplicate. Kept consistent so the pair is meaningful and the unique index works.
 */
export interface IEnquiryDuplicate {
  _id: Types.ObjectId;

  // the pair
  enquiry: Types.ObjectId;
  duplicateOf: Types.ObjectId;

  // payload — why this is a junction table and not an array
  matchedOn: "phone" | "email" | "both";
  programme: Types.ObjectId;

  reviewStatus: "flagged" | "dismissed" | "confirmed";
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  reviewNote?: string;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const EnquiryDuplicateSchema = new Schema<IEnquiryDuplicate>(
  {
    // the pair — newer first
    enquiry: { type: Schema.Types.ObjectId, ref: "Enquiry", required: true },
    duplicateOf: { type: Schema.Types.ObjectId, ref: "Enquiry", required: true },

    // payload
    matchedOn: {
      type: String,
      enum: ["phone", "email", "both"],
      required: true,
    },

    // The programme both enquiries share. Denormalised from the pair because it
    // is the discriminator in the duplicate rule, so reporting on "duplicates by
    // programme" should not need two joins.
    programme: { type: Schema.Types.ObjectId, ref: "Programme", required: true },

    reviewStatus: {
      type: String,
      enum: ["flagged", "dismissed", "confirmed"],
      default: "flagged",
    },

    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// One link per pair. Re-running detection must not accumulate identical rows —
// and must not silently wipe an existing dismissal.
EnquiryDuplicateSchema.index(
  { enquiry: 1, duplicateOf: 1 },
  { unique: true, name: "enquiryduplicate_pair_uq" },
);

// "show me the open duplicate flags" — the manager's review queue.
EnquiryDuplicateSchema.index(
  { reviewStatus: 1, createdAt: -1 },
  { name: "enquiryduplicate_review_created_idx" },
);

// Both directions, because either enquiry of a pair may be the one on screen.
EnquiryDuplicateSchema.index({ enquiry: 1 }, { name: "enquiryduplicate_enquiry_idx" });
EnquiryDuplicateSchema.index({ duplicateOf: 1 }, { name: "enquiryduplicate_duplicateof_idx" });

const EnquiryDuplicate =
  (mongoose.models.EnquiryDuplicate as Model<IEnquiryDuplicate>) ??
  mongoose.model<IEnquiryDuplicate>("EnquiryDuplicate", EnquiryDuplicateSchema);

export default EnquiryDuplicate;
