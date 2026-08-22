import { z } from "zod";

/**
 * The staff queue's filter, sort and pagination parameters.
 *
 * WHY THE QUEUE'S STATE LIVES IN THE URL. Every filter is a query parameter, so a
 * filtered view is a link: it survives a refresh, it works with the back button,
 * and — the reason that matters for the brief — it makes "every number in the
 * management view links to the filtered queue that produced it" (conventions §12)
 * literally true rather than aspirational. A reporting figure can be a link to the
 * exact query that produced it, which is how the numbers are shown to trace back
 * to stored records.
 *
 * There is also a failure mode it removes entirely. Client-side filtering means
 * concurrent in-flight requests, and a slow response for "status=NEW" arriving
 * after a fast one for "status=CONTACTED" would render the wrong rows under the
 * right filter. With server rendering per navigation there is no second request to
 * race.
 *
 * EVERY PARAMETER IS OPTIONAL AND EVERY BAD VALUE FALLS BACK, rather than erroring.
 * A query string is user-editable and gets truncated by chat clients and email
 * software; a staff member following a mangled link should see the unfiltered queue,
 * not a validation page. `.catch()` per field does that — and it is confined to
 * READ parameters. Nothing here writes, so a silently-ignored bad filter cannot
 * corrupt anything; the same leniency on a write endpoint would be indefensible.
 *
 * CODES, NEVER ObjectIds, for programme / source / status — the same rule the
 * enquiry schemas follow. A caller who can pass a raw ObjectId can reference any
 * document; a code is resolved against a lookup table that must contain it.
 */

/** Owner filter. `me` and `unassigned` are keywords; anything else is a profile id. */
export const OWNER_KEYWORDS = ["any", "me", "unassigned"] as const;

/**
 * Follow-up state. These are derived at query time from `nextFollowUpAt`, never
 * stored — a stored "overdue" flag would be wrong the moment the clock moved past
 * midnight and nothing wrote to the row.
 */
export const FOLLOWUP_FILTERS = ["any", "overdue", "today", "week", "none"] as const;

/** `open` = has at least one duplicate link still awaiting review. */
export const DUPLICATE_FILTERS = ["any", "open"] as const;

export const QUEUE_SORTS = ["newest", "oldest", "followup", "name"] as const;

export type QueueSort = (typeof QUEUE_SORTS)[number];

/** 25 rows is a working page for a staff tool; 100 is the export-ish ceiling. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const objectIdish = /^[a-f\d]{24}$/i;

export const queueQuerySchema = z.object({
  /**
   * Free-text search over name, phone, email and enquiry number.
   *
   * Capped at 80 characters because it becomes a regular expression. The cap and
   * the escaping in `queue.service.ts` are two halves of one control: without
   * escaping, a `q` of `(((((` is a malformed pattern; without the cap, a long
   * pathological pattern is a cheap way to make the database work hard.
   */
  q: z.string().trim().max(80).optional().catch(undefined),

  status: z.string().trim().max(40).optional().catch(undefined),
  programme: z.string().trim().max(40).optional().catch(undefined),
  source: z.string().trim().max(40).optional().catch(undefined),

  /** `any` | `me` | `unassigned` | a StaffProfile id. */
  owner: z
    .string()
    .trim()
    .max(40)
    .refine(
      (v) => (OWNER_KEYWORDS as readonly string[]).includes(v) || objectIdish.test(v),
      "Unknown owner filter.",
    )
    .optional()
    .catch(undefined),

  followup: z.enum(FOLLOWUP_FILTERS).optional().catch(undefined),

  /**
   * `open` narrows to enquiries carrying an unreviewed duplicate flag.
   *
   * Added so the "possible duplicates" figure on the queue can link to the rows
   * behind it, like every other figure. A count that cannot be opened is a claim
   * rather than a fact, which is exactly what this system is meant to replace.
   */
  duplicates: z.enum(DUPLICATE_FILTERS).optional().catch(undefined),

  sort: z.enum(QUEUE_SORTS).default("newest").catch("newest"),

  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .catch(DEFAULT_LIMIT),
});

export type QueueQuery = z.output<typeof queueQuerySchema>;

/**
 * Parse Next's `searchParams` or a `URLSearchParams`.
 *
 * Next hands a repeated parameter over as an array. The first value wins rather
 * than the last, so `?status=NEW&status=CONTACTED` is deterministic instead of
 * depending on how a link was assembled.
 */
export function parseQueueQuery(
  input: Record<string, string | string[] | undefined> | URLSearchParams,
): QueueQuery {
  const raw: Record<string, string | undefined> =
    input instanceof URLSearchParams
      ? Object.fromEntries(input.entries())
      : Object.fromEntries(
          Object.entries(input).map(([key, value]) => [
            key,
            Array.isArray(value) ? value[0] : value,
          ]),
        );

  // Empty strings are dropped, not passed through: `?status=` comes from clearing a
  // dropdown and means "no filter", but it would otherwise be looked up as a status
  // whose code is the empty string and match nothing.
  for (const key of Object.keys(raw)) {
    if (raw[key] === "") delete raw[key];
  }

  // Cannot fail — every field either has a default or is optional with `.catch()`.
  return queueQuerySchema.parse(raw);
}

/**
 * Serialise a query back to a query string, for pagination and sort links.
 *
 * Defaults are omitted so the common URL stays short and readable, and so two
 * links to the same view are the same string.
 */
export function queueQueryToSearch(
  query: Partial<QueueQuery>,
  overrides: Partial<QueueQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.programme) params.set("programme", merged.programme);
  if (merged.source) params.set("source", merged.source);
  if (merged.owner && merged.owner !== "any") params.set("owner", merged.owner);
  if (merged.followup && merged.followup !== "any") params.set("followup", merged.followup);
  if (merged.duplicates && merged.duplicates !== "any")
    params.set("duplicates", merged.duplicates);
  if (merged.sort && merged.sort !== "newest") params.set("sort", merged.sort);
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  if (merged.limit && merged.limit !== DEFAULT_LIMIT) params.set("limit", String(merged.limit));

  const search = params.toString();
  return search ? `?${search}` : "";
}
