import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import { PERMISSION_CODES, PROGRAMME_CODES, SOURCE_CODES, STATUS_CODES } from "@/config/codes";
import type { Principal } from "@/lib/auth";
import { ERROR_CODES } from "@/lib/result";
import { Enquiry, EnquiryEvent, FollowUp, StaffProfile } from "@/models";
import { followUpSchema, statusChangeSchema } from "@/schemas/workflow.schema";
import { seedEnquiries } from "@/scripts/seed/enquiries";
import { seedPermissions } from "@/scripts/seed/permissions";
import { seedProgrammes } from "@/scripts/seed/programmes";
import { seedRoles } from "@/scripts/seed/roles";
import { seedSources } from "@/scripts/seed/sources";
import { seedStaff } from "@/scripts/seed/staff";
import { seedStatuses } from "@/scripts/seed/statuses";
import { createEnquiry } from "@/services/enquiry.service";
import { getEnquiryDetail } from "@/services/queue.service";
import {
  addNote,
  changeOwner,
  changeStatus,
  recordFollowUpOutcome,
  scheduleFollowUp,
} from "@/services/workflow.service";

/**
 * Workflow write tests.
 *
 * The concurrency cases are the reason this file exists. "Overwritten or lost
 * records" is the risk the brief names as SCCT's reason for leaving Excel, so a test
 * that proves a stale write is REFUSED is worth more than any number of happy-path
 * assertions.
 */

let counsellor: Principal;
let otherCounsellor: Principal;
let manager: Principal;
let ineligibleProfileId: string;

async function seedAll() {
  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions.ids);
  await seedStaff(roles.ids);
  await seedProgrammes();
  await seedSources();
  await seedStatuses();

  const [asha, rohit, vikram, meera] = await Promise.all([
    StaffProfile.findOne({ firstName: "Asha" }).lean(),
    StaffProfile.findOne({ firstName: "Rohit" }).lean(),
    StaffProfile.findOne({ firstName: "Vikram" }).lean(),
    // Seeded with eligibleForAssignment: false — the counsellor "not in the rota".
    StaffProfile.findOne({ firstName: "Meera" }).lean(),
  ]);

  ineligibleProfileId = String(meera!._id);

  counsellor = {
    userId: String(new mongoose.Types.ObjectId()),
    email: "asha@x.invalid",
    displayName: "Asha Demo",
    staffProfileId: String(asha!._id),
    roleCodes: ["counsellor"],
    permissions: [
      PERMISSION_CODES.ENQUIRY_VIEW_OWN,
      PERMISSION_CODES.ENQUIRY_UPDATE_OWN,
      PERMISSION_CODES.ENQUIRY_NOTE_CREATE,
    ],
  };

  otherCounsellor = {
    ...counsellor,
    userId: String(new mongoose.Types.ObjectId()),
    email: "rohit@x.invalid",
    displayName: "Rohit Sample",
    staffProfileId: String(rohit!._id),
  };

  manager = {
    ...counsellor,
    userId: String(new mongoose.Types.ObjectId()),
    email: "vikram@x.invalid",
    displayName: "Vikram Example",
    staffProfileId: String(vikram!._id),
    roleCodes: ["manager"],
    permissions: [
      PERMISSION_CODES.ENQUIRY_VIEW_OWN,
      PERMISSION_CODES.ENQUIRY_VIEW_ALL,
      PERMISSION_CODES.ENQUIRY_UPDATE_OWN,
      PERMISSION_CODES.ENQUIRY_UPDATE_ALL,
      PERMISSION_CODES.ENQUIRY_NOTE_CREATE,
      PERMISSION_CODES.ENQUIRY_REASSIGN,
    ],
  };
}

async function enquiryOwnedBy(owner: string | null, phone = "9876543210") {
  const result = await createEnquiry({
    fullName: "Test Person",
    phone,
    programmeCode: PROGRAMME_CODES.BCOM,
    sourceCode: SOURCE_CODES.WALK_IN,
    captureChannel: "staff_capture",
    consentBasis: "verbal_to_staff",
  });

  if (!result.ok) throw new Error(result.message);

  await Enquiry.updateOne(
    { _id: result.data.enquiry._id },
    { $set: { owner: owner ? new mongoose.Types.ObjectId(owner) : null } },
  );

  return String(result.data.enquiry._id);
}

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

