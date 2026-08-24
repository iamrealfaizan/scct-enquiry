"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { WriteFeedback } from "./WriteFeedback";
import { useWriteAction } from "./useWriteAction";

/**
 * Add a note to the enquiry's history.
 *
 * NO CONCURRENCY GUARD, and that is correct rather than an omission: a note is an
 * insert into an append-only log, so there is no existing value for a stale screen to
 * overwrite. Two counsellors adding notes at the same moment both succeed.
 *
 * THE BOX IS ONLY CLEARED ON A CONFIRMED SUCCESS. Losing a paragraph someone typed
 * about a phone call because the database blinked is small, avoidable, and exactly
 * the kind of thing that makes staff stop trusting a system.
 *
 * There is no edit and no delete. A correction is a new note — an editable audit
 * trail is not an audit trail.
 */
export function NoteForm({ enquiryId }: { enquiryId: string }) {
  const [note, setNote] = useState("");
  const { pending, error, success, run } = useWriteAction();

  async function submit() {
    const saved = await run(`/api/staff/enquiries/${enquiryId}/notes`, { note: note.trim() });
    if (saved) setNote("");
  }

  return (
    <div>
      <Textarea
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What happened on the call?"
        aria-label="Note"
      />

      <div className="mt-2 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          // The server enforces a 2-character minimum; matching it here means the
          // button is not offered for a state that would be refused.
          disabled={pending || note.trim().length < 2}
          onClick={submit}
        >
          {pending ? "Saving…" : "Add note"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Notes are permanent and cannot be edited or removed.
        </p>
      </div>

      <WriteFeedback error={error} success={success} />
    </div>
  );
}
