import type { Types } from "mongoose";

import {
  PERMISSION_CODES,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
} from "@/config/codes";
import { Role } from "@/models";

import type { PermissionIds } from "./permissions";
import { upsertByCode } from "./upsert";

/**
 * The three confirmed roles, and the permissions each holds.
 *
 * CUMULATIVE BY CONSTRUCTION. `manager` is spread from `counsellor`, `admin` from
 * `manager`. Written this way rather than as three independent lists so that
 * adding a counsellor permission cannot accidentally leave managers without it —
 * the bug class where a junior role can do something a senior role cannot.
 *
 * ROLE CODES ARE STABLE, LABELS ARE NOT. Business logic and permission checks
 * read codes. SCCT may rename "counsellor" to whatever their staff actually call
 * the job; that is a label change here and nothing else.
 */

const COUNSELLOR: PermissionCode[] = [
  PERMISSION_CODES.ENQUIRY_VIEW_OWN,
  PERMISSION_CODES.ENQUIRY_UPDATE_OWN,
  PERMISSION_CODES.ENQUIRY_NOTE_CREATE,
  PERMISSION_CODES.ENQUIRY_CAPTURE,
];

const MANAGER: PermissionCode[] = [
  ...COUNSELLOR,
  PERMISSION_CODES.ENQUIRY_VIEW_ALL,
  PERMISSION_CODES.ENQUIRY_UPDATE_ALL,
  PERMISSION_CODES.ENQUIRY_REASSIGN,
  PERMISSION_CODES.DUPLICATE_REVIEW,
  PERMISSION_CODES.REPORT_VIEW,
  PERMISSION_CODES.EXPORT_RUN,
];

const ADMIN: PermissionCode[] = [
  ...MANAGER,
  PERMISSION_CODES.STAFF_MANAGE,
  PERMISSION_CODES.CONFIG_MANAGE,
];


const ROLES: Array<{
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
}> = [
  {
    code: ROLE_CODES.COUNSELLOR,
    name: "Counsellor",
    description:
      "Owns and follows up the enquiries assigned to them. Cannot see other owners' enquiries or reporting.",
    permissions: COUNSELLOR,
  },
  {
    code: ROLE_CODES.MANAGER,
    name: "Manager",
    description:
      "Sees every enquiry, reassigns ownership, reviews duplicate flags, and reads reporting and exports.",
    permissions: MANAGER,
  },
  {
    code: ROLE_CODES.ADMIN,
    name: "Administrator",
    description:
      "Everything a manager can do, plus staff accounts and the programme, source and status configuration.",
    permissions: ADMIN,
  },
];

export type RoleIds = Map<RoleCode, Types.ObjectId>;

export async function seedRoles(permissionIds: PermissionIds) {
  const ids: RoleIds = new Map();
  let created = 0;

  for (const role of ROLES) {
    const permissions = role.permissions.map((code) => {
      const id = permissionIds.get(code);

      // A role referencing a permission that was never seeded would produce a
      // role that silently grants less than it claims. Fail loudly instead.
      if (!id) throw new Error(`Role "${role.code}" references unseeded permission "${code}"`);

      return id;
    });

    // `permissions` is in `$set`, on purpose: the seed owns what a system role
    // grants. If SCCT later confirms different access, editing this file and
    // re-running is the intended path — as opposed to leaving a stale grant in
    // place because the role row already existed.
    const { doc, outcome } = await upsertByCode(Role, role.code, {
      name: role.name,
      description: role.description,
      permissions,
    });

    if (outcome === "created") created += 1;
    ids.set(role.code, doc._id);
  }

  return { label: "roles", total: ROLES.length, created, ids };
}
