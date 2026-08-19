import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import { EnquirySource, EnquiryStatus, Permission, Programme, Role, StaffProfile, User } from "@/models";
import { PERMISSION_CODES, seedPermissions } from "@/scripts/seed/permissions";
import { PROGRAMME_CODES, seedProgrammes } from "@/scripts/seed/programmes";
import { ROLE_CODES, seedRoles } from "@/scripts/seed/roles";
import { PUBLIC_FORM_SOURCE_CODE, seedSources } from "@/scripts/seed/sources";
import { seedStaff } from "@/scripts/seed/staff";
import { DEFAULT_STATUS_CODE, seedStatuses } from "@/scripts/seed/statuses";

/**
 * Seed tests.
 *
 * These run the seeders against the in-memory database, never against Atlas — so
 * they verify the seed logic without a cluster existing and without touching any
 * real environment.
 *
 * The property under test that matters most is IDEMPOTENCE. The seed will be run
 * more than once, including against the deployed database, and a seed that
 * duplicates rows or resets an operator's deliberate change on the second run is
 * a data-loss bug wearing a setup script's clothes.
 */

async function seedAll() {
  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions.ids);
  const staff = await seedStaff(roles.ids);
  const programmes = await seedProgrammes();
  const sources = await seedSources();
  const statuses = await seedStatuses();

  return { permissions, roles, staff, programmes, sources, statuses };
}

