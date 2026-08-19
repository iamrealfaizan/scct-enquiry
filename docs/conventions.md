# Conventions — SCCT Enquiry System

Standing engineering conventions for this repository. Everything here must be defensible in a live
review; anything that could not be justified in one sentence was cut.

Scope authority: [../CLAUDE.md](../CLAUDE.md) and `docs/phase-1-proposal.md`. Where this file and
those disagree, those win.

---

## 1. Shape of the repository

**One application.** Next.js App Router serves the public enquiry form, the authenticated staff
interface, and the API as route handlers. One Vercel project.

```
scct-enquiry/
├── app/
│   ├── (public)/enquire/          # the one public enquiry surface
│   ├── (staff)/                   # authenticated staff interface
│   └── api/                       # route handlers — the API
├── components/
│   ├── ui/                        # shadcn primitives, untouched
│   ├── common/                    # shell pieces
│   └── <feature>/                 # all real feature code
├── models/                        # ONE FILE PER ENTITY — see §5
├── services/                      # business logic — the only writers
├── schemas/                       # zod schemas shared by form and API
├── lib/
│   ├── db.ts                      # cached Mongoose connection
│   ├── env.ts                     # zod-validated environment
│   ├── auth.ts                    # session + permission checks
│   └── utils.ts
├── scripts/seed/                  # synthetic seed data + index creation
├── tests/
└── docs/
```

**Why one app, not a separate API server.** The confirmed deployment target is Vercel, which hosts
Next.js route handlers natively and does not host a long-lived Express process. A second service
would add a host, a deployment, an environment and CORS for one client, and forfeit shared types
between the form, the API and the export contract.

---

## 2. Versions

| Thing | Version | Why |
|---|---|---|
| Node.js | 20 LTS | Vercel default runtime |
| Next.js | **14.2.35** (App Router) — the last 14.x release | Pinned for delivery certainty on a version already shipped in production. **This version carries residual advisories fixed only in 15.x** — the decision, the full applicability triage and the pre-production upgrade requirement are in [security-notes.md](security-notes.md). Do not change this pin without reading that file. |
| React | 18 | Pairs with Next 14 |
| TypeScript | 5, `strict: true` | |
| Mongoose | 8.x | |
| zod | one version across the whole app | Single app, so no frontend/backend split |
| Tailwind CSS | 3.4.x | v4 changes the config model; no benefit here |
| shadcn/ui | `new-york`, base `neutral`, CSS variables | |
| bcryptjs | current | Password hashing |
| jose | current | Signed session cookie |
| Vitest | current | ESM- and TS-native; route handlers are plain functions, so no HTTP harness needed |
| mongodb-memory-server | current | Tests must run with no Atlas dependency |

Dependencies are added only when a feature needs them. No carousel, drag-and-drop, animation, 2FA
or i18n libraries. Export uses **one** spreadsheet library, not two.

`package.json` carries two `overrides` — `postcss` and `glob` — to pull transitive dependencies past
known advisories that `next@14.2.35` and its eslint plugin would otherwise pin below. They are
load-bearing: removing them reintroduces four audit findings. Reason recorded in
[security-notes.md](security-notes.md) §1.

**The API uses route handlers, never Server Actions.** Primary reason: a route handler is a plain
`(req: Request) => Response` function that a test can call directly, with no HTTP server and no
framework harness. Secondary reason: it removes five Next advisories from the applicable set
([security-notes.md](security-notes.md) §3).

---

## 3. Layering

Three layers, one direction: `route handler → service → model`.

| Layer | Owns | Never does |
|---|---|---|
| **Route handler** (`app/api/**/route.ts`) | Parsing the request, zod validation, session and permission check, HTTP status, the response envelope | Business rules, direct model access |
| **Service** (`services/*.ts`) | Business rules: duplicate detection, assignment, history writes | Touch `Request`/`Response`, choose status codes |
| **Model** (`models/*.ts`) | Schema, indexes, hooks | Business rules |

