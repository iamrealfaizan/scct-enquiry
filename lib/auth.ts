import NextAuth, { CredentialsSignin, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import type { PermissionCode } from "@/config/codes";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth-cookie";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ERROR_CODES, fail, ok, type Result } from "@/lib/result";
import { verifyCredentials, type SessionUser } from "@/services/auth.service";

/**
 * Auth.js configuration, and the session + permission checks every protected
 * surface uses. Conventions §10.
 *
 * ─── WHY Auth.js AND NOT A HAND-ROLLED COOKIE ──────────────────────────────────
 *
 * `jose` was already a dependency and signing a cookie by hand is perhaps sixty
 * lines. Auth.js was chosen anyway because the sixty lines are not the hard part:
 * CSRF tokens on the sign-in POST, cookie chunking, the `__Secure-`/`__Host-`
 * prefix rules, clock-skew tolerance on verification and correct cookie clearing
 * on sign-out are all things a hand-rolled version gets subtly wrong and nobody
 * notices until it matters.
 *
 * THE COST, STATED PLAINLY: `next-auth@5` is a beta. It is pinned exactly, and the
 * blast radius is contained on purpose — Auth.js owns the cookie and nothing else.
 * Every business rule is in `services/auth.service.ts`, every authorization
 * decision is in this file's guards, and both are tested by calling functions
 * directly. Replacing Auth.js with sixty lines of `jose` would touch this file and
 * no other. The rejected alternatives are recorded in docs/conventions.md §17.
 *
 * ─── WHY THE SESSION IS A JWT AND NOT A DATABASE SESSION ───────────────────────
 *
 * A stateless cookie means a protected request costs no session round-trip, which
 * matters on an M0 cluster behind serverless functions with a hard connection
 * ceiling.
 *
 * THE TRADE-OFF, AND IT IS A REAL ONE. Permissions are resolved ONCE, at login,
 * and then travel in the cookie. So revoking a role — or suspending an account —
 * does not take effect until the session expires or the user signs in again. Worst
 * case is one working day, because the cookie lasts eight hours.
 *
 * That is the correct trade for a synthetic-data trial and the wrong one for real
 * student data. Before production, either add a session store so a session can be
 * killed on demand, or re-resolve permissions per request and accept the read. The
 * decision is recorded rather than hidden; see the README's limitations section.
 */

/**
 * Carries a machine-readable reason out of `authorize` and into the login form.
 *
 * Auth.js collapses every `authorize` failure into one generic error, which is the
 * right default — but it also collapses "the database is unreachable" into "your
 * password is wrong", and those two require completely different actions from the
 * person reading the message. The `code` distinguishes exactly that one case; all
 * genuine credential failures deliberately share a single indistinguishable
 * message so the endpoint cannot be used to enumerate staff emails.
 */
class LoginError extends CredentialsSignin {
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Explicit rather than read from AUTH_SECRET, so there is ONE validated secret
  // in this system (lib/env.ts) instead of two env vars that can disagree.
  secret: env.SESSION_SECRET,

  // Required on Vercel, where the deployment URL is not known at build time.
  trustHost: true,

  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  // Named explicitly so middleware can look for one cookie. See lib/auth-cookie.ts.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: SESSION_COOKIE_OPTIONS,
    },
  },

  pages: {
    signIn: "/login",
    // Errors render on the login page itself. Auth.js's default error page is
    // unstyled and mentions Auth.js, which is confusing on an internal tool.
    error: "/login",
  },

  providers: [
    Credentials({
      // Declared so Auth.js knows the field names. Validation is NOT here — it is
      // in the shared zod schema, which the login form uses too.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      /**
       * A thin adapter. All of the rule lives in `verifyCredentials`; this function
       * connects to the database, calls it, and translates a `Result` into what
       * Auth.js expects (an object, or a throw).
       */
      async authorize(credentials) {
        // The connection is established here rather than at module load: a cold
        // start must not connect until something actually needs the database.
        await db();

        /**
         * ONLY the two fields this system owns are forwarded.
         *
         * Auth.js hands `authorize` the WHOLE submitted body, which carries its own
         * `csrfToken` and `callbackUrl` alongside the credentials. `loginSchema` is
         * `.strict()`, so passing the body straight through makes every login fail
         * validation before the password is ever checked — which reads as "wrong
         * password" and is not.
         *
         * Picking the fields here rather than loosening the schema is the right way
         * round: the service's contract is two fields, and an adapter's job is to
         * translate. Keeping `.strict()` is what stops a caller smuggling a `role`
         * or `permissions` field into a credential check.
         */
        const result = await verifyCredentials({
          email: credentials?.email,
          password: credentials?.password,
        });

        if (!result.ok) throw new LoginError(result.code);

        // Auth.js requires `id`; everything else is this system's own principal,
        // typed by the augmentation in types/next-auth.d.ts.
        return {
          id: result.data.userId,
          email: result.data.email,
          userId: result.data.userId,
          displayName: result.data.displayName,
          staffProfileId: result.data.staffProfileId,
          roleCodes: result.data.roleCodes,
          permissions: result.data.permissions,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Copy the principal into the token — but ONLY on the sign-in call, when
     * `user` is present. On every subsequent request this callback runs with the
     * already-decoded token and must leave it alone; re-resolving here would put a
     * database read back on every request, which is the cost the JWT strategy was
     * chosen to avoid.
     */
    jwt({ token, user }) {
      if (user) {
        token.userId = user.userId;
        token.displayName = user.displayName;
        token.staffProfileId = user.staffProfileId;
        token.roleCodes = user.roleCodes;
        token.permissions = user.permissions;
      }

      return token;
    },

    /**
     * Expose the token to server components and route handlers.
     *
     * No `?? []` fallbacks here, on purpose. A token that reached this point
     * without a permission list is a bug in the `jwt` callback, and defaulting it
     * to an empty array would hide that bug behind a confusing "you do not have
     * permission" for a user who does.
     */
    session({ session, token }) {
      session.user.userId = token.userId;
      session.user.displayName = token.displayName;
      session.user.staffProfileId = token.staffProfileId;
      session.user.roleCodes = token.roleCodes;
      session.user.permissions = token.permissions;

      return session;
    },
  },
});

// ─── Guards ──────────────────────────────────────────────────────────────────
//
// EVERY protected route handler calls these itself. Middleware's cookie check is
// a redirect for the user's benefit and is NOT authorization: it cannot verify a
// signature at the edge without dragging the whole auth stack there, and hiding a
// nav link has never stopped anyone from typing a URL.

/** The authenticated principal, as read back from a verified session cookie. */
export type Principal = SessionUser;

function toPrincipal(session: Session): Principal {
  return {
    userId: session.user.userId,
    email: session.user.email ?? "",
    displayName: session.user.displayName,
    staffProfileId: session.user.staffProfileId,
    roleCodes: session.user.roleCodes,
    permissions: session.user.permissions,
  };
}

/**
 * The current principal, or `null` when there is no valid session.
 *
 * `null` means anonymous. It does not mean "loading" — a server component either
 * has a session or does not, and conflating the two is a client-side concern
 * (conventions §12).
 */
export async function currentPrincipal(): Promise<Principal | null> {
  /**
   * ALWAYS THE NO-ARGUMENT FORM. `auth()` reads the session cookie through Next's
   * `headers()`, which works in a server component, a layout AND a route handler —
   * all three run inside a request scope.
   *
   * DO NOT PASS THE REQUEST. An earlier version of this function called
   * `auth(request)` in route handlers, on the assumption that Auth.js's runtime
   * branch on `args[0] instanceof Request` was an untyped session read. It is not:
   * that branch is the MIDDLEWARE entry point (`next-auth/lib/index.js`), and it
   * returns a `Response`, not a `Session`. The result had no `user`, so every
   * authenticated write was rejected as unauthenticated — a bug that reached the
   * browser as "Sign in to continue" on a perfectly valid session.
   *
   * The cast that made it compile is the lesson: the published overloads did not
   * include `Request` for a reason, and casting past them replaced a compile error
   * with a runtime one. Anything Auth.js does not type is not a private API to be
   * reached around.
   */
  const session = await auth();

  // A session object with no userId is a decoded-but-malformed token. Treated as
  // anonymous rather than trusted with a missing field.
  if (!session?.user?.userId) return null;

  return toPrincipal(session);
}

/**
 * Require a session. For route handlers — returns a `Result`, so the handler maps
 * the code to a status through the same envelope as every other failure.
 */
export async function requireSession(): Promise<Result<Principal>> {
  const principal = await currentPrincipal();

  if (!principal) {
    return fail(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue.");
  }

  return ok(principal);
}

/**
 * Require a session AND a permission code.
 *
 * Takes `PermissionCode`, not `string`, so a typo in a permission name is a
 * compile error rather than a check that can never pass — a guard that silently
 * always denies is as much a bug as one that always allows, and much harder to
 * spot.
 */
export async function requirePermission(code: PermissionCode): Promise<Result<Principal>> {
  const session = await requireSession();

  if (!session.ok) return session;

  if (!session.data.permissions.includes(code)) {
    // The message names the permission. This is an internal tool: a counsellor who
    // hits a manager-only screen needs to know what to ask for, and the code is
    // not sensitive.
    return fail(ERROR_CODES.FORBIDDEN, `This action requires the "${code}" permission.`);
  }

  return ok(session.data);
}

/** Non-throwing check, for deciding whether to render a link or a button. */
export function can(principal: Principal | null, code: PermissionCode): boolean {
  return principal?.permissions.includes(code) ?? false;
}