describe("seed — first run", () => {
  it("creates the configuration and reports what it created", async () => {
    const result = await seedAll();

    expect(result.permissions.created).toBe(result.permissions.total);
    expect(result.roles.created).toBe(3);
    expect(result.programmes.created).toBe(7);
    expect(result.statuses.created).toBe(5);
    expect(result.staff.created).toBe(5);

    // Both reported taxonomies, seeded as reported: 7 route + 6 source.
    expect(result.sources.created).toBe(13);
  });

  it("seeds the seven confirmed programmes and leaves `stream` unset", async () => {
    await seedProgrammes();

    const programmes = await Programme.find().sort({ displayOrder: 1 });

    expect(programmes.map((p) => p.code)).toEqual([
      PROGRAMME_CODES.BCOM,
      PROGRAMME_CODES.BCOM_MS,
      PROGRAMME_CODES.BAF,
      PROGRAMME_CODES.BBI,
      PROGRAMME_CODES.BAMMC,
      PROGRAMME_CODES.BSC_IT,
      PROGRAMME_CODES.BSC_CS,
    ]);

    // NEP / Non-NEP is unconfirmed. Guessing it would put an invented client fact
    // into reporting.
    for (const programme of programmes) {
      expect(programme.stream).toBeUndefined();
    }
  });

  it("keeps both source taxonomies distinguishable and maps neither", async () => {
    await seedSources();

    const route = await EnquirySource.countDocuments({ taxonomyGroup: "route_analysis" });
    const analysis = await EnquirySource.countDocuments({ taxonomyGroup: "source_analysis" });
    const canonical = await EnquirySource.countDocuments({ taxonomyGroup: "canonical" });

    expect(route).toBe(7);
    expect(analysis).toBe(6);

    // No canonical taxonomy is invented. The self-ref column stands ready for
    // SCCT's answer; nothing pre-empts it.
    expect(canonical).toBe(0);
    expect(await EnquirySource.countDocuments({ canonicalSource: { $ne: null } })).toBe(0);
  });

  it("forces the public form's source to a real SCCT route", async () => {
    await seedSources();

    const source = await EnquirySource.findOne({ code: PUBLIC_FORM_SOURCE_CODE });

    expect(source).not.toBeNull();
    expect(source!.isActive).toBe(true);
  });

  it("marks every seeded status as an unconfirmed placeholder", async () => {
    await seedStatuses();

    const statuses = await EnquiryStatus.find();

    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      // Hard rule: unconfirmed values are never presented as confirmed process.
      expect(status.isPlaceholder).toBe(true);
      expect(status.description).toBeTruthy();
    }
  });

  it("has exactly one default status, enforced by the database", async () => {
    await seedStatuses();

    const defaults = await EnquiryStatus.find({ isDefault: true });

    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe(DEFAULT_STATUS_CODE);

    // The partial unique index — a second default is impossible, not merely
    // discouraged. Two defaults would make intake non-deterministic.
    await expect(
      EnquiryStatus.create({ code: "SECOND_DEFAULT", label: "Second", isDefault: true }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("marks the two closing stages terminal and the working stages not", async () => {
    await seedStatuses();

    const terminal = await EnquiryStatus.find({ isTerminal: true });
    const open = await EnquiryStatus.find({ isTerminal: false });

    // isTerminal drives follow-up and reporting logic, so the split is asserted
    // rather than left to the display order.
    expect(terminal).toHaveLength(2);
    expect(open).toHaveLength(3);
  });
});

describe("seed — role and permission wiring", () => {
  beforeEach(async () => {
    await seedAll();
  });

  it("gives each role its permissions cumulatively", async () => {
    const roles = await Role.find().populate<{ permissions: { code: string }[] }>("permissions");
    const codesFor = (code: string) =>
      roles.find((r) => r.code === code)!.permissions.map((p) => p.code);

    const counsellor = codesFor(ROLE_CODES.COUNSELLOR);
    const manager = codesFor(ROLE_CODES.MANAGER);
    const admin = codesFor(ROLE_CODES.ADMIN);

    // The bug this prevents: a junior role able to do something a senior role
    // cannot, because the three lists were maintained independently.
    for (const code of counsellor) expect(manager).toContain(code);
    for (const code of manager) expect(admin).toContain(code);

    expect(manager.length).toBeGreaterThan(counsellor.length);
    expect(admin.length).toBeGreaterThan(manager.length);
  });

  it("withholds cross-queue, reporting and export access from a counsellor", async () => {
    const role = await Role.findOne({ code: ROLE_CODES.COUNSELLOR }).populate<{
      permissions: { code: string }[];
    }>("permissions");

    const codes = role!.permissions.map((p) => p.code);

    expect(codes).toContain(PERMISSION_CODES.ENQUIRY_VIEW_OWN);
    expect(codes).not.toContain(PERMISSION_CODES.ENQUIRY_VIEW_ALL);
    expect(codes).not.toContain(PERMISSION_CODES.ENQUIRY_REASSIGN);
    expect(codes).not.toContain(PERMISSION_CODES.REPORT_VIEW);
    expect(codes).not.toContain(PERMISSION_CODES.EXPORT_RUN);
    expect(codes).not.toContain(PERMISSION_CODES.CONFIG_MANAGE);
  });

  it("resolves a user's permissions through roles, with no permissions on the user", async () => {
    // The three-table path every request will walk: User.roles → Role.permissions.
    const user = await User.findOne({ email: "manager1@demo.scct-enquiry.local" }).populate<{
      roles: { code: string; permissions: mongoose.Types.ObjectId[] }[];
    }>("roles");

    expect(user!.roles).toHaveLength(1);
    expect(user!.roles[0].code).toBe(ROLE_CODES.MANAGER);
    expect(user!.roles[0].permissions.length).toBeGreaterThan(0);

    // Identity holds no domain data and no direct permissions (conventions §5.3).
    expect(user).not.toHaveProperty("firstName");
    expect(user).not.toHaveProperty("permissions");
  });
});

describe("seed — synthetic staff", () => {
  beforeEach(async () => {
    await seedAll();
  });

  it("creates five accounts, all on a non-resolvable demo domain", async () => {
    const users = await User.find();

    expect(users).toHaveLength(5);
    for (const user of users) {
      // `.local` is reserved and cannot resolve, so a synthetic account can never
      // reach a real inbox.
      expect(user.email).toMatch(/@demo\.scct-enquiry\.local$/);
    }
  });

  it("hashes every seeded password", async () => {
    // The reason staff seeding uses .save() and not findOneAndUpdate: the latter
    // does not fire save hooks and would write plaintext.
    const raw = await mongoose.connection.collection("users").find().toArray();

    for (const user of raw) {
      expect(user.password).toMatch(/^\$2[aby]\$/);
      expect(user.password).not.toBe(process.env.DEMO_PASSWORD);
    }
  });

  it("pairs every login with exactly one staff profile", async () => {
    const users = await User.find();
    const profiles = await StaffProfile.find();

    expect(profiles).toHaveLength(users.length);
    for (const user of users) {
      expect(await StaffProfile.countDocuments({ user: user._id })).toBe(1);
    }
  });

  it("leaves three staff eligible for assignment, including one deliberate exclusion", async () => {
    const eligible = await StaffProfile.find({ eligibleForAssignment: true });
    const excluded = await StaffProfile.find({ eligibleForAssignment: false });

    // Three eligible is what makes a round-robin cycle visible rather than
    // indistinguishable from alternating.
    expect(eligible).toHaveLength(3);
    // And the ineligible pair is what proves the filter is applied at all.
    expect(excluded).toHaveLength(2);
  });

  it("refuses to seed without a DEMO_PASSWORD", async () => {
    const original = process.env.DEMO_PASSWORD;
    delete process.env.DEMO_PASSWORD;

    try {
      const permissions = await seedPermissions();
      const roles = await seedRoles(permissions.ids);
      await expect(seedStaff(roles.ids)).rejects.toThrow(/DEMO_PASSWORD/);
    } finally {
      process.env.DEMO_PASSWORD = original;
    }
  });
});

describe("seed — second run is idempotent", () => {
  it("creates nothing new and duplicates nothing", async () => {
    await seedAll();
    const second = await seedAll();

    // Every seeder reports zero created on the second pass.
    for (const step of Object.values(second)) {
      expect(step.created, `${step.label} created rows on a re-run`).toBe(0);
    }

    expect(await Permission.countDocuments()).toBe(second.permissions.total);
    expect(await Role.countDocuments()).toBe(3);
    expect(await Programme.countDocuments()).toBe(7);
    expect(await EnquirySource.countDocuments()).toBe(13);
    expect(await EnquiryStatus.countDocuments()).toBe(5);
    expect(await User.countDocuments()).toBe(5);
    expect(await StaffProfile.countDocuments()).toBe(5);
  });

  it("does not reset a password on a re-run", async () => {
    await seedAll();

    const before = (await mongoose.connection
      .collection("users")
      .findOne({ email: "admin1@demo.scct-enquiry.local" }))!.password;

    await seedAll();

    const after = (await mongoose.connection
      .collection("users")
      .findOne({ email: "admin1@demo.scct-enquiry.local" }))!.password;

    // Silently resetting a password on every seed run is a hostile side effect in
    // any shared environment.
    expect(after).toBe(before);
  });

  it("does not resurrect an archived configuration row", async () => {
    await seedAll();

    // Stand-in for an admin deliberately retiring a source through the app.
    await EnquirySource.updateOne(
      { code: PUBLIC_FORM_SOURCE_CODE },
      { $set: { isArchived: true, isActive: false } },
    );

    await seedSources();

    const source = await EnquirySource.findOne({ code: PUBLIC_FORM_SOURCE_CODE });

    // Lifecycle flags are `$setOnInsert`, never `$set` — un-archiving a row a
    // human archived is a destructive change disguised as a create.
    expect(source!.isArchived).toBe(true);
    expect(source!.isActive).toBe(false);
  });

  it("does not reset assignment eligibility on a re-run", async () => {
    await seedAll();

    // Stand-in for a manager taking a counsellor out of the rota.
    await StaffProfile.updateOne(
      { firstName: "Asha" },
      { $set: { eligibleForAssignment: false } },
    );

    await seedAll();

    const profile = await StaffProfile.findOne({ firstName: "Asha" });

    expect(profile!.eligibleForAssignment).toBe(false);
  });

  it("propagates a corrected label on a re-run", async () => {
    await seedAll();

    // The other half of the $set / $setOnInsert split: fields the seed OWNS must
    // update, or fixing a typo would require a manual database edit.
    await EnquiryStatus.updateOne({ code: DEFAULT_STATUS_CODE }, { $set: { label: "Wrong" } });

    await seedStatuses();

    const status = await EnquiryStatus.findOne({ code: DEFAULT_STATUS_CODE });

    expect(status!.label).toBe("New");
  });
});
