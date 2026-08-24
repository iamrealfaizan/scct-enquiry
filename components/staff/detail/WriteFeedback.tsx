import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * The success/error line every write control reports through.
 *
 * Shared so that a failure looks the same wherever it happens — and so that no
 * control can quietly render a failure in a way that reads like a success.
 *
 * THE ERROR USES `Alert`, THE CONFIRMATION DOES NOT. `Alert` carries `role="alert"`,
 * which interrupts a screen reader — right for "that change was not saved", wrong
 * for "saved". A confirmation that shouts is a confirmation people learn to ignore.
 *
 * A separate file from the hook because this returns JSX and the hook does not.
 */
export function WriteFeedback({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) {
  if (error) {
    return (
      <Alert variant="destructive" className="mt-3 px-3 py-2">
        <AlertDescription className="text-xs font-medium">{error}</AlertDescription>
      </Alert>
    );
  }

  if (success) {
    return (
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {success}
      </p>
    );
  }

  return null;
}
