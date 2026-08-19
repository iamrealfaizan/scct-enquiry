import type { Types } from "mongoose";

import { normaliseEmail, normalisePhone } from "@/lib/normalise";
import {
  ERROR_CODES,
  fail,
  fromError,
  ok,
  type Result,
} from "@/lib/result";
import {
  Enquiry,
  EnquiryDuplicate,
  EnquiryEvent,
  EnquirySource,
  EnquiryStatus,
  Programme,
  type IEnquiry,
} from "@/models";

import { assignNextOwner, isAssignable } from "./assignment.service";

/**
 * THE SINGLE ENQUIRY WRITE PATH.
 *
 * Every enquiry in the system is created by this function — public form, staff
 * capture, and the demo seed. That is deliberate, and it is the v2 Google Sheets
 * boundary: one function to add an adapter to, rather than an unused interface
 * with one implementation. `EnquiryEvent` gives that adapter an ordered change
 * record to replay.
 *
 * ORDER OF OPERATIONS, and why:
 *   1. resolve configuration (programme, source, status) — fail before writing
 *      anything if the system is misconfigured
 *   2. check the idempotency key — a retry must resolve, not create
 *   3. pick an owner
 *   4. WRITE THE ENQUIRY, and wait for the database to confirm it
 *   5. append history
 *   6. detect and flag duplicates
 *
 * Duplicate detection runs AFTER the write, not before. The approved rule is that
 * a same-programme repeat is flagged and STORED — so refusing to write until the
 * check passes would implement the opposite behaviour, and any pre-write check is
 * also racy: two simultaneous identical submissions would both see nothing.
 * Checking afterwards catches that pair.
 *
 * NOT TRANSACTIONAL, stated deliberately. Steps 5 and 6 could in principle fail
 * after step 4 succeeded, leaving an enquiry with no `created` event. The enquiry —
 * the record this system exists to protect — is never lost, the failure is logged
 * rather than swallowed, and a retry is safe because of the idempotency key. Multi-
 * document transactions need a replica-set session and would make every write
 * heavier for a gap this narrow. The pre-production fix is recorded in the handoff
 * note.
 */

export type CreateEnquiryInput = {
  fullName: string;
  phone: string;
  email?: string;

  programmeCode: string;
  sourceCode: string;

  message?: string;

  previousInstitution?: string;
  hscStream?: string;
  hscPercentageBand?: string;
  city?: string;

  captureChannel: "public_form" | "staff_capture";
  consentBasis: "self_submitted" | "verbal_to_staff" | "sourced_list";

  /** The User who keyed it in. null for a public submission. */
  capturedBy?: Types.ObjectId | null;
  /** Staff self-assignment. When set, it replaces round-robin. */
  assignTo?: Types.ObjectId | null;

  idempotencyKey?: string;
};

export type PossibleDuplicate = {
  enquiryNumber: string;
  matchedOn: "phone" | "email" | "both";
  status: string;
  owner: string | null;
  createdAt: Date;
};

export type CreateEnquiryData = {
  enquiry: IEnquiry;
  /** True when an idempotency key resolved to an existing record. */
  replayed: boolean;
  /** Internal detail. The public surface must never disclose this — see below. */
  possibleDuplicates: PossibleDuplicate[];
  assignmentReason: "round_robin" | "self_assigned" | "no_eligible_staff";
};