Services return a **result object**, never an HTTP response:

```ts
type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };
```

The handler maps `code` to a status. This is what makes the critical path testable without HTTP,
and why every failure has an explicit, observable shape rather than a generic 500.

There is no `controllers/` folder: in the App Router the route handler **is** the controller.

---

## 4. The response envelope

One shape, on every path including errors.

| Case | Body |
|---|---|
| Success, single or list | `{ success: true, data }` |
| Success, paginated | `{ success: true, page, limit, total, totalPages, data }` |
| Success, no payload | `{ success: true, message }` |
| **Failure — always** | `{ success: false, code, message, details? }` |

Status codes: `200`, `201`, `400` (validation), `401` (unauthenticated), `403` (permission),
`404`, `409` (conflict), `500`.

`details` carries field-level zod errors on `400` and nothing else. Stack traces are never returned,
in any environment. **No bare arrays, no bare objects, and no second error shape** — a client that
unwraps `res.data.data` on success must not unwrap something different on failure.

---

## 5. Model architecture

Fully normalised, **one entity per file**. Every distinct noun in the domain gets its own collection
and its own file. Never nest a domain entity as a subdocument; never merge two nouns into one table.

### 5.1 One file, one schema, one collection

`models/<EntityName>.ts` — PascalCase, singular. The file declares the schema, its indexes, and
exports the **compiled model**. Other entities are referenced by string `ref` name only.

> **Adaptation, stated deliberately:** this convention was taken from a multi-tenant system whose
> models exported a bare `Schema` for a per-connection registry to compile. We have one connection
> and no registry, and Next.js reuses warm serverless invocations — so models export the compiled
> model behind a re-registration guard. Without the guard, the second request to a warm function
> throws `OverwriteModelError`.

```ts
export default (mongoose.models.Enquiry as Model<IEnquiry>) ??
  mongoose.model<IEnquiry>("Enquiry", EnquirySchema);
```

### 5.2 Relationships are ObjectId refs, never embedded documents

If a field describes another entity with its own identity or lifecycle, it is a ref — not an inline
object, not a string label.

```ts
// WRONG
programme: "B.Sc IT"
programme: { code: "BSCIT", name: "B.Sc IT" }

// RIGHT
programme: { type: Schema.Types.ObjectId, ref: "Programme", required: true }
```

Embed a subdocument **only** when it has no independent identity and is never queried alone.

**One deliberate exception — label snapshots.** The brief asks how historical records stay
understandable when configuration changes. So alongside the ref, the enquiry stores the programme's
label *as it read at capture time* (`programmeLabelAtCapture`), and each history event stores the
status label as it read then. Rename a programme or a stage next year and last year's history still
reads correctly. This is denormalisation for historical truth, not for convenience, and it is the
only place we duplicate a label.

### 5.3 Identity is split from domain profile

`User` holds **only** authentication and RBAC. It holds zero domain data. Every domain person is a
separate table with a ref back to it.

```ts
// User.ts — identity only
email, password, status, roles: [{ ref: "Role" }]

// StaffProfile.ts — domain profile, 1:1 with a login
user: { type: Schema.Types.ObjectId, ref: "User", required: true }
firstName, lastName, phone, eligibleForAssignment, ...
```

Enquiry ownership refs `StaffProfile` (the person doing admissions work). Audit fields ref `User`
(the account that acted). Those are different questions and they get different refs.

### 5.4 RBAC is three tables

`User.roles[] → Role`, `Role.permissions[] → Permission`. Permissions are **rows, not enum strings**.

Seeded roles and permission codes:

| Role | Permissions |
|---|---|
| `counsellor` | `enquiry.view.own`, `enquiry.update.own`, `enquiry.note.create` |
| `manager` | the above + `enquiry.view.all`, `enquiry.reassign`, `report.view`, `export.run` |
| `admin` | the above + `staff.manage`, `config.manage` |

