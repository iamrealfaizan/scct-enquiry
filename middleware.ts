import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth-cookie";

/**
 * A COARSE REDIRECT FOR THE USER'S BENEFIT. NOT AUTHORIZATION.
 *
 * This checks that a session cookie is PRESENT. It does not verify the signature,
 * does not decode the token, and does not look at permissions. A forged cookie
 * containing the word "x" gets past this file — and then hits a real guard in
 * `lib/auth.ts` on the page and again in the route handler, which is where
 * authorization actually happens (conventions §10).
 *
 * WHY DELIBERATELY THIS WEAK. Verifying the token here would mean running the auth
 * stack on the Edge runtime, on every request including static assets. The benefit
 * would be zero, because every protected surface must check the session itself
 * anyway — a middleware check cannot be trusted by the handler behind it, since
 * the handler can be reached in ways middleware never sees.
 *
 * WHAT IT IS ACTUALLY FOR: a staff member whose session expired overnight lands on
 * the login page instead of on an error, and `?next=` brings them back to the page
 * they wanted afterwards.
 *
 * `next` IS VALIDATED AS A PATH, not just accepted. An unchecked redirect
 * parameter is an open-redirect: `/login?next=https://evil.example` would send
 * someone from a link that genuinely starts on this domain to somewhere else. Only
 * a single-slash-prefixed path is allowed, which rules out both absolute URLs and
 * the `//host` protocol-relative form.
 */

const PROTECTED_PREFIXES = ["/staff"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (isProtected && !hasSessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);

    return NextResponse.redirect(url);
  }

  // Already signed in and asking for the login page: send them to the queue rather
  // than showing a form they do not need. Harmless if the cookie turns out to be
  // invalid — the destination's own guard will bounce them straight back.
  if (pathname === "/login" && hasSessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/staff";
    url.search = "";

    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * Matched paths, narrow on purpose.
 *
 * Middleware runs on every matched request, so `/_next/*`, the API and static
 * files are excluded: they either need no redirect or must never be redirected.
 * `/api/**` in particular is excluded deliberately — an API caller with no session
 * must receive a 401 in the response envelope, never a 307 to an HTML login page,
 * which is a genuinely confusing thing to debug from a fetch call.
 */
export const config = {
  matcher: ["/staff", "/staff/:path*", "/login"],
};
