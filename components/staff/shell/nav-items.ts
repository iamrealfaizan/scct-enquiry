import { PERMISSION_CODES, STATUS_CODES, type PermissionCode } from "@/config/codes";

/**
 * The staff navigation, as data.
 *
 * WHY EVERY ITEM IS JUST A QUEUE URL. "Unassigned" and "My follow-ups" are not
 * separate screens with separate queries — they are the queue with a filter
 * applied. Building them as pages would mean three copies of the same scoped
 * query and three places for the permission scope to be forgotten. As links they
 * inherit the queue's filtering, its scoping and its pagination for free, and the
 * URL a staff member ends up on is one they can paste to a colleague.
 *
 * `permission` GATES DISPLAY ONLY. Hiding a link is courtesy; the page and its
 * route handler check for themselves (conventions §10). A counsellor who types
 * `/staff/reporting` is stopped by the page, not by the absence of a link.
 */

export type NavItem = {
  label: string;
  href: string;
  /** Omitted means every signed-in staff member sees it. */
  permission?: PermissionCode;
  /** Rendered but not clickable, with the reason shown. */
  comingSoon?: boolean;
  /** Which pathname prefix marks this item active. */
  match: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Enquiry queue",
    href: "/staff",
    match: "/staff",
    permission: PERMISSION_CODES.ENQUIRY_VIEW_OWN,
  },
  {
    label: "Unassigned",
    href: "/staff?owner=unassigned",
    match: "/staff",
    permission: PERMISSION_CODES.ENQUIRY_VIEW_OWN,
  },
  {
    label: "My follow-ups",
    href: "/staff?owner=me&followup=week&sort=followup",
    match: "/staff",
    permission: PERMISSION_CODES.ENQUIRY_UPDATE_OWN,
  },
  {
    label: "Overdue",
    href: "/staff?followup=overdue&sort=followup",
    match: "/staff",
    permission: PERMISSION_CODES.ENQUIRY_VIEW_OWN,
  },
  {
    label: "New this week",
    href: `/staff?status=${STATUS_CODES.NEW}&sort=newest`,
    match: "/staff",
    permission: PERMISSION_CODES.ENQUIRY_VIEW_OWN,
  },
  {
    label: "Reporting",
    href: "/staff/reporting",
    match: "/staff/reporting",
    permission: PERMISSION_CODES.REPORT_VIEW,
    // Shown greyed rather than hidden. A manager should be able to see that
    // reporting is a planned part of the system, not wonder whether their account
    // is missing something.
    comingSoon: true,
  },
  {
    label: "My access",
    href: "/staff/session",
    match: "/staff/session",
  },
];