**Why rows for three fixed roles:** final staff access and permission requirements are open question
10 — unconfirmed by SCCT. Permissions as rows means answering that question later is a data change,
not a code change. Roles carry no payload, so `User.roles[]` stays an array of refs rather than a
junction table (§5.7).

### 5.5 Rules deliberately excluded

The source convention came from a multi-tenant SaaS platform. Two of its rules are **not** adopted,
because this is a single-institute system and multi-institute is explicitly out of scope:

- **No scope key.** No `institute` ref as the first field of every table. Adding one is a mechanical
  migration — a ref on each collection and a leading key on each compound index — and the handoff
  note documents exactly that. Building it now would be the platform the brief says not to build.
- **No ancestor-chain denormalisation.** The domain is two levels deep (`EnquiryEvent → Enquiry`),
  so there is no chain to flatten.

*Defence: "I know the pattern and chose not to build it. Here is the exact migration path."*

### 5.6 Every table ends with the same blocks

```ts
// lifecycle
isActive:   { type: Boolean, default: true },
isArchived: { type: Boolean, default: false },

// audit — always ref the identity table, never the profile table
createdBy: { type: Schema.Types.ObjectId, ref: "User" },
updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
```

…plus `{ timestamps: true }` on every schema.

**Field precedence, so there is one authoritative answer:** `isArchived` hides a row from all normal
queries. `isActive` marks a row unusable for *new* work but still visible on history. Workflow
`status` on `Enquiry` is a **ref to `EnquiryStatus`**, never a string enum (§5.8) — it is the
business state, and it is independent of the two lifecycle flags.

**Deliberate exceptions:**

- `EnquiryEvent` has `createdBy` but **no `updatedBy`**. History is append-only, so a row is never
  updated and the field would always be null. Omitting it makes append-only visible in the schema
  rather than being a convention someone can break.
- `EnquiryEvent` also has **no `isActive` / `isArchived`**. An audit record that can be hidden is not
  an audit record — archiving history would let someone remove the evidence of a change while leaving
  the change in place.
- `Sequence` carries none of these blocks, and no `timestamps`. It is an internal counter, not a
  domain entity: there is no archived counter, and "who incremented it" is answered by `EnquiryEvent`.
- `EnquiryEvent.createdBy` and `Enquiry.capturedBy` are **nullable**, and null is meaningful: the
  actor was the public form or a system process, not a staff account.

### 5.7 Many-to-many gets its own junction table

Named `<Parent><Child>`, with a unique compound index on the pair, plus any payload the relationship
itself carries. A bare array of refs is only acceptable when the relationship carries no data.

None are needed today. The one we can see coming: if SCCT confirms **programme-specific ownership**
(open question 5), that becomes `StaffProgramme` — `staffProfile` + `programme` + payload — and the
assignment service filters eligible owners through it. Named here so the change is a known shape,
not a surprise.

### 5.8 Lookup tables over enums

Any list a user can extend is its own collection with `isSystem: Boolean` separating seeded rows from
user-created ones. `enum` is reserved for closed sets only code can change.

| Lookup table | Why not an enum |
|---|---|
| `Programme` | Seven confirmed today, more later; carries `stream` and eligibility |
| `EnquirySource` | Taxonomy is **not** normalised — see below |
| `EnquiryStatus` | Final stage names are unconfirmed (open question 1) |

Genuine enums, because only code changes them: `consentBasis`, `EnquiryEvent.type`, `User.status`.

**`EnquirySource` carries a self-ref.** The pre-discovery material contains two conflicting source
taxonomies. Rather than pick one or flatten them, every source row may point at a canonical parent:

```ts
canonicalSource: { type: Schema.Types.ObjectId, ref: "EnquirySource", default: null }
```

