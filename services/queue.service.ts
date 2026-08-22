import mongoose, { type PipelineStage, type Types } from "mongoose";

import type { Principal } from "@/lib/auth";
import { endOfInstituteDay, endOfInstituteDayIn } from "@/lib/dates";
import { normalisePhone } from "@/lib/normalise";
import { ERROR_CODES, fail, fromError, ok, type Result } from "@/lib/result";
import {
  Enquiry,
  EnquiryDuplicate,
  EnquiryEvent,
  EnquirySource,
  EnquiryStatus,
  FollowUp,
  Programme,
} from "@/models";
import { PERMISSION_CODES } from "@/config/codes";
import type { QueueQuery } from "@/schemas/queue.schema";

/**
 * THE STAFF READ MODEL — the enquiry queue and one enquiry's detail.
 *
 * This file only reads. Nothing here writes, and that is worth stating because the
 * queue is the surface staff spend their day on: a read path that can mutate is how
 * an accidental overwrite happens.
 *
 * ─── VISIBILITY IS ENFORCED HERE, NOT IN THE UI ────────────────────────────────
 *
 * Every query is built from a scope derived from the caller's permissions, and the
 * scope is combined with the user's filters using `$and` — so a filter can only
 * ever NARROW what a caller sees, never widen it. A counsellor who edits the URL to
 * `?owner=<someone else's id>` gets an empty page, not somebody else's enquiries.
 *
 * That structure is the security property. The alternative — applying the scope
 * only when no owner filter is present — is one forgotten branch away from a data
 * leak, and it would be invisible in testing because the happy path looks correct.
 *
 * ─── WHY COUNSELLORS SEE UNASSIGNED ENQUIRIES ──────────────────────────────────
 *
 * `enquiry.view.own` read strictly means `owner = me`, which would make an enquiry
 * that fell to the `Unassigned` fallback invisible to every counsellor — visible
 * only to managers, while the people who actually make the calls cannot find it.
 * Round-robin falls back to Unassigned by design when nobody is eligible, so that
 * state is expected, not exceptional, and something has to surface it.
 *
 * So the rule implemented here is: **a counsellor sees their own enquiries plus the
 * unassigned pool.** It is a documented product decision, not a reinterpretation of
 * the permission, and it is deliberately conservative — a counsellor still cannot
 * see another counsellor's enquiries.
 *
 * OPEN QUESTION FOR SCCT (added to the README's list): may a counsellor claim an
 * unassigned enquiry themselves, or must a manager assign it? If the answer is
 * "manager only", this rule stays as it is and only the write path changes. If the
 * answer is "counsellors should not see the unassigned pool at all", this becomes
 * an `enquiry.view.unassigned` permission row and the scope reads it.
 */

// ─── Shapes returned to the UI ───────────────────────────────────────────────

/** Derived at query time from `nextFollowUpAt`. Never stored — see below. */
export type FollowUpState = "none" | "overdue" | "today" | "upcoming";

export type QueueRow = {
  id: string;
  enquiryNumber: string;
  fullName: string;
  phone: string;
  email: string | null;

  /** The snapshots taken at capture, so a later rename cannot rewrite history. */
  programmeLabel: string;
  sourceLabel: string;

  statusCode: string;
  statusLabel: string;
  statusIsTerminal: boolean;
  statusIsPlaceholder: boolean;

  ownerName: string | null;

  nextFollowUpAt: string | null;
  followUpState: FollowUpState;

  /** Open (still `flagged`) duplicate links touching this enquiry, either way round. */
  openDuplicateFlags: number;

  createdAt: string;
};

export type QueuePage = {
  rows: QueueRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;

  /** What the caller was allowed to see, so the UI can say so honestly. */
  scope: "all" | "own_and_unassigned" | "unassigned_only";
};

// ─── Visibility ──────────────────────────────────────────────────────────────

export type Scope = { filter: Record<string, unknown>; label: QueuePage["scope"] };

/**
 * The caller's visibility, as a Mongo filter fragment.
 *
 * The `unassigned_only` case is real rather than theoretical: an account with no
 * StaffProfile (an administrator, say) has no id that `Enquiry.owner` could match,
 * because ownership refs StaffProfile and not User. Returning `owner: null` for
 * them is honest — they can see the unassigned pool and nothing else — where
 * matching their User id against an owner field would silently match nothing and
 * read as "there are no enquiries".
 */
