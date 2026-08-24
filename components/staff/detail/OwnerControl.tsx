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

import { WriteFeedback } from "./WriteFeedback";
import { useWriteAction } from "./useWriteAction";

/**
 * Claim, release, or reassign an enquiry.
 *
 * WHAT IS OFFERED DEPENDS ON WHAT THE CALLER MAY DO, and the server decides
 * independently — hiding a button is not authorization, it is courtesy. A counsellor
 * who forges the request still hits `changeOwner`, which reads the stored owner and
 * refuses.
 *
 *   claim    — offered when the enquiry is unassigned and the caller has a profile
 *   release  — offered when the caller owns it
 *   reassign — offered only with `enquiry.reassign`
 *
 * `fromOwnerId` IS SENT WITH EVERY REQUEST. Two managers assigning the same
 * unassigned enquiry to two different counsellors is the exact race this prevents:
 * the first write wins, the second is told, and neither change disappears.
 */
export function OwnerControl({
  enquiryId,
  currentOwnerId,
  myStaffProfileId,
  canReassign,
  assignableStaff,
}: {
  enquiryId: string;
  currentOwnerId: string | null;
  myStaffProfileId: string | null;
  canReassign: boolean;
  assignableStaff: Array<{ id: string; name: string }>;
}) {
  const [toOwnerId, setToOwnerId] = useState("");
  const { pending, error, success, run } = useWriteAction();

  const isMine = !!myStaffProfileId && currentOwnerId === myStaffProfileId;
  const isUnassigned = currentOwnerId === null;

  function change(next: string | null) {
    return run(`/api/staff/enquiries/${enquiryId}/owner`, {
      fromOwnerId: currentOwnerId,
      toOwnerId: next,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {isUnassigned && myStaffProfileId && (
          <Button type="button" size="sm" disabled={pending} onClick={() => change(myStaffProfileId)}>
            {pending ? "Saving…" : "Claim this enquiry"}
          </Button>
        )}

        {isMine && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => change(null)}
          >
            {pending ? "Saving…" : "Release to the pool"}
          </Button>
        )}
      </div>

      {canReassign && (
        <div className="mt-3">
          <Label htmlFor="toOwnerId" className="text-xs text-muted-foreground">
            Reassign to
          </Label>

          <div className="mt-1.5 flex gap-2">
            <Select value={toOwnerId} onValueChange={setToOwnerId}>
              <SelectTrigger id="toOwnerId" className="flex-1">
                <SelectValue placeholder="Choose a staff member…" />
              </SelectTrigger>
              <SelectContent>
                {/* Only staff who are eligible for assignment appear. The server
                    checks the same rule, so the queue can never be pointed at
                    someone on leave — and "why is this assigned to a person not in
                    the rota" never becomes a question. */}
                {assignableStaff
                  .filter((staff) => staff.id !== currentOwnerId)
                  .map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.name}
                    </SelectItem>
                  ))}
                {!isUnassigned && (
                  <SelectItem value="__unassign">Unassigned (back to the pool)</SelectItem>
                )}
              </SelectContent>
            </Select>

            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={pending || !toOwnerId}
              onClick={() => change(toOwnerId === "__unassign" ? null : toOwnerId)}
            >
              {pending ? "Saving…" : "Reassign"}
            </Button>
          </div>
        </div>
      )}

      {!isUnassigned && !isMine && !canReassign && (
        // Said plainly instead of showing nothing. A blank panel reads as a broken
        // page; this reads as a rule.
        <p className="text-xs text-muted-foreground">
          Someone else owns this enquiry. Changing its owner needs the{" "}
          <code className="font-mono">enquiry.reassign</code> permission.
        </p>
      )}

      <WriteFeedback error={error} success={success} />
    </div>
  );
}
