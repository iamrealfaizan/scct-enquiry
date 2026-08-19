import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * EnquirySource — how an enquiry reached SCCT.
 *
 * THIS TABLE ENCODES A REAL FINDING, NOT A GUESS.
 *
 * The pre-discovery material contains TWO CONFLICTING source taxonomies:
 *
 *   route analysis   — walk-ins, social media, in-house students, teacher calling
 *                      through purchased data, website, references, University
 *                      tag lists
 *   source analysis  — Google Search, friends/family, school/teacher, train
 *                      advertisements, other, blank/unattributed
 *
 * The taxonomy is therefore NOT NORMALISED, and which one is authoritative is
 * unconfirmed (open question 2).
 *
 * Rather than pick one, flatten them, or quietly invent a merged list, every row
 * may point at a canonical parent via `canonicalSource`:
 *
 *   canonicalSource === null  -> this row IS canonical
 *   canonicalSource === <id>  -> this row is an alias reported by SCCT that maps
 *                                to that canonical source
 *
 * So both taxonomies are seeded exactly as reported, `taxonomyGroup` records
 * which analysis each came from, and mapping happens as a DATA change once SCCT
 * confirms — no code change, and no historical enquiry loses the source value it
 * actually arrived with.
 *
 * Self-referencing ref is deliberate and is not the embedded-document case: a
 * source has its own identity and lifecycle.
 */
export interface IEnquirySource {
  _id: Types.ObjectId;

  // domain
  code: string;
  label: string;

  // null means this row is itself canonical
  canonicalSource: Types.ObjectId | null;

  taxonomyGroup: "route_analysis" | "source_analysis" | "canonical";
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

const EnquirySourceSchema = new Schema<IEnquirySource>(
  {
    // domain
    code: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },

    canonicalSource: {
      type: Schema.Types.ObjectId,
      ref: "EnquirySource",
      default: null,
    },

    // Which of the two conflicting analyses this row came from. Keeping this
    // visible is the point — it is the evidence for the finding.
    taxonomyGroup: {
      type: String,
      enum: ["route_analysis", "source_analysis", "canonical"],
      required: true,
    },

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

EnquirySourceSchema.index({ code: 1 }, { unique: true, name: "enquirysource_code_uq" });

// "show me everything that maps to this canonical source"
EnquirySourceSchema.index({ canonicalSource: 1 }, { name: "enquirysource_canonical_idx" });

EnquirySourceSchema.index(
  { taxonomyGroup: 1, isActive: 1 },
  { name: "enquirysource_taxonomy_active_idx" },
);

const EnquirySource =
  (mongoose.models.EnquirySource as Model<IEnquirySource>) ??
  mongoose.model<IEnquirySource>("EnquirySource", EnquirySourceSchema);

export default EnquirySource;
