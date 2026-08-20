import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A divider, with shadcn's Separator API.
 *
 * WHY THIS IS NOT THE RADIX VERSION. shadcn's separator wraps
 * `@radix-ui/react-separator`, which for a horizontal rule contributes one thing:
 * the correct ARIA semantics. Those are three attributes, and they are written out
 * below. Adding a dependency to render a one-pixel line would sit badly next to this
 * repo's rule that dependencies are added when a feature needs them (conventions
 * §2) — and it is a package that would need auditing and updating forever.
 *
 * The API is identical, so swapping in the Radix version later is an import change.
 *
 * `decorative` is the meaningful prop: a purely visual rule should be hidden from
 * assistive technology (`role="none"`), while one that genuinely separates two
 * groups of content should announce itself as a separator. Defaulting to decorative
 * matches Radix, and matches the common case.
 */
const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: "horizontal" | "vertical"
    decorative?: boolean
  }
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = "Separator"

export { Separator }
