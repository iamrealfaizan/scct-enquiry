import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * Programme — a course a prospective student can enquire about.
 *
 * CONFIRMED SCCT FACT: the seven Degree College programmes are B.Com,
 * B.Com (MS), BAF, BBI, BAMMC, B.Sc IT and B.Sc CS. These are seeded with
 * isSystem: true.
 *
 * A lookup table rather than an enum because the list grows, and because the
 * duplicate rule keys on programme — "same phone + same programme is a possible
 * duplicate, same phone + different programme is a legitimate separate enquiry"
 * — so programme needs stable identity, not a string that can be typed two ways.
 *
 * `stream` (NEP / Non-NEP) is UNCONFIRMED. It is modelled as an enum, not a
 * lookup table, because it is set by university regulation rather than by a user
 * — the closed-set case (conventions §5.8). If SCCT confirms further streams or
 * wants to edit them, it becomes a ProgrammeStream lookup table and this field
 * becomes a ref. That migration touches this file and the seed only.
 */
export interface IProgramme {
  _id: Types.ObjectId;

  // domain
  code: string;
  name: string;
  shortName?: string;
  stream?: "NEP" | "NON_NEP";
  displayOrder: number;
  isSystem: boolean;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const ProgrammeSchema = new Schema<IProgramme>(
  {
    // domain
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, trim: true },

    // UNCONFIRMED — observed as distinct streams on scct.edu.in, not confirmed by
    // SCCT. Optional on purpose: an enquiry captured before this is confirmed
    // must not be forced to claim a stream it does not know.
    stream: { type: String, enum: ["NEP", "NON_NEP"] },

    displayOrder: { type: Number, default: 0 },
    isSystem: { type: Boolean, default: false },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ProgrammeSchema.index({ code: 1 }, { unique: true, name: "programme_code_uq" });
ProgrammeSchema.index(
  { isActive: 1, isArchived: 1, displayOrder: 1 },
  { name: "programme_active_order_idx" },
);

const Programme =
  (mongoose.models.Programme as Model<IProgramme>) ??
  mongoose.model<IProgramme>("Programme", ProgrammeSchema);

export default Programme;