export function visibilityScope(principal: Principal): Scope {
  if (principal.permissions.includes(PERMISSION_CODES.ENQUIRY_VIEW_ALL)) {
    return { filter: {}, label: "all" };
  }

  if (!principal.staffProfileId) {
    return { filter: { owner: null }, label: "unassigned_only" };
  }

  return {
    filter: {
      $or: [
        { owner: new mongoose.Types.ObjectId(principal.staffProfileId) },
        { owner: null },
      ],
    },
    label: "own_and_unassigned",
  };
}

// ─── The queue ───────────────────────────────────────────────────────────────

/**
 * A date far enough in the future that nothing real sorts after it, used to push
 * "no follow-up scheduled" to the end of a follow-up-urgency sort.
 *
 * WHY THIS EXISTS. Mongo sorts `null` BEFORE any date ascending, so a plain
 * `sort({ nextFollowUpAt: 1 })` would put every enquiry with no follow-up at the
 * top of a list whose entire purpose is "what is most urgent". The alternatives
 * were worse: excluding those rows hides records (the failure class this project is
 * graded on), and storing a sentinel date instead of null would put a fake
 * follow-up date on a record that has none.
 *
 * The cost is that this one sort is computed rather than served by the
 * `enquiry_status_owner_followup_idx` index. Acceptable at SCCT's scale — a few
 * thousand enquiries a year — and the honest fix before it matters is a partial
 * index, recorded in the handoff note.
 */
const FOLLOW_UP_SORT_SENTINEL = new Date("9999-12-31T00:00:00.000Z");

const SORTS: Record<QueueQuery["sort"], Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  followup: { followUpRank: 1, createdAt: -1 },
  name: { fullName: 1 },
};

export async function listEnquiries(
  principal: Principal,
  query: QueueQuery,
  now: Date = new Date(),
): Promise<Result<QueuePage>> {
  try {
    const scope = visibilityScope(principal);
    const filters = await buildFilters(principal, query, now);

    if (!filters.ok) return filters;

    // `$and`, so a filter can only narrow the scope. See the note at the top.
    const clauses = [scope.filter, ...filters.data].filter(
      (clause) => Object.keys(clause).length > 0,
    );

    const match: Record<string, unknown> = {
      isArchived: false,
      ...(clauses.length > 0 ? { $and: clauses } : {}),
    };

    const skip = (query.page - 1) * query.limit;

    /**
     * ONE round trip for the page and the count, via `$facet`.
     *
     * Two separate queries would be simpler to read, but they can disagree: an
     * enquiry arriving between the count and the page makes `total` and the rows
     * describe different states of the database, which shows up as a pagination
     * control that is off by one for no visible reason. `$facet` computes both from
     * one pass over the same match.
     */
    const pipeline: PipelineStage[] = [
      { $match: match },
      { $addFields: { followUpRank: { $ifNull: ["$nextFollowUpAt", FOLLOW_UP_SORT_SENTINEL] } } },
      { $sort: SORTS[query.sort] },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: query.limit }],
          total: [{ $count: "value" }],
        },
      },
    ];

    const [facet] = (await Enquiry.aggregate(pipeline)) as Array<{
      rows: Array<Record<string, unknown>>;
      total: Array<{ value: number }>;
    }>;

    const total = facet?.total[0]?.value ?? 0;
    const raw = facet?.rows ?? [];

    /**
     * `Model.populate` on plain aggregation results.
     *
     * Aggregation does not run `ref` population, and the alternative — three
     * `$lookup` stages — would triple the length of the pipeline above for data
     * Mongoose can resolve from the refs it already knows about. Programme and
     * source are NOT populated at all, because the label snapshots on the document
     * are what should be displayed (conventions §5.2).
     */
    const populated = (await Enquiry.populate(raw, [
      { path: "status", select: "code label isTerminal isPlaceholder" },
      { path: "owner", select: "firstName lastName" },
    ])) as unknown as PopulatedEnquiry[];

    const duplicateCounts = await openDuplicateCounts(
      populated.map((enquiry) => enquiry._id),
    );

    return ok({
      rows: populated.map((enquiry) => toQueueRow(enquiry, duplicateCounts, now)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      scope: scope.label,
    });
  } catch (err) {
    return fromError(err);
  }
}

