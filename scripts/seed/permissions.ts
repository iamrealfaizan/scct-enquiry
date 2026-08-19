import type { Types } from "mongoose";

import { Permission } from "@/models";

import { upsertByCode } from "./upsert";

/**
 * Permissions — rows, not enum strings (conventions §5.4).
 *
 * WHY ROWS FOR WHAT LOOKS LIKE A FIXED LIST. Final staff access and permission
 * requirements are open question 10, unconfirmed by SCCT. As rows, SCCT's answer
 * is a data change; as an enum in code it is a deployment.
 *
 * NAMING: `<resource>.<action>[.<scope>]`. The `.own` / `.all` scope suffix is
 * the part that carries weight — it is what lets a counsellor see their own
 * queue and a manager see everything, without a second permission system.
 */
export const PERMISSION_CODES = {
  ENQUIRY_VIEW_OWN: "enquiry.view.own",
  ENQUIRY_VIEW_ALL: "enquiry.view.all",
  ENQUIRY_UPDATE_OWN: "enquiry.update.own",
  ENQUIRY_NOTE_CREATE: "enquiry.note.create",
  ENQUIRY_REASSIGN: "enquiry.reassign",
  ENQUIRY_CAPTURE: "enquiry.capture",
  DUPLICATE_REVIEW: "duplicate.review",
  REPORT_VIEW: "report.view",
  EXPORT_RUN: "export.run",
  STAFF_MANAGE: "staff.manage",
  CONFIG_MANAGE: "config.manage",
} as const;

export type PermissionCode = (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES];

const PERMISSIONS: Array<{
  code: PermissionCode;
  name: string;
  category: string;
  description: string;
}> = [
  {
    code: PERMISSION_CODES.ENQUIRY_VIEW_OWN,
    name: "View own enquiries",
    category: "enquiry",
    description: "See enquiries where this staff member is the owner.",
  },
  {
    code: PERMISSION_CODES.ENQUIRY_VIEW_ALL,
    name: "View all enquiries",
    category: "enquiry",
    description: "See every enquiry, including unassigned ones and other owners'.",
  },
  {
    code: PERMISSION_CODES.ENQUIRY_UPDATE_OWN,
    name: "Update own enquiries",
    category: "enquiry",
    description: "Change status and next follow-up on an owned enquiry.",
  },
  {
    code: PERMISSION_CODES.ENQUIRY_NOTE_CREATE,
    name: "Add notes",
    category: "enquiry",
    description: "Append a note to an enquiry's history.",
  },
  {
    code: PERMISSION_CODES.ENQUIRY_REASSIGN,
    name: "Reassign ownership",
    category: "enquiry",
    description: "Move an enquiry to a different owner, or back to Unassigned.",
  },
  {
    code: PERMISSION_CODES.ENQUIRY_CAPTURE,
    name: "Capture an enquiry",
    category: "enquiry",
    description:
      "Key in an enquiry taken by phone, walk-in or a sourced list, through the staff surface.",
  },
  {
    code: PERMISSION_CODES.DUPLICATE_REVIEW,
    name: "Review duplicate flags",
    category: "enquiry",
    description:
      "Dismiss or confirm a possible-duplicate flag. Never merges or deletes a record.",
  },
  {
    code: PERMISSION_CODES.REPORT_VIEW,
    name: "View reporting",
    category: "reporting",
    description: "Open the management view: counts by programme, source, status, owner.",
  },
  {
    code: PERMISSION_CODES.EXPORT_RUN,
    name: "Run an export",
    category: "reporting",
    description: "Download the enquiry export. Recorded in each enquiry's history.",
  },
  {
    code: PERMISSION_CODES.STAFF_MANAGE,
    name: "Manage staff",
    category: "administration",
    description: "Create staff accounts and set assignment eligibility.",
  },
  {
    code: PERMISSION_CODES.CONFIG_MANAGE,
    name: "Manage configuration",
    category: "administration",
    description: "Maintain programmes, sources and enquiry statuses.",
  },
];

export type PermissionIds = Map<PermissionCode, Types.ObjectId>;

export async function seedPermissions() {
  const ids: PermissionIds = new Map();
  let created = 0;

  for (const permission of PERMISSIONS) {
    const { doc, outcome } = await upsertByCode(Permission, permission.code, {
      name: permission.name,
      category: permission.category,
      description: permission.description,
    });

    if (outcome === "created") created += 1;
    ids.set(permission.code, doc._id);
  }

  return { label: "permissions", total: PERMISSIONS.length, created, ids };
}
