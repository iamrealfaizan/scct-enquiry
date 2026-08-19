import { z } from "zod";

import { isValidIndianMobile, normalisePhone } from "@/lib/normalise";

/**
 * Enquiry validation — one definition, shared by the client form and the server
 * handler. Fast feedback in the browser, authoritative check on the server, and
 * no chance of the two disagreeing about what a valid enquiry is.
 *
 * The server ALWAYS re-validates. The client having run the same schema is not
 * evidence about what arrived over the wire.
 *
 * TWO SURFACES, TWO SCHEMAS, ONE BASE. This is the security design, not a tidying
 * choice: a public caller cannot set an owner or claim a consent basis, because
 * those fields are not in the schema their request is parsed against. With
 * `.strict()`, sending them is rejected outright rather than ignored. That makes
 * authorization structural — there is no `if (session)` branch inside the only
 * unauthenticated write in the system, which would be the highest-risk code here.
 */

const trimmed = z.string().trim();

const baseEnquiry = z.object({
  fullName: trimmed
    .min(2, "Please enter a name.")
    .max(120, "That name is too long.")
    // Rejects a name that is only punctuation or digits, without trying to
    // validate what a name may contain — names legitimately carry apostrophes,
    // hyphens and non-Latin scripts.
    .refine((v) => /\p{L}/u.test(v), "Please enter a name."),

  phone: trimmed
    .min(6, "Please enter a phone number.")
    .max(20, "That phone number is too long.")
    .refine(
      (v) => isValidIndianMobile(normalisePhone(v)),
      "Enter a 10-digit Indian mobile number.",
    ),

  // Optional on purpose: a walk-in or phone enquiry often has no email, and
  // requiring one pushes staff into inventing values — which corrupts the very
  // field the duplicate rule matches on.
  email: z
    .union([z.literal(""), trimmed.email("Enter a valid email address.").max(160)])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  // Codes, never labels or ObjectIds. The client is given codes by /api/config;
  // sending a raw ObjectId would let a caller reference any document.
  programmeCode: trimmed.min(1, "Please choose a programme."),

  message: trimmed.max(2000, "Please keep this under 2000 characters.").optional(),

  // ── qualification: UNCONFIRMED PLACEHOLDERS (open question 3) ──────────────
  // All optional, none used in any business rule, all labelled as placeholders in
  // the UI. Present so the shape is real; harmless if SCCT replaces them.
  previousInstitution: trimmed.max(160).optional(),
  hscStream: trimmed.max(60).optional(),
  hscPercentageBand: trimmed.max(40).optional(),
  city: trimmed.max(80).optional(),
});

/**
 * The public form.
 *
 * `source` is absent by design — the server forces it. A self-reported channel on
 * an anonymous endpoint is unreliable, and it feeds the one number leadership
 * will actually act on.
 *
 * `idempotencyKey` is generated once per form mount by the client, so a
 * double-click or a retry after a timeout resolves to the original record instead
 * of creating a second one.
 */
export const publicEnquirySchema = baseEnquiry
  .extend({
    idempotencyKey: trimmed.min(8).max(64).optional(),
  })
  .strict();

/**
 * Staff capture — a teacher or counsellor keying in a walk-in or a phone call.
 *
 * Three fields exist here and nowhere else:
 *   sourceCode    — staff know how the enquiry actually arrived; the public form
 *                   cannot be trusted with it
 *   consentBasis  — SCCT's routes include purchased data and university tag
 *                   lists, where the person never expressed interest. Recording
 *                   how consent arose is what makes retention (open question 9)
 *                   answerable later
 *   assignToMe    — the staff surface defaults to self-assignment; the public
 *                   form is always round-robin
 */
export const staffEnquirySchema = baseEnquiry
  .extend({
    sourceCode: trimmed.min(1, "Please choose a source."),
    consentBasis: z.enum(["self_submitted", "verbal_to_staff", "sourced_list"]),
    assignToMe: z.boolean().default(true),
    idempotencyKey: trimmed.min(8).max(64).optional(),
  })
  .strict();

export type PublicEnquiryInput = z.infer<typeof publicEnquirySchema>;
export type StaffEnquiryInput = z.infer<typeof staffEnquirySchema>;

/**
 * Field-level errors in the shape the envelope's `details` carries, and the shape
 * the form binds to. Only field names and messages — never the submitted values,
 * which would echo personal data back through an error response.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }

  return out;
}
