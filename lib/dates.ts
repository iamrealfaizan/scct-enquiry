import { INSTITUTE_TIMEZONE, INSTITUTE_UTC_OFFSET } from "@/config/codes";

/**
 * Every date boundary and every displayed date in the system, resolved through the
 * institute's timezone.
 *
 * WHY THIS FILE EXISTS. The server runs in UTC on Vercel; SCCT works in IST. Without
 * one place that owns the conversion, "due today" means one thing in the queue query
 * and another in the reporting figure, and a date rendered on the server disagrees
 * with the one a staff member is reading off their phone. Both are the kind of bug
 * that gets explained away as a rounding quirk for months.
 *
 * See `INSTITUTE_TIMEZONE` in config/codes.ts for why a fixed offset is exact for
 * Asia/Kolkata and would not be for a timezone with daylight saving.
 */

/**
 * The calendar date in the institute's timezone, as `YYYY-MM-DD`.
 *
 * `en-CA` because its short date format IS ISO order — the alternative is
 * assembling the parts by hand from `formatToParts`, which is more code for the
 * same string.
 */
function instituteDateParts(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: INSTITUTE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The last instant of `at`'s day, in the institute's timezone. */
export function endOfInstituteDay(at: Date): Date {
  return new Date(`${instituteDateParts(at)}T23:59:59.999${INSTITUTE_UTC_OFFSET}`);
}

/** The first instant of `at`'s day, in the institute's timezone. */
export function startOfInstituteDay(at: Date): Date {
  return new Date(`${instituteDateParts(at)}T00:00:00.000${INSTITUTE_UTC_OFFSET}`);
}

/**
 * The last instant of the day `days` from now, in the institute's timezone.
 *
 * Deliberately built by moving the CALENDAR DATE rather than adding milliseconds:
 * adding `7 × 24h` to a timestamp lands at the same clock time seven days later,
 * which is not the end of that day and would quietly exclude follow-ups due in the
 * evening of the seventh day.
 */
export function endOfInstituteDayIn(at: Date, days: number): Date {
  const shifted = new Date(at);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return endOfInstituteDay(shifted);
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: INSTITUTE_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: INSTITUTE_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * Formatted for display. Takes the ISO strings the services return.
 *
 * FORMATTED ON THE SERVER, IN A FIXED LOCALE AND TIMEZONE. Letting the browser
 * format would make the rendered output depend on the viewer's machine, which
 * causes a hydration mismatch and — worse for this system — means two staff members
 * comparing screens can see different dates for the same follow-up.
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return dateTimeFormatter.format(new Date(iso));
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return dateFormatter.format(new Date(iso));
}

/**
 * "3 days ago" / "in 2 days", for the follow-up column and the history timeline.
 *
 * Rounded to whole days and given a genuine "today" case, because a follow-up due
 * in eleven hours reading as "in 0 days" is worse than useless.
 */
export function formatRelativeDays(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";

  const target = new Date(iso);
  const startOfTargetDay = startOfInstituteDay(target).getTime();
  const startOfToday = startOfInstituteDay(now).getTime();

  const days = Math.round((startOfTargetDay - startOfToday) / 86_400_000);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}
