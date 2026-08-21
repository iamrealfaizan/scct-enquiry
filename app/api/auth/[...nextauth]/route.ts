import { handlers } from "@/lib/auth";

/**
 * Auth.js's own endpoints — sign-in, sign-out, session, CSRF token.
 *
 * This is the ONE catch-all route in the system, and it is Auth.js's requirement
 * rather than a choice: the library owns these paths and the CSRF token that pairs
 * with the sign-in POST.
 *
 * WHY THE NODE RUNTIME IS FORCED. `authorize` reaches Mongoose and bcrypt, neither
 * of which runs on the Edge runtime. Next 14 defaults route handlers to Node, so
 * this line changes nothing today — it is here so that turning on edge rendering
 * elsewhere in the app cannot silently break login.
 */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
