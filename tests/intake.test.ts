import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/enquiries/route";
import { PROGRAMME_CODES, PUBLIC_FORM_SOURCE_CODE, SOURCE_CODES } from "@/config/codes";
import { Enquiry, EnquiryDuplicate, EnquiryEvent, StaffProfile } from "@/models";
import { publicEnquirySchema, staffEnquirySchema } from "@/schemas/enquiry.schema";
import { seedPermissions } from "@/scripts/seed/permissions";
import { seedProgrammes } from "@/scripts/seed/programmes";
import { seedRoles } from "@/scripts/seed/roles";
import { seedSources } from "@/scripts/seed/sources";
import { seedStaff } from "@/scripts/seed/staff";
import { seedStatuses } from "@/scripts/seed/statuses";
import { createEnquiry } from "@/services/enquiry.service";

/**
 * Intake tests — the critical path and its failure cases.
 *
 * Route handlers are called directly with a constructed `Request`. No HTTP server,
 * no port, no supertest: a handler is a plain function, so a test can just be a
 * function call.
 */

async function seedConfig() {
  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions.ids);
  await seedStaff(roles.ids);
  await seedProgrammes();
  await seedSources();
  await seedStatuses();
}

const validInput = {
  fullName: "Asha Demo",
  phone: "9876543210",
  email: "asha.demo@example.invalid",
  programmeCode: PROGRAMME_CODES.BSC_IT,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost:3000/api/enquiries", {
      method: "POST",
      // A distinct IP per test, so the shared in-memory rate-limit bucket from one
      // test cannot fail the next one.
      headers: { "content-type": "application/json", "x-forwarded-for": randomIp(), ...headers },
      body: JSON.stringify(body),
    }),
  );
}

