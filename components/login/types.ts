/**
 * Login-failure messages, mapped from the `code` Auth.js carries out of
 * `authorize` (see `LoginError` in lib/auth.ts).
 *
 * THREE OF THE FOUR MESSAGES ARE THE SAME SENTENCE, and that is the design. A
 * wrong password, an unknown email and a suspended account are indistinguishable
 * to the caller, so the login page cannot be used to work out which staff emails
 * exist. Only an unreachable database gets its own message, because it is the one
 * case where the person reading it should do something different — wait and retry
 * rather than check their password.
 */

export const LOGIN_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Those details do not match an active account.",
  FORBIDDEN: "Those details do not match an active account.",
  VALIDATION_FAILED: "Those details do not match an active account.",
  DB_UNAVAILABLE:
    "We could not reach the database, so we could not check your details. Nothing is wrong with your password — please try again in a moment.",
};

/**
 * Used when the code is missing or unrecognised. It must stay generic: an
 * unexpected internal failure is not the caller's problem to diagnose, and a
 * message naming the cause would leak more than it helps.
 */
export const LOGIN_FALLBACK_MESSAGE = "We could not sign you in. Please try again.";