export async function createEnquiry(
  input: CreateEnquiryInput,
): Promise<Result<CreateEnquiryData>> {
  try {
    // ── 1. configuration ─────────────────────────────────────────────────────
    const [programme, source, status] = await Promise.all([
      Programme.findOne({ code: input.programmeCode, isActive: true, isArchived: false }),
      EnquirySource.findOne({ code: input.sourceCode, isActive: true, isArchived: false }),
      EnquiryStatus.findOne({ isDefault: true, isActive: true, isArchived: false }),
    ]);

    if (!programme) {
      return fail(
        ERROR_CODES.VALIDATION_FAILED,
        "That programme is not available.",
        { programmeCode: "Unknown programme." },
      );
    }

    if (!source) {
      return fail(
        ERROR_CODES.VALIDATION_FAILED,
        "That enquiry source is not available.",
        { sourceCode: "Unknown source." },
      );
    }

    if (!status) {
      // A configuration failure, not the submitter's fault — so it is a 503 and it
      // says so, rather than a validation error blaming their input.
      return fail(
        ERROR_CODES.CONFIG_MISSING,
        "No default enquiry status is configured. Run the seed before accepting enquiries.",
      );
    }

    const phoneNormalised = normalisePhone(input.phone);
    const emailNormalised = input.email ? normaliseEmail(input.email) : undefined;

    // ── 2. idempotency ───────────────────────────────────────────────────────
    // Checked before writing so the common retry costs one query. The unique index
    // is still the authority — see the catch at the end of this block for the race.
    if (input.idempotencyKey) {
      const existing = await Enquiry.findOne({ idempotencyKey: input.idempotencyKey });

      if (existing) {
        return ok({
          enquiry: existing.toObject() as IEnquiry,
          replayed: true,
          possibleDuplicates: [],
          assignmentReason: "round_robin",
        });
      }
    }

    // ── 3. ownership ─────────────────────────────────────────────────────────
    let owner: Types.ObjectId | null = null;
    let assignmentReason: CreateEnquiryData["assignmentReason"] = "round_robin";

    if (input.assignTo) {
      // Manual self-assignment is still checked against the eligibility rule, so
      // the queue can never point at someone who is not in the rota.
      if (!(await isAssignable(input.assignTo))) {
        return fail(
          ERROR_CODES.VALIDATION_FAILED,
          "That staff member cannot currently own enquiries.",
        );
      }
      owner = input.assignTo;
      assignmentReason = "self_assigned";
    } else {
      const assignment = await assignNextOwner();
      owner = assignment.owner;
      assignmentReason = assignment.reason;
    }

    // ── 4. the write ─────────────────────────────────────────────────────────
    let enquiry;

    try {
      enquiry = await Enquiry.create({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        phoneNormalised,
        emailNormalised,

        programme: programme._id,
        // The label AS IT READS NOW. Rename the programme next year and this
        // record still describes what the person actually enquired about.
        programmeLabelAtCapture: programme.shortName || programme.name,
        source: source._id,
        sourceLabelAtCapture: source.label,

        status: status._id,
        owner,
        nextFollowUpAt: null,

        message: input.message,

        previousInstitution: input.previousInstitution,
        hscStream: input.hscStream,
        hscPercentageBand: input.hscPercentageBand,
        city: input.city,

        captureChannel: input.captureChannel,
        capturedBy: input.capturedBy ?? null,
        consentBasis: input.consentBasis,
        idempotencyKey: input.idempotencyKey,

        createdBy: input.capturedBy ?? undefined,
      });
    } catch (err) {
      // The idempotency race: two retries of the same submission arriving at once
      // both pass the check in step 2, and the unique index rejects the second.
      // That is the index doing its job — resolve to the original record.
      if (isDuplicateKeyError(err, "enquiry_idempotency_uq") && input.idempotencyKey) {
        const original = await Enquiry.findOne({ idempotencyKey: input.idempotencyKey });

        if (original) {
          return ok({
            enquiry: original.toObject() as IEnquiry,
            replayed: true,
            possibleDuplicates: [],
            assignmentReason,
          });
        }
      }

      throw err;
    }

    // ── 5. history ───────────────────────────────────────────────────────────
    // Non-fatal, and logged rather than swallowed. See the note at the top of the
    // file: the enquiry is confirmed stored, and we do not turn a successful save
    // into a failure the submitter would retry.
    try {
      await EnquiryEvent.create({
        enquiry: enquiry._id,
        type: "created",
        toStatus: status._id,
        statusLabelAtEvent: status.label,
        toOwner: owner,
        detail:
          assignmentReason === "no_eligible_staff"
            ? "Unassigned: no staff were eligible for assignment at capture time."
            : `Owner set by ${assignmentReason.replace("_", " ")}.`,
        createdBy: input.capturedBy ?? null,
      });
    } catch (err) {
      console.error("[enquiry.service] created event failed for", enquiry.enquiryNumber, err);
    }

    // ── 6. duplicates ────────────────────────────────────────────────────────
    let possibleDuplicates: PossibleDuplicate[] = [];

    try {
      possibleDuplicates = await flagPossibleDuplicates(enquiry._id);
    } catch (err) {
      console.error("[enquiry.service] duplicate check failed for", enquiry.enquiryNumber, err);
    }

    return ok({
      enquiry: enquiry.toObject() as IEnquiry,
      replayed: false,
      possibleDuplicates,
      assignmentReason,
    });
  } catch (err) {
    return fromError(err);
  }
}