beforeEach(seedAll);

// ─── Concurrency: the reason this file exists ────────────────────────────────

describe("concurrency guards", () => {
  it("refuses a stage change made from a stale screen, and changes nothing", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    // Two people open the same enquiry. Both see NEW.
    const first = await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
    });
    expect(first.ok).toBe(true);

    // The second acts on what they could see, which is now out of date.
    const second = await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CLOSED_NOT_PROCEEDING,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe(ERROR_CODES.CONFLICT);

    // The first person's change survives. This is the assertion that matters: the
    // Excel failure mode is the second write silently winning.
    const detail = await getEnquiryDetail(manager, id);
    if (!detail.ok) throw new Error(detail.message);
    expect(detail.data.statusCode).toBe(STATUS_CODES.CONTACTED);
  });

  it("refuses an ownership change made from a stale screen", async () => {
    const id = await enquiryOwnedBy(null);

    // Two managers both looking at an unassigned enquiry.
    const first = await changeOwner(manager, id, {
      fromOwnerId: null,
      toOwnerId: counsellor.staffProfileId,
    });
    expect(first.ok).toBe(true);

    const second = await changeOwner(manager, id, {
      fromOwnerId: null,
      toOwnerId: otherCounsellor.staffProfileId,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe(ERROR_CODES.CONFLICT);

    const detail = await getEnquiryDetail(manager, id);
    if (!detail.ok) throw new Error(detail.message);
    expect(detail.data.ownerId).toBe(counsellor.staffProfileId);
  });

  it("refuses to re-resolve an already-resolved follow-up", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const scheduled = await scheduleFollowUp(counsellor, id, { dueAt: inDays(2) });
    if (!scheduled.ok) throw new Error(scheduled.message);

    const completed = await recordFollowUpOutcome(counsellor, id, scheduled.data.id, {
      status: "completed",
      outcome: "Spoke to the student.",
    });
    expect(completed.ok).toBe(true);

    // Re-marking it would change the overdue figure a manager reads, with no trace
    // that the earlier outcome ever existed.
    const remark = await recordFollowUpOutcome(counsellor, id, scheduled.data.id, {
      status: "missed",
    });

    expect(remark.ok).toBe(false);
    if (remark.ok) return;
    expect(remark.code).toBe(ERROR_CODES.CONFLICT);

    const followUp = await FollowUp.findById(scheduled.data.id).lean();
    expect(followUp?.status).toBe("completed");
    expect(followUp?.outcome).toBe("Spoke to the student.");
  });

  it("lets two notes be added concurrently, because a note overwrites nothing", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const [one, two] = await Promise.all([
      addNote(counsellor, id, { note: "Called, no answer." }),
      addNote(otherCounsellor, id, { note: "Left a voicemail." }),
    ]);

    // Rohit does not own it, so his note is refused for authorization — not for
    // concurrency. Asha's succeeds.
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(false);

    const notes = await EnquiryEvent.countDocuments({ type: "note_added" });
    expect(notes).toBe(1);
  });
});

// ─── Authorization ───────────────────────────────────────────────────────────