`null` means the row *is* canonical. So "Google Search", "train advertisement" and "website" can be
seeded as reported and mapped to canonical codes once SCCT confirms — and every enquiry keeps the
raw source it actually arrived with. The finding becomes data instead of a paragraph in the README.

**Seeded placeholder rows must be visibly labelled synthetic** in the data and in the UI. Statuses
and the source taxonomy are unconfirmed, and must never be presented as confirmed SCCT process.

### 5.9 Indexes live in the model file, explicitly named

Every compound index leads with its primary discriminator, then any secondary filters, then the sort
field. Every index is named `<collection>_<fields>_<idx|uq>`.

```ts
EnquirySchema.index({ enquiryNumber: 1 }, { unique: true, name: "enquiry_number_uq" });
EnquirySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true, name: "enquiry_idempotency_uq" });
EnquirySchema.index({ phoneNormalised: 1, programme: 1 }, { name: "enquiry_phone_programme_idx" });
EnquirySchema.index({ emailNormalised: 1, programme: 1 }, { name: "enquiry_email_programme_idx" });
EnquirySchema.index({ status: 1, owner: 1, nextFollowUpAt: 1 }, { name: "enquiry_status_owner_followup_idx" });
EnquirySchema.index({ isArchived: 1, createdAt: -1 }, { name: "enquiry_archived_created_idx" });
```

Note which are unique and which are not. `idempotencyKey` **is** unique — a retry must collide. The
phone/programme index is **not** unique — a same-programme repeat is *flagged and stored*, never
rejected, per the approved duplicate rule. A unique index there would enforce the opposite.

### 5.10 Naming — no drift

- Ref field name is the camelCase entity name with **no** `Id`/`_id` suffix: `programme`, not
  `programmeId`.
- A human-readable serial is `<entity>Number` — `enquiryNumber`, never `enquiryId`.
- Index names: `<collection>_<fields>_<idx|uq>`.
- Sequential numbers come from the `Sequence` collection (`_id` = counter name) via an atomic
  `findOneAndUpdate` + `$inc`. **Never `countDocuments() + 1`** — two concurrent writes would
  produce the same number.

### 5.11 The twelve models

| # | Model | Holds |
|---|---|---|
| 1 | `User` | Identity only: email, hashed password, status, `roles[]` |
| 2 | `Role` | code, name, `permissions[]`, `isSystem` |
| 3 | `Permission` | code, name, category, `isSystem` |
| 4 | `StaffProfile` | Domain profile, 1:1 → `User`; name, phone, `eligibleForAssignment` |
| 5 | `Programme` | code, name, `stream` enum, `isSystem` |
| 6 | `EnquirySource` | code, label, `canonicalSource` self-ref, `taxonomyGroup`, `isSystem` |
| 7 | `EnquiryStatus` | code, label, order, `isDefault`, `isTerminal`, `isPlaceholder` |
| 8 | `Enquiry` | The core record |
| 9 | `EnquiryEvent` | Append-only history — **notes live here** as `type: "note_added"` |
| 10 | `EnquiryDuplicate` | Junction: the possible-duplicate pair + `matchedOn` + review state |
| 11 | `FollowUp` | A scheduled next action with its own lifecycle and outcome |
| 12 | `Sequence` | Atomic counters |

`models/index.ts` re-exports all twelve. It is **load-bearing, not convenience**:
Mongoose resolves a `ref` by name at populate time, and a name exists only once its file has been
imported. Importing `Enquiry` alone and calling `.populate("programme")` throws
`MissingSchemaError` — intermittently, depending on import order, which in serverless varies per cold
start. **Services and route handlers import from `@/models`, never from an individual model file.**
No schema is declared in the index, so one-file-one-entity still holds.

**`EnquiryDuplicate` is a junction rather than an array on `Enquiry`** because the relationship
carries data: which field matched, and whether a manager reviewed and dismissed it. Without a review
state a dismissed false positive reappears forever, and a flag nobody trusts is worse than no flag.
It stores `matchedOn` but **no contact values** — the values already exist on both enquiries, and
copying a phone number into a third collection widens exposure of personal data for no benefit.