// ─── Counts, for the stat strip ──────────────────────────────────────────────

export type QueueCounts = {
  total: number;
  new: number;
  overdue: number;
  unassigned: number;
  duplicates: number;
};

/**
 * The five headline counts, scoped to what this caller may see.
 *
 * SCOPED THROUGH THE SAME `visibilityScope()` THE LIST USES. That is the whole
 * point: a counsellor's "12 overdue" must mean twelve enquiries they can actually
 * open, not twelve in the college. A count computed on a different filter from the
 * list it sits above is a number that cannot be checked, and the brief asks for
 * figures that trace back to stored records.
 *
 * EACH COUNT CORRESPONDS EXACTLY TO ONE QUEUE URL, so every tile can link to the
 * filtered list that produced it. The tests assert that equality rather than
 * trusting it, because the two code paths could drift.
 *
 * ONE `$facet`, NOT FIVE QUERIES. Five round trips to an M0 cluster for five
 * numbers on one page load is the kind of thing that makes a live demo feel slow,
 * and they could disagree with each other if a record arrived between them.
 */
export async function queueCounts(
  principal: Principal,
  now: Date = new Date(),
): Promise<Result<QueueCounts>> {
  try {
    const scope = visibilityScope(principal).filter;

    const base: Record<string, unknown> = {
      isArchived: false,
      ...(Object.keys(scope).length > 0 ? { $and: [scope] } : {}),
    };

    // Resolved by code, not assumed to be the first row: the default stage is
    // whatever SCCT's configuration says it is.
    const newStatus = await EnquiryStatus.findOne({ isDefault: true }).select("_id").lean();

    const [facet] = (await Enquiry.aggregate([
      { $match: base },
      {
        $facet: {
          total: [{ $count: "value" }],
          new: newStatus
            ? [{ $match: { status: newStatus._id } }, { $count: "value" }]
            : [{ $match: { _id: null } }, { $count: "value" }],
          overdue: [
            { $match: { nextFollowUpAt: { $ne: null, $lt: now } } },
            { $count: "value" },
          ],
          unassigned: [{ $match: { owner: null } }, { $count: "value" }],
        },
      },
    ])) as Array<Record<string, Array<{ value: number }>>>;

    /**
     * Duplicates are counted separately, and cannot be folded into the `$facet`
     * above: the flags live in another collection, and an enquiry with two flags
     * must count once. So the ids in scope are intersected with the flagged pairs
     * — the same both-directions logic the list uses.
     */
    const inScope = await Enquiry.find(base).select("_id").lean();
    const duplicateCounts = await openDuplicateCounts(inScope.map((e) => e._id));

    return ok({
      total: facet?.total[0]?.value ?? 0,
      new: facet?.new[0]?.value ?? 0,
      overdue: facet?.overdue[0]?.value ?? 0,
      unassigned: facet?.unassigned[0]?.value ?? 0,
      duplicates: duplicateCounts.size,
    });
  } catch (err) {
    return fromError(err);
  }
}

/**
 * Turn the query's codes into filter fragments.
 *
 * AN UNKNOWN CODE IS AN ERROR, not an empty result — and this is the one place the
 * schema's lenient `.catch()` behaviour deliberately stops. A malformed parameter
 * (`page=banana`) is a mangled link and falls back silently. A well-formed code
 * that does not exist (`status=CONTACTEDD`) means the caller believes they are
 * looking at a filtered view that the system cannot produce, and showing them an
 * empty queue would let them conclude "there are no enquiries in that stage". That
 * is a wrong answer presented as a fact, which is worse than an error.
 */
