import { PUBLIC_FORM_SOURCE_CODE } from "@/config/codes";
import { jsonFail, jsonOk, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { ERROR_CODES } from "@/lib/result";
import { fieldErrors, publicEnquirySchema } from "@/schemas/enquiry.schema";
import { createEnquiry } from "@/services/enquiry.service";

/**
 * POST /api/enquiries — the public enquiry intake.
 *
 * The only unauthenticated write in the system, so it is treated as hostile
 * input: rate-limited, body-size capped, parsed with a `.strict()` schema that
 * has no owner or consent field to set.
 *
 * WHAT THIS RESPONSE DELIBERATELY DOES NOT CONTAIN: any indication that a
 * duplicate exists. `createEnquiry()` returns the matches and this handler drops
 * them. An anonymous endpoint that confirmed "this phone number has already
 * enquired" is a phone-number enumeration oracle against prospective students'
 * contact details — many of them minors. That is a security boundary, and it is
 * why the staff surface is a separate route rather than this one branching on a
 * session.
 */
export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req));

  if (!limit.allowed) {
    return jsonFail(
      ERROR_CODES.RATE_LIMITED,
      `Too many submissions. Please try again in ${limit.retryAfterSeconds} seconds.`,
    );
  }

  const body = await readJson(req);
  if (!body.ok) {
    return jsonFail(ERROR_CODES.VALIDATION_FAILED, body.message);
  }

  // Server-side validation always runs. That the client ran the same schema is not
  // evidence about what arrived over the wire.
  const parsed = publicEnquirySchema.safeParse(body.body);

  if (!parsed.success) {
    return jsonFail(
      ERROR_CODES.VALIDATION_FAILED,
      "Please check the highlighted fields.",
      fieldErrors(parsed.error),
    );
  }

  try {
    await db();
  } catch {
    // An explicit, honest failure. Never an optimistic acknowledgement — the
    // submitter must know their enquiry was not saved so they can retry, and the
    // form keeps what they typed.
    return jsonFail(
      ERROR_CODES.DB_UNAVAILABLE,
      "We could not save your enquiry just now. Nothing was recorded — please try again.",
    );
  }

  const result = await createEnquiry({
    ...parsed.data,
    // Forced server-side. A public submitter never chooses their own source, and
    // by definition of this surface the enquiry arrived through the website.
    sourceCode: PUBLIC_FORM_SOURCE_CODE,
    captureChannel: "public_form",
    consentBasis: "self_submitted",
    capturedBy: null,
  });

  if (!result.ok) {
    return jsonFail(result.code, result.message, result.details);
  }

  // 201 only now — after the database confirmed the write.
  // 200 on a replay, because nothing was created this time.
  return jsonOk(
    {
      enquiryNumber: result.data.enquiry.enquiryNumber,
      // The plain acknowledgement, identical whether or not a duplicate was
      // flagged internally.
      message:
        "Thank you. Your enquiry has been received and someone from the admissions team will contact you.",
    },
    result.data.replayed ? 200 : 201,
  );
}
