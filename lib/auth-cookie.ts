/**
 * The session cookie's name and options — in their own module, deliberately.
 *
 * WHY THIS IS NOT IN `lib/auth.ts`. Middleware runs on the Edge runtime and needs
 * exactly one fact: what the session cookie is called. Importing `lib/auth.ts`
 * there would drag in Mongoose, bcrypt and `lib/env.ts` — none of which can or
 * should run at the edge, and the last of which would make middleware fail unless
 * `MONGODB_URI` were present in the edge environment. This file has no imports at
 * all, so both runtimes can share it and the name cannot drift between them.
 *
 * WHY THE NAME IS SET EXPLICITLY RATHER THAN LEFT TO Auth.js. The default name
 * changes between the plain and `__Secure-` forms depending on configuration, so
 * middleware would have to guess at two names and hope. Naming it here means one
 * constant, checked in one place.
 *
 * THE `__Secure-` PREFIX IS NOT DECORATION. Browsers refuse a `__Secure-` cookie
 * that is not `secure` and not from HTTPS, which makes a misconfigured production
 * deployment fail loudly at the browser rather than quietly sending session
 * cookies over plain HTTP.
 */

const isProductionRuntime = process.env.NODE_ENV === "production";

export const SESSION_COOKIE_NAME = isProductionRuntime
  ? "__Secure-scct.session"
  : "scct.session";

/** 8 hours, in seconds — one working day, per conventions §10. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const SESSION_COOKIE_OPTIONS = {
  // Script cannot read it, so an XSS bug cannot lift a session.
  httpOnly: true,

  // "lax", not "strict": "strict" would drop the cookie on a top-level navigation
  // from another site, so a staff member following a link to an enquiry would land
  // on the login page while holding a perfectly valid session. "lax" still blocks
  // the cross-site POST that CSRF needs.
  sameSite: "lax" as const,

  path: "/",
  secure: isProductionRuntime,
} as const;
