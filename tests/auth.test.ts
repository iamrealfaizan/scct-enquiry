import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import { PERMISSION_CODES, ROLE_CODES } from "@/config/codes";
import { ERROR_CODES } from "@/lib/result";
import { Permission, Role, StaffProfile, User } from "@/models";
import { loginSchema } from "@/schemas/auth.schema";
import { seedPermissions } from "@/scripts/seed/permissions";
import { seedRoles } from "@/scripts/seed/roles";
import { seedStaff } from "@/scripts/seed/staff";
import { verifyCredentials } from "@/services/auth.service";

/**
 * Authentication tests — the critical path and its failure cases.
 *
 * `verifyCredentials` is called directly. That is the reason the rule lives in a
 * service rather than inside Auth.js's `authorize` callback: none of these tests
 * needs a cookie jar, an HTTP request, a CSRF token or the Auth.js runtime, so
 * none of them can fail for a reason unrelated to what it is testing.
 *
 * The password comes from `DEMO_PASSWORD`, which tests/setup.ts sets to an obvious
 * throwaway. It is never written in this file, for the same reason it is not in the
 * seed: a password literal in the repository is a password in source control even
 * when the account is synthetic.
 */

const PASSWORD = process.env.DEMO_PASSWORD as string;

const COUNSELLOR_EMAIL = "counsellor1@demo.scct-enquiry.local";
const MANAGER_EMAIL = "manager1@demo.scct-enquiry.local";
const ADMIN_EMAIL = "admin1@demo.scct-enquiry.local";

async function seedAccounts() {
  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions.ids);
  await seedStaff(roles.ids);
}

beforeEach(seedAccounts);

// ─── The critical path ───────────────────────────────────────────────────────

