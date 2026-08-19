import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * StaffProfile — the domain profile for a member of admissions staff, 1:1 with a
 * User login (conventions §5.3).
 *
 * Enquiry ownership refs THIS table, not User. Two flags decide who round-robin
 * may assign to, and they mean different things on purpose:
 *
 *   isActive              — is this person still working here at all?
 *   eligibleForAssignment — should NEW enquiries be routed to them?
 *
 * A counsellor on leave stays isActive but goes eligibleForAssignment: false, so
 * they keep their existing enquiries and history while new ones route elsewhere.
 * Collapsing these into one flag would force you to choose between losing their
 * back-catalogue and flooding them while they are away.
 *
 * Which staff may receive enquiries at all is open question 4 — unconfirmed.
 */
export interface IStaffProfile {
  _id: Types.ObjectId;

  // identity link
  user: Types.ObjectId;

  // domain
  firstName: string;
  lastName?: string;
  phone?: string;
  jobTitle?: string;
  eligibleForAssignment: boolean;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const StaffProfileSchema = new Schema<IStaffProfile>(
  {
    // identity link
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // domain
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    jobTitle: { type: String, trim: true },

    // See the note above on why this is separate from isActive.
    eligibleForAssignment: { type: Boolean, default: true },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// One profile per login. Unique, so a duplicate profile cannot silently create a
// second identity for the same person.
StaffProfileSchema.index({ user: 1 }, { unique: true, name: "staffprofile_user_uq" });

// The round-robin eligibility query, served entirely by this index.
StaffProfileSchema.index(
  { eligibleForAssignment: 1, isActive: 1, isArchived: 1 },
  { name: "staffprofile_eligible_active_idx" },
);

const StaffProfile =
  (mongoose.models.StaffProfile as Model<IStaffProfile>) ??
  mongoose.model<IStaffProfile>("StaffProfile", StaffProfileSchema);

export default StaffProfile;