**`FollowUp` is its own table** because a follow-up has a lifecycle — scheduled, then completed,
missed, rescheduled or cancelled, with an outcome. A bare `nextFollowUpAt` date cannot represent a
follow-up that was **missed**, which is exactly the question a manager needs answered given that
SCCT's follow-up process is currently unrecorded phone calls. `Enquiry.nextFollowUpAt` is a
maintained **cache** of the earliest scheduled follow-up, written only by the follow-up service, so
the queue can sort by urgency on one index. If the two disagree, `FollowUp` wins.

**Notes are `EnquiryEvent` rows, not their own table.** A note is not a separate noun — it *is* an
audit event. Giving it a table would either duplicate the append-only machinery or leave a gap in the
history log where notes bypassed it.

**Not built, deliberately:** no `Institute` (§5.5). No `Person`/`Contact` — the link between one
person's several enquiries is *derived* from normalised phone and email; a Person table is the first
brick of a CRM, and the brief says do not assume a CRM. It becomes justified the day SCCT needs to
store facts about a person rather than about an enquiry. No `Session` — the signed cookie carries it.

---

## 6. MongoDB on Vercel

Route handlers run in short-lived serverless invocations. A connection opened per invocation will
exhaust an Atlas M0 cluster.

`lib/db.ts` caches the connection **and the connection promise** on `globalThis`, so concurrent cold
starts await one in-flight connect rather than racing:

```ts
// cache the promise, not just the connection — two concurrent cold starts
// must await the same connect, not open two.
let cached = global._mongoose ?? (global._mongoose = { conn: null, promise: null });

export async function db() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      maxPoolSize: 5,          // M0 is connection-limited
      serverSelectionTimeoutMS: 8000,
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
```

`autoIndex` is **off** in production. Indexes are created by `scripts/seed/` and documented in the
README, so index creation is a deliberate, observable step rather than a side effect of the first
request.

---

## 7. The atomic sequence — enquiry numbers and round-robin

One primitive, two requirements:

```ts
const doc = await Sequence.findOneAndUpdate(
  { _id: key },
  { $inc: { value: 1 } },
  { new: true, upsert: true },
);
```

- `key: "enquiryNumber"` → the next serial for a stable, human-readable
  `enquiryNumber` (`ENQ-2026-000148`), issued inside the write via a `pre("save")` hook.
- `key: "assignmentCursor"` → the round-robin position. `value % eligibleOwners.length` picks the
  owner. Document-level atomicity means two simultaneous submissions cannot get the same owner.

The assignment cursor is incremented **from the service**, not from a save hook — it is not tied to
saving any one document.

If the eligible-owner list is empty, ownership falls back to `Unassigned` and that is recorded in
history. The submission does not fail, and no ineligible owner is silently chosen.

---

## 8. No silent data loss

A graded failure mode, so these are rules and not preferences.

1. The API responds `201` only **after** the database confirms the write. No optimistic
   acknowledgement, anywhere.
2. Every failure returns an explicit `code` the client can act on. Nothing is swallowed.
3. Duplicate detection **flags**; it never deletes, never merges, never rejects a legitimate
   different-programme enquiry. A flagged enquiry is stored and returned as
   `{ success: true, data: { ..., possibleDuplicates: [...] } }` — a stored record with a warning,
   not an error.
4. A retried submission carrying a known `idempotencyKey` returns the **original** record and the
   original `enquiryNumber`, with `201` → `200`. No second row, no error.
5. `EnquiryEvent` is append-only. No code path updates or deletes an event.
6. Records are archived (`isArchived`), never destructively deleted.
7. If the write fails, the submitter sees an explicit failure and their entered data is preserved in
   the form for retry.

### Duplicate disclosure — different by surface, on purpose

