import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, last-writer-wins on conflicts.
 *
 * `clsx` resolves conditionals and arrays into a string; `twMerge` then removes
 * earlier classes that the later ones contradict. Without the merge step,
 * `cn("px-2", "px-4")` emits both and the winner depends on CSS source order —
 * which makes a component's `className` override silently unreliable.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