async function buildFilters(
  principal: Principal,
  query: QueueQuery,
  now: Date,
): Promise<Result<Array<Record<string, unknown>>>> {
  const clauses: Array<Record<string, unknown>> = [];

  if (query.status) {
    const status = await EnquiryStatus.findOne({ code: query.status }).select("_id").lean();
    if (!status) {
      return fail(ERROR_CODES.VALIDATION_FAILED, `Unknown status filter "${query.status}".`);
    }
    clauses.push({ status: status._id });
  }

  if (query.programme) {
    const programme = await Programme.findOne({ code: query.programme }).select("_id").lean();
    if (!programme) {
      return fail(
        ERROR_CODES.VALIDATION_FAILED,
        `Unknown programme filter "${query.programme}".`,
      );
    }
    clauses.push({ programme: programme._id });
  }

  if (query.source) {
    const source = await EnquirySource.findOne({ code: query.source }).select("_id").lean();
    if (!source) {
      return fail(ERROR_CODES.VALIDATION_FAILED, `Unknown source filter "${query.source}".`);
    }
    clauses.push({ source: source._id });
  }

  // Owner. `me` resolves to the caller's StaffProfile — never their User id, which
  // is a different collection and would match nothing.
  if (query.owner && query.owner !== "any") {
    if (query.owner === "unassigned") {
      clauses.push({ owner: null });
    } else if (query.owner === "me") {
      // An account with no staff profile cannot own anything, so "mine" is
      // genuinely empty rather than an error.
      clauses.push(
        principal.staffProfileId
          ? { owner: new mongoose.Types.ObjectId(principal.staffProfileId) }
          : { _id: null },
      );
    } else {
      clauses.push({ owner: new mongoose.Types.ObjectId(query.owner) });
    }
  }

  if (query.followup && query.followup !== "any") {
    clauses.push(followUpClause(query.followup, now));
  }

  /**
   * Duplicate flags live in another collection, so this resolves to a list of ids.
   *
   * Two queries rather than a `$lookup`: the flagged set is small — it is the
   * exception, not the rule — and an id list keeps the main query a plain `find`
   * that the existing indexes still serve. If flagged pairs ever became a large
   * fraction of the collection this would need revisiting, and that is worth
   * knowing rather than discovering.
   */
  if (query.duplicates === "open") {
    const links = await EnquiryDuplicate.find({ reviewStatus: "flagged", isArchived: false })
      .select("enquiry duplicateOf")
      .lean();

    // Both sides of each pair, because either record may be the one a staff member
    // is looking for — the same rule the badge count uses.
    const ids = links.flatMap((link) => [link.enquiry, link.duplicateOf]);

    // An empty list must match nothing. Without this, `$in: []` is correct but a
    // missing clause would silently widen the query to everything.
    clauses.push({ _id: { $in: ids } });
  }

  if (query.q) {
    clauses.push(searchClause(query.q));
  }

  return ok(clauses);
}

/**
 * Follow-up windows, computed from the clock at query time.
 *
 * NOTHING IS STORED. A stored `isOverdue` flag is wrong from the moment the clock
 * passes the due date until something happens to write to the row — and the rows
 * nobody touches are exactly the overdue ones, so the flag would be least reliable
 * precisely where it matters most.
 *
 * "Today" and "this week" are boundaries in the INSTITUTE's timezone, not the
 * server's. Vercel runs in UTC and SCCT works in IST: using the server's clock
 * would make a follow-up due at 9pm IST count as tomorrow, and would move the
 * meaning of "overdue today" at 5:30am local. `lib/dates.ts` owns the conversion so
 * the queue query, the reporting figures and the dates on screen cannot disagree.
 */
function followUpClause(
  followup: NonNullable<QueueQuery["followup"]>,
  now: Date,
): Record<string, unknown> {
  const endOfToday = endOfInstituteDay(now);
  const endOfWeek = endOfInstituteDayIn(now, 7);

  switch (followup) {
    case "overdue":
      return { nextFollowUpAt: { $ne: null, $lt: now } };
    case "today":
      return { nextFollowUpAt: { $ne: null, $lte: endOfToday } };
    case "week":
      return { nextFollowUpAt: { $ne: null, $lte: endOfWeek } };
    case "none":
      return { nextFollowUpAt: null };
    case "any":
      // The caller already skips this value; the case exists so the switch is
      // exhaustive over the union. An added filter option then becomes a compile
      // error here rather than a silently ignored parameter.
      return {};
  }
}