The same rule, presented two ways, because the surfaces have different trust levels:

- **Staff capture** shows the match: number, programme, current owner, status. Without it, two
  teachers call the same person — the exact failure this system exists to fix.
- **The public form must never** reveal that a record exists. An anonymous endpoint that confirms
  "this phone number already enquired" is a phone-number enumeration vulnerability against minors'
  contact data. The public response is a plain acknowledgement; the flag is visible only internally.

This is a security boundary, not a UI preference, and it is why the two surfaces are two routes
(§10) rather than one endpoint that branches on session.

---

## 9. Configuration

Programmes, sources and statuses are **lookup tables** (§5.8), seeded from `scripts/seed/`.
Business logic reads codes; it never contains a literal like `"B.Sc IT"` or `"Contacted"`.

- The seven programmes are **confirmed** SCCT facts.
- Statuses, source taxonomy, `stream` (NEP / Non-NEP) and qualification fields are **not**
  confirmed. They ship as visibly labelled synthetic placeholders and stay on the open-questions
  list in the README.

What this does *not* mean: no dynamic form builder, no per-institute config resolution, and no admin
CRUD screens beyond what `config.manage` needs. Generalising further is premature.

---

## 10. Auth

Credentials login, seeded synthetic staff users, three seeded roles.

- Passwords hashed with **bcrypt**, in a `pre("save")` hook on `User`. Never logged, never returned
  by any API, `select: false` on the field.
- Login issues one **signed, HTTP-only** cookie. `secure` in production, `sameSite: "lax"`, 8-hour
  expiry. HTTP-only means script cannot read it, so an XSS bug cannot lift a session.
- **No tokens in `localStorage`, ever.** No refresh rotation, no Redis session store, no 2FA — none
  is required, and each adds a dependency that must survive a "your dependency is down" question.
- Permission checks resolve `User.roles[] → Role.permissions[] → Permission` into a flat code list
  once per request.
- **Every** protected route handler checks the session and the required permission code itself.
  Middleware does a coarse cookie-presence redirect for UX only.

> Hidden navigation is not authorization. Gate the page *and* the route handler. A counsellor who
> types the reporting URL must be stopped by the API, not by the sidebar.

**State the limitation yourself:** the session is stateless, so a specific user cannot be
force-logged-out before expiry. Correct trade for a synthetic-data trial; before real student data,
add a session store for revocation.

### Two surfaces, one core

| | Public | Staff |
|---|---|---|
| Route | `POST /api/enquiries` | `POST /api/staff/enquiries` |
| Auth | none, rate-limited | session + permission |
| Accepted fields | narrow; `source` forced, owner not settable | wider; `source` required, `capturedBy` set, assign-to-me option |
| Duplicate response | acknowledgement only | full match detail |
| Ownership | always round-robin | defaults to self-assign, may release to the queue |

Both call the **same** `createEnquiry()` service, and each extends a shared base zod schema.
Authorization is structural: a public caller cannot reach staff fields because they are not in that
schema.

---

## 11. Validation

zod schemas live in `schemas/` and are **shared** by the client form and the server handler. One
definition, two consumers — fast client feedback, authoritative server check.

Server-side validation is never skipped because the client already ran it. The public intake
endpoint assumes a hostile caller: rate-limited, body-size capped, and the only unauthenticated
write in the system.

---

## 12. Frontend conventions

- `app/**/page.tsx` is a thin wrapper. Real code lives in `components/<feature>/`.
- A feature folder is self-contained: `<Feature>Page.tsx` (the `"use client"` root), presentational
  children, `types.ts`, `constants.ts`, `use<Feature>Data.ts`.
- The feature's `use*Data.ts` hook **is** the service layer. There is no frontend `services/`.
- Every fetch responding to user-changed filters uses an `AbortController`, and treats an aborted
  request as **superseded, not failed**. The staff queue is search/filter/sort driven; a stale
  response must never overwrite a fresh one.
