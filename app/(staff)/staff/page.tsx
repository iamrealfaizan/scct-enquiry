import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PERMISSION_CODES } from "@/config/codes";
import { QueueFilters, type FilterOption } from "@/components/staff/queue/QueueFilters";
import { QueuePagination } from "@/components/staff/queue/QueuePagination";
import { QueueStats } from "@/components/staff/queue/QueueStats";
import { QueueTable } from "@/components/staff/queue/QueueTable";
import { ScopeNotice } from "@/components/staff/queue/badges";
import { can, currentPrincipal } from "@/lib/auth";
import { db } from "@/lib/db";
import { EnquirySource, EnquiryStatus, Programme, StaffProfile } from "@/models";
import { parseQueueQuery } from "@/schemas/queue.schema";
import { listEnquiries, queueCounts } from "@/services/queue.service";

export const metadata: Metadata = {
  title: "Enquiry queue — SCCT Admissions (demo)",
  robots: { index: false, follow: false },
};

/**
 * The enquiry queue.
 *
 * A SERVER COMPONENT THAT QUERIES MONGO DIRECTLY, rather than fetching its own API.
 * A page calling its own HTTP endpoint pays a second network round trip on the same
 * machine and has to forward the session cookie to authenticate as the user who is
 * already authenticated. `GET /api/staff/enquiries` exists for the callers that
 * genuinely need HTTP — the export and any future consumer — and both paths run the
 * same `listEnquiries()`, so they cannot disagree.
 *
 * NO CACHING. `searchParams` makes this route dynamic automatically, but the
 * important part is deliberate: a queue is the definition of data that must not be
 * served stale, and a cached page would show one counsellor another's view.
 */
export const dynamic = "force-dynamic";

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const principal = await currentPrincipal();

  // The layout has already redirected an anonymous caller; this narrows the type
  // and covers the case where this page is reached some other way.
  if (!principal) redirect("/login?next=/staff");

  // A staff account with no read permission at all. Not an error page: it is a
  // configuration state SCCT can create by editing a role, and it should read as
  // "ask an administrator", not "something broke".
  if (!can(principal, PERMISSION_CODES.ENQUIRY_VIEW_OWN)) {
    return (
      <main className="px-4 py-8 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Enquiry queue</h1>
        <Alert variant="destructive" className="mt-6 max-w-2xl">
          <AlertTitle>This account cannot view enquiries</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            It needs the <code className="font-mono text-xs">enquiry.view.own</code> permission.
            An administrator can grant it by changing this account&apos;s role.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const query = parseQueueQuery(searchParams);

  try {
    await db();
  } catch {
    return <QueueError message="The database is not reachable, so the queue cannot be shown. No data has been lost — reload once the connection is back." />;
  }

  const canSeeEveryone = can(principal, PERMISSION_CODES.ENQUIRY_VIEW_ALL);

  // The dropdown options, the counts and the queue itself, in parallel — six
  // independent reads that would otherwise be six sequential round trips to Atlas.
  const [result, counts, programmes, sources, statuses, owners] = await Promise.all([
    listEnquiries(principal, query),
    queueCounts(principal),

    Programme.find({ isActive: true, isArchived: false })
      .select("code shortName name displayOrder")
      .sort({ displayOrder: 1 })
      .lean(),

    EnquirySource.find({ isActive: true, isArchived: false })
      .select("code label taxonomyGroup displayOrder")
      .sort({ displayOrder: 1 })
      .lean(),

    EnquiryStatus.find({ isActive: true, isArchived: false })
      .select("code label displayOrder")
      .sort({ displayOrder: 1 })
      .lean(),

    // Only fetched for someone who can filter by owner at all. A counsellor's
    // dropdown of colleagues would return an empty queue for every choice.
    canSeeEveryone
      ? StaffProfile.find({ isArchived: false })
          .select("firstName lastName eligibleForAssignment isActive")
          .sort({ firstName: 1 })
          .lean()
      : Promise.resolve([]),
  ]);

  if (!result.ok) {
    // An explicit error state, and the previous figures are NOT left on screen —
    // stale numbers presented as current is the failure this codebase is most
    // concerned with.
    return <QueueError message={result.message} />;
  }

  const { rows, page, limit, total, totalPages, scope } = result.data;

  const programmeOptions: FilterOption[] = programmes.map((programme) => ({
    code: programme.code,
    label: programme.shortName ?? programme.name,
  }));

  const sourceOptions: FilterOption[] = sources.map((source) => ({
    code: source.code,
    label: source.label,
    // Grouped so the two unreconciled taxonomies stay visibly separate.
    group:
      source.taxonomyGroup === "route_analysis"
        ? "Reported enquiry routes"
        : source.taxonomyGroup === "source_analysis"
          ? "Reported source analysis"
          : "Other",
  }));

  const statusOptions: FilterOption[] = statuses.map((status) => ({
    code: status.code,
    label: status.label,
  }));

  const ownerOptions: FilterOption[] = owners.map((owner) => ({
    code: String(owner._id),
    label:
      `${owner.firstName} ${owner.lastName ?? ""}`.trim() +
      // Marked in the dropdown, because "why is nothing being assigned to Meera"
      // is answered here rather than in a support conversation.
      (owner.eligibleForAssignment && owner.isActive ? "" : " (not in rota)"),
  }));

  return (
    <main className="px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Enquiry queue</h1>
          <div className="mt-1">
            <ScopeNotice scope={scope} />
          </div>
        </div>

        <Link
          href="/enquire"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Open the public enquiry form ↗
        </Link>
      </div>

      {/* The counts come from the same scope as the list below, and each one links
          to the filtered view that produced it. If the count fails, the tiles are
          omitted rather than shown as zero — a wrong zero reads as "nothing to do". */}
      {counts.ok && (
        <div className="mt-5">
          <QueueStats counts={counts.data} />
        </div>
      )}

      <div className="mt-5">
        <QueueFilters
          query={query}
          programmes={programmeOptions}
          sources={sourceOptions}
          statuses={statusOptions}
          owners={ownerOptions}
        />
      </div>

      {/* overflow-hidden so the table's corners follow the Card's radius rather
          than squaring off against it. */}
      <Card className="mt-5 overflow-hidden">
        <QueueTable rows={rows} query={query} />
      </Card>

      <div className="mt-4">
        <QueuePagination
          query={query}
          page={page}
          limit={limit}
          total={total}
          totalPages={totalPages}
        />
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Open an enquiry to change its stage, claim it, add a note or schedule a follow-up. Enquiry
        stages shown with a <span className="font-mono">?</span> are unconfirmed placeholders, not
        SCCT process.
      </p>
    </main>
  );
}

function QueueError({ message }: { message: string }) {
  return (
    <main className="px-4 py-8 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Enquiry queue</h1>

      <Alert variant="destructive" className="mt-6 max-w-2xl">
        <AlertDescription className="font-medium">{message}</AlertDescription>
      </Alert>

      <Link
        href="/staff"
        className="mt-4 inline-block text-sm underline underline-offset-2"
      >
        Back to the unfiltered queue
      </Link>
    </main>
  );
}
