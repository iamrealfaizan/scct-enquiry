import bcrypt from "bcryptjs";
import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * User — IDENTITY ONLY.
 *
 * This table holds authentication and RBAC and nothing else. It carries zero
 * domain data: no job title, no phone, no assignment eligibility. Every domain
 * person is a separate table with a ref back here (conventions §5.3) — for
 * admissions staff, that is StaffProfile.
 *
 * Why the split matters here specifically: enquiry OWNERSHIP refs StaffProfile
 * (the person doing admissions work), while AUDIT fields ref User (the account
 * that acted). Those are genuinely different questions and would collide if
 * merged into one table.
 *
 * `password` is `select: false`, so it is never returned unless explicitly asked
 * for. To verify a login you must opt in:
 *
 *   const user = await User.findOne({ email }).select("+password");
 */
export interface IUser {
  _id: Types.ObjectId;

  // domain — identity only
  email: string;
  password: string;
  status: "active" | "inactive" | "suspended";
  roles: Types.ObjectId[];
  lastLoginAt?: Date;

  // lifecycle
  isActive: boolean;
  isArchived: boolean;

  // audit
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

type UserModel = Model<IUser, Record<string, never>, IUserMethods>;

const UserSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    // domain
    email: { type: String, required: true, trim: true, lowercase: true },

    // Never returned by default. See the note above.
    password: { type: String, required: true, select: false },

    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },

    roles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
    lastLoginAt: { type: Date },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true, name: "user_email_uq" });
UserSchema.index({ status: 1, isActive: 1 }, { name: "user_status_active_idx" });

/**
 * Hash on save, and only when the password actually changed — otherwise every
 * unrelated update (a status change, a lastLoginAt write) would re-hash the
 * already-hashed value and lock the user out of their own account.
 */
UserSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();

  try {
    this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
    return next();
  } catch (err) {
    return next(err as Error);
  }
});

UserSchema.methods.comparePassword = function comparePassword(candidate: string) {
  // Throws a clear error rather than silently comparing against undefined, which
  // bcrypt would treat as a plain mismatch and hide the real bug.
  if (!this.password) {
    throw new Error(
      "comparePassword called on a User loaded without the password field. " +
        'Use .select("+password").',
    );
  }
  return bcrypt.compare(candidate, this.password);
};

const User =
  (mongoose.models.User as UserModel) ?? mongoose.model<IUser, UserModel>("User", UserSchema);

export default User;