describe("verifyCredentials — the happy path", () => {
  it("accepts a seeded counsellor and resolves their permissions", async () => {
    const result = await verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.email).toBe(COUNSELLOR_EMAIL);
    expect(result.data.roleCodes).toEqual([ROLE_CODES.COUNSELLOR]);

    // The seeded counsellor's exact grant. Asserted as a set rather than an array
    // so a change to the ORDER of the seed's permission list does not fail a test
    // about what a counsellor can do.
    expect(new Set(result.data.permissions)).toEqual(
      new Set([
        PERMISSION_CODES.ENQUIRY_VIEW_OWN,
        PERMISSION_CODES.ENQUIRY_UPDATE_OWN,
        PERMISSION_CODES.ENQUIRY_NOTE_CREATE,
        PERMISSION_CODES.ENQUIRY_CAPTURE,
      ]),
    );
  });

  it("resolves the staff profile id, which is what enquiry ownership refs", async () => {
    const result = await verifyCredentials({ email: MANAGER_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Not the user id. The two identities are deliberately different (conventions
    // §5.3), and confusing them would assign enquiries to the wrong collection's
    // id — a bug that looks like "the owner column is empty" much later.
    const profile = await StaffProfile.findById(result.data.staffProfileId).lean();

    expect(profile).not.toBeNull();
    expect(String(profile?.user)).toBe(result.data.userId);
    expect(result.data.staffProfileId).not.toBe(result.data.userId);
  });

  it("gives a manager strictly more than a counsellor, and an admin more again", async () => {
    // The seeded roles are cumulative by construction. This test is what stops a
    // junior role from ever being able to do something a senior role cannot — the
    // bug that construction is designed to prevent.
    const [counsellor, manager, admin] = await Promise.all([
      verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD }),
      verifyCredentials({ email: MANAGER_EMAIL, password: PASSWORD }),
      verifyCredentials({ email: ADMIN_EMAIL, password: PASSWORD }),
    ]);

    if (!counsellor.ok || !manager.ok || !admin.ok) throw new Error("seeded login failed");

    const managerSet = new Set(manager.data.permissions);
    const adminSet = new Set(admin.data.permissions);

    for (const code of counsellor.data.permissions) expect(managerSet.has(code)).toBe(true);
    for (const code of manager.data.permissions) expect(adminSet.has(code)).toBe(true);

    expect(manager.data.permissions.length).toBeGreaterThan(counsellor.data.permissions.length);
    expect(admin.data.permissions.length).toBeGreaterThan(manager.data.permissions.length);
  });

  it("records the sign-in time", async () => {
    const before = await User.findOne({ email: COUNSELLOR_EMAIL }).lean();
    expect(before?.lastLoginAt).toBeUndefined();

    await verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD });

    const after = await User.findOne({ email: COUNSELLOR_EMAIL }).lean();
    expect(after?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("does not return the password hash anywhere in the principal", async () => {
    const result = await verifyCredentials({ email: ADMIN_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Asserted against the whole serialised object rather than field by field, so
    // adding a field to `SessionUser` later cannot leak the hash past this test.
    expect(JSON.stringify(result.data)).not.toContain("$2");
    expect(Object.keys(result.data)).not.toContain("password");
  });

  it("stores the password hashed, never in plaintext", async () => {
    // The single most important assertion about the seed: `findOneAndUpdate` would
    // skip the pre-save hook and write the plaintext straight to the database.
    const user = await User.findOne({ email: COUNSELLOR_EMAIL }).select("+password").lean();

    expect(user?.password).toBeDefined();
    expect(user?.password).not.toBe(PASSWORD);
    expect(user?.password).toMatch(/^\$2[aby]\$/);
  });
});

// ─── Failure cases ──────────────────────────────────────────────────────────

describe("verifyCredentials — failure cases", () => {
  it("rejects a wrong password", async () => {
    const result = await verifyCredentials({
      email: COUNSELLOR_EMAIL,
      password: `${PASSWORD}-wrong`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it("rejects an unknown email", async () => {
    const result = await verifyCredentials({
      email: "nobody@demo.scct-enquiry.local",
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it("tells an unknown email and a wrong password apart nowhere in the message", async () => {
    // Account enumeration: if these two differ by so much as a full stop, the login
    // endpoint reveals which staff emails are real.
    const [unknownEmail, wrongPassword] = await Promise.all([
      verifyCredentials({ email: "nobody@demo.scct-enquiry.local", password: PASSWORD }),
      verifyCredentials({ email: COUNSELLOR_EMAIL, password: "definitely-not-it" }),
    ]);

    if (unknownEmail.ok || wrongPassword.ok) throw new Error("expected both to fail");
    expect(unknownEmail.message).toBe(wrongPassword.message);
  });

  it("rejects a suspended account, with the same message as a wrong password", async () => {
    await User.updateOne({ email: MANAGER_EMAIL }, { $set: { status: "suspended" } });

    const suspended = await verifyCredentials({ email: MANAGER_EMAIL, password: PASSWORD });

    expect(suspended.ok).toBe(false);
    if (suspended.ok) return;

    // The CODE differs — that is for logs and for this test. The MESSAGE does not.
    expect(suspended.code).toBe(ERROR_CODES.FORBIDDEN);

    const wrongPassword = await verifyCredentials({
      email: COUNSELLOR_EMAIL,
      password: "definitely-not-it",
    });

    if (wrongPassword.ok) throw new Error("expected failure");
    expect(suspended.message).toBe(wrongPassword.message);
  });

  it("rejects an archived account even while its status still reads active", async () => {
    await User.updateOne({ email: MANAGER_EMAIL }, { $set: { isArchived: true } });

    const result = await verifyCredentials({ email: MANAGER_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(false);
  });

  it("rejects a malformed payload without touching the database", async () => {
    for (const payload of [
      undefined,
      null,
      {},
      { email: "not-an-email", password: PASSWORD },
      { email: COUNSELLOR_EMAIL },
      // `.strict()` — an extra field is refused, not ignored. This is what stops a
      // caller smuggling in a field and hoping something downstream spreads it.
      { email: COUNSELLOR_EMAIL, password: PASSWORD, permissions: ["staff.manage"] },
    ]) {
      const result = await verifyCredentials(payload);

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it("rejects a payload carrying Auth.js's own form fields", async () => {
    /**
     * REGRESSION TEST. Auth.js hands `authorize` the whole submitted body, which
     * includes its `csrfToken` and `callbackUrl`. Because `loginSchema` is
     * `.strict()`, passing that body straight through failed EVERY login with
     * VALIDATION_FAILED — and the login page showed it as "those details do not
     * match", so it read as a wrong password.
     *
     * The fix is in `lib/auth.ts`, which now forwards only email and password. This
     * test pins the schema behaviour that made the mistake possible, so the strict
     * contract stays deliberate rather than being loosened later to "fix" a symptom.
     */
    const result = await verifyCredentials({
      email: COUNSELLOR_EMAIL,
      password: PASSWORD,
      csrfToken: "a-csrf-token",
      callbackUrl: "http://localhost:3000/staff",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    // And the two fields on their own still work — proving the failure above is
    // about the extra fields, not about the credentials.
    const clean = await verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD });
    expect(clean.ok).toBe(true);
  });

  it("accepts an email in any case, because the schema lowercases it", async () => {
    // Not cosmetic: `User.email` is `lowercase: true`, so a mixed-case login would
    // otherwise miss the row and read as an unknown account.
    const result = await verifyCredentials({
      email: COUNSELLOR_EMAIL.toUpperCase(),
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
  });
});

// ─── Permission resolution edge cases ────────────────────────────────────────

describe("permission resolution", () => {
  it("grants nothing when a role has been deactivated", async () => {
    await Role.updateOne({ code: ROLE_CODES.COUNSELLOR }, { $set: { isActive: false } });

    const result = await verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Sign-in still succeeds — the account is valid — but it carries no permissions,
    // so every guard denies. Failing closed is the required direction here.
    expect(result.data.permissions).toEqual([]);
    expect(result.data.roleCodes).toEqual([]);
  });

  it("revokes a deactivated permission row everywhere at once", async () => {
    await Permission.updateOne(
      { code: PERMISSION_CODES.ENQUIRY_CAPTURE },
      { $set: { isActive: false } },
    );

    const result = await verifyCredentials({ email: ADMIN_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No role was edited. Filtering at both levels is what makes this work, and it
    // is why "turn that capability off for everyone" is one write, not eleven.
    expect(result.data.permissions).not.toContain(PERMISSION_CODES.ENQUIRY_CAPTURE);
    expect(result.data.permissions).toContain(PERMISSION_CODES.STAFF_MANAGE);
  });

  it("deduplicates permissions held through two overlapping roles", async () => {
    const [counsellor, manager] = await Promise.all([
      Role.findOne({ code: ROLE_CODES.COUNSELLOR }).lean(),
      Role.findOne({ code: ROLE_CODES.MANAGER }).lean(),
    ]);

    await User.updateOne(
      { email: COUNSELLOR_EMAIL },
      { $set: { roles: [counsellor!._id, manager!._id] } },
    );

    const result = await verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The seeded roles are cumulative, so these two overlap almost entirely. An
    // undeduplicated list would carry the same codes twice into the cookie.
    expect(result.data.permissions.length).toBe(new Set(result.data.permissions).size);
    expect(result.data.roleCodes.sort()).toEqual([ROLE_CODES.COUNSELLOR, ROLE_CODES.MANAGER]);
  });

  it("signs in an account with no staff profile, and marks it unable to own enquiries", async () => {
    const role = await Role.findOne({ code: ROLE_CODES.ADMIN }).lean();

    const user = new User({
      email: "profileless@demo.scct-enquiry.local",
      password: PASSWORD,
      roles: [role!._id],
    });
    await user.save();

    const result = await verifyCredentials({
      email: "profileless@demo.scct-enquiry.local",
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A real state, not a failure: this account can act, but can never be an
    // enquiry owner because ownership refs StaffProfile.
    expect(result.data.staffProfileId).toBeNull();
    // With no profile there is no name to show, so the email stands in rather than
    // rendering an empty header.
    expect(result.data.displayName).toBe("profileless@demo.scct-enquiry.local");
  });

  it("grants nothing to an account holding a role that no longer exists", async () => {
    await User.updateOne(
      { email: COUNSELLOR_EMAIL },
      { $set: { roles: [new mongoose.Types.ObjectId()] } },
    );

    const result = await verifyCredentials({ email: COUNSELLOR_EMAIL, password: PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.permissions).toEqual([]);
  });
});

// ─── The shared schema ──────────────────────────────────────────────────────

describe("loginSchema", () => {
  it("trims and lowercases the email, so the form and the service agree", () => {
    const parsed = loginSchema.parse({
      email: "  Counsellor1@Demo.SCCT-Enquiry.Local  ",
      password: "whatever",
    });

    expect(parsed.email).toBe("counsellor1@demo.scct-enquiry.local");
  });

  it("does not trim the password", () => {
    // Leading or trailing whitespace can be part of a password. Trimming it would
    // silently reject a correct one, and the user would have no way to tell why.
    const parsed = loginSchema.parse({ email: COUNSELLOR_EMAIL, password: "  spaced  " });

    expect(parsed.password).toBe("  spaced  ");
  });

  it("caps the password length, because bcrypt cost scales with input", () => {
    const result = loginSchema.safeParse({
      email: COUNSELLOR_EMAIL,
      password: "x".repeat(5_000),
    });

    expect(result.success).toBe(false);
  });
});
