import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatRelativeDays } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { queueQueryToSearch, type QueueQuery, type QueueSort } from "@/schemas/queue.schema";
import type { QueueRow } from "@/services/queue.service";

import { DuplicateBadge, FollowUpBadge, StatusBadge } from "./badges";

/**
 * The enquiry queue.
 *
 * SORTING IS LINKS, not click handlers — the same reasoning as the filter bar. A
 * sorted view is a URL, so it survives a refresh and can be linked to.
 *
 * THE WHOLE ROW IS NOT A LINK. A `<tr>` wrapped in an anchor is invalid HTML, and
 * the JavaScript version breaks text selection — staff copy phone numbers out of
 * this table all day. The enquiry number is the link, and it is the first column.
 *
 * PHONE NUMBERS ARE SHOWN IN FULL, deliberately. This is an internal tool whose
 * entire purpose is that a counsellor can call the person; masking the number would
 * make the queue useless and the data is no less exposed for being abbreviated.
 */

const COLUMNS: Array<{ label: string; sort?: QueueSort; className?: string }> = [
  { label: "Enquiry", sort: "newest" },
  { label: "Name", sort: "name" },
  { label: "Contact" },
  { label: "Programme" },
  { label: "Source" },
  { label: "Stage" },
  { label: "Owner" },
  { label: "Follow-up", sort: "followup" },
  { label: "Received" },
];

export function QueueTable({ rows, query }: { rows: QueueRow[]; query: QueueQuery }) {
  if (rows.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm font-medium">No enquiries match this view.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {/* Two genuinely different situations, and telling them apart is the
              difference between "clear the filter" and "nothing has come in yet". */}
          {hasAnyFilter(query)
            ? "Try clearing a filter — the enquiries may exist outside this view."
            : "Nothing has been captured yet. Submit one through the enquiry form, or seed demo data."}
        </p>
      </div>
    );
  }

  return (
    <Table>
      {/* Sticky header: the queue is scrolled, and a column you cannot name is a
          column you cannot read. `bg-card` rather than transparent, or rows show
          through it as it passes. */}
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map((column) => (
            <TableHead
              key={column.label}
              className={cn("h-9 whitespace-nowrap text-xs", column.className)}
            >
              {column.sort ? (
                <SortLink label={column.label} sort={column.sort} query={query} />
              ) : (
                column.label
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(
              // An overdue row is marked structurally as well as by its badge.
              // Colour is never the only signal — the badge still says "Overdue" in
              // words, for anyone who cannot distinguish the border.
              row.followUpState === "overdue" &&
                "border-l-2 border-l-destructive bg-destructive/[0.03]",
            )}
          >
            <TableCell className="whitespace-nowrap">
              <Link
                href={`/staff/${row.id}`}
                className="font-mono text-xs font-medium underline-offset-2 hover:underline"
              >
                {row.enquiryNumber}
              </Link>

              {row.openDuplicateFlags > 0 && (
                <div className="mt-1">
                  <DuplicateBadge count={row.openDuplicateFlags} />
                </div>
              )}
            </TableCell>

            <TableCell className="font-medium">{row.fullName}</TableCell>

            <TableCell className="whitespace-nowrap text-xs">
              <div>{row.phone}</div>
              {row.email ? (
                <div className="text-muted-foreground">{row.email}</div>
              ) : (
                // Said explicitly rather than left blank. An empty cell reads as
                // missing data; "no email" is a fact about the enquiry, and a
                // common one for walk-ins.
                <div className="text-muted-foreground">no email</div>
              )}
            </TableCell>

            {/* The labels snapshotted at capture, not the current lookup values —
                so renaming a programme next year does not rewrite what this person
                actually enquired about. */}
            <TableCell className="whitespace-nowrap text-xs">{row.programmeLabel}</TableCell>
            <TableCell className="text-xs">{row.sourceLabel}</TableCell>

            <TableCell>
              <StatusBadge
                label={row.statusLabel}
                isTerminal={row.statusIsTerminal}
                isPlaceholder={row.statusIsPlaceholder}
              />
            </TableCell>

            <TableCell className="whitespace-nowrap text-xs">
              {row.ownerName ?? (
                // "Unassigned" is a real state that round-robin falls back to, not
                // an error, and it must be visibly different from a name.
                <span className="italic text-muted-foreground">Unassigned</span>
              )}
            </TableCell>

            <TableCell className="whitespace-nowrap">
              <FollowUpBadge state={row.followUpState} />
              {row.nextFollowUpAt && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatRelativeDays(row.nextFollowUpAt)}
                </div>
              )}
            </TableCell>

            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDate(row.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SortLink({
  label,
  sort,
  query,
}: {
  label: string;
  sort: QueueSort;
  query: QueueQuery;
}) {
  const isActive = query.sort === sort;

  // "Enquiry" toggles newest/oldest because that is the only column where both
  // directions are meaningful to a person working a queue. Name and follow-up have
  // one useful direction each: A–Z, and most urgent first.
  const nextSort: QueueSort =
    sort === "newest" && query.sort === "newest" ? "oldest" : sort === "newest" && query.sort === "oldest" ? "newest" : sort;

  const active = isActive || (sort === "newest" && query.sort === "oldest");

  return (
    <Link
      // Sorting returns to page one: staying on page 4 while the order changes
      // shows a slice of a different list.
      href={`/staff${queueQueryToSearch(query, { sort: nextSort, page: 1 })}`}
      className={active ? "font-semibold text-foreground underline underline-offset-2" : "hover:underline"}
    >
      {label}
      {active && (sort === "newest" ? (query.sort === "oldest" ? " ↑" : " ↓") : " ↓")}
    </Link>
  );
}

function hasAnyFilter(query: QueueQuery): boolean {
  return (
    !!query.q ||
    !!query.status ||
    !!query.programme ||
    !!query.source ||
    (!!query.owner && query.owner !== "any") ||
    (!!query.followup && query.followup !== "any") ||
    (!!query.duplicates && query.duplicates !== "any")
  );
}
