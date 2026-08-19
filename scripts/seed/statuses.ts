import type { Types } from "mongoose";

import {
  DEFAULT_STATUS_CODE,
  STATUS_CODES,
  type StatusCode,
} from "@/config/codes";
import { EnquiryStatus } from "@/models";

import { upsertByCode } from "./upsert";

/**
 * Enquiry statuses — EVERY ROW HERE IS A SYNTHETIC PLACEHOLDER.
 *
 * SCCT's actual enquiry stages are open question 1, and the definitions of a
 * successful, unsuccessful or closed outcome are open question 6. Neither is
 * confirmed. So these rows:
 *
 *   · carry `isPlaceholder: true`, which the UI reads to label them visibly;
 *   · use the plainest possible generic workflow, so nothing implies SCCT works
 *     this way today;
 *   · are ordered in tens, leaving room to insert real stages between them
 *     without renumbering.
 *
 * Presenting an invented workflow as confirmed SCCT process is a listed critical
 * failure. The system treats stages as data precisely so that SCCT's answer
 * replaces this list without a code change.
 *
 * `isTerminal` MATTERS TO LOGIC, not just to display: a terminal status is one
 * where an open follow-up no longer makes sense, so the follow-up service and the
 * "needs attention" reporting figure both read it. It is not a synonym for the
 * last row in the list.
 */



const STATUSES: Array<{
  code: StatusCode;
  label: string;
  description: string;
  displayOrder: number;
  isDefault: boolean;
  isTerminal: boolean;
}> = [
  {
    code: STATUS_CODES.NEW,
    label: "New",
    description: "Captured, not yet contacted. Every enquiry starts here.",
    displayOrder: 10,
    isDefault: true,
    isTerminal: false,
  },
  {
    code: STATUS_CODES.CONTACTED,
    label: "Contacted",
    description: "Someone has reached the prospective student at least once.",
    displayOrder: 20,
    isDefault: false,
    isTerminal: false,
  },
  {
    code: STATUS_CODES.IN_DISCUSSION,
    label: "In discussion",
    description: "An active conversation is under way, with follow-ups scheduled.",
    displayOrder: 30,
    isDefault: false,
    isTerminal: false,
  },
  {
    code: STATUS_CODES.CLOSED_ENROLLED,
    label: "Closed — enrolled",
    description:
      "PLACEHOLDER OUTCOME. SCCT has not confirmed what marks an enquiry successful, or whether this system should record enrolment at all.",
    displayOrder: 40,
    isDefault: false,
    isTerminal: true,
  },
  {
    code: STATUS_CODES.CLOSED_NOT_PROCEEDING,
    label: "Closed — not proceeding",
    description:
      "PLACEHOLDER OUTCOME. Covers uninterested, unreachable and lost-to-another-college, which SCCT may well want as separate outcomes.",
    displayOrder: 50,
    isDefault: false,
    isTerminal: true,
  },
];

export type StatusIds = Map<StatusCode, Types.ObjectId>;

export async function seedStatuses() {
  const ids: StatusIds = new Map();
  let created = 0;

  for (const status of STATUSES) {
    const { doc, outcome } = await upsertByCode(EnquiryStatus, status.code, {
      label: status.label,
      description: status.description,
      displayOrder: status.displayOrder,
      isDefault: status.isDefault,
      isTerminal: status.isTerminal,

      // In `$set`, not `$setOnInsert`: as long as a row is seeded by this file it
      // IS unconfirmed, and the flag must not be quietly droppable by editing the
      // row. It is cleared when SCCT confirms the stage, which is a deliberate act.
      isPlaceholder: true,
    });

    if (outcome === "created") created += 1;
    ids.set(status.code, doc._id);
  }

  // A missing or duplicated default would leave intake with no status to assign,
  // which the intake service cannot recover from. Cheaper to catch here.
  const defaults = STATUSES.filter((s) => s.isDefault);
  if (defaults.length !== 1) {
    throw new Error(
      `Exactly one status must be the default; this seed declares ${defaults.length}.`,
    );
  }

  return { label: "statuses", total: STATUSES.length, created, ids };
}