- Unwrap the envelope at the hook boundary (`res.data?.data ?? null`). Components never see it.
- A permission gate must early-return while the session is still `undefined`. `undefined` (loading)
  and `null` (anonymous) are different states; conflating them bounces a valid user on refresh.
- On fetch failure, clear the data and render an explicit error state. Never leave stale figures on
  screen, especially in the management view.
- Import via `@/`, never `../../..`.
- Every number in the management view links to the filtered queue that produced it. The brief asks
  for numbers that trace back to stored records; making it clickable makes that provable.

---

## 13. Testing

`tests/`, Vitest, `mongodb-memory-server`. No live Atlas dependency, so tests run anywhere.

Route handlers are plain `(req: Request) => Response` functions, so they are invoked **directly**
with a constructed `Request`. No HTTP server, no supertest, no port.

| Must pass | Must also pass |
|---|---|
| Valid submission stores and returns a stable `enquiryNumber` | Invalid payload returns `400` with field errors and stores nothing |
| Same phone + same programme is flagged | Same phone + different programme is allowed as separate |
| Retried `idempotencyKey` returns the original record, no second row | Database unavailable returns an explicit error, not a fake success |
| Round-robin distributes across eligible owners | No eligible owners falls back to `Unassigned` |
| Concurrent submissions get distinct numbers and distinct owners | Unauthenticated and insufficient-permission requests are refused at the API |
| An event is appended on every workflow change | No code path updates or deletes an event |
| Reporting numbers reconcile against stored records | Export contract matches its documented columns |
| Public duplicate response leaks nothing | Staff duplicate response includes the match |

---

## 14. Environment

`lib/env.ts` validates with zod at import time. Server secrets are **required with no default**, so
a missing value fails the build rather than surfacing at runtime in front of a reviewer.

`.env.example` holds placeholders only and is committed. `.env*` is gitignored from the **first**
commit. No secrets in source control, no exceptions — a listed critical failure.

---

## 15. The v2 Google Sheets boundary

Sheets sync is out of scope. The boundary is created by **discipline, not abstraction**:

> Every enquiry write goes through exactly one function in `services/enquiry.service.ts`.

That single write path is the seam, and `EnquiryEvent` already gives a v2 adapter an ordered change
record to replay. Documented in the README and the handoff note.

Deliberately **not** built: an unused `EnquirySink` interface, a queue, an outbox table, or a
pluggable-destination registry with one implementation. An abstraction with a single implementation
is premature generalisation.

---

## 16. The laws

1. Route handlers own HTTP. Services own rules. Models own storage. One direction only.
2. One response envelope, success **and** failure. No second error shape.
3. Never acknowledge a write the database has not confirmed.
4. Duplicates are flagged. Never deleted, never auto-merged, never silently rejected.
5. `EnquiryEvent` is append-only, and has no `updatedBy` to make that structural.
6. Serial numbers and the round-robin cursor come from `Sequence`. Never `countDocuments()`.
7. One file, one entity. Never two entities in one file; never a domain entity as a subdocument.
8. Relationships are ObjectId refs. The only duplicated labels are the deliberate capture-time
   snapshots in §5.2.
9. `User` holds identity only. Domain fields live on `StaffProfile`.
10. Every schema: `{ timestamps: true }`, lifecycle block, audit block, and every index explicitly
    named.
11. Models export the compiled model behind the `mongoose.models.X ??` guard; the connection is
    cached on `globalThis`.
12. Any user-extendable list is a lookup table with `isSystem`, not an enum.
13. Server-side validation always runs, regardless of client validation.
14. Every protected route handler checks session and permission itself. Hidden nav is not
    authorization.
15. Session cookie only. No tokens in `localStorage`.
16. Unconfirmed values are visibly labelled synthetic placeholders, never presented as confirmed
    SCCT process.
