import { Badge } from "@/components/ui/badge";
import type { FollowUpState } from "@/services/queue.service";

/**
 * The queue's badges. Server components — no interactivity, so no client bundle.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every badge carries words, and the overdue one
 * carries a symbol as well. A colour-only status column is unreadable to a
 * colour-blind counsellor and invisible in a printed or screenshotted queue, which
 * is exactly how this data gets passed around an office.
 */

export function StatusBadge({
  label,
  isTerminal,
  isPlaceholder,
}: {
  label: string;
  isTerminal: boolean;
  isPlaceholder: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {/**
       * A terminal stage is neutral, not green.
       *
       * Green for "enrolled" would be the obvious move, and it is wrong here: the
       * only thing this component knows is `isTerminal`, which is equally true of
       * "Closed — not proceeding". Colouring by stage CODE instead would hardcode a
       * placeholder status into presentation, and SCCT's stages are unconfirmed
       * (open question 1) — so the colour would have to change when they answer.
       * Stages are data; their styling stays data-driven too.
       */}
      <Badge variant={isTerminal ? "secondary" : "outline"}>{label}</Badge>

      {/**
       * SCCT has not confirmed their enquiry stages (open question 1), so a
       * placeholder stage says so ON SCREEN. Labelling it only in the README would
       * let a demo present invented workflow as confirmed process, which is a
       * listed critical failure.
       *
       * VISIBLE TEXT RATHER THAN A TOOLTIP. This was a `title` attribute with a
       * "?", which fails in the two places it matters most: `title` never appears on
       * a touch device, and it is not reachable by keyboard. So on a phone — where a
       * counsellor actually works — the explanation did not exist. A Radix Tooltip
       * would fix the keyboard case but still needs hover or focus, and it would turn
       * every badge in a 40-row table into a client component.
       *
       * The honest fix is to say it. `sr-only` text carries the full sentence for a
       * screen reader; the short visible label carries it for everyone else.
       */}
      {isPlaceholder && (
        <Badge variant="outline" className="border-dashed text-muted-foreground">
          <span aria-hidden="true">placeholder</span>
          <span className="sr-only">
            Placeholder stage — SCCT has not confirmed their enquiry stages
          </span>
        </Badge>
      )}
    </span>
  );
}

export function FollowUpBadge({ state }: { state: FollowUpState }) {
  switch (state) {
    case "overdue":
      // The symbol matters as much as the colour: this badge is the one people look
      // for, and it has to survive a greyscale print or a screenshot.
      return <Badge variant="destructive">⚠ Overdue</Badge>;
    case "today":
      return (
        <Badge className="border-warning/40 bg-warning/10 text-warning" variant="outline">
          Due today
        </Badge>
      );
    case "upcoming":
      return <Badge variant="outline">Scheduled</Badge>;
    case "none":
      // Not styled as a warning. No follow-up scheduled is the normal state of a
      // brand-new enquiry, and a queue where every new row screams is a queue
      // nobody reads.
      return <span className="text-xs text-muted-foreground">Not scheduled</span>;
  }
}

export function DuplicateBadge({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Badge
      variant="outline"
      // The `--warning` token, not a raw Tailwind amber. Every colour resolves
      // through a token so a brand change stays an edit to globals.css — a literal
      // palette colour here would survive that edit and quietly go off-brand.
      className="border-warning/40 bg-warning/5 text-warning"
    >
      <span aria-hidden="true">
        {count === 1 ? "Possible duplicate" : `${count} possible duplicates`}
      </span>
      {/* The reassurance that nothing was merged was a `title` attribute, which no
          touch user ever saw. It is said in full on the detail page's duplicate
          panel; here it is available to a screen reader without adding a tooltip
          and its client bundle to every row of the table. */}
      <span className="sr-only">
        {count === 1 ? "One possible duplicate" : `${count} possible duplicates`}, flagged for
        review. Nothing has been merged or deleted.
      </span>
    </Badge>
  );
}

export function ScopeNotice({ scope }: { scope: "all" | "own_and_unassigned" | "unassigned_only" }) {
  // Saying what the caller is looking at, rather than letting them assume the queue
  // is everything. "I thought I could see all the enquiries" is how a missed
  // follow-up gets explained after the fact.
  const text = {
    all: "Showing all enquiries.",
    own_and_unassigned: "Showing enquiries you own, plus the unassigned pool.",
    unassigned_only:
      "Showing unassigned enquiries only — this account has no staff profile, so it cannot own enquiries.",
  }[scope];

  return <p className="text-xs text-muted-foreground">{text}</p>;
}
