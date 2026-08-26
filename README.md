# SCCT Digital Admissions Foundation — enquiry system

A structured system of record for admissions enquiries, built as a **technical trial** for
Totem Interactive, based on their SCCT (Sanpada College of Commerce and Technology) engagement.

The critical slice:

```
Capture → Validate → Duplicate check → Store → Ownership → Follow-up → History → Reporting
```

**Everything in this system is synthetic.** No real SCCT student, parent or staff data appears
anywhere — not in the repository, not in the seed, not in the demo. Demo email addresses use the
reserved `.local` and `.invalid` TLDs, which can never resolve.

---

## Contents

1. [Run it locally](#1-run-it-locally)
2. [Demo accounts](#2-demo-accounts)
3. [Test it in 12 checks](#3-test-it-in-12-checks)
4. [What was built, and what was not](#4-what-was-built-and-what-was-not)
5. [Architecture](#5-architecture)
6. [Data model](#6-data-model)
7. [The rules that shaped it](#7-the-rules-that-shaped-it)
8. [API and export contract](#8-api-and-export-contract)
9. [Tests](#9-tests)
10. [Deployment](#10-deployment)
11. [Assumptions and limitations](#11-assumptions-and-limitations)
12. [Open questions for SCCT](#12-open-questions-for-scct)
13. [Handoff note](#13-handoff-note)

---

## 1. Run it locally

**Requirements:** Node 20+, and a MongoDB connection string (a free Atlas M0 cluster is fine — the
app creates its own database inside whatever cluster you point it at).

```bash
git clone <repo-url>
cd scct-enquiry
npm install
```

Create `.env.local` in the project root:

```ini
MONGODB_URI=mongodb+srv://USER:PASS@yourcluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=scct_enquiry
SESSION_SECRET=<32+ random characters>
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEMO_PASSWORD=<12+ characters, your choice>
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
npm run db:indexes            # create the 37 indexes
npm run seed -- --enquiries=40   # config, staff, and 40 synthetic enquiries
npm run dev                   # http://localhost:3000
```

The seed prints the demo logins when it finishes.

> `.env.local` is gitignored and is not created for you. `lib/env.ts` validates every value at
> startup and refuses to boot with a clear message rather than failing later — a missing secret
> should be a loud error, not a confusing one.

### Every command

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | The full test suite (161 tests, no cluster needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Configuration + staff only, idempotent |
| `npm run seed -- --enquiries=40` | …and 40 synthetic enquiries with stages and follow-ups |
| `npm run db:indexes` | Create/sync indexes — deliberately a separate, visible step |
| `npm run db:reset` | **Destructive.** Drops collections in the configured database only. Refuses under `NODE_ENV=production`, and makes you type the database name. |

---

## 2. Demo accounts

Five synthetic staff accounts, all using the `DEMO_PASSWORD` you set. They are also listed on the
sign-in page so a reviewer never has to leave the app to find them.

| Email | Role | Sees | In assignment rota |
|---|---|---|---|
| `counsellor1@demo.scct-enquiry.local` | Counsellor | own + unassigned | yes |
| `counsellor2@demo.scct-enquiry.local` | Counsellor | own + unassigned | yes |
| `counsellor3@demo.scct-enquiry.local` | Counsellor | own + unassigned | **no** — represents someone on leave |
| `manager1@demo.scct-enquiry.local` | Manager | everything, can reassign | yes |
| `admin1@demo.scct-enquiry.local` | Administrator | everything + configuration | no |

**`counsellor3` is deliberately ineligible.** It means the very first demo of round-robin proves the
eligibility filter works, rather than proving it on a happy path where everyone is eligible.

The password is never committed and never rendered — it comes from `DEMO_PASSWORD`. A committed
password is a secret in source control even when the account is synthetic.

---

## 3. Test it in 12 checks

### The public form — `/enquire`

1. **Submit an enquiry.** You get an `ENQ-2026-000041` style reference immediately.
2. **Submit again with the same phone and the same programme.** It saves. Open it in the staff queue
   and it is flagged *possible duplicate* — flagged, not merged, not rejected.
3. **Submit again with the same phone but a different programme.** It must **not** be flagged. One
   person can genuinely enquire about B.Com and B.Sc IT.
4. **Double-click submit.** Exactly one record is created — the idempotency key is generated once per
   form mount.

### The staff interface — `/staff`

5. **Visit `/staff` signed out.** You are redirected to `/login`. Sign in as `counsellor1`.
6. **Use the filters.** The URL changes. Copy it into a new tab — same results. Every filtered queue
   is a shareable link.
7. **Click a stat tile.** The table below shows exactly that many rows. The numbers trace back.
8. **Open an enquiry.** Change the stage, add a note, schedule a follow-up. The **Activity history**
   at the bottom lists all three, with your account and the time.
9. **Claim an unassigned enquiry.** History records it as a self-claim.

### The three that matter most

10. **Concurrency.** Open one enquiry in two browser tabs. Change the stage in tab 1. Then, in tab 2
    *without refreshing*, change it to something else. Tab 2 is **refused** with a message telling
    you to reload — and tab 1's change survives. This is the "overwritten records" failure the brief
    describes, and it is prevented rather than mitigated.
11. **Permissions.** As `manager1`, find an enquiry owned by Rohit and copy its URL. Sign in as
    `counsellor1` and open it: **404, not 403**. A 403 on real ids and 404 on fake ones together
    reveal which ids exist.
12. **Database unavailable.** Stop the server, corrupt the password in `MONGODB_URI`, restart, and
    submit the public form. You get an explicit *"your enquiry was NOT saved"* — never a false
    success. Restore the URI afterwards.

---

## 4. What was built, and what was not

### Built

- Public enquiry form — one surface, shared zod validation on client and server
- Intake API with stable sequential enquiry numbers and idempotency keys
- Documented duplicate rule, flagging only — nothing is ever merged or deleted
- Credentials authentication, three seeded roles, permission-based authorization
- Staff queue: search, filter, sort, paginate — all state in the URL
- Enquiry detail with full record, provenance, consent basis and history
- Round-robin ownership with an `Unassigned` fallback; claim, release, reassign
- Stage changes, notes, follow-up scheduling and outcomes — every write guarded against
  concurrent edits
- Append-only activity history that cannot be edited, archived or deleted
- Scoped headline counts that link to the queries that produced them
- 161 tests covering the critical path and its failure cases

### Deliberately out of scope

Full CRM · end-to-end admissions processing · student accounts · applications or document processing
· payments · marketing automation · advertising · LMS or examinations · advanced BI · AI features ·
multi-institute SaaS · recreating SCCT's public website · **Google Sheets sync (v2)**

### Not finished — stated plainly

| Gap | Why it matters |
|---|---|
| **CSV / Excel export** | In scope and not built. The contract it would use is defined in §8. |
| **Management reporting view** | In scope and not built. The scoped-count pattern the queue uses is the foundation for it. |
| **Staff capture form** | The schema (`staffEnquirySchema`) and the `enquiry.capture` permission exist; there is no screen. |
| **Duplicate review UI** | Flags are raised and shown. Dismissing or confirming one needs `duplicate.review` and has no screen yet. |

---

## 5. Architecture

**One Next.js application**, App Router, deployed as one Vercel project. The public form, the staff
interface and the API are all route handlers in the same app — a second service would add a host, a
deployment, an environment and CORS for a single client, and forfeit shared types.

### Three layers, one direction

```
route handler  →  service  →  model
```

| Layer | Owns | Never does |
|---|---|---|
| **Route handler** (`app/api/**/route.ts`) | Parsing, zod validation, the session and permission check, HTTP status, the response envelope | Business rules, direct model access |
| **Service** (`services/*.ts`) | Business rules: duplicate detection, assignment, guarded writes, history | Touch `Request`/`Response`, choose status codes |
| **Model** (`models/*.ts`) | Schema, indexes, hooks | Business rules |

Services return a **result object**, never an HTTP response:

```ts
type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string }
```

The handler maps `code` to a status. This is what makes the critical path testable without HTTP, and
why every failure is an explicit named case rather than a generic 500.

### Repository shape

```
scct-enquiry/
├── middleware.ts              # cookie-presence redirect ONLY — not authorization
├── app/
│   ├── (public)/enquire/      # the one public surface
│   ├── (auth)/login/
│   ├── (staff)/               # its layout guards every page beneath it
│   └── api/                   # route handlers
├── components/
│   ├── ui/                    # shadcn primitives
│   ├── brand/                 # wordmark, demo notice
│   ├── enquire/ login/ staff/ # feature components
├── models/                    # one file per entity — 12 total
├── services/                  # business logic — the only writers
├── schemas/                   # zod, shared by form and API
├── lib/                       # db, env, auth, dates, result envelope
├── scripts/seed/              # idempotent, one file per entity
└── tests/                     # Vitest + in-memory MongoDB
```

### Reading and writing

**Staff pages read Mongo directly in server components** and write through API routes. A page calling
its own HTTP endpoint pays a second round trip on the same machine and has to forward its own session
cookie. `GET /api/staff/enquiries` exists for callers that genuinely need HTTP — the export, and any
future consumer — and both paths run the same `listEnquiries()`, so they cannot disagree.

**The queue's filter bar is a plain `<form method="get">` with no client JavaScript.** Filter, sort
and pagination state lives in the URL. That gives shareable filtered links, a working back button, no
loading states, and no stale-response race — there is no second request to arrive out of order.

---

## 6. Data model

Twelve collections. Every one ends with the same lifecycle and audit blocks, except where noted.

| Model | Holds | Note |
|---|---|---|
| `Enquiry` | The record this system exists to protect | Normalised phone/email for matching; label snapshots for historical truth |
| `EnquiryEvent` | Append-only history, including notes | **No `updatedBy`, no `isArchived`** — an audit record that can be hidden is not an audit record |
| `EnquiryDuplicate` | Possible-duplicate pairs | A junction table because the link carries data: what matched, and who reviewed it |
| `FollowUp` | Scheduled next actions | Authoritative; `Enquiry.nextFollowUpAt` is a maintained cache of the earliest open one |
| `Programme` | The seven degree programmes | Confirmed SCCT fact |
| `EnquirySource` | Enquiry sources | **Two unreconciled taxonomies**, seeded as reported — see §12 |
| `EnquiryStatus` | Enquiry stages | **Unconfirmed placeholders**, flagged as such in the UI |
| `User` | Identity only — login and RBAC | Zero domain data |
| `StaffProfile` | The admissions person | Enquiry ownership refs **this**, not `User` |
| `Role`, `Permission` | RBAC | Rows, not enum strings, so SCCT's answer is a data change |
| `Sequence` | Atomic counters | Enquiry numbers and the round-robin cursor |

### Two identifiers that are not interchangeable

- `User` is **the account that acted** — audit fields reference it.
- `StaffProfile` is **the person who owns admissions work** — `Enquiry.owner` references it.

An account can exist without a staff profile (an administrator). It can act, but can never own an
enquiry. Conflating the two would assign enquiries to ids from the wrong collection — a bug that
surfaces much later as "the owner column is empty".

### Configuration is data, not code

Programmes, sources, stages, roles and permissions are **lookup tables**. Business logic compares
stable `code` values, never labels and never ObjectIds. SCCT renaming a stage is a data change, not a
deployment.

---

## 7. The rules that shaped it

### The duplicate rule, as approved

| Case | Behaviour |
|---|---|
| Same phone/email **+ same programme** | Flagged as a possible duplicate. Both records stored. |
| Same phone/email **+ different programme** | Allowed as a separate enquiry. Not flagged. |
| Repeated technical submission or retry | Suppressed by the idempotency key |
| Anything | **Never silently deleted or auto-merged** |

Detection runs *after* the write, not before — because the rule says a repeat is flagged and
**stored**, so refusing to write until a check passes would implement the opposite behaviour. A
pre-write check is also racy: two simultaneous identical submissions would both see nothing.

**The public surface is told nothing about duplicates.** The acknowledgement is identical whether or
not a flag was raised, because disclosing it would let anyone test whether a given phone number has
enquired before — against contact data belonging in part to minors.

### No silent data loss

- Nothing is acknowledged before the database confirms the write.
- An unreachable database returns `503` with an explicit "your enquiry was NOT saved", never a
  generic 500 and never a false success.
- A failed submission keeps everything the user typed.
- `bufferCommands: false` on the connection, so an unavailable database throws immediately instead of
  queueing silently.

### Concurrent edits are refused, not merged

Every workflow write is a single conditional update, guarded on the value the caller believed was
current. If someone else changed it first, **zero documents are written** and the caller is told to
reload. Notes are the deliberate exception — an insert into an append-only log has nothing to
overwrite, so two people can add notes simultaneously.

### Authorization is structural

- The public and staff intake schemas are separate. A public caller cannot set an owner or a consent
  basis because those fields are not in the schema their request is parsed against, and `.strict()`
  rejects them outright rather than ignoring them.
- Queue visibility is a filter fragment combined with the user's filters using `$and`, so a filter can
  only ever **narrow** what a caller sees. A counsellor who edits the URL to a colleague's owner id
  gets an empty page.
- Every route handler checks the session and its permission itself. Middleware does a cookie-presence
  redirect **for UX only** — it does not verify the signature and is not authorization.

> Hidden navigation is not authorization. A counsellor who types a manager's URL is stopped by the
> API, not by the absence of a link.

---

## 8. API and export contract

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/config` | none | Programmes, sources, stages for dropdowns |
| `POST` | `/api/enquiries` | none, rate-limited | Public intake — the only unauthenticated write |
| `GET` | `/api/staff/enquiries` | `enquiry.view.own` | The queue as data — **the export contract** |
| `POST` | `/api/staff/enquiries/[id]/status` | `enquiry.update.own` | Change stage |
| `POST` | `/api/staff/enquiries/[id]/notes` | `enquiry.note.create` | Append a note |
| `POST` | `/api/staff/enquiries/[id]/owner` | `enquiry.update.own` | Claim, release, reassign |
| `POST` | `/api/staff/enquiries/[id]/followups` | `enquiry.update.own` | Schedule a follow-up |
| `PATCH` | `/api/staff/enquiries/[id]/followups/[followUpId]` | `enquiry.update.own` | Record an outcome |

### One envelope, on every path

| Case | Body |
|---|---|
| Success | `{ success: true, data }` |
| Success, paginated | `{ success: true, page, limit, total, totalPages, data }` |
| Success, no payload | `{ success: true, message }` |
| **Failure, always** | `{ success: false, code, message, details? }` |

`details` carries field-level zod errors on `400` and nothing else. Stack traces are never returned,
in any environment. Every response sets `Cache-Control: no-store`.

Codes: `VALIDATION_FAILED` `UNAUTHENTICATED` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `RATE_LIMITED`
`CONFIG_MISSING` `DB_UNAVAILABLE` `INTERNAL`.

### The export contract

**CSV export is not built.** When it is, it reads `GET /api/staff/enquiries` rather than
reimplementing the query — an export that ran its own query would drift from the screen it claims to
export, and *"the spreadsheet does not match the queue"* is the complaint this system exists to end.

The endpoint accepts the same filters as the queue UI (`q`, `status`, `programme`, `source`, `owner`,
`followup`, `duplicates`, `sort`, `page`, `limit`) and returns permission-scoped rows. The column set
is `QueueRow` in `services/queue.service.ts`.

### The v2 Google Sheets boundary

Sheets sync is **out of scope**. The boundary is maintained by discipline rather than abstraction:
every enquiry is created by one function, `createEnquiry()`, and every change is recorded in
`EnquiryEvent`. A future sync has one write path to hook and an ordered change log to replay. An
`EnquirySink` interface with a single implementation was rejected as an abstraction pretending to be
a seam.

---

## 9. Tests

```bash
npm test
```

**161 tests**, using Vitest and `mongodb-memory-server` — a real `mongod`, so unique indexes,
`$inc` atomicity and write errors behave exactly as they will in Atlas. No cluster, no secrets, no
network. Route handlers are plain functions and are called directly.

| File | Tests | Covers |
|---|---|---|
| `tests/foundation.test.ts` | 17 | Models, indexes, hooks |
| `tests/seed.test.ts` | 20 | Idempotency, no destructive default |
| `tests/intake.test.ts` | 34 | The critical path, duplicates, idempotency, round-robin, failure modes |
| `tests/auth.test.ts` | 22 | Credentials, account state, permission resolution, account enumeration |
| `tests/queue.test.ts` | 38 | Visibility scoping, filters, counts, detail, the API |
| `tests/workflow.test.ts` | 30 | Concurrency guards, write authorization, history, follow-ups |

Assertions worth pointing at:

- **A stale write is refused and the earlier change survives** — the Excel failure, tested directly.
- **Every headline count equals the total of the queue view it links to** — the two are computed by
  different code paths, so the equality is asserted rather than assumed.
- **An unknown email and a wrong password produce the identical message** — account enumeration.
- **The stored password is a bcrypt hash and never appears in the principal.**
- **Same phone + different programme is not flagged.**

---

## 10. Deployment

Target is **Vercel**, which hosts Next.js route handlers natively.

1. Push the repository to GitHub and import it into Vercel.
2. Set these environment variables in the Vercel project:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Your Atlas connection string |
   | `MONGODB_DB` | `scct_enquiry` |
   | `SESSION_SECRET` | A **different** 32+ character secret from the local one |
   | `NEXT_PUBLIC_APP_URL` | The deployed URL |
   | `DEMO_PASSWORD` | The demo login password |

3. In Atlas, allow access from anywhere (`0.0.0.0/0`) — Vercel's functions do not have static IPs.
4. Deploy.
5. Seed the deployed database **from your machine**, pointing `.env.local` at the same cluster:

   ```bash
   npm run db:indexes
   npm run seed -- --enquiries=40
   ```

The seed is idempotent and non-destructive, which is what makes it safe to point at a deployed
database. Indexes are a separate explicit step (`autoIndex` is off everywhere) so development and
production cannot silently disagree about which indexes exist.

---

## 11. Assumptions and limitations

### Labelled assumptions — none of this is confirmed SCCT process

- **Enquiry stages are invented placeholders.** They carry `isPlaceholder: true` and are marked as
  such on screen, not just in this document.
- **Qualification fields** (previous institution, HSC stream, HSC percentage) are placeholder
  examples, all optional, none used in any business rule, visibly labelled in the UI.
- **Counsellors can see and claim unassigned enquiries.** A documented product decision, not a
  reading of the permission table — see open question 11.
- **The brand palette was read off SCCT's live site** (`scct.edu.in`, theme `tisson`). Those values
  are the stock Flat UI pair shipped with that theme, so they are *observed*, not a brand guideline
  SCCT issued. SCCT's logo is **not** used; a typographic wordmark stands in.

### Limitations, stated rather than hidden

| Limitation | Consequence | Fix before production |
|---|---|---|
| **Stateless session** | Permissions resolve once at sign-in and travel in the cookie. A role change takes effect at next sign-in, or within 8 hours. A specific user cannot be force-logged-out. | A session store, or re-resolve per request |
| **Writes are not transactional** | An update and its history event are two writes. The record is never lost and failures are logged, but a log entry could in principle be missing. | Multi-document transactions on a replica set |
| **Search does not use an index** | Free-text search is a `$regex` scan within the caller's scope. Fine at SCCT's volume, not at ten times it. | A text index or Atlas Search |
| **Follow-up urgency sort is computed** | Sorting by urgency cannot use the compound index, because "no follow-up" must sort last. | A partial index |
| **`next-auth@5` is a beta** | Pinned exactly. Its blast radius is one file. | Upgrade at stable, or the documented `jose` fallback |
| **Next.js 14.2.35 carries residual advisories** | Triaged; none applicable to this app's surface. | **Upgrade to Next 15/16 — the first pre-production task** |
| **No rate limiting on staff endpoints** | The public intake endpoint is rate-limited; authenticated endpoints are not. | Add if abuse is plausible |
| **In-memory rate limiter** | Per-instance, so it resets on cold start and does not coordinate across serverless functions. | Redis or Vercel KV |

---

## 12. Open questions for SCCT

These are **not** guessed at anywhere in the code. Each one has a placeholder that is visibly labelled
as such, and each answer is a data or configuration change rather than a rewrite.

1. The final enquiry stage list, and their definitions
2. The final source taxonomy — **two conflicting lists exist** and are seeded as reported, unreconciled
3. Which qualification fields are actually required
4. Which staff may receive enquiries
5. Whether round-robin needs programme-specific rules
6. Definitions of successful / unsuccessful / closed
7. Follow-up frequency and escalation rules
8. Website integration method, and access from Saurav
9. Data-retention requirements — `consentBasis` is recorded so this is answerable later
10. Final staff access and permission requirements
11. **May a counsellor claim an unassigned enquiry, or must a manager assign it?**
12. **Confirm the real brand colours and logo, and whether this demo may use SCCT's identity at all**

Questions 11 and 12 arose from building; the rest are from the Phase 1 proposal.

---

## 13. Handoff note

### Built

The full critical slice, end to end, with the failure cases tested rather than assumed: capture,
validation, duplicate flagging, storage, ownership, follow-up, an append-only history, and scoped
counts that link to the records behind them.

### Cut, and why

- **CSV export and the reporting view** — in scope, not reached. Both have their foundations in place
  (§8 defines the contract; the scoped-count pattern is the reporting primitive).
- **Staff capture and duplicate review screens** — the schemas and permissions exist; the UI does not.
- **Google Sheets sync** — explicitly v2. A documented boundary was left instead.

### What I would do next, in order

1. CSV export against the documented contract
2. The management reporting view, reusing the scoped-count pattern
3. Duplicate review UI — the model already supports dismiss and confirm
4. Staff capture form — the schema is written

### What I would change before production

1. **Upgrade Next.js.** The 14.x pin was a delivery-certainty decision for a short trial; it carries
   residual advisories that 15.x clears at near-zero migration cost.
2. **Add a session store**, so a compromised or revoked account can be cut off immediately rather than
   within eight hours. This is the change that matters most once real student data is involved.
3. **Wrap the workflow writes in transactions**, closing the narrow window where an update succeeds
   and its history event does not.
4. **Replace regex search** with a text index or Atlas Search before the collection grows.
5. **Confirm every open question in §12** and replace the placeholders. Nothing in this system should
   reach production still describing SCCT's process in values I chose.

### The biggest weaknesses, honestly

- **The reporting half of the brief is missing.** It was a deliberate ordering choice — the capture,
  ownership and history path is the part that must be right, and it is the part with the failure modes
  worth testing — but a reviewer looking for "minimal reporting" will not find it.
- **Framework integration is the least-tested seam.** Two bugs during the build were exactly there: a
  `.strict()` schema rejecting Auth.js's own form fields, and a session read that passed a `Request`
  to a function that treats one as middleware. Both compiled, both passed the tests as written, and
  both only surfaced by running the app. The unit tests are strong on business rules and weak on
  wiring, and no test I could write would have caught either.
- **`next-auth@5` is a beta in a graded deliverable.** Pinned and contained, but it is a dependency I
  would have to defend.
