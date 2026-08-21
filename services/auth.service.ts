import bcrypt from "bcryptjs";
import type { Types } from "mongoose";

import { ERROR_CODES, fail, fromError, ok, type Result } from "@/lib/result";
import { Permission, Role, StaffProfile, User } from "@/models";
import { loginSchema, type LoginInput } from "@/schemas/auth.schema";

/**
 * Credential verification — the business rule behind logging in.
 *
 * WHY THIS IS A SERVICE AND NOT THE Auth.js `authorize` CALLBACK. Conventions §3:
 * business rules live in services, and services are plain functions that return a
 * `Result`. Keeping the rule here means the whole of login — a wrong password, a
 * suspended account, an account with no staff profile, a database that is down —
 * is testable by calling one function, with no Auth.js machinery, no HTTP and no
 * cookie jar. `lib/auth.ts` is left as a thin adapter that calls this and
 * translates the result into what Auth.js expects.
 *
 * WHAT ENDS UP IN THE SESSION IS DECIDED HERE, once, at login. The returned
 * `SessionUser` is exactly what gets signed into the cookie — see the staleness
 * trade-off recorded in `lib/auth.ts`.
 */

/**
 * The authenticated principal. Deliberately flat and primitive-only: this object
 * is JSON-serialised into a JWT, so no ObjectIds, no Dates, no Mongoose documents.
 *
 * TWO IDENTIFIERS, AND THEY ARE NOT INTERCHANGEABLE (conventions §5.3):
 *   userId         — the account that ACTED. Audit fields ref this.
 *   staffProfileId — the person who OWNS admissions work. Enquiry.owner refs this.
 *
 * `staffProfileId` is nullable because an account can legitimately exist without
 * being a member of admissions staff. Such a user can log in and use whatever
 * their role permits; they simply can never be an enquiry owner.
 */
export type SessionUser = {
  userId: string;
  email: string;
  displayName: string;
  staffProfileId: string | null;
  roleCodes: string[];
  permissions: string[];
};

/**
 * A bcrypt hash of a value nobody knows, used when the email does not exist.
 *
 * WHY. Without it, a request for an unknown email returns as fast as the database
 * lookup, while a known email pays for a bcrypt comparison. That difference is
 * measurable over a few hundred requests and turns the login endpoint into an
 * account-enumeration oracle. Comparing against this constant makes both paths do
 * the same work.
 *
 * The cost factor matches the one in `User`'s pre-save hook (10). If that changes,
 * this must change with it or the timing equalisation stops holding.
 */
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * Verify an email and password, and resolve everything the session needs.
 *
 * FAILURE MESSAGES ARE IDENTICAL ON EVERY PATH, on purpose. A wrong password, an
 * unknown email, a suspended account and an archived account all produce the same
 * sentence, so the response cannot be used to discover which staff emails are
 * real. The `code` differs — that is for logs and tests, and is never shown to the
 * caller.
 *
 * The ONE exception is `DB_UNAVAILABLE`, which must be distinguishable: "we cannot
 * reach the database" and "your password is wrong" require different actions from
 * the person reading it, and conflating them is the failure-handling mistake this
 * codebase exists to avoid.
 */
export async function verifyCredentials(input: unknown): Promise<Result<SessionUser>> {
  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    return fail(ERROR_CODES.VALIDATION_FAILED, "Enter a valid email address and password.");
  }

  const { email, password }: LoginInput = parsed.data;

  try {
    // `.select("+password")` is mandatory: the field is `select: false` in the
    // schema, and `comparePassword` throws rather than silently comparing against
    // undefined if it is missing.
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      // Equalise timing before returning. See DUMMY_HASH above.
      await bcrypt.compare(password, DUMMY_HASH);
      return invalidCredentials();
    }

    // Password first, then account state. Checking state first would let a caller
    // learn that an email exists and is suspended without knowing the password.
    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) return invalidCredentials();

    if (user.status !== "active" || !user.isActive || user.isArchived) {
      return fail(
        ERROR_CODES.FORBIDDEN,
        // Same sentence as a wrong password. Deliberate — see the note above.
        "Those details do not match an active account.",
      );
    }

    const permissions = await resolvePermissions(user.roles);

    // The domain profile, if this account is a member of admissions staff.
    // `isArchived` is excluded but `isActive` is NOT: an inactive staff member who
    // can still log in keeps their identity for audit purposes, and eligibility
    // for NEW enquiries is a separate flag the assignment service owns.
    const profile = await StaffProfile.findOne({ user: user._id, isArchived: false })
      .select("firstName lastName")
      .lean();

    // Recorded after every successful verification, and deliberately not awaited
    // as part of the critical path's correctness: if this write fails the login
    // still succeeds, because a missing `lastLoginAt` is a lost diagnostic, not a
    // lost session. It is awaited only so tests are deterministic.
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    return ok({
      userId: String(user._id),
      email: user.email,
      displayName: profile
        ? [profile.firstName, profile.lastName].filter(Boolean).join(" ")
        : user.email,
      staffProfileId: profile ? String(profile._id) : null,
      roleCodes: permissions.roleCodes,
      permissions: permissions.codes,
    });
  } catch (err) {
    // `fromError` separates an unreachable database from a genuine bug, so the
    // login page can say "try again" rather than "check your password".
    return fromError(err);
  }
}

function invalidCredentials(): Result<SessionUser> {
  return fail(ERROR_CODES.UNAUTHENTICATED, "Those details do not match an active account.");
}

/**
 * Resolve `User.roles[] → Role.permissions[] → Permission.code[]` into a flat list.
 *
 * TWO EXPLICIT QUERIES RATHER THAN `.populate()` NESTING. A nested populate here
 * returns a shape TypeScript cannot narrow without casting, and the cast is where
 * a silent mistake would hide — a role whose permissions failed to populate would
 * read as a role with no permissions, which grants less than intended and is
 * invisible until someone reports being unable to do their job.
 *
 * INACTIVE AND ARCHIVED ROWS ARE FILTERED AT BOTH LEVELS. Deactivating a
 * permission row must revoke it everywhere, without editing every role that
 * references it.
 */
async function resolvePermissions(
  roleIds: Types.ObjectId[],
): Promise<{ roleCodes: string[]; codes: string[] }> {
  if (!roleIds || roleIds.length === 0) return { roleCodes: [], codes: [] };

  const roles = await Role.find({
    _id: { $in: roleIds },
    isActive: true,
    isArchived: false,
  })
    .select("code permissions")
    .lean();

  const permissionIds = roles.flatMap((role) => role.permissions);

  if (permissionIds.length === 0) {
    return { roleCodes: roles.map((role) => role.code), codes: [] };
  }

  const permissions = await Permission.find({
    _id: { $in: permissionIds },
    isActive: true,
    isArchived: false,
  })
    .select("code")
    .lean();

  return {
    roleCodes: roles.map((role) => role.code),
    // Deduplicated: the seeded roles are cumulative by construction, so two roles
    // on one account overlap heavily and an undeduplicated list would carry the
    // same code several times into the cookie.
    codes: [...new Set(permissions.map((permission) => permission.code))],
  };
}
