import { ERROR_CODES, type ErrorCode } from "./result";

/**
 * The response envelope — one shape on every path, success and failure.
 *
 * A client that unwraps `body.data` on success must not have to unwrap something
 * different on failure, so there is exactly one success shape and exactly one
 * error shape. No bare arrays, no second error format.
 *
 * Every response sets `Cache-Control: no-store`. Authenticated responses must
 * never be cacheable, and an intake response is never worth replaying.
 */

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Content-Type": "application/json",
} as const;

export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: NO_STORE,
  });
}

export function jsonMessage(message: string, status = 200): Response {
  return new Response(JSON.stringify({ success: true, message }), {
    status,
    headers: NO_STORE,
  });
}

export function jsonPaginated<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data,
    }),
    { status: 200, headers: NO_STORE },
  );
}

export function jsonFail(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Response {
  return new Response(
    JSON.stringify({ success: false, code, message, ...(details ? { details } : {}) }),
    { status: statusFor(code), headers: NO_STORE },
  );
}

/**
 * The single place an error code becomes an HTTP status. Kept here rather than in
 * each handler so two endpoints cannot disagree about what a conflict is.
 */
export function statusFor(code: ErrorCode): number {
  switch (code) {
    case ERROR_CODES.VALIDATION_FAILED:
      return 400;
    case ERROR_CODES.UNAUTHENTICATED:
      return 401;
    case ERROR_CODES.FORBIDDEN:
      return 403;
    case ERROR_CODES.NOT_FOUND:
      return 404;
    case ERROR_CODES.CONFLICT:
      return 409;
    case ERROR_CODES.RATE_LIMITED:
      return 429;
    case ERROR_CODES.CONFIG_MISSING:
    case ERROR_CODES.DB_UNAVAILABLE:
      // 503, not 500: the request was fine, the dependency was not, and a client
      // may retry. This is the status a reviewer should see when they take the
      // database away.
      return 503;
    case ERROR_CODES.INTERNAL:
    default:
      return 500;
  }
}

/**
 * Read and size-cap a JSON body.
 *
 * The public intake endpoint is the only unauthenticated write in the system, so
 * it assumes a hostile caller: a body that is not JSON, or is large enough to be
 * an attack, fails before any parsing work is done.
 */
const MAX_BODY_BYTES = 16 * 1024;

export async function readJson(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, message: "Request body is too large." };
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, message: "Request body is too large." };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Request body is not valid JSON." };
  }
}
