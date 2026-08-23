import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QueueQuery } from "@/schemas/queue.schema";

/**
 * The queue's filter bar — a plain HTML GET form, and that is the interesting part.
 *
 * NO CLIENT JAVASCRIPT AT ALL. Submitting navigates to the same page with new query
 * parameters, and the server renders the filtered queue. Consequences worth having:
 *
 *   · A filtered queue is a URL. It can be bookmarked, pasted into a message, and
 *     linked to from a reporting figure — which is how the management view's numbers
 *     are made to trace back to the records behind them (conventions §12).
 *   · The back button works, because each filter change is a real navigation.
 *   · There is no stale-response race. Client-side filtering means concurrent
 *     requests, and a slow response for one filter arriving after a fast response
 *     for another renders the wrong rows under the right filter. There is no second
 *     request here to arrive out of order.
 *   · It works with JavaScript disabled or still loading, which for a staff tool on
 *     a college's connection is not a hypothetical.
 *
 * NATIVE `<select>` RATHER THAN THE RADIX ONE the enquiry form uses. Radix's Select
 * is a client component and does not submit as a form field — adopting it here would
 * mean making this whole bar interactive to gain a nicer-looking dropdown. The
 * enquiry form is a different case: it needs client validation anyway.
 *
 * `page` IS DELIBERATELY NOT A HIDDEN FIELD. Changing a filter must return to page
 * one; carrying the old page number over lands the user on "page 4 of 2", which
 * looks like an empty queue.
 */

/**
 * Native `<select>`, styled to match the shadcn `SelectTrigger` exactly.
 *
 * These are the ONLY native selects left in the system, and they stay native for an
 * architectural reason rather than an oversight. Radix's Select renders a `<button>`
 * plus a portal and does NOT submit as a form field — so adopting it here would mean
 * client state and hidden inputs, and this whole bar would stop being a plain GET
 * form. What that form buys is worth keeping: filtered queues are shareable URLs, the
 * back button works, there is no stale-response race, and `/staff` ships almost no
 * JavaScript.
 *
 * So the visual language is matched instead of the implementation. Same height,
 * radius, border, shadow and focus ring as `SelectTrigger`; the arrow is drawn as an
 * inline SVG background because `appearance-none` removes the browser's own, which
 * otherwise differs between Chrome, Safari and Firefox.
 *
 * If these ever need to look identical down to the open-state panel, the honest
 * answer is a Radix Select paired with a hidden input — not a half-measure that keeps
 * the native element and pretends.
 */
const selectClass =
  "flex h-9 w-full appearance-none items-center rounded-md border border-input bg-transparent bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] bg-[length:1rem] bg-[right_0.625rem_center] bg-no-repeat py-2 pl-3 pr-9 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "text-xs text-muted-foreground";

export type FilterOption = { code: string; label: string; group?: string };

export function QueueFilters({
  query,
  programmes,
  sources,
  statuses,
  owners,
}: {
  query: QueueQuery;
  programmes: FilterOption[];
  sources: FilterOption[];
  statuses: FilterOption[];
  /** Empty when the caller cannot see other people's enquiries anyway. */
  owners: FilterOption[];
}) {
  const hasFilters =
    !!query.q ||
    !!query.status ||
    !!query.programme ||
    !!query.source ||
    (!!query.owner && query.owner !== "any") ||
    (!!query.followup && query.followup !== "any") ||
    (!!query.duplicates && query.duplicates !== "any");

  return (
    // Card wraps the form rather than replacing it — the `<form>` element is
    // load-bearing here, and a Card renders a div.
    <Card className="p-4">
      <form method="get" action="/staff">
      {/* Sort survives a filter change — someone who sorted by follow-up urgency
          still wants that order after narrowing to one programme. */}
      <input type="hidden" name="sort" value={query.sort} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Label className={labelClass} htmlFor="q">
            Search
          </Label>
          <Input
            id="q"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Name, phone, email or enquiry number"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className={labelClass} htmlFor="status">
            Stage
          </Label>
          <select id="status" name="status" defaultValue={query.status ?? ""} className={`${selectClass} mt-1.5`}>
            <option value="">Any stage</option>
            {statuses.map((status) => (
              <option key={status.code} value={status.code}>
                {status.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label className={labelClass} htmlFor="programme">
            Programme
          </Label>
          <select
            id="programme"
            name="programme"
            defaultValue={query.programme ?? ""}
            className={`${selectClass} mt-1.5`}
          >
            <option value="">Any programme</option>
            {programmes.map((programme) => (
              <option key={programme.code} value={programme.code}>
                {programme.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label className={labelClass} htmlFor="source">
            Source
          </Label>
          {/* GROUPED BY TAXONOMY, on purpose. SCCT reported two conflicting source
              lists and they are not reconciled (open question 2). Showing thirteen
              flat options would present them as one clean vocabulary and hide a
              real finding; the group headings make the problem visible to whoever
              is looking at this screen. */}
          <select
            id="source"
            name="source"
            defaultValue={query.source ?? ""}
            className={`${selectClass} mt-1.5`}
          >
            <option value="">Any source</option>
            {groupBy(sources).map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <Label className={labelClass} htmlFor="followup">
            Follow-up
          </Label>
          <select
            id="followup"
            name="followup"
            defaultValue={query.followup ?? "any"}
            className={`${selectClass} mt-1.5`}
          >
            <option value="any">Any follow-up state</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today or earlier</option>
            <option value="week">Due within 7 days</option>
            <option value="none">Not scheduled</option>
          </select>
        </div>

        <div>
          <Label className={labelClass} htmlFor="duplicates">
            Duplicate flags
          </Label>
          <select
            id="duplicates"
            name="duplicates"
            defaultValue={query.duplicates ?? "any"}
            className={`${selectClass} mt-1.5`}
          >
            <option value="any">Any</option>
            <option value="open">Awaiting review</option>
          </select>
        </div>

        {/* Only rendered when the caller can actually see other owners' enquiries.
            A counsellor given an owner dropdown would pick a colleague, get an
            empty queue, and reasonably conclude the system is broken. */}
        {owners.length > 0 && (
          <div>
            <Label className={labelClass} htmlFor="owner">
              Owner
            </Label>
            <select
              id="owner"
              name="owner"
              defaultValue={query.owner ?? "any"}
              className={`${selectClass} mt-1.5`}
            >
              <option value="any">Any owner</option>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
              {owners.map((owner) => (
                <option key={owner.code} value={owner.code}>
                  {owner.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" size="sm">
          Apply
        </Button>

        {hasFilters && (
          // A link, not a reset button: `type="reset"` restores the form's default
          // values, which are the CURRENT filters — so it would appear to do
          // nothing. Clearing has to be a navigation.
          <Button asChild variant="ghost" size="sm">
            <Link href="/staff">Clear filters</Link>
          </Button>
        )}
      </div>
      </form>
    </Card>
  );
}

function groupBy(options: FilterOption[]): Array<[string, FilterOption[]]> {
  const groups = new Map<string, FilterOption[]>();

  for (const option of options) {
    const key = option.group ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }

  return [...groups.entries()];
}
