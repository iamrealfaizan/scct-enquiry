import type { Types } from "mongoose";

import { StaffProfile, User } from "@/models";

import { ROLE_CODES, type RoleCode, type RoleIds } from "./roles";

/**
 * Synthetic staff accounts — five of them, and every detail here is a decision.
 *
 * ALL DATA IS SYNTHETIC. No real SCCT staff member appears in this file. The
 * email domain is `demo.scct-enquiry.local`: `.local` is reserved and can never
 * resolve, so one of these addresses can never reach a real inbox even by
 * accident, and it can never be confused for a real SCCT account.
 *
 * WHY THREE COUNSELLORS. Round-robin assignment across two owners is
 * indistinguishable from alternating, and across one it is indistinguishable from
 * doing nothing. Three is the smallest number where the cursor visibly cycles —
 * which matters because that is a thing to demonstrate live, not just claim.
 *
 * ONE COUNSELLOR IS INELIGIBLE, deliberately. `counsellor3` has
 * `eligibleForAssignment: false`, representing someone on leave or not in the
 * admissions rota. It means the very first demo of round-robin proves the
 * eligibility filter works, rather than proving it on a happy path where every
 * staff member is eligible.
 *
 * THE PASSWORD IS NOT IN THIS FILE. It comes from `DEMO_PASSWORD` in the
 * environment. A committed password string is a secret in source control even
 * when the account is synthetic — and it is exactly what a reviewer greps for.
 *
 * HOW HASHING HAPPENS. These are created with `new User(...).save()`, never
 * `findOneAndUpdate`. The bcrypt hash lives in a `pre("save")` hook, and
 * `findOneAndUpdate` does NOT fire save hooks — it would write the plaintext
 * password straight to the database. That is the single most important line in
 * this file.
 */

const DEMO_EMAIL_DOMAIN = "demo.scct-enquiry.local";

const STAFF: Array<{
  localPart: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  role: RoleCode;
  eligibleForAssignment: boolean;
}> = [
  {
    localPart: "counsellor1",
    firstName: "Asha",
    lastName: "Demo",
    jobTitle: "Admissions Counsellor",
    role: ROLE_CODES.COUNSELLOR,
    eligibleForAssignment: true,
  },
  {
    localPart: "counsellor2",
    firstName: "Rohit",
    lastName: "Sample",
    jobTitle: "Admissions Counsellor",
    role: ROLE_CODES.COUNSELLOR,
    eligibleForAssignment: true,
  },
  {
    localPart: "counsellor3",
    firstName: "Meera",
    lastName: "Placeholder",
    jobTitle: "Admissions Counsellor (not in rota)",
    role: ROLE_CODES.COUNSELLOR,
    // See the note above: the deliberately ineligible owner.
    eligibleForAssignment: false,
  },
  {
    localPart: "manager1",
    firstName: "Vikram",
    lastName: "Example",
    jobTitle: "Admissions Manager",
    role: ROLE_CODES.MANAGER,
    // A manager oversees the queue rather than working it. Eligible so that the
    // fallback behaviour when no counsellor is available is demonstrable, and
    // because SCCT has not confirmed who may receive enquiries (open question 4).
    eligibleForAssignment: true,
  },
  {
    localPart: "admin1",
    firstName: "Sara",
    lastName: "Testcase",
    jobTitle: "System Administrator",
    role: ROLE_CODES.ADMIN,
    // An administrator maintains configuration; they are not in the calling rota.
    eligibleForAssignment: false,
  },
];

export type StaffIds = Map<string, { user: Types.ObjectId; profile: Types.ObjectId }>;

export async function seedStaff(roleIds: RoleIds) {
  const password = process.env.DEMO_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error(
      "DEMO_PASSWORD is missing or shorter than 12 characters.\n" +
        "  It is required to seed the synthetic staff accounts, and is deliberately\n" +
        "  not committed. Add it to .env.local — see .env.example.",
    );
  }

  if (password.startsWith("REPLACE_")) {
    throw new Error("DEMO_PASSWORD still holds the .env.example placeholder value.");
  }

  const ids: StaffIds = new Map();
  let createdUsers = 0;
  let createdProfiles = 0;

  for (const member of STAFF) {
    const email = `${member.localPart}@${DEMO_EMAIL_DOMAIN}`;
    const roleId = roleIds.get(member.role);

    if (!roleId) throw new Error(`Staff "${email}" references unseeded role "${member.role}"`);

    // ── the login ─────────────────────────────────────────────────────────────
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        email,
        password,
        status: "active",
        roles: [roleId],
      });
      // .save() so the pre("save") bcrypt hook runs. See the note above.
      await user.save();
      createdUsers += 1;
    } else {
      // Re-seeding an existing account: refresh the ROLE (the seed owns that) and
      // leave the PASSWORD alone. Silently resetting a password on every seed run
      // would be a surprising, and in a shared environment a hostile, side effect.
      user.roles = [roleId];
      await user.save();
    }

    // ── the domain profile, 1:1 with the login (conventions §5.3) ─────────────
    let profile = await StaffProfile.findOne({ user: user._id });

    if (!profile) {
      profile = await StaffProfile.create({
        user: user._id,
        firstName: member.firstName,
        lastName: member.lastName,
        jobTitle: member.jobTitle,
        eligibleForAssignment: member.eligibleForAssignment,
      });
      createdProfiles += 1;
    } else {
      profile.firstName = member.firstName;
      profile.lastName = member.lastName;
      profile.jobTitle = member.jobTitle;

      // NOT reset on re-seed. Eligibility is an operational decision someone may
      // have changed in the app — taking a counsellor out of the rota is exactly
      // the kind of change a seed run must not undo.
      await profile.save();
    }

    ids.set(member.localPart, { user: user._id, profile: profile._id });
  }

  return {
    label: "staff",
    total: STAFF.length,
    created: createdUsers,
    createdProfiles,
    ids,
    // Returned so the seed can print the login table for the README without
    // this file knowing anything about how it is displayed.
    accounts: STAFF.map((s) => ({
      email: `${s.localPart}@${DEMO_EMAIL_DOMAIN}`,
      role: s.role,
      eligible: s.eligibleForAssignment,
    })),
  };
}