let ipCounter = 0;
function randomIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("schema — the two surfaces", () => {
  it("rejects a public payload that tries to set an owner", () => {
    // The heart of the design: authorization is structural. `.strict()` means the
    // field is refused, not silently ignored.
    const result = publicEnquirySchema.safeParse({
      ...validInput,
      owner: new mongoose.Types.ObjectId().toString(),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a public payload that tries to claim a consent basis", () => {
    const result = publicEnquirySchema.safeParse({ ...validInput, consentBasis: "sourced_list" });

    expect(result.success).toBe(false);
  });

  it("rejects a public payload that tries to choose its own source", () => {
    const result = publicEnquirySchema.safeParse({
      ...validInput,
      sourceCode: SOURCE_CODES.WALK_IN,
    });

    expect(result.success).toBe(false);
  });

  it("accepts those same fields on the staff schema", () => {
    const result = staffEnquirySchema.safeParse({
      ...validInput,
      sourceCode: SOURCE_CODES.WALK_IN,
      consentBasis: "verbal_to_staff",
      assignToMe: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts the phone formats a person actually types", () => {
    for (const phone of ["9876543210", "+91 98765 43210", "098765 43210", "+919876543210"]) {
      expect(publicEnquirySchema.safeParse({ ...validInput, phone }).success, phone).toBe(true);
    }
  });

  it("rejects a phone number that is not a valid Indian mobile", () => {
    for (const phone of ["12345", "1234567890", "98765 4321", "abcdefghij"]) {
      expect(publicEnquirySchema.safeParse({ ...validInput, phone }).success, phone).toBe(false);
    }
  });

  it("treats email as optional, because a walk-in often has none", () => {
    const { email: _email, ...withoutEmail } = validInput;

    expect(publicEnquirySchema.safeParse(withoutEmail).success).toBe(true);
    expect(publicEnquirySchema.safeParse({ ...withoutEmail, email: "" }).success).toBe(true);
    expect(publicEnquirySchema.safeParse({ ...validInput, email: "not-an-email" }).success).toBe(
      false,
    );
  });
});

describe("POST /api/enquiries — the happy path", () => {
  beforeEach(seedConfig);

  it("stores the enquiry and returns 201 with a stable number", async () => {
    const res = await post(validInput);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.enquiryNumber).toMatch(/^ENQ-\d{4}-\d{6}$/);

    // 201 is returned only after the database confirmed the write, so the record
    // must be findable by the number the submitter was given.
    const stored = await Enquiry.findOne({ enquiryNumber: body.data.enquiryNumber });
    expect(stored).not.toBeNull();
    expect(stored!.fullName).toBe(validInput.fullName);
  });

  it("never caches an intake response", async () => {
    const res = await post(validInput);

    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("forces source and consent basis server-side", async () => {
    const res = await post(validInput);
    const { enquiryNumber } = (await res.json()).data;

    const stored = await Enquiry.findOne({ enquiryNumber }).populate<{
      source: { code: string };
    }>("source");

    expect(stored!.source.code).toBe(PUBLIC_FORM_SOURCE_CODE);
    expect(stored!.captureChannel).toBe("public_form");
    expect(stored!.consentBasis).toBe("self_submitted");
    expect(stored!.capturedBy).toBeNull();
  });

  it("snapshots the programme label at capture time", async () => {
    const res = await post(validInput);
    const { enquiryNumber } = (await res.json()).data;

    const stored = await Enquiry.findOne({ enquiryNumber });

    // So a programme renamed next year does not rewrite what this person enquired
    // about.
    expect(stored!.programmeLabelAtCapture).toBe("B.Sc IT");
    expect(stored!.sourceLabelAtCapture).toBe("Website");
  });

  it("stores the phone as typed and normalised for matching", async () => {
    const res = await post({ ...validInput, phone: "+91 98765 43210" });
    const { enquiryNumber } = (await res.json()).data;

    const stored = await Enquiry.findOne({ enquiryNumber });

    expect(stored!.phone).toBe("+91 98765 43210");
    expect(stored!.phoneNormalised).toBe("9876543210");
  });

  it("appends a created event", async () => {
    const res = await post(validInput);
    const { enquiryNumber } = (await res.json()).data;

    const stored = await Enquiry.findOne({ enquiryNumber });
    const events = await EnquiryEvent.find({ enquiry: stored!._id });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("created");
    // null actor: submitted by the person themselves, which is itself meaningful.
    expect(events[0].createdBy).toBeNull();
  });
});

describe("POST /api/enquiries — validation failures", () => {
  beforeEach(seedConfig);

  it("returns 400 with field errors and stores nothing", async () => {
    const res = await post({ fullName: "A", phone: "123", programmeCode: "" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(body.details).sort()).toEqual(["fullName", "phone", "programmeCode"]);

    expect(await Enquiry.countDocuments()).toBe(0);
  });

  it("never echoes the submitted values back in the error", async () => {
    const res = await post({ ...validInput, email: "not-an-email" });
    const text = await res.text();

    // A validation error that repeated the payload would put personal data into
    // logs and error trackers for no reason.
    expect(text).not.toContain("not-an-email");
    expect(text).not.toContain(validInput.phone);
  });

  it("rejects an unknown programme code without storing anything", async () => {
    const res = await post({ ...validInput, programmeCode: "NOT_A_PROGRAMME" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details.programmeCode).toBeTruthy();
    expect(await Enquiry.countDocuments()).toBe(0);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/enquiries", {
        method: "POST",
        headers: { "x-forwarded-for": randomIp() },
        body: "this is not json",
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_FAILED");
  });

  it("rejects an oversized body before parsing it", async () => {
    const res = await post({ ...validInput, message: "x".repeat(20_000) });

    expect(res.status).toBe(400);
    expect(await Enquiry.countDocuments()).toBe(0);
  });

  it("returns a 503 with an explicit code when no default status is configured", async () => {
    // Configuration failure, not the submitter's fault — so it must not be dressed
    // up as a validation error blaming their input.
    await mongoose.connection.collection("enquirystatuses").deleteMany({});

    const res = await post(validInput);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("CONFIG_MISSING");
    expect(await Enquiry.countDocuments()).toBe(0);
  });
});

describe("POST /api/enquiries — rate limiting", () => {
  beforeEach(seedConfig);

  it("refuses a burst from one client with 429 and a retry hint", async () => {
    const ip = "203.0.113.7";
    const results: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      const res = await post(validInput, { "x-forwarded-for": ip });
      results.push(res.status);
    }

    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(results.filter((s) => s === 201).length).toBeLessThanOrEqual(8);
  });
});

describe("idempotency", () => {
  beforeEach(seedConfig);

  it("returns the original record and 200 on a retry, with no second row", async () => {
    const key = "form-mount-abc12345";

    const first = await post({ ...validInput, idempotencyKey: key });
    const second = await post({ ...validInput, idempotencyKey: key });

    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    // 200, not 201: nothing was created this time.
    expect(second.status).toBe(200);
    expect(secondBody.data.enquiryNumber).toBe(firstBody.data.enquiryNumber);

    expect(await Enquiry.countDocuments()).toBe(1);
  });

  it("survives two concurrent retries of the same submission", async () => {
    // Both pass the pre-write check, and the unique index rejects the second. The
    // service must resolve that to the original record, not surface an error.
    const key = "double-click-xyz98765";

    const [a, b] = await Promise.all([
      createEnquiry({
        ...validInput,
        sourceCode: PUBLIC_FORM_SOURCE_CODE,
        captureChannel: "public_form",
        consentBasis: "self_submitted",
        idempotencyKey: key,
      }),
      createEnquiry({
        ...validInput,
        sourceCode: PUBLIC_FORM_SOURCE_CODE,
        captureChannel: "public_form",
        consentBasis: "self_submitted",
        idempotencyKey: key,
      }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    expect(await Enquiry.countDocuments()).toBe(1);

    if (a.ok && b.ok) {
      expect(a.data.enquiry.enquiryNumber).toBe(b.data.enquiry.enquiryNumber);
      // Exactly one of the two was a replay.
      expect([a.data.replayed, b.data.replayed].filter(Boolean)).toHaveLength(1);
    }
  });

  it("does not collide across different submissions without a key", async () => {
    await post(validInput);
    await post(validInput);

    expect(await Enquiry.countDocuments()).toBe(2);
  });
});

describe("the duplicate rule", () => {
  beforeEach(seedConfig);

  it("flags same phone + same programme, and stores both records", async () => {
    const first = await post(validInput);
    const second = await post(validInput);

    // Both stored. The rule flags; it never rejects.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await Enquiry.countDocuments()).toBe(2);

    const flags = await EnquiryDuplicate.find();
    expect(flags).toHaveLength(1);
    expect(flags[0].reviewStatus).toBe("flagged");
    expect(flags[0].matchedOn).toBe("both");
  });

  it("allows same phone + different programme as a separate enquiry", async () => {
    await post({ ...validInput, programmeCode: PROGRAMME_CODES.BSC_IT });
    await post({ ...validInput, programmeCode: PROGRAMME_CODES.BCOM });

    expect(await Enquiry.countDocuments()).toBe(2);
    // One person may genuinely enquire about two programmes. Flagging that would
    // lose a real enquiry.
    expect(await EnquiryDuplicate.countDocuments()).toBe(0);
  });

  it("matches on email alone when the phone differs", async () => {
    await post(validInput);
    await post({ ...validInput, phone: "9000000009" });

    const flags = await EnquiryDuplicate.find();

    expect(flags).toHaveLength(1);
    expect(flags[0].matchedOn).toBe("email");
  });

  it("records the flag in history without storing any contact value", async () => {
    await post(validInput);
    await post(validInput);

    const event = await EnquiryEvent.findOne({ type: "duplicate_flagged" });

    expect(event).not.toBeNull();
    expect(event!.detail).toContain("matched on");
    // Which field matched, never the value — it already exists on both records.
    expect(event!.detail).not.toContain(validInput.phone);
    expect(event!.detail).not.toContain(validInput.email);
  });

  it("never deletes, archives or merges either record", async () => {
    await post(validInput);
    await post(validInput);

    const all = await Enquiry.find();

    expect(all).toHaveLength(2);
    for (const enquiry of all) {
      expect(enquiry.isArchived).toBe(false);
      expect(enquiry.isActive).toBe(true);
    }
  });

  it("does not reset a dismissed flag when detection runs again", async () => {
    await post(validInput);
    await post(validInput);

    await EnquiryDuplicate.updateOne({}, { $set: { reviewStatus: "dismissed" } });

    // A third submission re-runs detection over the same pair.
    await post(validInput);

    const dismissed = await EnquiryDuplicate.countDocuments({ reviewStatus: "dismissed" });

    // A flag that reappears after a manager dismissed it is a flag nobody trusts.
    expect(dismissed).toBe(1);
  });

  it("tells the public submitter nothing about the duplicate", async () => {
    const first = await post(validInput);
    const firstNumber = (await first.json()).data.enquiryNumber;

    const second = await post(validInput);
    const text = await second.text();

    // An anonymous endpoint confirming "this number already enquired" is a
    // phone-number enumeration oracle. The submitter gets their OWN number — that
    // is the receipt — but nothing at all about the earlier record.
    expect(text.toLowerCase()).not.toContain("duplicate");
    expect(text).not.toContain(firstNumber);
    expect(JSON.parse(text).data.possibleDuplicates).toBeUndefined();

    // And the acknowledgement wording is byte-identical either way, so the
    // response cannot be distinguished by its shape.
    const clean = await post({ ...validInput, phone: "9000000123" });
    expect(JSON.parse(text).data.message).toBe((await clean.json()).data.message);
  });

  it("does return the match detail to the service caller, for the staff surface", async () => {
    await post(validInput);

    const result = await createEnquiry({
      ...validInput,
      sourceCode: SOURCE_CODES.WALK_IN,
      captureChannel: "staff_capture",
      consentBasis: "verbal_to_staff",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Staff must see it: without it, two teachers phone the same person, which
      // is the exact failure this system exists to fix.
      expect(result.data.possibleDuplicates).toHaveLength(1);
      expect(result.data.possibleDuplicates[0].enquiryNumber).toMatch(/^ENQ-/);
      expect(result.data.possibleDuplicates[0].status).toBe("New");
    }
  });
});

describe("round-robin ownership", () => {
  beforeEach(seedConfig);

  it("distributes across the eligible staff only", async () => {
    for (let i = 0; i < 6; i += 1) {
      await post({ ...validInput, phone: `98765432${10 + i}` });
    }

    const enquiries = await Enquiry.find().populate<{
      owner: { _id: mongoose.Types.ObjectId; eligibleForAssignment: boolean } | null;
    }>("owner");

    const owners = enquiries.map((e) => String(e.owner?._id));

    // Three eligible staff, six enquiries: every eligible owner used, twice each.
    expect(new Set(owners).size).toBe(3);

    for (const enquiry of enquiries) {
      expect(enquiry.owner).not.toBeNull();
      // The ineligible counsellor must never appear.
      expect(enquiry.owner!.eligibleForAssignment).toBe(true);
    }
  });

  it("falls back to Unassigned when nobody is eligible, without failing the submission", async () => {
    await StaffProfile.updateMany({}, { $set: { eligibleForAssignment: false } });

    const res = await post(validInput);
    const { enquiryNumber } = (await res.json()).data;

    // The submission must not fail because the college has nobody in the rota.
    expect(res.status).toBe(201);

    const stored = await Enquiry.findOne({ enquiryNumber });
    expect(stored!.owner).toBeNull();

    // And the reason is in the history, so "why is this unassigned" is answerable.
    const event = await EnquiryEvent.findOne({ enquiry: stored!._id, type: "created" });
    expect(event!.detail).toContain("no staff were eligible");
  });

  it("gives nine concurrent submissions an even spread and distinct numbers", async () => {
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => post({ ...validInput, phone: `98765430${10 + i}` })),
    );

    const enquiries = await Enquiry.find();
    const numbers = enquiries.map((e) => e.enquiryNumber);
    const owners = enquiries.map((e) => String(e.owner));

    expect(new Set(numbers).size).toBe(9);

    // Three eligible staff, nine enquiries, atomic cursor: three each. A
    // non-atomic cursor produces an uneven spread here.
    const counts = [...new Set(owners)].map((o) => owners.filter((x) => x === o).length);
    expect(counts.sort()).toEqual([3, 3, 3]);
  });
});
