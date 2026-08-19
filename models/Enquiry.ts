import mongoose, { Schema, type Model, type Types } from "mongoose";

import Sequence from "./Sequence";

/**
 * Enquiry — the record this entire system exists to protect.
 *
 * Notes on the fields that are not obvious:
 *
 * NORMALISED MATCH FIELDS. `phone`/`email` keep the value exactly as submitted,
 * because that is what staff will read back to the person. `phoneNormalised`/
 * `emailNormalised` are derived and exist ONLY for duplicate matching. Matching
 * on the raw value would miss "+91 98765 43210" against "9876543210".
 *
 * LABEL SNAPSHOTS. `programmeLabelAtCapture` and `sourceLabelAtCapture` duplicate
 * a label that is already reachable through the ref. This is the one deliberate
 * denormalisation for historical truth (conventions §5.2): rename a programme
 * next year and last year's records still read correctly. The ref remains the
 * source of identity; the snapshot is only ever displayed as history.
 *
 * OWNER IS NULLABLE. `owner: null` means Unassigned, which is a real and
 * expected state — round-robin falls back to it when no eligible staff exist,
 * rather than failing the submission or silently picking an ineligible owner.
 *
 * nextFollowUpAt IS A CACHE. The authoritative record of follow-ups is the
 * FollowUp collection. This field is maintained alongside it purely so the staff
 * queue can sort and filter "overdue" on one index instead of joining. It is
 * written only by the follow-up service, never by hand.
 *
 * CAPTURE CHANNEL vs SOURCE. These are different questions and conflating them
 * would corrupt every report: `source` is how the person came to SCCT (website,
 * walk-in, reference), `captureChannel` is who keyed the record in. A walk-in
 * typed by a teacher is source=walk_in, captureChannel=staff_capture.
 */
export interface IEnquiry {
  _id: Types.ObjectId;

  // identity
  enquiryNumber: string;

  // contact — as submitted
  fullName: string;
  phone: string;
  email?: string;

  // contact — derived, for duplicate matching only
  phoneNormalised: string;
  emailNormalised?: string;

  // classification
  programme: Types.ObjectId;
  programmeLabelAtCapture: string;
  source: Types.ObjectId;
  sourceLabelAtCapture: string;
  rawSourceValue?: string;

  // workflow
  status: Types.ObjectId;
  owner: Types.ObjectId | null;
  nextFollowUpAt: Date | null;

  // content
  message?: string;

  // qualification — UNCONFIRMED PLACEHOLDERS (open question 3)
  previousInstitution?: string;
  hscStream?: string;
  hscPercentageBand?: string;
  city?: string;

  // provenance
  captureChannel: "public_form" | "staff_capture";
  capturedBy: Types.ObjectId | null;
  consentBasis: "self_submitted" | "verbal_to_staff" | "sourced_list";
  idempotencyKey?: string;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const EnquirySchema = new Schema<IEnquiry>(
  {
    // ─── identity ──────────────────────────────────────────────────────────────
    // Human-readable and stable: ENQ-2026-000148. Assigned by the pre-save hook
    // below from an atomic sequence, never from a document count.
    enquiryNumber: { type: String, trim: true },

    // ─── contact, as submitted ─────────────────────────────────────────────────
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },

    // Optional on purpose. A walk-in or phone enquiry frequently has no email,
    // and requiring one would push staff into inventing values.
    email: { type: String, trim: true, lowercase: true },

    // ─── contact, derived for matching ─────────────────────────────────────────
    phoneNormalised: { type: String, required: true, trim: true },
    emailNormalised: { type: String, trim: true, lowercase: true },

    // ─── classification ────────────────────────────────────────────────────────
    programme: { type: Schema.Types.ObjectId, ref: "Programme", required: true },
    programmeLabelAtCapture: { type: String, required: true, trim: true },

    source: { type: Schema.Types.ObjectId, ref: "EnquirySource", required: true },
    sourceLabelAtCapture: { type: String, required: true, trim: true },

    // The source string exactly as it arrived from an external surface, before it
    // was mapped to a source row. Kept so a mapping decision is auditable and
    // reversible.
    rawSourceValue: { type: String, trim: true },

    // ─── workflow ──────────────────────────────────────────────────────────────
    status: { type: Schema.Types.ObjectId, ref: "EnquiryStatus", required: true },

    // null === Unassigned. A real state, not a missing value.
    owner: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },

    // Cache of the earliest open FollowUp.dueAt. See the note above.
    nextFollowUpAt: { type: Date, default: null },

    // ─── content ───────────────────────────────────────────────────────────────
    message: { type: String, trim: true },

