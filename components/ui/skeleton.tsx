import { cn } from "@/lib/utils"

/**
 * A loading placeholder.
 *
 * Used in exactly one place — the public enquiry form, while it fetches the
 * programme list from `/api/config`. Everywhere else in this system renders on the
 * server with its data already resolved, so there is no loading state to show.
 *
 * A SKELETON RATHER THAN A SPINNER because it holds the space the content will
 * occupy, so the form does not jump when the programmes arrive. It is also honest
 * about what is coming: three field-shaped blocks say "a form is loading", where a
 * spinner says only "wait".
 *
 * `aria-hidden` and a live-region message belong together — the visual placeholder
 * is meaningless to a screen reader, so callers pair this with real text.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
