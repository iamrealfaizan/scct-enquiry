"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { WriteFeedback } from "./WriteFeedback";
import { useWriteAction } from "./useWriteAction";

/**
 * Move an enquiry to another stage.
 *
 * `fromStatusCode` IS SENT WITH THE REQUEST, and it is the whole concurrency story:
 * the server turns it into a conditional update, so if a colleague moved this
 * enquiry while the page was open, this write is rejected instead of silently
 * overwriting them. The value comes from the server-rendered page, so it is exactly
 * what the person could see when they decided.
 *
 * THE OPTIONAL NOTE IS PART OF THE SAME ACTION rather than a second one. "Why did
 * this go to Not proceeding" is the question every stage change raises, and recording
 * the answer alongside the change is what stops the reason drifting away from it.
 *
 * NO TRANSITION FILTERING IN THIS DROPDOWN. Every active stage is offered because
 * SCCT's stages are unconfirmed and no transition rule exists to enforce — hiding
 * options here would be inventing one in the UI, where it would be invisible to
 * anyone reading the service.
 */
export function StatusControl({
  enquiryId,
  currentStatusCode,
  statuses,
}: {
  enquiryId: string;
  currentStatusCode: string;
  statuses: Array<{ code: string; label: string; isPlaceholder: boolean }>;
}) {
  const [toStatusCode, setToStatusCode] = useState("");
  const [note, setNote] = useState("");
  const { pending, error, success, run } = useWriteAction();

  async function submit() {
    const saved = await run(`/api/staff/enquiries/${enquiryId}/status`, {
      fromStatusCode: currentStatusCode,
      toStatusCode,
      note: note.trim() || undefined,
    });

    // Cleared only on a confirmed success. On failure the typed reason survives so
    // it can be retried rather than rewritten.
    if (saved) {
      setToStatusCode("");
      setNote("");
    }
  }

  return (
    <div>
      <Label htmlFor="toStatusCode" className="text-xs text-muted-foreground">
        Move to stage
      </Label>

      {/* The shadcn Select, matching the public enquiry form. This control is
          already a client component, so the Radix version costs nothing here —
          unlike the queue's filter bar, which is a plain GET form and must keep
          native selects to stay submittable without JavaScript. */}
      <Select value={toStatusCode} onValueChange={setToStatusCode}>
        <SelectTrigger id="toStatusCode" className="mt-1.5">
          <SelectValue placeholder="Choose a stage…" />
        </SelectTrigger>
        <SelectContent>
          {statuses
            // The current stage is not offered: the server rejects it as a no-op,
            // and offering it invites a pointless failure.
            .filter((status) => status.code !== currentStatusCode)
            .map((status) => (
              <SelectItem key={status.code} value={status.code}>
                {status.label}
                {status.isPlaceholder ? " (placeholder)" : ""}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <Textarea
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why is it moving? (optional, recorded in the history)"
        className="mt-2"
      />

      <Button
        type="button"
        size="sm"
        className="mt-2"
        disabled={pending || !toStatusCode}
        onClick={submit}
      >
        {pending ? "Saving…" : "Change stage"}
      </Button>

      <WriteFeedback error={error} success={success} />
    </div>
  );
}