/**
 * Free-text search across the four things staff actually search by.
 *
 * THE REGEX IS ESCAPED. `q` reaches the database as a pattern, so an unescaped `.`
 * would match any character and an unescaped `(` would be a malformed pattern that
 * throws. Escaping plus the schema's 80-character cap are two halves of one
 * control.
 *
 * PHONE SEARCH RUNS AGAINST `phoneNormalised`, not `phone`. Someone typing
 * "9876543210" must find a record stored as "+91 98765 43210" — which is the same
 * reason the normalised field exists for duplicate matching.
 *
 * STATED LIMITATION: a `$regex` that is not anchored to the start of the value
 * cannot use an index, so this is a collection scan within the caller's scope. That
 * is fine for SCCT's volume and would not be fine at ten times it; the fix is a
 * text index or Atlas Search, and it is in the handoff note rather than pretended
 * away.
 */
function searchClause(q: string): Record<string, unknown> {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");

  const clauses: Array<Record<string, unknown>> = [
    { fullName: pattern },
    { enquiryNumber: pattern },
    { emailNormalised: pattern },
  ];

  // Only worth adding when the term contains digits — otherwise it is a name and
  // the normalised phone is guaranteed not to match.
  const digits = normalisePhone(q);
  if (digits.length >= 3) {
    clauses.push({ phoneNormalised: new RegExp(digits.replace(/\D/g, ""), "i") });
  }

  return { $or: clauses };
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

type PopulatedEnquiry = {
  _id: Types.ObjectId;
  enquiryNumber: string;
  fullName: string;
  phone: string;
  email?: string;
  programmeLabelAtCapture: string;
  sourceLabelAtCapture: string;
  status: { code: string; label: string; isTerminal: boolean; isPlaceholder: boolean } | null;
  owner: { firstName: string; lastName?: string } | null;
  nextFollowUpAt: Date | null;
  createdAt: Date;
};

/**
 * Open duplicate flags per enquiry, in one query for the whole page.
 *
 * Counted in BOTH directions: either enquiry of a flagged pair may be the one on
 * screen, and a staff member looking at the earlier record needs to know a later
 * one may duplicate it just as much as the other way round.
 *
 * Only `flagged` rows count. A dismissed flag is a decision someone made, and
 * showing it as an open warning forever is how staff learn to ignore the badge.
 */
async function openDuplicateCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;

  const links = await EnquiryDuplicate.find({
    reviewStatus: "flagged",
    isArchived: false,
    $or: [{ enquiry: { $in: ids } }, { duplicateOf: { $in: ids } }],
  })
    .select("enquiry duplicateOf")
    .lean();

  const onPage = new Set(ids.map(String));

  for (const link of links) {
    for (const side of [link.enquiry, link.duplicateOf]) {
      const key = String(side);
      if (onPage.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return counts;
}

export function followUpState(nextFollowUpAt: Date | null, now: Date): FollowUpState {
  if (!nextFollowUpAt) return "none";
  if (nextFollowUpAt < now) return "overdue";

  // Same institute-timezone boundary the "today" FILTER uses, so a row badged
  // "today" is exactly a row that filter returns. Two nearly-identical date
  // calculations in two files is how those two answers drift apart.
  return nextFollowUpAt <= endOfInstituteDay(now) ? "today" : "upcoming";
}

function toQueueRow(
  enquiry: PopulatedEnquiry,
  duplicateCounts: Map<string, number>,
  now: Date,
): QueueRow {
  return {
    id: String(enquiry._id),
    enquiryNumber: enquiry.enquiryNumber,
    fullName: enquiry.fullName,
    phone: enquiry.phone,
    email: enquiry.email ?? null,

    programmeLabel: enquiry.programmeLabelAtCapture,
    sourceLabel: enquiry.sourceLabelAtCapture,

    // A missing status is a configuration failure, not a blank cell. Saying so is
    // more useful than rendering an empty column nobody can explain.
    statusCode: enquiry.status?.code ?? "UNKNOWN",
    statusLabel: enquiry.status?.label ?? "Unknown status",
    statusIsTerminal: enquiry.status?.isTerminal ?? false,
    statusIsPlaceholder: enquiry.status?.isPlaceholder ?? false,

    ownerName: enquiry.owner
      ? `${enquiry.owner.firstName} ${enquiry.owner.lastName ?? ""}`.trim()
      : null,

    // ISO strings, not Dates: these cross the server/client boundary into a client
    // component, and formatting is the UI's job.
    nextFollowUpAt: enquiry.nextFollowUpAt ? enquiry.nextFollowUpAt.toISOString() : null,
    followUpState: followUpState(enquiry.nextFollowUpAt, now),

    openDuplicateFlags: duplicateCounts.get(String(enquiry._id)) ?? 0,

    createdAt: enquiry.createdAt.toISOString(),
  };
}

// ─── One enquiry ─────────────────────────────────────────────────────────────

export type HistoryEntry = {
  id: string;
  type: string;
  at: string;
  actor: string;
  statusLabelAtEvent: string | null;
  fromOwnerName: string | null;
  toOwnerName: string | null;
  note: string | null;
  detail: string | null;
};

export type DuplicateLink = {
  id: string;
  /** The OTHER enquiry in the pair — never the one being viewed. */
  otherEnquiryId: string;
  otherEnquiryNumber: string;
  direction: "may_duplicate" | "may_be_duplicated_by";
  matchedOn: "phone" | "email" | "both";
  reviewStatus: "flagged" | "dismissed" | "confirmed";
  reviewedAt: string | null;
};

export type FollowUpEntry = {
  id: string;
  dueAt: string;
  status: "scheduled" | "completed" | "missed" | "cancelled";
  assignedToName: string | null;
  outcome: string | null;
  completedAt: string | null;
};

export type EnquiryDetail = QueueRow & {
  message: string | null;
  city: string | null;
  previousInstitution: string | null;
  hscStream: string | null;
  hscPercentageBand: string | null;

  captureChannel: "public_form" | "staff_capture";
  consentBasis: "self_submitted" | "verbal_to_staff" | "sourced_list";

  history: HistoryEntry[];
  duplicates: DuplicateLink[];
  followUps: FollowUpEntry[];

  /** Whether this caller may act on it, so the UI shows only usable controls. */
  isOwnedByCaller: boolean;

  /**
   * The current owner's StaffProfile id, or null for Unassigned.
   *
   * Exposed because a write control has to send back the value it is acting on —
   * that is what makes the update conditional and stops a stale screen silently
   * overwriting someone else's change. `ownerName` is for reading; this is for
   * writing, and they are not interchangeable.
   */
  ownerId: string | null;
};

/**
 * One enquiry, with its history, duplicate links and follow-ups.
 *
 * AN ENQUIRY OUTSIDE THE CALLER'S SCOPE RETURNS `NOT_FOUND`, NOT `FORBIDDEN`.
 * Deliberate: `403` on a real id and `404` on a made-up one is an oracle for
 * "which enquiry ids exist", and enquiry numbers are sequential and guessable.
 * The caller cannot see it, so as far as they are concerned it does not exist.
 */
export async function getEnquiryDetail(
  principal: Principal,
  id: string,
  now: Date = new Date(),
): Promise<Result<EnquiryDetail>> {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist.");
    }

    const scope = visibilityScope(principal);

    const clauses = [scope.filter].filter((clause) => Object.keys(clause).length > 0);

    // The scope is part of the QUERY, not a check after the fetch. Fetching first
    // and then comparing is the shape where a missing `return` leaks the record.
    const enquiry = await Enquiry.findOne({
      _id: new mongoose.Types.ObjectId(id),
      isArchived: false,
      ...(clauses.length > 0 ? { $and: clauses } : {}),
    })
      .populate<{
        status: { code: string; label: string; isTerminal: boolean; isPlaceholder: boolean };
      }>("status", "code label isTerminal isPlaceholder")
      .populate<{ owner: { _id: Types.ObjectId; firstName: string; lastName?: string } | null }>(
        "owner",
        "firstName lastName",
      )
      .lean();

    if (!enquiry) {
      return fail(ERROR_CODES.NOT_FOUND, "That enquiry does not exist, or you cannot see it.");
    }

    const [history, duplicates, followUps, duplicateCounts] = await Promise.all([
      loadHistory(enquiry._id),
      loadDuplicates(enquiry._id),
      loadFollowUps(enquiry._id),
      openDuplicateCounts([enquiry._id]),
    ]);

    const row = toQueueRow(enquiry as unknown as PopulatedEnquiry, duplicateCounts, now);

    return ok({
      ...row,
      message: enquiry.message ?? null,
      city: enquiry.city ?? null,
      previousInstitution: enquiry.previousInstitution ?? null,
      hscStream: enquiry.hscStream ?? null,
      hscPercentageBand: enquiry.hscPercentageBand ?? null,

      captureChannel: enquiry.captureChannel,
      consentBasis: enquiry.consentBasis,

      history,
      duplicates,
      followUps,

      isOwnedByCaller:
        !!principal.staffProfileId &&
        String(enquiry.owner?._id ?? "") === principal.staffProfileId,

      ownerId: enquiry.owner?._id ? String(enquiry.owner._id) : null,
    });
  } catch (err) {
    return fromError(err);
  }
}

/**
 * The append-only history, newest first.
 *
 * The actor is rendered from the User's email rather than a staff name, because the
 * question history answers is "which ACCOUNT did this" — and `createdBy: null` is
 * meaningful rather than missing: it means the public form or a system process,
 * which is exactly what a reviewer asking "who created this record" needs to see.
 */
async function loadHistory(enquiryId: Types.ObjectId): Promise<HistoryEntry[]> {
  const events = await EnquiryEvent.find({ enquiry: enquiryId })
    .populate<{ createdBy: { email: string } | null }>("createdBy", "email")
    .populate<{ fromOwner: { firstName: string; lastName?: string } | null }>(
      "fromOwner",
      "firstName lastName",
    )
    .populate<{ toOwner: { firstName: string; lastName?: string } | null }>(
      "toOwner",
      "firstName lastName",
    )
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return events.map((event) => ({
    id: String(event._id),
    type: event.type,
    at: event.createdAt.toISOString(),
    actor: event.createdBy?.email ?? "Public form / system",
    statusLabelAtEvent: event.statusLabelAtEvent ?? null,
    fromOwnerName: staffName(event.fromOwner),
    toOwnerName: staffName(event.toOwner),
    note: event.note ?? null,
    detail: event.detail ?? null,
  }));
}

async function loadDuplicates(enquiryId: Types.ObjectId): Promise<DuplicateLink[]> {
  const links = await EnquiryDuplicate.find({
    isArchived: false,
    $or: [{ enquiry: enquiryId }, { duplicateOf: enquiryId }],
  })
    .populate<{ enquiry: { _id: Types.ObjectId; enquiryNumber: string } }>(
      "enquiry",
      "enquiryNumber",
    )
    .populate<{ duplicateOf: { _id: Types.ObjectId; enquiryNumber: string } }>(
      "duplicateOf",
      "enquiryNumber",
    )
    .sort({ createdAt: -1 })
    .lean();

  return links.map((link) => {
    // `enquiry` is always the newer record and `duplicateOf` the earlier one. So
    // whether the enquiry on screen "may duplicate" or "may be duplicated by" the
    // other depends on which side of the pair it sits on — and getting this
    // backwards would tell a staff member the wrong record is the original.
    const isNewer = String(link.enquiry._id) === String(enquiryId);
    const other = isNewer ? link.duplicateOf : link.enquiry;

    return {
      id: String(link._id),
      otherEnquiryId: String(other._id),
      otherEnquiryNumber: other.enquiryNumber,
      direction: isNewer ? "may_duplicate" : "may_be_duplicated_by",
      matchedOn: link.matchedOn,
      reviewStatus: link.reviewStatus,
      reviewedAt: link.reviewedAt ? link.reviewedAt.toISOString() : null,
    };
  });
}

async function loadFollowUps(enquiryId: Types.ObjectId): Promise<FollowUpEntry[]> {
  const followUps = await FollowUp.find({ enquiry: enquiryId, isArchived: false })
    .populate<{ assignedTo: { firstName: string; lastName?: string } | null }>(
      "assignedTo",
      "firstName lastName",
    )
    .sort({ dueAt: -1 })
    .lean();

  return followUps.map((followUp) => ({
    id: String(followUp._id),
    dueAt: followUp.dueAt.toISOString(),
    status: followUp.status,
    assignedToName: staffName(followUp.assignedTo),
    outcome: followUp.outcome ?? null,
    completedAt: followUp.completedAt ? followUp.completedAt.toISOString() : null,
  }));
}

function staffName(staff: { firstName: string; lastName?: string } | null | undefined) {
  return staff ? `${staff.firstName} ${staff.lastName ?? ""}`.trim() : null;
}
