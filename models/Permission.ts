import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * Permission — a single capability, stored as a row rather than an enum string.
 *
 * Why rows for what is currently three fixed roles: SCCT's final staff access
 * and permission requirements are unconfirmed (open question 10). Permissions as
 * rows means answering that question later is a data change, not a code change.
 *
 * Codes are dotted and read `<domain>.<thing>.<scope>`:
 *   enquiry.view.own   enquiry.view.all   enquiry.reassign
 *   report.view        export.run         staff.manage      config.manage
 */
export interface IPermission {
  _id: Types.ObjectId;

  // domain
  code: string;
  name: string;
  category: string;
  description?: string;
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

const PermissionSchema = new Schema<IPermission>(
  {
    // domain
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    // Seeded rows are isSystem: true and must not be editable through any UI.
    isSystem: { type: Boolean, default: false },

    // lifecycle
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    // audit — always ref the identity table, never the profile table
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

PermissionSchema.index({ code: 1 }, { unique: true, name: "permission_code_uq" });
PermissionSchema.index({ category: 1, isActive: 1 }, { name: "permission_category_active_idx" });

const Permission =
  (mongoose.models.Permission as Model<IPermission>) ??
  mongoose.model<IPermission>("Permission", PermissionSchema);

export default Permission;
