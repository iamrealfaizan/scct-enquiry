# Security notes — dependency posture

Recorded deliberately, so the position is explainable rather than accidental.

Last reviewed: **2026-08-18**, against `npm audit` on the committed lockfile.

---

## 1. Current state

| | |
|---|---|
| Next.js | **14.2.35** — the final release of the 14.x line |
| React | 18 |
| `npm audit` | **1 high-severity finding**, in `next` itself |
| Everything else | clean |

The scaffold began at `next@14.2.26`, which npm flags directly with a security warning, and audited at
**5 high-severity findings**. Three of those were resolved:

| Package | Was | Now | How |
|---|---|---|---|
| `next` | 14.2.26 | 14.2.35 | Upgrade to the last 14.x release — closes 6 advisories |
| `postcss` | 8.4.31 (bundled inside `next`) | 8.5.26 | `overrides` in `package.json` |
| `glob` | 10.3.10 (via `@next/eslint-plugin-next`) | 10.5.0 | `overrides` in `package.json` |

The `postcss` and `glob` findings were **build- and lint-time only** — neither is reachable at
runtime in production. They were still fixed, because a reviewer running `npm audit` should see a
short list, and because an unexplained finding is worse than a fixed one. The production build was
verified after the overrides were applied.

---

## 2. The residual finding, stated plainly

**21 advisories against `next` remain unfixed, because they were patched only in the 15.x line
(15.0.8 through 15.5.21). The Next 14 line no longer receives fixes for them.**

This is a deliberate, owned decision: the trial pins 14.2.35 for delivery certainty within a 3–4 day
build, on a version already shipped in production elsewhere. Upgrading to 15.5.23 would clear all of
them and was considered at scaffold time — see §5.

Rather than leave that as "known issue", every remaining advisory was checked against what this
application actually does.

---

## 3. Applicability triage

### Not applicable — 13 of 21

Each is unreachable because of a property this application has, not because of luck.

| Advisory theme | Why this app is not exposed |
|---|---|
| Image Optimizer `remotePatterns` DoS | Self-hosted only. Deployed on Vercel, and no `remotePatterns` are configured. |
| Unbounded `next/image` disk cache growth | Self-hosted only. Image caching is platform-managed. |
| Image Optimization API DoS | No remote images are served through `next/image`. |
| HTTP request smuggling in rewrites | No `rewrites` in `next.config`. |
| SSRF in rewrites via attacker-controlled destination | Same — no rewrites. |
| Middleware / Proxy bypass in Pages Router using i18n | App Router only, and no i18n. |
| SSRF via WebSocket upgrades | No WebSocket upgrades. |
| SSRF in Server Actions on custom servers | No custom server; Vercel-hosted. |
| DoS in App Router using Server Actions | **No Server Actions** — see §4. |
| Unbounded Server Action payload in Edge runtime | No Server Actions, and no Edge runtime. |
| Unauthenticated disclosure of internal Server Function endpoints | No Server Functions / Actions. |
| XSS via CSP nonces | CSP nonces are not used. |
| XSS in `beforeInteractive` scripts | `beforeInteractive` is not used. |

### Residual exposure — 8 of 21

Honest list. All are **denial-of-service or cache-correctness** issues. **None** is an
authentication bypass, and **none** discloses stored enquiry data.

| Advisory | Severity | Note |
|---|---|---|
| DoS with Server Components (two related advisories) | high | React Server Components are used by the App Router. Real residual exposure. |
| HTTP request deserialization DoS via React Server Components | high | Same surface. |
| Cache poisoning in React Server Component responses | moderate | Mitigated in part by §4. |
| Cache confusion of response bodies for requests with bodies (two advisories) | moderate | Relevant because the intake API accepts POST bodies. Mitigated by §4. |
| RSC cache-busting collision cache poisoning | low | |
| Middleware / Proxy redirect cache poisoning | low | Middleware is used for a coarse auth redirect only. |

---

## 4. Mitigations actually in place

Not claims — these are properties of the code, each verifiable:

1. **No Server Actions.** The API is explicit route handlers. This was chosen for testability (a
   route handler is a plain function a test can call directly), and it happens to remove five
   advisories from the applicable set.
2. **`Cache-Control: no-store` on every API route**, and no caching of authenticated responses. The
   cache-confusion and cache-poisoning advisories all depend on a cacheable response; ours are not.
3. **No rewrites, no i18n, no Edge runtime, no custom server, no WebSockets, no CSP nonces, no
   `beforeInteractive`.** Each absence is a closed door, and none of them was a feature we wanted.
4. **Rate limiting and a body-size cap on the public intake endpoint** — the only unauthenticated
   write in the system. This is the surface a DoS advisory would be aimed at.
5. **Vercel hosting**, so platform-level request filtering sits in front of the application.
6. **Synthetic data only** throughout the trial. No real student or parent record is exposed by any
   of these advisories, because no real record exists in the system.

---

## 5. Rejected alternative, and the production recommendation

**Considered and rejected: Next 15.5.23.** It clears all 21 advisories and still supports React 18,
so churn would have been limited to `cookies()`, `headers()` and route `params` becoming async — and
at scaffold time there was no application code to migrate. It was rejected in favour of delivery
certainty on a familiar version within a 3–4 day build.

That trade is reasonable for a synthetic-data trial. **It is not reasonable for production.**

### Before real student data is handled

1. **Upgrade to Next 15.5.21 or later.** This is the first item on the pre-production list, not an
   optional improvement. Every residual advisory in §3 disappears.
2. Add a session store so a specific staff session can be revoked before expiry (see
   `conventions.md` §10).
3. Re-run this triage. It is dated, and advisories accumulate.
4. Add automated dependency auditing to CI so a new advisory surfaces without a manual check.

---

## 6. How to re-verify

```bash
npm audit                 # expect: 1 high, in `next` only
npm ls next postcss glob   # expect: next 14.2.35, postcss 8.5.26, glob 10.5.0 (overridden)
npm run build              # must pass with the overrides applied
```

If the count is higher than 1, the overrides in `package.json` are not being applied — check that
`npm install` was run against the committed lockfile rather than a fresh resolution.
