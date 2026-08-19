/**
 * The result object every service returns.
 *
 * Services never touch `Request`/`Response` and never choose a status code — the
 * route handler maps `code` to one. That is what lets the critical path be tested
 * by calling a function, and what makes every failure an explicit, named case
 * instead of a thrown exception that becomes a generic 500.
 */

export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  CONFIG_MISSING: "CONFIG_MISSING",
  DB_UNAVAILABLE: "DB_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; details?: unknown };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Result<T> {
  return { ok: false, code, message, details };
}

/**
 * Map a thrown error onto a result.
 *
 * Only used at the outer edge of a service, so an unexpected failure still comes
 * back as a named code rather than escaping as an exception. A dropped connection
 * is separated from a genuine bug because the two mean different things to the
 * caller: one is worth retrying, the other is not.
 */
export function fromError<T = never>(err: unknown): Result<T> {
  const message = err instanceof Error ? err.message : String(err);

  const unavailable =
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|topology|server selection|connection.*closed|Client must be connected/i.test(
      message,
    );

  if (unavailable) {
    return fail(
      ERROR_CODES.DB_UNAVAILABLE,
      "The database is not reachable. Your enquiry was NOT saved — please try again.",
    );
  }

  // The message is kept server-side only; the handler decides what the client
  // sees. Never a stack trace, in any environment.
  return fail(ERROR_CODES.INTERNAL, message);
}
