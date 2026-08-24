import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DuplicatePanel } from "@/components/staff/detail/DuplicatePanel";
import {
  FollowUpOutcomeControls,
  ScheduleFollowUpForm,
} from "@/components/staff/detail/FollowUpControls";
import { HistoryTimeline } from "@/components/staff/detail/HistoryTimeline";
import { NoteForm } from "@/components/staff/detail/NoteForm";
import { OwnerControl } from "@/components/staff/detail/OwnerControl";
import { StatusControl } from "@/components/staff/detail/StatusControl";
import { DuplicateBadge, FollowUpBadge, StatusBadge } from "@/components/staff/queue/badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PERMISSION_CODES } from "@/config/codes";
import { can, currentPrincipal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, formatRelativeDays } from "@/lib/dates";
import { ERROR_CODES } from "@/lib/result";
import { EnquiryStatus, StaffProfile } from "@/models";
import { getEnquiryDetail } from "@/services/queue.service";

export const metadata: Metadata = {
  title: "Enquiry — SCCT Admissions (demo)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * One enquiry, in full.
 *
 * THE PAGE IS GUARDED AND THE QUERY IS SCOPED — two different things, both needed.
 * The guard here stops a caller with no read permission; the scope inside
 * `getEnquiryDetail()` stops a counsellor reading a colleague's enquiry by pasting
 * its id. Only the second one survives someone typing a URL, which is why the scope
 * lives in the query rather than in a check on this page.
 *
 * AN ENQUIRY OUTSIDE THE CALLER'S SCOPE RENDERS AS A 404, not a "forbidden" page.
 * A 403 on a real id and a 404 on a made-up one together reveal which ids exist, and
 * enquiry ids are the only thing standing between a guessed URL and someone else's
 * personal data.
 */
export default async function EnquiryDetailPage({ params }: { params: { id: string } }) {
  const principal = await currentPrincipal();
  if (!principal) redirect(`/login?next=/staff/${params.id}`);

  if (!can(principal, PERMISSION_CODES.ENQUIRY_VIEW_OWN)) notFound();

  try {
    await db();
  } catch {
    return (
      <main className="px-4 py-8 lg:px-8">
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>The database is not reachable</AlertTitle>
          <AlertDescription>
            This enquiry cannot be shown. Nothing has been lost — reload once the connection is
            back.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const result = await getEnquiryDetail(principal, params.id);

  if (!result.ok) {
    // NOT_FOUND covers both "no such enquiry" and "not yours to see", on purpose.
    if (result.code === ERROR_CODES.NOT_FOUND) notFound();

    return (
      <main className="px-4 py-8 lg:px-8">
        <Alert variant="destructive" className="max-w-2xl">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const enquiry = result.data;

  /**
   * What this caller may do, computed once and passed down.
   *
   * THESE FLAGS DECIDE WHAT IS RENDERED, NOT WHAT IS ALLOWED. Every one of them is
   * checked again by the route handler and then by the service against the stored
   * record — hiding a control is courtesy to the user, never a security boundary
   * (conventions §10). A counsellor who forges the request still gets refused.
   */
  const canUpdate =
    can(principal, PERMISSION_CODES.ENQUIRY_UPDATE_ALL) ||
    (can(principal, PERMISSION_CODES.ENQUIRY_UPDATE_OWN) &&
      // `update.own` reaches an enquiry they own, and the unassigned pool they may
      // claim from. Anything else belongs to a colleague.
      (enquiry.isOwnedByCaller || enquiry.ownerId === null));

  const canReassign = can(principal, PERMISSION_CODES.ENQUIRY_REASSIGN);
  const canNote = canUpdate && can(principal, PERMISSION_CODES.ENQUIRY_NOTE_CREATE);

  // Only the two lists the write controls need, and only when something can be
  // written — a read-only viewer should not cost two extra queries.
  const [statuses, assignable] = canUpdate
    ? await Promise.all([
        EnquiryStatus.find({ isActive: true, isArchived: false })
          .select("code label displayOrder isPlaceholder")
          .sort({ displayOrder: 1 })
          .lean(),
        canReassign
          ? StaffProfile.find({
              eligibleForAssignment: true,
              isActive: true,
              isArchived: false,
            })
              .select("firstName lastName")
              .sort({ firstName: 1 })
              .lean()
          : Promise.resolve([]),
      ])
    : [[], []];

  const openFollowUps = enquiry.followUps.filter(
    (followUp) => followUp.status === "scheduled",
  );

  return (
    <main className="px-4 py-6 lg:px-8">
      <Link
        href="/staff"
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        ← Back to the queue
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="tabular font-mono text-xs text-muted-foreground">
            {enquiry.enquiryNumber}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{enquiry.fullName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Received {formatDateTime(enquiry.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={enquiry.statusLabel}
            isTerminal={enquiry.statusIsTerminal}
            isPlaceholder={enquiry.statusIsPlaceholder}
          />
          <FollowUpBadge state={enquiry.followUpState} />
          {enquiry.openDuplicateFlags > 0 && (
            <DuplicateBadge count={enquiry.openDuplicateFlags} />
          )}
        </div>
      </div>

      {/**
       * TWO COLUMNS: the record on the left, the actions on the right.
       *
       * The actions panel is sticky, so a counsellor scrolling through a long history
       * can still change the stage or add a note without scrolling back — which is
       * the actual sequence of work: read what happened, then record what you did.
       *
       * On a phone the record comes first and the actions follow, because the
       * decision precedes the action.
       */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">

      {/* ── Contact and classification ──────────────────────────────────────── */}
      <Card asChild><section className="grid gap-6 p-6 sm:grid-cols-2">
        <Field label="Phone">
          {/* A tel: link, because the entire follow-up process is a phone call and
              staff will be reading this on a phone. */}
          <a href={`tel:${enquiry.phone}`} className="underline underline-offset-2">
            {enquiry.phone}
          </a>
        </Field>

        <Field label="Email">
          {enquiry.email ? (
            <a href={`mailto:${enquiry.email}`} className="underline underline-offset-2">
              {enquiry.email}
            </a>
          ) : (
            <span className="text-muted-foreground">Not given</span>
          )}
        </Field>

        <Field label="Programme">{enquiry.programmeLabel}</Field>
        <Field label="Source">{enquiry.sourceLabel}</Field>

        <Field label="Owner">
          {enquiry.ownerName ?? (
            <span className="italic text-muted-foreground">Unassigned</span>
          )}
          {enquiry.isOwnedByCaller && (
            <Badge variant="secondary" className="ml-2">
              You
            </Badge>
          )}
        </Field>

        <Field label="Next follow-up">
          {enquiry.nextFollowUpAt ? (
            <>
              {formatDateTime(enquiry.nextFollowUpAt)}{" "}
              <span className="text-muted-foreground">
                ({formatRelativeDays(enquiry.nextFollowUpAt)})
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Not scheduled</span>
          )}
        </Field>

        <Field label="City">{enquiry.city ?? <Muted>Not given</Muted>}</Field>

        {/* HOW THIS RECORD CAME TO EXIST, and how consent to be contacted arose.
            Kept visible rather than buried in the schema because SCCT's enquiry
            routes include purchased data and university tag lists, where the person
            may never have expressed interest — and that is precisely what a
            retention or consent question later depends on (open question 9). */}
        <Field label="Captured via">
          {enquiry.captureChannel === "public_form"
            ? "Public enquiry form"
            : "Keyed in by staff"}
        </Field>

        <Field label="Consent basis">
          {
            {
              self_submitted: "Submitted by the person themselves",
              verbal_to_staff: "Given verbally to staff",
              sourced_list: "From a purchased or supplied list — not self-submitted",
            }[enquiry.consentBasis]
          }
        </Field>
      </section></Card>

      {enquiry.message && (
        <Card asChild><section className="p-6">
          <h2 className="text-sm font-semibold">Message from the enquirer</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{enquiry.message}</p>
        </section></Card>
      )}

      {/* ── Placeholder qualification fields ────────────────────────────────── */}
      {/* Dashed border and no Card, deliberately: these fields are unconfirmed
          placeholders and must not look like settled data sitting in a card
          alongside the real record. */}
      <section className="rounded-lg border border-dashed bg-muted/30 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Placeholder fields — pending SCCT confirmation
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Which qualification details SCCT needs is unconfirmed (open question 3). None of these
          affect how the enquiry is handled.
        </p>

        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <Field label="Previous institution">
            {enquiry.previousInstitution ?? <Muted>Not given</Muted>}
          </Field>
          <Field label="HSC stream">{enquiry.hscStream ?? <Muted>Not given</Muted>}</Field>
          <Field label="HSC percentage">
            {enquiry.hscPercentageBand ?? <Muted>Not given</Muted>}
          </Field>
        </div>
      </section>

      {/* ── Duplicates ──────────────────────────────────────────────────────── */}
      <Card asChild><section className="p-6">
        <h2 className="text-sm font-semibold">Possible duplicates</h2>
        <div className="mt-3">
          <DuplicatePanel duplicates={enquiry.duplicates} />
        </div>
      </section></Card>

      {/* ── Follow-ups ──────────────────────────────────────────────────────── */}
      <Card asChild><section className="p-6">
        <h2 className="text-sm font-semibold">Follow-ups</h2>

        {enquiry.followUps.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            None scheduled yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {enquiry.followUps.map((followUp) => (
              <li key={followUp.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={followUp.status === "missed" ? "destructive" : "outline"}>
                    {followUp.status}
                  </Badge>
                  <span>due {formatDate(followUp.dueAt)}</span>
                  <span className="text-muted-foreground">
                    {followUp.assignedToName ?? "Unassigned"}
                  </span>
                  {followUp.outcome && (
                    <span className="text-muted-foreground">— {followUp.outcome}</span>
                  )}
                  {followUp.completedAt && (
                    <span className="text-xs text-muted-foreground">
                      recorded {formatDate(followUp.completedAt)}
                    </span>
                  )}
                </div>

                {/* Only an OPEN follow-up can be resolved. A resolved one is history
                    and the server refuses to re-mark it, so offering the buttons
                    would be offering a guaranteed failure. */}
                {canUpdate && followUp.status === "scheduled" && (
                  <FollowUpOutcomeControls enquiryId={enquiry.id} followUpId={followUp.id} />
                )}
              </li>
            ))}
          </ul>
        )}

        {openFollowUps.length > 1 && (
          // Allowed — several planned calls is legitimate — but worth surfacing,
          // because the queue's urgency column shows only the earliest.
          <p className="mt-3 text-xs text-muted-foreground">
            {openFollowUps.length} follow-ups are open. The queue sorts on the earliest.
          </p>
        )}
      </section></Card>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      <Card asChild><section className="p-6">
        <h2 className="text-sm font-semibold">Activity history</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Append-only. Nothing in this list can be edited, archived or removed.
        </p>

        <div className="mt-5">
          <HistoryTimeline history={enquiry.history} />
        </div>
      </section></Card>
        </div>

        {/* ── Right column: the actions ────────────────────────────────────────
            Sticky, so it stays reachable while reading a long history. `top-6`
            clears the page padding rather than pinning to the very edge. */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          {canUpdate ? (
            <>
              <Card className="p-5">
                <h2 className="text-sm font-semibold">Update this enquiry</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every change is appended to the history and cannot be undone.
                </p>

                <div className="mt-5 space-y-6">
                  <StatusControl
                    enquiryId={enquiry.id}
                    currentStatusCode={enquiry.statusCode}
                    statuses={statuses.map((status) => ({
                      code: status.code,
                      label: status.label,
                      isPlaceholder: status.isPlaceholder,
                    }))}
                  />

                  <div>
                    <Separator className="mb-5" />
                    <p className="text-xs font-medium text-muted-foreground">Ownership</p>
                    <div className="mt-2">
                      <OwnerControl
                        enquiryId={enquiry.id}
                        currentOwnerId={enquiry.ownerId}
                        myStaffProfileId={principal.staffProfileId}
                        canReassign={canReassign}
                        assignableStaff={assignable.map((staff) => ({
                          id: String(staff._id),
                          name: `${staff.firstName} ${staff.lastName ?? ""}`.trim(),
                        }))}
                      />
                    </div>
                  </div>

                  <div>
                    <Separator className="mb-5" />
                    <ScheduleFollowUpForm enquiryId={enquiry.id} />
                  </div>
                </div>
              </Card>

              {canNote && (
                <Card className="p-5">
                  <h2 className="text-sm font-semibold">Add a note</h2>
                  <div className="mt-3">
                    <NoteForm enquiryId={enquiry.id} />
                  </div>
                </Card>
              )}
            </>
          ) : (
            // Explained rather than simply absent, so a counsellor looking at a
            // colleague's record knows why there is nothing to click.
            <div className="rounded-lg border border-dashed bg-muted/30 p-5">
              <p className="text-sm font-medium">Read-only for you</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This enquiry belongs to another owner. Changing it needs the{" "}
                <code className="font-mono">enquiry.update.all</code> permission, or ownership of
                the enquiry.
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

/**
 * Plain divs rather than `<dt>`/`<dd>`: a definition-list pair is only valid inside
 * a `<dl>`, and these fields sit in `<section>` grids. Invalid nesting that happens
 * to render is still invalid, and it is the kind of thing a screen reader surfaces
 * as nonsense.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
