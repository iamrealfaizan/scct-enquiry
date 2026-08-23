import Link from "next/link";

import { Card } from "@/components/ui/card";
import { STATUS_CODES } from "@/config/codes";
import { cn } from "@/lib/utils";
import type { QueueCounts } from "@/services/queue.service";

/**
 * The five headline counts above the queue.
 *
 * EVERY TILE IS A LINK TO THE QUERY THAT PRODUCED IT. That is the design, not a
 * convenience: the brief asks for management figures that trace back to stored
 * records, and a number you can click to see the exact rows behind it is provable
 * in a way a printed figure is not. Click "12 overdue" and the table below shows
 * twelve rows — if it ever showed eleven, the bug would be visible immediately
 * rather than at the end of a reporting quarter.
 *
 * The hrefs are the same filter strings the sidebar and the filter bar use, so all
 * three routes into a filtered queue produce identical URLs.
 *
 * THE COUNTS ARE ALREADY PERMISSION-SCOPED by `queueCounts()`. A counsellor's
 * "overdue" means overdue among enquiries they can open, not across the college —
 * otherwise the tile would promise rows the table cannot show.
 *
 * A server component: five numbers and five links, no interactivity.
 */

type Tile = {
  key: keyof QueueCounts;
  label: string;
  href: string;
  tone: "default" | "warning" | "destructive";
  hint: string;
};

const TILES: Tile[] = [
  {
    key: "total",
    label: "Visible to you",
    href: "/staff",
    tone: "default",
    hint: "Every enquiry in your scope",
  },
  {
    key: "new",
    label: "Not yet contacted",
    href: `/staff?status=${STATUS_CODES.NEW}`,
    tone: "default",
    hint: "Still in the default stage",
  },
  {
    key: "overdue",
    label: "Follow-up overdue",
    href: "/staff?followup=overdue&sort=followup",
    // The one figure that should feel uncomfortable. Red because an overdue
    // follow-up is the failure this system exists to make visible.
    tone: "destructive",
    hint: "Due date has passed",
  },
  {
    key: "unassigned",
    label: "Unassigned",
    href: "/staff?owner=unassigned",
    tone: "warning",
    hint: "Nobody owns these yet",
  },
  {
    key: "duplicates",
    label: "Possible duplicates",
    href: "/staff?duplicates=open",
    tone: "warning",
    hint: "Flagged for review, nothing merged",
  },
];

export function QueueStats({ counts }: { counts: QueueCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map((tile) => {
        const value = counts[tile.key];

        // A zero is greyed rather than coloured. Five red-bordered tiles reading
        // zero teaches people to ignore the colour, so the emphasis is spent only
        // when there is something to act on.
        const emphasise = value > 0;

        return (
          // Card inside Link, so the whole tile is the target rather than just the
          // label. A number you have to aim at is a number people stop clicking.
          <Link key={tile.key} href={tile.href} className="group rounded-lg">
            <Card
              className={cn(
                "h-full p-4 transition-colors group-hover:border-primary/40",
                emphasise &&
                  tile.tone === "destructive" &&
                  "border-destructive/40 bg-destructive/5",
                emphasise && tile.tone === "warning" && "border-warning/40 bg-warning/5",
              )}
            >
            <p
              className={cn(
                "tabular text-2xl font-semibold leading-none",
                emphasise && tile.tone === "destructive" && "text-destructive",
                emphasise && tile.tone === "warning" && "text-warning",
                !emphasise && "text-muted-foreground",
              )}
            >
              {value}
            </p>

            <p className="mt-2 text-xs font-medium">{tile.label}</p>

            {/* The hint says what the number MEANS. "Overdue" is obvious to whoever
                built it and ambiguous to everyone else — a manager should not have
                to guess whether it counts cancelled follow-ups. */}
            <p className="mt-0.5 text-[11px] text-muted-foreground">{tile.hint}</p>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
