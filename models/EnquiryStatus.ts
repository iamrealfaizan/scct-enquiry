import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * EnquiryStatus — where an enquiry sits in the admissions workflow.
 *
 * SCCT'S FINAL STAGE NAMES ARE UNCONFIRMED (open question 1). Every seeded row
 * is a clearly labelled SYNTHETIC PLACEHOLDER and must be presented as such in
 * the UI. Nothing here should be read as confirmed SCCT process.
 *
 * A lookup table rather than an enum precisely BECAUSE it is unconfirmed: when
 * SCCT tells us their real stages, that is a seed change, not a code change and
 * not a migration of every stored enquiry.
 *
 * `isDefault` marks the status a new enquiry starts in. `isTerminal` marks a
 * status that ends the workflow — the definitions of successful, unsuccessful and
 * closed outcomes are also unconfirmed (open question 6), so `isTerminal` is a
 * structural flag rather than an attempt to name those outcomes.
 */
export interface IEnquiryStatus {
  _id: Types.ObjectId;

  // domain
  code: string;
  label: string;
  displayOrder: number;
  isDefault: boolean;
  isTerminal: boolean;
  isSystem: boolean;

  // Marks a row as an unconfirmed placeholder, so the UI can label it honestly
  // and a seed can be replaced without guessing which rows were invented.
  isPlaceholder: boolean;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const EnquiryStatusSchema = new Schema<IEnquiryStatus>(
  {
    // domain
    code: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    displayOrder: { type: Number, default: 0 },

    isDefault: { type: Boolean, default: false },
    isTerminal: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    isPlaceholder: { type: Boolean, default: true },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

EnquiryStatusSchema.index({ code: 1 }, { unique: true, name: "enquirystatus_code_uq" });
EnquiryStatusSchema.index(
  { isActive: 1, isArchived: 1, displayOrder: 1 },
  { name: "enquirystatus_active_order_idx" },
);

// Partial unique index: at most ONE row may be the default. Enforced by the
// database rather than by convention, because "two default statuses" would make
// intake non-deterministic and would be hard to notice.
EnquiryStatusSchema.index(
  { isDefault: 1 },
  {
    unique: true,
    name: "enquirystatus_default_uq",
    partialFilterExpression: { isDefault: true },
  },
);

const EnquiryStatus =
  (mongoose.models.EnquiryStatus as Model<IEnquiryStatus>) ??
  mongoose.model<IEnquiryStatus>("EnquiryStatus", EnquiryStatusSchema);

export default EnquiryStatus;
