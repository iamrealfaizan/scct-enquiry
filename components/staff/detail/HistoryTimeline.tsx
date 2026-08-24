import { formatDateTime } from "@/lib/dates";
import type { HistoryEntry } from "@/services/queue.service";

/**
 * The append-only activity log for one enquiry.
 *
 * THIS IS THE EVIDENCE TRAIL the brief asks for, so it is rendered as facts rather
 * than prose: what happened, when, and which account did it. Nothing here is
 * editable and nothing is hidden — `EnquiryEvent` has no `isArchived` field
 * precisely so that history cannot be quietly removed.
 *
 * `createdBy: null` RENDERS AS "Public form / system" rather than blank. A missing
 * actor is meaningful — it means the person submitted it themselves, or a process
 * did it — and an empty cell would read as lost data.
 *
 * NEWEST FIRST. A counsellor picking up an enquiry needs the last thing that
 * happened, not the first.
 */

/**
 * Labels and a tone per event type.
 *
 * `tone` drives a coloured dot on the rail so the shape of an enquiry's history is
 * scannable — a run of red dots is a story before you read a word of it. The LABEL
 * always says what happened, so the colour adds nothing a reader depends on.
 */
const EVENTS: Record<string, { label: string; tone: "neutral" | "good" | "warn" | "bad" }> = {
  created: { label: "Enquiry captured", tone: "neutral" },
  status_changed: { label: "Stage changed", tone: "neutral" },
  owner_assigned: { label: "Owner assigned", tone: "neutral" },
  owner_changed: { label: "Owner changed", tone: "neutral" },
  note_added: { label: "Note added", tone: "neutral" },
  followup_scheduled: { label: "Follow-up scheduled", tone: "neutral" },
  followup_completed: { label: "Follow-up completed", tone: "good" },
  followup_missed: { label: "Follow-up missed", tone: "bad" },
  duplicate_flagged: { label: "Flagged as possible duplicate", tone: "warn" },
  duplicate_dismissed: { label: "Duplicate flag dismissed", tone: "neutral" },
  duplicate_confirmed: { label: "Duplicate confirmed", tone: "warn" },
  exported: { label: "Included in an export", tone: "neutral" },
};

const TONE_CLASS = {
  neutral: "bg-border",
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
} as const;

export function HistoryTimeline({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    // Should not happen — `createEnquiry()` writes a `created` event — so it is
    // reported as the anomaly it would be rather than as an empty state. The event
    // write is deliberately non-fatal (the enquiry matters more than its log), so
    // this is the visible trace of that trade-off.
    return (
      <p className="text-sm text-muted-foreground">
        No history recorded. Every enquiry should have at least a capture event — if this is
        blank, the history write failed after the enquiry was stored.
      </p>
    );
  }

  return (
    // The rail is a border on the list, with each dot sitting on top of it. Drawing
    // it once rather than per item means it is continuous, including behind the gaps.
    <ol className="space-y-5 border-l pl-6">
      {history.map((entry) => {
        const event = EVENTS[entry.type] ?? { label: entry.type, tone: "neutral" as const };

        return (
        <li key={entry.id} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[1.8125rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${TONE_CLASS[event.tone]}`}
          />

          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{event.label}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</span>
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">by {entry.actor}</p>

          {/* The stage label AS IT READ at the time, not as it reads now. Renaming
              a stage must not rewrite what the history says happened. */}
          {entry.statusLabelAtEvent && (
            <p className="mt-1 text-sm">
              Stage: <span className="font-medium">{entry.statusLabelAtEvent}</span>
            </p>
          )}

          {(entry.fromOwnerName || entry.toOwnerName) && (
            <p className="mt-1 text-sm">
              {entry.fromOwnerName ?? "Unassigned"} → {entry.toOwnerName ?? "Unassigned"}
            </p>
          )}

          {entry.note && (
            <p className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
              {entry.note}
            </p>
          )}

          {entry.detail && <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>}
        </li>
        );
      })}
    </ol>
  );
}
