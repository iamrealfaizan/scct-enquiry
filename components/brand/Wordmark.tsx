import { cn } from "@/lib/utils";

/**
 * The system's mark — a typographic wordmark, deliberately.
 *
 * SCCT'S ACTUAL LOGO IS NOT USED, and that is a decision rather than an omission.
 * Their logo is a PNG on their website; copying it into a public repository for a
 * demonstration build is a different act from matching their colours, and it would
 * make a synthetic-data demo visually indistinguishable from their real site.
 * Whether this build may use the real logo is open question 12 — if the answer is
 * yes, it replaces the mark below and nothing else changes.
 *
 * WHY AN SVG AND NOT AN IMAGE FILE. It inherits `currentColor`, so it works on the
 * navy sidebar and on white without a second asset, and it costs no network
 * request. The three ascending bars are a neutral reference to a pipeline of
 * enquiries — it carries no claim to be SCCT's identity.
 */
export function Wordmark({
  className,
  showSubtitle = true,
}: {
  className?: string;
  /** Off in tight spaces — a collapsed sidebar, a mobile header. */
  showSubtitle?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-6 w-6 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M4 17v-4" />
        <path d="M12 17V9" />
        <path d="M20 17V5" />
      </svg>

      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight">SCCT Admissions</span>
        {showSubtitle && (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest opacity-70">
            Enquiry system
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The demonstration notice, in one place.
 *
 * It appears on EVERY surface, and centralising it is what guarantees that. The
 * repo's position is that this build must never be mistaken for SCCT's live site —
 * which matters more now that it shares their colours, not less. Removing this from
 * a page would quietly undo the honesty the rest of the build maintains.
 */
export function DemoNotice({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-warning/40 bg-warning/5 px-3 py-2",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">
        <strong className="font-semibold text-foreground">Demonstration build.</strong> {children}
      </p>
    </div>
  );
}