17. Synthetic data only. No real student or parent information anywhere.
18. The public form never discloses that a duplicate exists.
19. Filter-driven fetches use `AbortController`; aborted ≠ failed.
20. Permission gates early-return while the session is `undefined`.
21. `.env*` gitignored from the first commit; `.env.example` committed with placeholders.
22. Add a dependency only when a feature needs it. Every one must be justifiable in one sentence.
23. The API is route handlers, never Server Actions.
24. Every API response sets `Cache-Control: no-store`. Authenticated responses are never cacheable.

---

## 17. Rejected alternatives

Recorded as decisions are made, for the live defence.

| Rejected | Why |
|---|---|
| Separate Express API service | Vercel hosts route handlers natively, not a long-lived process. A second service adds a host, a deploy, an env and CORS for one client, and forfeits shared types. |
| Scope key (`institute` ref) on every table | Multi-institute is explicitly out of scope and premature platform-building is a listed critical failure. The migration path is documented instead. |
| Ancestor-chain denormalisation | The domain is two levels deep. Nothing to flatten. |
| Multi-tenant, database-per-tenant with a connection pool | Same reason. One institute, one database. |
| `Person` / `Contact` entity | The person link is derived from normalised phone and email. A Person table is the first brick of a CRM, and the brief says don't assume a CRM. |
| Redis for sessions and caching | Nothing in the slice needs it, and it adds an external dependency that must survive a deliberately induced outage. |
| NextAuth / Auth.js | Built for OAuth providers and adapters we don't use. Credentials-only with three roles is ~60 lines I can walk through line by line, and explainability is graded. |
| JWT refresh rotation, 2FA | One signed session cookie meets the confirmed requirement. Unrequested complexity on the critical path. |
| Enum strings for status / source / programme | Final stage names and the source taxonomy are unconfirmed. Lookup tables let SCCT's answer be a data change. |
| Unique index on phone/email | The approved duplicate rule requires a same-programme repeat to be flagged and stored, not rejected. A unique index enforces the opposite. |
| One endpoint branching on session for both surfaces | Field-level authorization inside the only public write endpoint is the highest-risk code in the system. Two routes make authorization structural. |
| Telling the public submitter about a duplicate | Phone-number enumeration against minors' contact data. |
| `next-intl` locale-prefixed routing | No i18n requirement, and it forces every route into per-locale lists. |
| Docker + file-mounted secrets | Deployment target is Vercel. |
| `EnquirySink` interface for the v2 Sheets sync | A single documented write path is a cleaner seam than an abstraction with one implementation. |
| Next 15.5.23 (and Next 16) | Would clear all 21 residual advisories at near-zero migration cost, since React 18 is still supported. Rejected in favour of delivery certainty on a familiar version for a 3–4 day synthetic-data trial. **Upgrading is the first pre-production requirement** — [security-notes.md](security-notes.md) §5. |
| Server Actions for form submission | Route handlers are directly callable in tests, and avoid five Next advisories. |
| `EnquiryNote` as its own table | A note is an audit event, not a separate noun. A table for it would either duplicate the append-only machinery or leave notes out of the history log. |
| `possibleDuplicates: [ref]` array on `Enquiry` | The link carries payload (what matched, who dismissed it). An array has nowhere to record a review, so clearing a false positive would mean destructively editing the record. |
| `ProgrammeStream` lookup table | NEP / Non-NEP is set by university regulation, not by a user — the closed-set case enum is reserved for. Becomes a lookup table if SCCT confirms more streams. |
| `hscStream` as a lookup table | It is an unconfirmed placeholder field (open question 3). A thirteenth collection for a field that may not exist is premature; it becomes a lookup the moment SCCT confirms it as controlled. |
| Embedding history as an array on `Enquiry` | Append-only becomes structural as a separate collection (inserts only); the array grows unbounded on a document read on every queue page; and "what did this counsellor do last week" is one query instead of impossible. |
