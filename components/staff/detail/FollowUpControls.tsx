"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { WriteFeedback } from "./WriteFeedback";
import { useWriteAction } from "./useWriteAction";

/**
 * Schedule the next follow-up, and record what happened to an open one.
 *
 * SCCT's follow-up cadence and escalation rules are unconfirmed (open question 7), so
 * nothing here suggests one: no default interval, no "in 3 days" shortcut, no
 * reminder. The system records what a person decided.
 *
 * `datetime-local` SENDS A LOCAL WALL-CLOCK STRING with no offset, so it is converted
 * to a real instant here with `new Date(value)` — which the browser resolves in the
 * viewer's timezone. For SCCT staff working in IST that is the right answer and the
 * one they expect. It is also the one place in the system where a date depends on the
 * VIEWER's clock rather than the institute's, which is a deliberate trade: someone
 * picking "3pm tomorrow" means 3pm where they are standing.
 *
 * MARKING A FOLLOW-UP MISSED IS A HUMAN ACTION. Nothing runs on a schedule here — no
 * cron, no worker — so if a person could not record that a call did not happen, the
 * follow-up would sit `scheduled` forever and the overdue figure would be fiction.
 */

export function ScheduleFollowUpForm({ enquiryId }: { enquiryId: string }) {
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const { pending, error, success, run } = useWriteAction();

  async function submit() {
    const saved = await run(`/api/staff/enquiries/${enquiryId}/followups`, {
      // An ISO instant, not the raw local string — the server stores a point in time.
      dueAt: new Date(dueAt).toISOString(),
      note: note.trim() || undefined,
    });

    if (saved) {
      setDueAt("");
      setNote("");
    }
  }

  return (
    <div>
      <Label htmlFor="dueAt" className="text-xs text-muted-foreground">
        Next follow-up
      </Label>

      <Input
        id="dueAt"
        type="datetime-local"
        value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}
        className="mt-1.5"
      />

      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What is this call for? (optional)"
        className="mt-2"
      />

      <Button type="button" size="sm" className="mt-2" disabled={pending || !dueAt} onClick={submit}>
        {pending ? "Saving…" : "Schedule follow-up"}
      </Button>

      <p className="mt-2 text-xs text-muted-foreground">
        Assigned to the current owner unless it is unassigned. Nothing is sent or reminded — the
        system records what was planned.
      </p>

      <WriteFeedback error={error} success={success} />
    </div>
  );
}

export function FollowUpOutcomeControls({
  enquiryId,
  followUpId,
}: {
  enquiryId: string;
  followUpId: string;
}) {
  const [outcome, setOutcome] = useState("");
  const { pending, error, success, run } = useWriteAction();

  function record(status: "completed" | "missed" | "cancelled") {
    return run(
      `/api/staff/enquiries/${enquiryId}/followups/${followUpId}`,
      { status, outcome: outcome.trim() || undefined },
      "PATCH",
    );
  }

  return (
    <div className="mt-2">
      <Input
        value={outcome}
        onChange={(event) => setOutcome(event.target.value)}
        placeholder="Outcome (optional) — free text, since SCCT's outcome list is unconfirmed"
        className="text-xs"
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => record("completed")}>
          Completed
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => record("missed")}
        >
          Missed
        </Button>

        {/* Cancelled is NOT the same as missed, and the history records them
            differently: one call was never going to happen, the other should have. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => record("cancelled")}
        >
          Cancel it
        </Button>
      </div>

      <WriteFeedback error={error} success={success} />
    </div>
  );
}