    // ─── qualification ─────────────────────────────────────────────────────────
    // UNCONFIRMED PLACEHOLDERS. SCCT has not confirmed which qualification fields
    // are required (open question 3). All optional, none used in business logic,
    // and labelled as placeholders in the UI. `hscStream` is a plain string for
    // now; it becomes a lookup table if SCCT confirms it as a controlled value.
    previousInstitution: { type: String, trim: true },
    hscStream: { type: String, trim: true },
    hscPercentageBand: { type: String, trim: true },
    city: { type: String, trim: true },

    // ─── provenance ────────────────────────────────────────────────────────────
    captureChannel: {
      type: String,
      enum: ["public_form", "staff_capture"],
      required: true,
    },

    // null === submitted by the person themselves through the public form.
    capturedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // How consent to be contacted arose. Recorded because SCCT's routes include
    // teacher calling through purchased data and University tag lists, where the
    // person may never have expressed interest. Retention rules are open
    // question 9, and this field is what makes them answerable later.
    consentBasis: {
      type: String,
      enum: ["self_submitted", "verbal_to_staff", "sourced_list"],
      required: true,
    },

    // Client-supplied key that makes a retried submission safe. Unique + sparse:
    // a retry MUST collide, but a record without a key must not.
    idempotencyKey: { type: String, trim: true },

    // ─── lifecycle ─────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // ─── audit ─────────────────────────────────────────────────────────────────
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
EnquirySchema.index({ enquiryNumber: 1 }, { unique: true, name: "enquiry_number_uq" });

// UNIQUE + SPARSE, deliberately: a retried submission carrying a known key must
// collide so it can be resolved to the original record instead of creating a
// second one. Sparse so the many records without a key do not collide on null.
EnquirySchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: "enquiry_idempotency_uq" },
);

// The duplicate-rule indexes. NOT UNIQUE, and that is the whole point: the
// approved rule is that same phone + same programme is FLAGGED AND STORED, never
// rejected. A unique index here would enforce the opposite behaviour.
EnquirySchema.index(
  { phoneNormalised: 1, programme: 1 },
  { name: "enquiry_phone_programme_idx" },
);
EnquirySchema.index(
  { emailNormalised: 1, programme: 1 },
  { name: "enquiry_email_programme_idx" },
);

// "same person, any programme" — supports linking a person's several enquiries
// without a Person table.
EnquirySchema.index({ phoneNormalised: 1 }, { name: "enquiry_phone_idx" });

// The staff queue: filter by status and owner, sort by follow-up urgency.
EnquirySchema.index(
  { status: 1, owner: 1, nextFollowUpAt: 1 },
  { name: "enquiry_status_owner_followup_idx" },
);

// Unassigned-queue visibility, which the brief calls out explicitly.
EnquirySchema.index({ owner: 1, createdAt: -1 }, { name: "enquiry_owner_created_idx" });

// Default listing order, and reporting by programme and source.
EnquirySchema.index({ isArchived: 1, createdAt: -1 }, { name: "enquiry_archived_created_idx" });
EnquirySchema.index({ programme: 1, status: 1 }, { name: "enquiry_programme_status_idx" });
EnquirySchema.index({ source: 1, createdAt: -1 }, { name: "enquiry_source_created_idx" });

/**
 * Assign the human-readable enquiry number from an atomic sequence.
 *
 * The counter is keyed by year (`enquiry:2026`) so the serial restarts annually
 * and the number stays short and readable. `findOneAndUpdate` + `$inc` + `upsert`
 * is atomic at the document level, so two simultaneous submissions cannot receive
 * the same number — which `countDocuments() + 1` would do routinely under load.
 *
 * If this hook throws, the save fails and NO enquiry is stored. That is correct:
 * a record without a stable identifier is worse than a visible failure the
 * submitter can retry.
 */
EnquirySchema.pre("save", async function assignEnquiryNumber(next) {
  if (!this.isNew || this.enquiryNumber) return next();

  try {
    const year = new Date().getFullYear();

    const counter = await Sequence.findOneAndUpdate(
      { _id: `enquiry:${year}` },
      { $inc: { value: 1 } },
      { new: true, upsert: true },
    );

    this.enquiryNumber = `ENQ-${year}-${String(counter.value).padStart(6, "0")}`;
    return next();
  } catch (err) {
    return next(err as Error);
  }
});

const Enquiry =
  (mongoose.models.Enquiry as Model<IEnquiry>) ??
  mongoose.model<IEnquiry>("Enquiry", EnquirySchema);

export default Enquiry;
