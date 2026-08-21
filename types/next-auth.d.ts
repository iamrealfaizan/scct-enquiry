import type { DefaultSession } from "next-auth";

/**
 * Module augmentation for Auth.js.
 *
 * WHY THIS FILE HAS TO EXIST. Auth.js types `session.user` as name/email/image —
 * the shape of a social login. This system's principal is different: it carries a
 * staff profile id, role codes and a resolved permission list. Without augmenting
 * the types, every permission check would be written against `any`, and
 * `session.user.permissions.includes(...)` would compile even if the field were
 * never populated. That is precisely the bug class that must not compile here: an
 * authorization check that silently reads undefined and denies (or worse, a
 * `?? []` that silently allows).
 *
 * The three interfaces below are the same fields at three points in their life:
 *   User    — what `authorize()` returns
 *   JWT     — what is signed into the cookie
 *   Session — what a server component or route handler reads back
 *
 * They are declared separately because Auth.js keeps them separate, and because
 * the `jwt` and `session` callbacks in `lib/auth.ts` are the code that copies
 * between them. If a field is added to one and not the others, that copy fails to
 * typecheck — which is the point.
 */

declare module "next-auth" {
  interface User {
    userId: string;
    displayName: string;
    staffProfileId: string | null;
    roleCodes: string[];
    permissions: string[];
  }

  interface Session {
    user: {
      userId: string;
      displayName: string;
      staffProfileId: string | null;
      roleCodes: string[];
      permissions: string[];
    } & DefaultSession["user"];
  }
}

/**
 * `@auth/core/jwt`, NOT `next-auth/jwt`.
 *
 * `next-auth/jwt` is a bare `export * from "@auth/core/jwt"`, so augmenting it
 * declares members on an interface that module does not own — which compiles
 * silently and does nothing, leaving `token.userId` as `unknown` because `JWT`
 * extends `Record<string, unknown>`. The index signature is what makes the failure
 * quiet: reading an unaugmented field is legal, it is just untyped.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    displayName: string;
    staffProfileId: string | null;
    roleCodes: string[];
    permissions: string[];
  }
}
