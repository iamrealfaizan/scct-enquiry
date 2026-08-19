import mongoose, { Schema, type Model, type Types } from "mongoose";

/**
 * Role — the middle table of the RBAC chain.
 *
 *   User.roles[] -> Role.permissions[] -> Permission
 *
 * `permissions` stays a plain array of refs rather than a junction table because
 * the relationship carries no payload of its own (conventions §5.7). If a role's
 * grant ever needs its own data — an expiry, a scope, who granted it — this
 * becomes a RolePermission junction.
 *
 * Seeded roles: counsellor, manager, admin.
 */
export interface IRole {
  _id: Types.ObjectId;

  // domain
  code: string;
  name: string;
  description?: string;
  permissions: Types.ObjectId[];
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

const RoleSchema = new Schema<IRole>(
  {
    // domain
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    permissions: [{ type: Schema.Types.ObjectId, ref: "Permission" }],
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

RoleSchema.index({ code: 1 }, { unique: true, name: "role_code_uq" });
RoleSchema.index({ isActive: 1, isArchived: 1 }, { name: "role_active_archived_idx" });

const Role =
  (mongoose.models.Role as Model<IRole>) ?? mongoose.model<IRole>("Role", RoleSchema);

export default Role;