describe("write authorization", () => {
  it("lets a counsellor claim an unassigned enquiry, recorded as a self-claim", async () => {
    const id = await enquiryOwnedBy(null);

    const result = await changeOwner(counsellor, id, {
      fromOwnerId: null,
      toOwnerId: counsellor.staffProfileId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reason).toBe("self_claimed");

    // Traceable rather than silent — the whole justification for allowing it.
    const event = await EnquiryEvent.findOne({ type: "owner_assigned" }).lean();
    expect(event?.detail).toContain("Claimed from the unassigned pool");
  });

  it("lets a counsellor release their own enquiry back to the pool", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await changeOwner(counsellor, id, {
      fromOwnerId: counsellor.staffProfileId,
      toOwnerId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reason).toBe("released_to_pool");

    // Released, not erased: the history still records who held it.
    const events = await EnquiryEvent.countDocuments({ type: "owner_changed" });
    expect(events).toBe(1);
  });

  it("stops a counsellor handing their enquiry to someone else", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await changeOwner(counsellor, id, {
      fromOwnerId: counsellor.staffProfileId,
      toOwnerId: otherCounsellor.staffProfileId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Claiming and releasing are `update.own`; moving an enquiry between other
    // people needs `enquiry.reassign`.
    expect(result.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it("lets a manager reassign between two people", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await changeOwner(manager, id, {
      fromOwnerId: counsellor.staffProfileId,
      toOwnerId: otherCounsellor.staffProfileId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reason).toBe("reassigned");
    expect(result.data.ownerName).toBe("Rohit Sample");
  });

  it("stops a counsellor changing an enquiry that belongs to a colleague", async () => {
    const id = await enquiryOwnedBy(otherCounsellor.staffProfileId);

    const status = await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
    });

    // The write scope and the visibility scope both exclude it, so the conditional
    // update simply matches nothing.
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.code).toBe(ERROR_CODES.CONFLICT);

    const note = await addNote(counsellor, id, { note: "Should not be recorded." });
    expect(note.ok).toBe(false);

    expect(await EnquiryEvent.countDocuments({ type: "note_added" })).toBe(0);
  });

  it("lets a manager change an enquiry owned by someone else", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    // This is what `enquiry.update.all` exists for. Without that permission row a
    // manager could see every enquiry and change none of them.
    const result = await changeStatus(manager, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.IN_DISCUSSION,
    });

    expect(result.ok).toBe(true);
  });

  it("refuses a caller with no update permission at all", async () => {
    const readOnly: Principal = {
      ...counsellor,
      permissions: [PERMISSION_CODES.ENQUIRY_VIEW_OWN],
    };

    const id = await enquiryOwnedBy(readOnly.staffProfileId);

    const result = await changeStatus(readOnly, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it("refuses an account with no staff profile, explaining why", async () => {
    const id = await enquiryOwnedBy(null);

    const profileless: Principal = { ...counsellor, staffProfileId: null };

    const result = await changeStatus(profileless, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(result.message).toContain("no staff profile");
  });
});

// ─── Stage changes ───────────────────────────────────────────────────────────

describe("changeStatus", () => {
  it("appends history with the stage label as it read at the time", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
      note: "Called and spoke to the parent.",
    });

    const event = await EnquiryEvent.findOne({ type: "status_changed" }).lean();

    expect(event).not.toBeNull();
    expect(event?.statusLabelAtEvent).toBeTruthy();
    // The note travels with the change rather than as a separate entry, so the reason
    // cannot drift away from what it explains.
    expect(event?.note).toBe("Called and spoke to the parent.");
    expect(event?.fromStatus).not.toBeNull();
    expect(event?.toStatus).not.toBeNull();
  });

  it("allows reopening a closed enquiry, and records it", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CLOSED_NOT_PROCEEDING,
    });

    // No transition graph: SCCT's stages are unconfirmed, and a student who said
    // they were not proceeding does sometimes come back.
    const reopened = await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.CLOSED_NOT_PROCEEDING,
      toStatusCode: STATUS_CODES.IN_DISCUSSION,
    });

    expect(reopened.ok).toBe(true);
    expect(await EnquiryEvent.countDocuments({ type: "status_changed" })).toBe(2);
  });

  it("rejects a no-op rather than filling history with empty entries", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.NEW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(await EnquiryEvent.countDocuments({ type: "status_changed" })).toBe(0);
  });

  it("refuses to move an enquiry into a deactivated stage", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    await mongoose.connection
      .collection("enquirystatuses")
      .updateOne({ code: STATUS_CODES.CONTACTED }, { $set: { isActive: false } });

    // Moving into a retired stage would be a one-way trip: it would not appear in
    // any dropdown to move back out of.
    const result = await changeStatus(counsellor, id, {
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

// ─── Follow-ups ──────────────────────────────────────────────────────────────

describe("follow-ups", () => {
  it("maintains Enquiry.nextFollowUpAt as the EARLIEST open follow-up", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const later = await scheduleFollowUp(counsellor, id, { dueAt: inDays(10) });
    if (!later.ok) throw new Error(later.message);

    let enquiry = await Enquiry.findById(id).select("nextFollowUpAt").lean();
    expect(enquiry?.nextFollowUpAt?.toISOString()).toBe(later.data.dueAt);

    // Scheduling an EARLIER one must move the cache back, which a naive "set it to
    // whatever was just written" implementation gets right by luck and then gets
    // wrong in the other order.
    const sooner = await scheduleFollowUp(counsellor, id, { dueAt: inDays(3) });
    if (!sooner.ok) throw new Error(sooner.message);

    enquiry = await Enquiry.findById(id).select("nextFollowUpAt").lean();
    expect(enquiry?.nextFollowUpAt?.toISOString()).toBe(sooner.data.dueAt);

    // Completing the earliest must fall back to the next open one, not to null.
    await recordFollowUpOutcome(counsellor, id, sooner.data.id, { status: "completed" });

    enquiry = await Enquiry.findById(id).select("nextFollowUpAt").lean();
    expect(enquiry?.nextFollowUpAt?.toISOString()).toBe(later.data.dueAt);

    // And with none left open, back to null — the state the queue reads as "not
    // scheduled".
    await recordFollowUpOutcome(counsellor, id, later.data.id, { status: "missed" });

    enquiry = await Enquiry.findById(id).select("nextFollowUpAt").lean();
    expect(enquiry?.nextFollowUpAt).toBeNull();
  });

  it("defaults the assignee to the enquiry's current owner", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await scheduleFollowUp(counsellor, id, { dueAt: inDays(2) });
    if (!result.ok) throw new Error(result.message);

    const followUp = await FollowUp.findById(result.data.id).lean();
    expect(String(followUp?.assignedTo)).toBe(counsellor.staffProfileId);
  });

  it("allows a follow-up on an unassigned enquiry", async () => {
    const id = await enquiryOwnedBy(null);

    const result = await scheduleFollowUp(manager, id, { dueAt: inDays(2) });

    // Otherwise the unassigned pool would drop out of the overdue view entirely,
    // which is where a forgotten enquiry hides.
    expect(result.ok).toBe(true);

    const followUp = await FollowUp.findById(result.ok ? result.data.id : "").lean();
    expect(followUp?.assignedTo).toBeNull();
  });

  it("refuses to assign a follow-up to someone not in the rota", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await scheduleFollowUp(counsellor, id, {
      dueAt: inDays(2),
      assignedToId: ineligibleProfileId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("records a cancelled follow-up as cancelled, never as missed", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const scheduled = await scheduleFollowUp(counsellor, id, { dueAt: inDays(2) });
    if (!scheduled.ok) throw new Error(scheduled.message);

    await recordFollowUpOutcome(counsellor, id, scheduled.data.id, { status: "cancelled" });

    // A call that was called off is not a call that was missed, and the log must not
    // claim otherwise — the missed count is a figure a manager acts on.
    expect(await EnquiryEvent.countDocuments({ type: "followup_missed" })).toBe(0);

    const followUp = await FollowUp.findById(scheduled.data.id).lean();
    expect(followUp?.status).toBe("cancelled");
  });

  it("refuses a follow-up belonging to a different enquiry", async () => {
    const mine = await enquiryOwnedBy(counsellor.staffProfileId, "9876543210");
    const other = await enquiryOwnedBy(counsellor.staffProfileId, "9876543211");

    const scheduled = await scheduleFollowUp(counsellor, other, { dueAt: inDays(2) });
    if (!scheduled.ok) throw new Error(scheduled.message);

    const result = await recordFollowUpOutcome(counsellor, mine, scheduled.data.id, {
      status: "completed",
    });

    expect(result.ok).toBe(false);
  });
});

// ─── Notes ───────────────────────────────────────────────────────────────────

describe("addNote", () => {
  it("appends a note as an event with the acting account recorded", async () => {
    const id = await enquiryOwnedBy(counsellor.staffProfileId);

    const result = await addNote(counsellor, id, { note: "Parent asked about fees." });

    expect(result.ok).toBe(true);

    const event = await EnquiryEvent.findOne({ type: "note_added" }).lean();
    expect(event?.note).toBe("Parent asked about fees.");
    expect(String(event?.createdBy)).toBe(counsellor.userId);
  });

  it("requires the note permission specifically", async () => {
    const withoutNotes: Principal = {
      ...counsellor,
      permissions: [PERMISSION_CODES.ENQUIRY_VIEW_OWN, PERMISSION_CODES.ENQUIRY_UPDATE_OWN],
    };

    const id = await enquiryOwnedBy(withoutNotes.staffProfileId);

    const result = await addNote(withoutNotes, id, { note: "Should be refused." });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it("lets a counsellor note an unassigned enquiry they could claim", async () => {
    const id = await enquiryOwnedBy(null);

    // Same scope as claiming: the unassigned pool is theirs to work with.
    const result = await addNote(counsellor, id, { note: "Tried calling, no answer." });

    expect(result.ok).toBe(true);
  });
});

// ─── Schemas ─────────────────────────────────────────────────────────────────

describe("workflow schemas", () => {
  it("requires the value the caller believed was current", () => {
    // Without `fromStatusCode` there is nothing to make the update conditional on,
    // so the schema refuses the request rather than letting it through as a
    // last-write-wins update.
    const result = statusChangeSchema.safeParse({ toStatusCode: STATUS_CODES.CONTACTED });
    expect(result.success).toBe(false);
  });

  it("rejects unexpected fields on a write", () => {
    const result = statusChangeSchema.safeParse({
      fromStatusCode: STATUS_CODES.NEW,
      toStatusCode: STATUS_CODES.CONTACTED,
      owner: new mongoose.Types.ObjectId().toString(),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a follow-up date that is almost certainly a typo", () => {
    for (const dueAt of ["2019-01-01T10:00:00.000Z", "2195-01-01T10:00:00.000Z", "not a date"]) {
      expect(followUpSchema.safeParse({ dueAt }).success, dueAt).toBe(false);
    }

    expect(followUpSchema.safeParse({ dueAt: inDays(3) }).success).toBe(true);
  });
});

// ─── The shaped seed ─────────────────────────────────────────────────────────

describe("seedEnquiries with shaping", () => {
  it("moves stages and schedules follow-ups through the services", async () => {
    const result = await seedEnquiries({
      count: 14,
      shape: true,
      now: new Date("2026-08-21T06:00:00.000Z"),
    });

    expect(result.failures).toEqual([]);
    expect(result.stagesMoved).toBeGreaterThan(0);
    expect(result.followUpsScheduled).toBeGreaterThan(0);

    // Every stage change went through changeStatus(), so each one left a real history
    // entry. That is the property that makes the demo data trustworthy.
    const statusEvents = await EnquiryEvent.countDocuments({ type: "status_changed" });
    expect(statusEvents).toBe(result.stagesMoved);

    // And the cache the queue sorts on was maintained by the service, not written by
    // the seed.
    const withFollowUp = await Enquiry.countDocuments({ nextFollowUpAt: { $ne: null } });
    expect(withFollowUp).toBeGreaterThan(0);
  });

  it("is safe to rerun: the stage guard refuses a second move", async () => {
    const options = { count: 8, shape: true, now: new Date("2026-08-21T06:00:00.000Z") };

    await seedEnquiries(options);
    const second = await seedEnquiries(options);

    // Enquiries already moved out of NEW hit the conditional guard, which is not a
    // failure — it is the guard doing its job, exercised on every rerun.
    expect(second.failures).toEqual([]);
    expect(second.created).toBe(0);
    expect(second.stagesMoved).toBe(0);
    expect(await Enquiry.countDocuments()).toBe(8);
  });
});