/**
 * Find and flag possible duplicates of one enquiry.
 *
 * THE APPROVED RULE:
 *   same phone/email + SAME programme      → flag, and store both records
 *   same phone/email + DIFFERENT programme → allowed, not a duplicate. One person
 *                                            may genuinely enquire about B.Com and
 *                                            B.Sc IT, and treating that as a
 *                                            duplicate would lose a real enquiry.
 *   repeated technical retry               → already handled by the idempotency key
 *
 * Nothing here deletes, merges or rejects. A flag is a prompt for a human.
 */
export async function flagPossibleDuplicates(
  enquiryId: Types.ObjectId,
): Promise<PossibleDuplicate[]> {
  const enquiry = await Enquiry.findById(enquiryId);
  if (!enquiry) return [];

  const matchers: Array<Record<string, unknown>> = [
    { phoneNormalised: enquiry.phoneNormalised },
  ];

  if (enquiry.emailNormalised) {
    matchers.push({ emailNormalised: enquiry.emailNormalised });
  }

  const candidates = await Enquiry.find({
    _id: { $ne: enquiry._id },
    // The discriminator in the rule. Without it this would flag every legitimate
    // second-programme enquiry.
    programme: enquiry.programme,
    isArchived: false,
    $or: matchers,
  })
    .populate<{ status: { label: string } }>("status", "label")
    .populate<{ owner: { firstName: string; lastName?: string } | null }>(
      "owner",
      "firstName lastName",
    )
    .sort({ createdAt: 1 });

  const flagged: PossibleDuplicate[] = [];

  for (const candidate of candidates) {
    const phoneMatch = candidate.phoneNormalised === enquiry.phoneNormalised;
    const emailMatch =
      !!enquiry.emailNormalised && candidate.emailNormalised === enquiry.emailNormalised;

    const matchedOn: "phone" | "email" | "both" =
      phoneMatch && emailMatch ? "both" : phoneMatch ? "phone" : "email";

    // `enquiry` is the newer record, `duplicateOf` the earlier one. Direction is
    // kept consistent so the unique pair index is meaningful.
    const [newer, older] =
      candidate.createdAt <= enquiry.createdAt
        ? [enquiry, candidate]
        : [candidate, enquiry];

    // upsert with $setOnInsert only: re-running detection must never overwrite an
    // existing review. A manager's dismissal is a decision, and resetting it to
    // "flagged" would make the flag untrustworthy — and a flag nobody trusts is
    // worse than no flag.
    await EnquiryDuplicate.updateOne(
      { enquiry: newer._id, duplicateOf: older._id },
      {
        $setOnInsert: {
          enquiry: newer._id,
          duplicateOf: older._id,
          matchedOn,
          programme: enquiry.programme,
          reviewStatus: "flagged",
        },
      },
      { upsert: true },
    );

    await EnquiryEvent.create({
      enquiry: enquiry._id,
      type: "duplicate_flagged",
      // WHICH field matched, never the value — the value already exists on both
      // records, and copying a phone number into the history log would widen the
      // exposure of personal data for no benefit.
      detail: `Possible duplicate of ${older.enquiryNumber} (matched on ${matchedOn}, same programme).`,
      createdBy: null,
    });

    const owner = candidate.owner as { firstName: string; lastName?: string } | null;

    flagged.push({
      enquiryNumber: candidate.enquiryNumber,
      matchedOn,
      status: candidate.status?.label ?? "Unknown",
      owner: owner ? `${owner.firstName} ${owner.lastName ?? ""}`.trim() : null,
      createdAt: candidate.createdAt,
    });
  }

  return flagged;
}

/** Mongo duplicate-key error, optionally for one named index. */
function isDuplicateKeyError(err: unknown, indexName?: string): boolean {
  const e = err as { code?: number; message?: string };
  if (e?.code !== 11000) return false;
  return indexName ? (e.message ?? "").includes(indexName) : true;
}
