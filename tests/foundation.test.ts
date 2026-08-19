import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import * as models from "@/models";
import { Enquiry, Sequence, User } from "@/models";

/**
 * Milestone 1 tests — the foundation's claims, verified rather than asserted.
 *
 * Each of these guards a specific failure that would be expensive to find later:
 * a `ref` that cannot resolve, two enquiries sharing a number under load, or a
 * password written in plaintext because a write bypassed a save hook.
 */

describe("model registry", () => {
  it("registers all twelve models on the shared mongoose instance", () => {
    // The names every `ref` in the schemas resolves against. If one is missing,
    // populate() throws MissingSchemaError — intermittently, depending on import
    // order, which in serverless varies per cold start. See models/index.ts.
    const expected = [
      "User",
      "Role",
      "Permission",
      "StaffProfile",
      "Programme",
      "EnquirySource",
      "EnquiryStatus",
      "Enquiry",
      "EnquiryEvent",
      "EnquiryDuplicate",
      "FollowUp",
      "Sequence",
    ];

    for (const name of expected) {
      expect(mongoose.models[name], `model "${name}" is not registered`).toBeDefined();
    }
  });

  it("re-importing does not throw OverwriteModelError", async () => {
    // The `mongoose.models.X ?? mongoose.model(...)` guard. Without it, the second
    // request to a warm serverless function throws.
    await expect(import("@/models")).resolves.toBeDefined();
    expect(Object.keys(models).length).toBeGreaterThan(0);
  });
});

describe("Sequence — atomic counters", () => {
  it("gives twenty concurrent callers twenty distinct values", async () => {
    // The property the enquiry number and the round-robin cursor both rest on.
    // `countDocuments() + 1` fails this test, which is why it is a rule.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        Sequence.findOneAndUpdate(
          { _id: "test:concurrent" },
          { $inc: { value: 1 } },
          { new: true, upsert: true },
        ),
      ),
    );

    const values = results.map((r) => r!.value);

    expect(new Set(values).size).toBe(20);
    expect(Math.max(...values)).toBe(20);
  });

  it("starts a new counter at 1, not 0", async () => {
    const doc = await Sequence.findOneAndUpdate(
      { _id: "test:fresh" },
      { $inc: { value: 1 } },
      { new: true, upsert: true },
    );

    expect(doc!.value).toBe(1);
  });
});

describe("User — password handling", () => {
  const credentials = { email: "hash-test@demo.scct-enquiry.local", password: "a-plain-password" };

  it("hashes the password on save and never stores the plaintext", async () => {
    const user = new User(credentials);
    await user.save();

    // Read straight from the driver, bypassing the schema's `select: false`, so
    // this asserts what is actually on disk.
    const raw = await mongoose.connection.collection("users").findOne({ email: credentials.email });

    expect(raw).not.toBeNull();
    expect(raw!.password).not.toBe(credentials.password);
    expect(raw!.password).toMatch(/^\$2[aby]\$/); // a bcrypt hash
  });

  it("excludes the password from a normal query", async () => {
    await new User(credentials).save();

    const found = await User.findOne({ email: credentials.email });

    expect(found).not.toBeNull();
    // `select: false` — an API that returns a user cannot leak the hash by accident.
    expect(found!.password).toBeUndefined();
  });

  it("compares a correct and an incorrect password", async () => {
    await new User(credentials).save();

    const found = await User.findOne({ email: credentials.email }).select("+password");

    await expect(found!.comparePassword(credentials.password)).resolves.toBe(true);
    await expect(found!.comparePassword("the-wrong-password")).resolves.toBe(false);
  });

  it("does not re-hash an unchanged password on an unrelated update", async () => {
    // The bug this guards: re-hashing an already-hashed value locks the user out
    // of their own account on the next unrelated save.
    const user = new User(credentials);
    await user.save();

    const before = (await mongoose.connection
      .collection("users")
      .findOne({ email: credentials.email }))!.password;

    user.lastLoginAt = new Date();
    await user.save();

    const after = (await mongoose.connection
      .collection("users")
      .findOne({ email: credentials.email }))!.password;

    expect(after).toBe(before);
  });

  it("refuses to compare when the password field was not selected", async () => {
    await new User(credentials).save();
    const found = await User.findOne({ email: credentials.email });

    // An explicit error, not a silent `false` — which would look like a wrong
    // password and send someone hunting in the wrong place.
    expect(() => found!.comparePassword(credentials.password)).toThrow(/select\("\+password"\)/);
  });

  it("rejects a duplicate email", async () => {
    await new User(credentials).save();
    await expect(new User(credentials).save()).rejects.toThrow(/duplicate key/i);
  });
});

describe("Enquiry — number assignment", () => {
  // The minimum a valid enquiry needs. Ids are stand-ins: this suite is about the
  // numbering hook, and the real refs are exercised by the seed and service tests.
  const base = () => ({
    fullName: "Asha Demo",
    phone: "+91 90000 00001",
    phoneNormalised: "9000000001",
    programme: new mongoose.Types.ObjectId(),
    programmeLabelAtCapture: "B.Sc IT",
    source: new mongoose.Types.ObjectId(),
    sourceLabelAtCapture: "Website",
    status: new mongoose.Types.ObjectId(),
    captureChannel: "public_form" as const,
    consentBasis: "self_submitted" as const,
  });

  it("assigns a stable, readable, year-scoped number", async () => {
    const enquiry = await Enquiry.create(base());
    const year = new Date().getFullYear();

    expect(enquiry.enquiryNumber).toBe(`ENQ-${year}-000001`);
  });

  it("gives ten concurrent submissions ten distinct numbers", async () => {
    // The failure this prevents is two enquiries with one identifier — which makes
    // every downstream reference ambiguous and is unrecoverable after the fact.
    const created = await Promise.all(Array.from({ length: 10 }, () => Enquiry.create(base())));
    const numbers = created.map((e) => e.enquiryNumber);

    expect(new Set(numbers).size).toBe(10);
  });

  it("enforces uniqueness of the number at the database level", async () => {
    const first = await Enquiry.create(base());

    // Bypasses the hook by supplying the number, to prove the index — not the
    // hook — is the last line of defence.
    await expect(
      Enquiry.create({ ...base(), enquiryNumber: first.enquiryNumber }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("treats a missing owner as Unassigned rather than an error", async () => {
    const enquiry = await Enquiry.create(base());

    // null is a real, expected state: it is where round-robin falls back to when
    // no eligible staff exist.
    expect(enquiry.owner).toBeNull();
    expect(enquiry.nextFollowUpAt).toBeNull();
  });

  it("allows two enquiries from the same phone for different programmes", async () => {
    // The approved duplicate rule at the storage layer: no unique index may stand
    // in the way of one person enquiring about two programmes.
    const phone = { phone: "+91 90000 00002", phoneNormalised: "9000000002" };

    await Enquiry.create({ ...base(), ...phone });
    await expect(Enquiry.create({ ...base(), ...phone })).resolves.toBeDefined();
  });

  it("suppresses a retried submission carrying the same idempotency key", async () => {
    const key = "idem-test-0001";

    await Enquiry.create({ ...base(), idempotencyKey: key });

    // Must collide, so the service can resolve the retry to the original record.
    await expect(Enquiry.create({ ...base(), idempotencyKey: key })).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("does not collide on the many records that carry no idempotency key", async () => {
    // The `sparse` half of the unique+sparse index. Without sparse, the second
    // key-less enquiry would fail on a null collision.
    await Enquiry.create(base());
    await expect(Enquiry.create(base())).resolves.toBeDefined();
  });
});
