"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The one place a workflow write talks to the server.
 *
 * Five controls on the enquiry page perform a write, and without this they would be
 * five copies of the same fetch, envelope-unwrapping, pending-state and error
 * handling — which is five places for one of them to quietly stop refreshing after a
 * success, or to report a failure as a success.
 *
 * WHAT IT GUARANTEES, and each of these is a rule from conventions §4 and §8:
 *
 *   · A response is only a success if the SERVER said so. `res.ok` alone is not
 *     enough — the envelope carries `success: false` with a 4xx, and a control that
 *     trusted the status code would tell someone their note was saved when it was
 *     not.
 *   · A failure NEVER clears what the user typed. They can correct and retry.
 *   · `router.refresh()` on success, so the server components re-render with the new
 *     state. Without it the page keeps showing the stage that was just changed, and
 *     the next write sends a stale guard value and gets a conflict — a confusing
 *     cascade from one missing line.
 *   · A thrown fetch is reported differently from a rejected request, because "the
 *     server never heard you" and "the server said no" need different actions from
 *     the person reading the message.
 */

export type WriteState = {
  pending: boolean;
  error: string | null;
  success: string | null;
};

export function useWriteAction() {
  const router = useRouter();

  const [state, setState] = useState<WriteState>({
    pending: false,
    error: null,
    success: null,
  });

  /**
   * Returns `true` when the write was confirmed. Callers use that to decide whether
   * to clear their inputs — never assuming it.
   */
  async function run(
    url: string,
    body: unknown,
    method: "POST" | "PATCH" = "POST",
  ): Promise<boolean> {
    setState({ pending: true, error: null, success: null });

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => null);

      // Both conditions, not either: a 200 carrying `success: false` is a failure,
      // and so is a 409 whose body failed to parse.
      if (!response.ok || !payload?.success) {
        setState({
          pending: false,
          error:
            payload?.message ??
            "That change could not be saved. Nothing was recorded — please try again.",
          success: null,
        });
        return false;
      }

      setState({
        pending: false,
        error: null,
        success: payload.message ?? "Saved.",
      });

      // Re-renders the server components on this route with the stored state, so
      // what is on screen is what is in the database.
      router.refresh();
      return true;
    } catch {
      setState({
        pending: false,
        error:
          "We could not reach the server. Nothing was changed — check your connection and try again.",
        success: null,
      });
      return false;
    }
  }

  return { ...state, run };
}
