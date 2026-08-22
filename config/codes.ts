/**
 * Configuration codes — the stable identifiers business logic reads.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE SEED. The seed writes the rows; the
 * app reads them by code. If the codes lived in `scripts/seed/`, then app code
 * would import from a script — which inverts the dependency and would ship the
 * seed's row definitions into the client bundle.
 *
 * Codes are stable. LABELS ARE NOT: SCCT may rename anything here, and a rename
 * must be a data change to the row, never a code change. So business logic
 * compares codes, and nothing else — never a literal like "B.Sc IT" or
 * "Contacted", and never an ObjectId.
 */

// ─── The institute's clock ───────────────────────────────────────────────────

/**
 * The timezone every date in this system is interpreted and displayed in.
 *
 * WHY THIS IS CONFIGURATION AND NOT AN ACCIDENT. Vercel runs in UTC while SCCT
 * works in IST, five and a half hours apart. Left to the server's clock, a
 * follow-up due at 9pm IST would count as tomorrow, "overdue today" would change
 * meaning at 5:30am local, and the reporting figures would disagree with what staff
 * see on screen. Every "is this overdue", "is this due today" and every displayed
 * date resolves through these two values, so the answer is the same everywhere.
 *
 * THE FIXED OFFSET IS SAFE HERE SPECIFICALLY. Asia/Kolkata has no daylight saving
 * and has not changed offset since 1945, so `+05:30` is exact and a date library is
 * unnecessary. That is a fact about this timezone, not a general shortcut — pointing
 * this at a DST zone would be wrong twice a year, and the correct fix at that point
 * is a real date library rather than a second constant.
 */
export const INSTITUTE_TIMEZONE = "Asia/Kolkata";
export const INSTITUTE_UTC_OFFSET = "+05:30";

// ─── Permissions ─────────────────────────────────────────────────────────────
export const PERMISSION_CODES = {
  ENQUIRY_VIEW_OWN: "enquiry.view.own",
  ENQUIRY_VIEW_ALL: "enquiry.view.all",
  ENQUIRY_UPDATE_OWN: "enquiry.update.own",

  /**
   * Added in milestone 5b, when the write path made a gap in the original list
   * visible: `update.own` covers an enquiry you own, and nothing covered a manager
   * acting on somebody else's. Without this row a manager could SEE every enquiry
   * and change none of them, which is not a role anyone asked for.
   *
   * The alternative was to treat `view.all` as implying write access. Rejected:
   * "can read" quietly becoming "can write" is a bad principle to install in an
   * authorization layer, and it would have been invisible in the permission table
   * that is supposed to be the single description of who can do what.
   */
  ENQUIRY_UPDATE_ALL: "enquiry.update.all",
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

// ─── Roles ───────────────────────────────────────────────────────────────────
export const ROLE_CODES = {
  COUNSELLOR: "counsellor",
  MANAGER: "manager",
  ADMIN: "admin",
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

// ─── Programmes — CONFIRMED SCCT facts ───────────────────────────────────────
export const PROGRAMME_CODES = {
  BCOM: "BCOM",
  BCOM_MS: "BCOM_MS",
  BAF: "BAF",
  BBI: "BBI",
  BAMMC: "BAMMC",
  BSC_IT: "BSC_IT",
  BSC_CS: "BSC_CS",
} as const;

export type ProgrammeCode = (typeof PROGRAMME_CODES)[keyof typeof PROGRAMME_CODES];

// ─── Sources — two unreconciled taxonomies, seeded as reported ───────────────
export const SOURCE_CODES = {
  // route analysis
  WALK_IN: "WALK_IN",
  SOCIAL_MEDIA: "SOCIAL_MEDIA",
  IN_HOUSE_STUDENT: "IN_HOUSE_STUDENT",
  TEACHER_CALLING_PURCHASED_DATA: "TEACHER_CALLING_PURCHASED_DATA",
  WEBSITE: "WEBSITE",
  REFERENCE: "REFERENCE",
  UNIVERSITY_TAG_LIST: "UNIVERSITY_TAG_LIST",

  // source analysis
  GOOGLE_SEARCH: "GOOGLE_SEARCH",
  FRIENDS_FAMILY: "FRIENDS_FAMILY",
  SCHOOL_TEACHER: "SCHOOL_TEACHER",
  TRAIN_ADVERTISEMENT: "TRAIN_ADVERTISEMENT",
  OTHER: "OTHER",
  UNATTRIBUTED: "UNATTRIBUTED",
} as const;

export type SourceCode = (typeof SOURCE_CODES)[keyof typeof SOURCE_CODES];

/**
 * The source recorded for a public-form submission, forced server-side.
 *
 * The public surface never lets the submitter choose: a self-reported channel is
 * unreliable, and it feeds the one number leadership will act on. A submission
 * through this surface arrived through the website by definition.
 */
export const PUBLIC_FORM_SOURCE_CODE: SourceCode = SOURCE_CODES.WEBSITE;

// ─── Statuses — UNCONFIRMED PLACEHOLDERS (open question 1) ───────────────────
export const STATUS_CODES = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  IN_DISCUSSION: "IN_DISCUSSION",
  CLOSED_ENROLLED: "CLOSED_ENROLLED",
  CLOSED_NOT_PROCEEDING: "CLOSED_NOT_PROCEEDING",
} as const;

export type StatusCode = (typeof STATUS_CODES)[keyof typeof STATUS_CODES];

/**
 * The status every new enquiry starts in.
 *
 * Resolved from the row flagged `isDefault`, never from "the lowest displayOrder" —
 * the default must not move because someone reordered a dropdown. This constant
 * is what the seed marks as default, and what the tests assert against.
 */
export const DEFAULT_STATUS_CODE: StatusCode = STATUS_CODES.NEW;
