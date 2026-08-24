import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/auth` is mocked for the route-handler tests.
 *
 * WHY IT HAS TO BE. Reading a session means reading a cookie through Next's
 * `headers()`, which only works inside a request scope — something Vitest cannot
 * provide when calling a handler as a plain function. Without the mock, the only
 * testable path is the unauthenticated one, and a guard that has only been proven to
 * say "no" has not been proven to work.
 *
 * WHAT THIS DOES NOT COVER, stated plainly: the wiring between Auth.js and the guard
 * itself. That is exactly where the "Sign in to continue" bug lived, and no unit test
 * would have found it — only running the app does. The mock is scoped to the
 * permission check, so everything downstream of it (scoping, the envelope, the
 * service) is the real code.
 */
const session = vi.hoisted(() => ({
  principal: null as unknown,
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: async (code: string) => {
    const principal = session.principal as { permissions: string[] } | null;

    if (!principal) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." };
    }
    if (!principal.permissions.includes(code)) {
      return { ok: false, code: "FORBIDDEN", message: `Requires "${code}".` };
    }
    return { ok: true, data: principal };
  },
  requireSession: async () =>
    session.principal
      ? { ok: true, data: session.principal }
      : { ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." },
  currentPrincipal: async () => session.principal,
  can: (principal: { permissions: string[] } | null, code: string) =>
    principal?.permissions.includes(code) ?? false,
}));

import { GET } from "@/app/api/staff/enquiries/route";
import { PERMISSION_CODES, PROGRAMME_CODES, SOURCE_CODES, STATUS_CODES } from "@/config/codes";
import type { Principal } from "@/lib/auth";
import { ERROR_CODES } from "@/lib/result";
import { Enquiry, EnquiryStatus, StaffProfile } from "@/models";
import { parseQueueQuery, queueQueryToSearch } from "@/schemas/queue.schema";
import { seedEnquiries } from "@/scripts/seed/enquiries";
import { seedPermissions } from "@/scripts/seed/permissions";
import { seedProgrammes } from "@/scripts/seed/programmes";
import { seedRoles } from "@/scripts/seed/roles";
import { seedSources } from "@/scripts/seed/sources";
import { seedStaff } from "@/scripts/seed/staff";
import { seedStatuses } from "@/scripts/seed/statuses";
import { createEnquiry } from "@/services/enquiry.service";
import { getEnquiryDetail, listEnquiries, queueCounts } from "@/services/queue.service";

/**
 * Queue tests — visibility scoping first, because it is the part that leaks personal
 * data if it is wrong, and it is invisible in manual testing (the happy path looks
 * identical whether the scope is applied or not).
 *
 * Services are called directly. The route handler is exercised separately, for the
 * permission check and the envelope.
 */

const COUNSELLOR = "counsellor1@demo.scct-enquiry.local";

let counsellorOne: Principal;
let counsellorTwo: Principal;
let manager: Principal;
let profileless: Principal;

async function seedConfig() {
  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions.ids);
  await seedStaff(roles.ids);
  await seedProgrammes();
  await seedSources();
  await seedStatuses();
}

/**
 * Principals are BUILT HERE rather than obtained by logging in.
 *
 * `verifyCredentials` is already tested in tests/auth.test.ts; threading a real
 * login through every queue test would couple these assertions to the auth path and
 * make a failure ambiguous. What matters here is what a given permission list can
 * see, so the permission list is the input.
 */
async function principals() {
  const [one, two, managerProfile] = await Promise.all([
    StaffProfile.findOne({ firstName: "Asha" }).lean(),
    StaffProfile.findOne({ firstName: "Rohit" }).lean(),
    StaffProfile.findOne({ firstName: "Vikram" }).lean(),
  ]);

  counsellorOne = {
    userId: String(new mongoose.Types.ObjectId()),
    email: COUNSELLOR,
    displayName: "Asha Demo",
    staffProfileId: String(one!._id),
    roleCodes: ["counsellor"],
    permissions: [PERMISSION_CODES.ENQUIRY_VIEW_OWN],
  };

  counsellorTwo = { ...counsellorOne, staffProfileId: String(two!._id), email: "two@x.invalid" };

  manager = {
    ...counsellorOne,
    staffProfileId: String(managerProfile!._id),
    email: "manager@x.invalid",
    roleCodes: ["manager"],
    permissions: [PERMISSION_CODES.ENQUIRY_VIEW_OWN, PERMISSION_CODES.ENQUIRY_VIEW_ALL],
  };

  // An account with a login but no StaffProfile — an administrator, say. It cannot
  // own enquiries, because ownership refs StaffProfile and not User.
  profileless = { ...counsellorOne, staffProfileId: null, email: "admin@x.invalid" };
}

/** One enquiry, owned by whoever is passed in. */
async function enquiryOwnedBy(owner: string | null, overrides: Record<string, unknown> = {}) {
  const result = await createEnquiry({
    fullName: "Test Person",
    phone: "9876543210",
    programmeCode: PROGRAMME_CODES.BCOM,
    sourceCode: SOURCE_CODES.WALK_IN,
    captureChannel: "staff_capture",
    consentBasis: "verbal_to_staff",
    ...overrides,
  });

  if (!result.ok) throw new Error(`could not create enquiry: ${result.message}`);

  // Ownership is set directly here, rather than through round-robin, so each test
  // controls exactly who owns what. Round-robin itself is tested in intake.test.ts.
  await Enquiry.updateOne(
    { _id: result.data.enquiry._id },
    { $set: { owner: owner ? new mongoose.Types.ObjectId(owner) : null } },
  );

  return result.data.enquiry;
}

/** Who the mocked guard reports for the next route-handler call. */
function signedInAs(principal: Principal | null) {
  session.principal = principal;
}

beforeEach(async () => {
  await seedConfig();
  await principals();
  // Anonymous by default, so a handler test that forgets to sign in fails loudly
  // rather than inheriting whoever the previous test happened to be.
  signedInAs(null);
});

// ─── Visibility ──────────────────────────────────────────────────────────────

describe("listEnquiries — visibility scoping", () => {
  it("shows a manager everything", async () => {
    await enquiryOwnedBy(counsellorOne.staffProfileId);
    await enquiryOwnedBy(counsellorTwo.staffProfileId);
    await enquiryOwnedBy(null);

    const result = await listEnquiries(manager, parseQueueQuery({}));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(3);
    expect(result.data.scope).toBe("all");
  });

  it("shows a counsellor their own enquiries and the unassigned pool, and nothing else", async () => {
    await enquiryOwnedBy(counsellorOne.staffProfileId);
    await enquiryOwnedBy(counsellorTwo.staffProfileId);
    await enquiryOwnedBy(null);

    const result = await listEnquiries(counsellorOne, parseQueueQuery({}));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(2);
    expect(result.data.scope).toBe("own_and_unassigned");

    // The colleague's enquiry is absent, not merely last.
    const owners = result.data.rows.map((row) => row.ownerName);
    expect(owners).not.toContain("Rohit Sample");
  });

  it("does NOT let an owner filter widen a counsellor's scope", async () => {
    // The attack, and the reason the scope is combined with `$and` rather than
    // applied only when no owner filter is present.
    const theirs = await enquiryOwnedBy(counsellorTwo.staffProfileId);

    const result = await listEnquiries(
      counsellorOne,
      parseQueueQuery({ owner: counsellorTwo.staffProfileId! }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(0);
    expect(result.data.rows.map((row) => row.enquiryNumber)).not.toContain(theirs.enquiryNumber);
  });

  it("shows an account with no staff profile the unassigned pool only", async () => {
    await enquiryOwnedBy(counsellorOne.staffProfileId);
    await enquiryOwnedBy(null);

    const result = await listEnquiries(profileless, parseQueueQuery({}));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(1);
    expect(result.data.scope).toBe("unassigned_only");
    expect(result.data.rows[0].ownerName).toBeNull();
  });

  it("excludes archived enquiries from every scope", async () => {
    const archived = await enquiryOwnedBy(counsellorOne.staffProfileId);
    await Enquiry.updateOne({ _id: archived._id }, { $set: { isArchived: true } });

    const result = await listEnquiries(manager, parseQueueQuery({}));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(0);
  });
});

// ─── Filters ─────────────────────────────────────────────────────────────────

describe("listEnquiries — filters", () => {
  it("filters by programme", async () => {
    await enquiryOwnedBy(null, { programmeCode: PROGRAMME_CODES.BCOM });
    await enquiryOwnedBy(null, { programmeCode: PROGRAMME_CODES.BSC_IT, phone: "9876543211" });

    const result = await listEnquiries(
      manager,
      parseQueueQuery({ programme: PROGRAMME_CODES.BSC_IT }),
    );

    if (!result.ok) throw new Error(result.message);
    expect(result.data.total).toBe(1);
    expect(result.data.rows[0].programmeLabel).toContain("IT");
  });

  it("filters by owner keyword `me` and `unassigned`", async () => {
    await enquiryOwnedBy(counsellorOne.staffProfileId);
    await enquiryOwnedBy(null, { phone: "9876543211" });

    const mine = await listEnquiries(counsellorOne, parseQueueQuery({ owner: "me" }));
    const pool = await listEnquiries(counsellorOne, parseQueueQuery({ owner: "unassigned" }));

    if (!mine.ok || !pool.ok) throw new Error("filter failed");

    expect(mine.data.total).toBe(1);
    expect(mine.data.rows[0].ownerName).toBe("Asha Demo");

    expect(pool.data.total).toBe(1);
    expect(pool.data.rows[0].ownerName).toBeNull();
  });

  it("searches by name, enquiry number, email and phone", async () => {
    const enquiry = await enquiryOwnedBy(null, {
      fullName: "Zoya Placeholder",
      phone: "9812345678",
      email: "zoya@example.invalid",
    });

    for (const q of ["Zoya", enquiry.enquiryNumber, "zoya@example.invalid", "9812345678"]) {
      const result = await listEnquiries(manager, parseQueueQuery({ q }));

      if (!result.ok) throw new Error(result.message);
      expect(result.data.total, `searching "${q}"`).toBe(1);
    }
  });

  it("finds a phone typed in a different format from the one stored", async () => {
    // The reason `phoneNormalised` exists. Someone reading a number off a notepad
    // types the digits; the record may have been stored with a country code.
    await enquiryOwnedBy(null, { phone: "+91 98123 45678" });

    const result = await listEnquiries(manager, parseQueueQuery({ q: "9812345678" }));

    if (!result.ok) throw new Error(result.message);
    expect(result.data.total).toBe(1);
  });

  it("treats a regex metacharacter in the search as a literal, not a pattern", async () => {
    await enquiryOwnedBy(null, { fullName: "Ananya Demo" });

    // Unescaped, `.*` would match every name in the collection. An unescaped `(`
    // would throw. Both are user input arriving from a URL.
    for (const q of [".*", "((("]) {
      const result = await listEnquiries(manager, parseQueueQuery({ q }));

      expect(result.ok, `searching "${q}"`).toBe(true);
      if (!result.ok) continue;
      expect(result.data.total, `searching "${q}"`).toBe(0);
    }
  });

  it("rejects an unknown status code instead of silently returning nothing", async () => {
    await enquiryOwnedBy(null);

    // An empty queue would let the caller conclude "no enquiries are in that stage",
    // which is a wrong answer presented as a fact.
    const result = await listEnquiries(manager, parseQueueQuery({ status: "NOT_A_STATUS" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("filters by follow-up state, in the institute's timezone", async () => {
    const now = new Date("2026-08-21T06:00:00.000Z"); // 11:30 IST

    const overdue = await enquiryOwnedBy(null, { phone: "9812345671" });
    const laterToday = await enquiryOwnedBy(null, { phone: "9812345672" });
    const nextMonth = await enquiryOwnedBy(null, { phone: "9812345673" });
    await enquiryOwnedBy(null, { phone: "9812345674" }); // no follow-up at all

    await Enquiry.updateOne(
      { _id: overdue._id },
      { $set: { nextFollowUpAt: new Date("2026-08-20T06:00:00.000Z") } },
    );
    // 22:00 IST on the 21st — still "today" in IST, but already the 22nd in UTC+0
    // terms if you used a naive local-time calculation on a UTC server.
    await Enquiry.updateOne(
      { _id: laterToday._id },
      { $set: { nextFollowUpAt: new Date("2026-08-21T16:30:00.000Z") } },
    );
    await Enquiry.updateOne(
      { _id: nextMonth._id },
      { $set: { nextFollowUpAt: new Date("2026-09-30T06:00:00.000Z") } },
    );

    const byFilter = async (followup: string) => {
      const result = await listEnquiries(manager, parseQueueQuery({ followup }), now);
      if (!result.ok) throw new Error(result.message);
      return result.data.total;
    };

    expect(await byFilter("overdue")).toBe(1);
    expect(await byFilter("today")).toBe(2); // the overdue one and the 22:00 IST one
    expect(await byFilter("week")).toBe(2);
    expect(await byFilter("none")).toBe(1);
    expect(await byFilter("any")).toBe(4);
  });

  it("derives the follow-up badge from the same boundary the filter uses", async () => {
    const now = new Date("2026-08-21T06:00:00.000Z");

    const enquiry = await enquiryOwnedBy(null);
    await Enquiry.updateOne(
      { _id: enquiry._id },
      { $set: { nextFollowUpAt: new Date("2026-08-21T16:30:00.000Z") } },
    );

    const result = await listEnquiries(manager, parseQueueQuery({}), now);

    if (!result.ok) throw new Error(result.message);
    // A row badged "today" must be a row the "today" filter returns. Two separate
    // date calculations are how those two answers drift apart.
    expect(result.data.rows[0].followUpState).toBe("today");
  });
});

// ─── Sorting and pagination ──────────────────────────────────────────────────

describe("listEnquiries — sorting and pagination", () => {
  it("sorts enquiries with no follow-up LAST when sorting by urgency", async () => {
    const withFollowUp = await enquiryOwnedBy(null, { phone: "9812345671" });
    await enquiryOwnedBy(null, { phone: "9812345672" }); // none

    await Enquiry.updateOne(
      { _id: withFollowUp._id },
      { $set: { nextFollowUpAt: new Date("2026-08-25T06:00:00.000Z") } },
    );

    const result = await listEnquiries(manager, parseQueueQuery({ sort: "followup" }));

    if (!result.ok) throw new Error(result.message);

    // Mongo sorts null BEFORE any date ascending, so without the sentinel the
    // enquiry with NO follow-up would top a list whose whole purpose is urgency.
    expect(result.data.rows[0].enquiryNumber).toBe(withFollowUp.enquiryNumber);
    expect(result.data.rows[1].followUpState).toBe("none");
  });

  it("paginates with a total that matches the rows returned", async () => {
    for (let index = 0; index < 7; index += 1) {
      await enquiryOwnedBy(null, { phone: `98123456${70 + index}` });
    }

    const first = await listEnquiries(manager, parseQueueQuery({ limit: "3" }));
    const last = await listEnquiries(manager, parseQueueQuery({ limit: "3", page: "3" }));

    if (!first.ok || !last.ok) throw new Error("pagination failed");

    expect(first.data.total).toBe(7);
    expect(first.data.totalPages).toBe(3);
    expect(first.data.rows).toHaveLength(3);
    expect(last.data.rows).toHaveLength(1);
  });

  it("returns an empty page rather than failing when the page is past the end", async () => {
    await enquiryOwnedBy(null);

    const result = await listEnquiries(manager, parseQueueQuery({ page: "99" }));

    // A URL can be edited and links get stale. An error here would be a dead end
    // for a caller who only needs to be told there is nothing on that page.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toHaveLength(0);
    expect(result.data.total).toBe(1);
  });
});

// ─── Duplicate badge ─────────────────────────────────────────────────────────

describe("listEnquiries — duplicate flags", () => {
  it("counts an open duplicate flag on BOTH enquiries of the pair", async () => {
    // Same phone, same programme → flagged by the approved rule.
    await enquiryOwnedBy(null, { phone: "9812345678" });
    await enquiryOwnedBy(null, { phone: "9812345678" });

    const result = await listEnquiries(manager, parseQueueQuery({}));

    if (!result.ok) throw new Error(result.message);
    expect(result.data.total).toBe(2);

    // Either record may be the one on screen, and the staff member looking at the
    // earlier one needs the warning just as much.
    for (const row of result.data.rows) expect(row.openDuplicateFlags).toBe(1);
  });

  it("does not flag the same phone against a different programme", async () => {
    await enquiryOwnedBy(null, { phone: "9812345678", programmeCode: PROGRAMME_CODES.BCOM });
    await enquiryOwnedBy(null, { phone: "9812345678", programmeCode: PROGRAMME_CODES.BSC_IT });

    const result = await listEnquiries(manager, parseQueueQuery({}));

    if (!result.ok) throw new Error(result.message);
    // One person may genuinely enquire about two programmes. Flagging that loses a
    // real enquiry to a false positive.
    for (const row of result.data.rows) expect(row.openDuplicateFlags).toBe(0);
  });
});

// ─── Counts ──────────────────────────────────────────────────────────────────

describe("queueCounts", () => {
  it("scopes the counts to what the caller can see", async () => {
    await enquiryOwnedBy(counsellorOne.staffProfileId, { phone: "9812345671" });
    await enquiryOwnedBy(counsellorTwo.staffProfileId, { phone: "9812345672" });
    await enquiryOwnedBy(null, { phone: "9812345673" });

    const [mine, all] = await Promise.all([
      queueCounts(counsellorOne),
      queueCounts(manager),
    ]);

    if (!mine.ok || !all.ok) throw new Error("counts failed");

    // A counsellor's headline number must mean "enquiries you can open", not
    // "enquiries in the college" — otherwise the tile promises rows the table
    // cannot show.
    expect(mine.data.total).toBe(2);
    expect(all.data.total).toBe(3);
  });

  it("every count equals the total of the queue view it links to", async () => {
    /**
     * THE ASSERTION THE WHOLE STAT STRIP RESTS ON. Each tile is a link to a
     * filtered queue, so the number on the tile and the number of rows behind it
     * are computed by two different code paths — `queueCounts` and
     * `listEnquiries`. If they ever disagree, a manager reads a figure that cannot
     * be reconciled against stored records, which is precisely what the brief
     * asks this system to end.
     */
    for (let index = 0; index < 5; index += 1) {
      await enquiryOwnedBy(null, { phone: `98123456${70 + index}` });
    }

    const owned = await enquiryOwnedBy(counsellorOne.staffProfileId, { phone: "9812345680" });
    await Enquiry.updateOne(
      { _id: owned._id },
      { $set: { nextFollowUpAt: new Date("2020-01-01T00:00:00.000Z") } },
    );

    // Same phone and programme as an existing one → a flagged duplicate pair.
    await enquiryOwnedBy(null, { phone: "9812345670" });

    const counts = await queueCounts(manager);
    if (!counts.ok) throw new Error(counts.message);

    // Each pair is (the count, the query its tile links to).
    const checks: Array<[number, Record<string, string>]> = [
      [counts.data.total, {}],
      [counts.data.new, { status: STATUS_CODES.NEW }],
      [counts.data.overdue, { followup: "overdue" }],
      [counts.data.unassigned, { owner: "unassigned" }],
      [counts.data.duplicates, { duplicates: "open" }],
    ];

    for (const [count, params] of checks) {
      const list = await listEnquiries(manager, parseQueueQuery(params));
      if (!list.ok) throw new Error(list.message);

      expect(list.data.total, `filter ${JSON.stringify(params)}`).toBe(count);
    }
  });

  it("counts an enquiry with two duplicate flags once", async () => {
    // Three enquiries sharing a phone and programme produce several links between
    // them. The tile counts ENQUIRIES needing review, not links, or the number
    // would exceed the rows its own filter returns.
    for (let index = 0; index < 3; index += 1) {
      await enquiryOwnedBy(null, { phone: "9812345678" });
    }

    const counts = await queueCounts(manager);
    if (!counts.ok) throw new Error(counts.message);

    const list = await listEnquiries(manager, parseQueueQuery({ duplicates: "open" }));
    if (!list.ok) throw new Error(list.message);

    expect(counts.data.duplicates).toBe(3);
    expect(list.data.total).toBe(3);
  });

  it("returns zeroes rather than failing on an empty database", async () => {
    const counts = await queueCounts(manager);

    expect(counts.ok).toBe(true);
    if (!counts.ok) return;
    expect(counts.data).toEqual({ total: 0, new: 0, overdue: 0, unassigned: 0, duplicates: 0 });
  });
});

// ─── Detail ──────────────────────────────────────────────────────────────────

describe("getEnquiryDetail", () => {
  it("returns the enquiry with its history", async () => {
    const enquiry = await enquiryOwnedBy(counsellorOne.staffProfileId);

    const result = await getEnquiryDetail(counsellorOne, String(enquiry._id));

    if (!result.ok) throw new Error(result.message);

    expect(result.data.enquiryNumber).toBe(enquiry.enquiryNumber);
    expect(result.data.isOwnedByCaller).toBe(true);

    // createEnquiry() writes a `created` event, so history is never empty.
    expect(result.data.history.length).toBeGreaterThan(0);
    expect(result.data.history.at(-1)?.type).toBe("created");
  });

  it("returns NOT_FOUND — not FORBIDDEN — for an enquiry outside the caller's scope", async () => {
    const theirs = await enquiryOwnedBy(counsellorTwo.staffProfileId);

    const result = await getEnquiryDetail(counsellorOne, String(theirs._id));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // 403 on a real id and 404 on a fake one together reveal which ids exist.
    expect(result.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("returns NOT_FOUND for a malformed id without throwing a cast error", async () => {
    const result = await getEnquiryDetail(manager, "not-an-object-id");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("reports both directions of a duplicate link correctly", async () => {
    const older = await enquiryOwnedBy(null, { phone: "9812345678" });
    const newer = await enquiryOwnedBy(null, { phone: "9812345678" });

    const [olderView, newerView] = await Promise.all([
      getEnquiryDetail(manager, String(older._id)),
      getEnquiryDetail(manager, String(newer._id)),
    ]);

    if (!olderView.ok || !newerView.ok) throw new Error("detail failed");

    // Getting this backwards would tell a staff member the wrong record is the
    // original.
    expect(newerView.data.duplicates[0].direction).toBe("may_duplicate");
    expect(newerView.data.duplicates[0].otherEnquiryNumber).toBe(older.enquiryNumber);

    expect(olderView.data.duplicates[0].direction).toBe("may_be_duplicated_by");
    expect(olderView.data.duplicates[0].otherEnquiryNumber).toBe(newer.enquiryNumber);
  });

  it("marks an enquiry the caller does not own as not theirs", async () => {
    const unassigned = await enquiryOwnedBy(null);

    const result = await getEnquiryDetail(counsellorOne, String(unassigned._id));

    if (!result.ok) throw new Error(result.message);
    // Visible, because unassigned is in scope — but not owned, which is what the
    // write controls in the next milestone will read.
    expect(result.data.isOwnedByCaller).toBe(false);
  });
});

// ─── The route handler ───────────────────────────────────────────────────────

describe("GET /api/staff/enquiries", () => {
  function get(search = "") {
    return GET(new Request(`http://localhost:3000/api/staff/enquiries${search}`));
  }

  it("refuses an unauthenticated caller with 401 and the standard envelope", async () => {
    signedInAs(null);

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
    // Never a bare array or a second error shape.
    expect(body.data).toBeUndefined();
  });

  it("returns the paginated envelope to an authenticated caller", async () => {
    /**
     * THIS TEST EXISTS BECAUSE ITS ABSENCE HID A REAL BUG.
     *
     * The handler tests previously only covered the 401 path — which passes whether
     * or not an authenticated request works at all. `requirePermission` was being
     * given the `Request` object, which Auth.js treats as a MIDDLEWARE call rather
     * than a session read, so every authenticated caller was rejected as
     * unauthenticated. Green tests, broken endpoint.
     *
     * A passing test for the success path is the minimum bar for a guard: proving it
     * says no is only half of proving it works.
     */
    signedInAs(manager);
    await enquiryOwnedBy(null);

    const response = await get("?limit=5");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].enquiryNumber).toMatch(/^ENQ-/);
  });

  it("scopes the API response the same way the page does", async () => {
    await enquiryOwnedBy(counsellorTwo.staffProfileId);
    await enquiryOwnedBy(null, { phone: "9812345671" });

    signedInAs(counsellorOne);
    const mine = await (await get()).json();

    signedInAs(manager);
    const all = await (await get()).json();

    // The endpoint is what the export and any future consumer read, so its scoping
    // must match the screen's exactly — an export that leaks a colleague's enquiries
    // would be worse than one that failed.
    expect(mine.total).toBe(1);
    expect(all.total).toBe(2);
  });

  it("never caches a response", async () => {
    signedInAs(manager);

    const response = await get();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

// ─── The query schema ────────────────────────────────────────────────────────

describe("queue query parsing", () => {
  it("falls back instead of failing on a mangled parameter", async () => {
    // Query strings get truncated by chat clients and mangled by email software. A
    // staff member following a broken link should see the unfiltered queue.
    const query = parseQueueQuery({ page: "banana", limit: "9999", sort: "sideways" });

    expect(query.page).toBe(1);
    expect(query.limit).toBe(25);
    expect(query.sort).toBe("newest");
  });

  it("drops an empty parameter rather than treating it as a filter", () => {
    // `?status=` comes from clearing a dropdown and means "no filter" — not "the
    // status whose code is the empty string", which matches nothing.
    const query = parseQueueQuery({ status: "", q: "" });

    expect(query.status).toBeUndefined();
    expect(query.q).toBeUndefined();
  });

  it("takes the first value when a parameter is repeated", () => {
    const query = parseQueueQuery({ status: [STATUS_CODES.NEW, STATUS_CODES.CONTACTED] });

    expect(query.status).toBe(STATUS_CODES.NEW);
  });

  it("round-trips a query to a search string and back, omitting defaults", () => {
    const query = parseQueueQuery({ q: "Zoya", programme: PROGRAMME_CODES.BAF, page: "2" });
    const search = queueQueryToSearch(query);

    // Defaults are absent, so two links to the same view are the same string.
    expect(search).not.toContain("sort=");
    expect(search).not.toContain("limit=");

    const reparsed = parseQueueQuery(new URLSearchParams(search.slice(1)));
    expect(reparsed.q).toBe("Zoya");
    expect(reparsed.programme).toBe(PROGRAMME_CODES.BAF);
    expect(reparsed.page).toBe(2);
  });
});

// ─── The demo seed ───────────────────────────────────────────────────────────

describe("seedEnquiries", () => {
  it("creates enquiries through createEnquiry() and is safe to rerun", async () => {
    const first = await seedEnquiries({ count: 14 });

    expect(first.created).toBe(14);
    expect(first.failures).toEqual([]);

    // The deterministic idempotency key means a rerun resolves every record instead
    // of creating a second copy — the same protection a double-clicked public
    // submission relies on.
    const second = await seedEnquiries({ count: 14 });

    expect(second.created).toBe(0);
    expect(second.replayed).toBe(14);
    expect(await Enquiry.countDocuments()).toBe(14);
  });

  it("generates a deliberate same-programme duplicate for the badge to show", async () => {
    const result = await seedEnquiries({ count: 14 });

    // Without one of these, the duplicate badge is never exercised by demo data and
    // nobody notices if it breaks.
    expect(result.duplicatesFlagged).toBeGreaterThan(0);
  });

  it("puts every demo enquiry in the default status with no follow-up", async () => {
    await seedEnquiries({ count: 6 });

    const defaultStatus = await EnquiryStatus.findOne({ isDefault: true }).lean();
    const enquiries = await Enquiry.find().select("status nextFollowUpAt").lean();

    // Status and follow-up are writes owned by services that do not exist yet.
    // Faking them in the seed would produce history that never happened.
    for (const enquiry of enquiries) {
      expect(String(enquiry.status)).toBe(String(defaultStatus!._id));
      expect(enquiry.nextFollowUpAt).toBeNull();
    }
  });
});
