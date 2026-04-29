import * as React from "react";
import { cn } from "./utils";

/**
 * IconButton — standardized icon-only button with guaranteed centering.
 *
 * Solves the iOS Safari min-tap-target inflation issue by always using
 * inline-flex + center alignment. Icons stay pixel-centered regardless
 * of the container's min-width/min-height.
 *
 * Sizes:
 *   sm  → 32px container, 16px icon (w-4 h-4)
 *   md  → 36px container, 18px icon (w-[18px] h-[18px])
 *   lg  → 44px container, 20px icon (w-5 h-5)
 *
 * Usage:
 *   <IconButton onClick={...} title="Close" aria-label="Close">
 *     <X />
 *   </IconButton>
 */

type IconButtonSize = "sm" | "md" | "lg";

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "w-8 h-8 [&>svg]:w-4 [&>svg]:h-4",
  md: "w-9 h-9 [&>svg]:w-[18px] [&>svg]:h-[18px]",
  lg: "w-11 h-11 [&>svg]:w-5 [&>svg]:h-5",
};

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** sm = 32px, md = 36px (default), lg = 44px */
  size?: IconButtonSize;
  /** Additional className */
  className?: string;
  children: React.ReactNode;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = "md", className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Layout — always flex-center, no line-height interference
          "inline-flex items-center justify-center",
          // Shape & interaction
          "rounded-lg shrink-0",
          "transition-colors",
          // Hover — zinc monochrome default
          "hover:bg-zinc-100 dark:hover:bg-zinc-800",
          // Text color default
          "text-zinc-500 dark:text-zinc-400",
          // Size
          sizeClasses[size],
          // SVG normalization
          "[&>svg]:block [&>svg]:shrink-0",
          className
        )}
        {...props}
      />
    );
  }
);

IconButton.displayName = "IconButton";

export { IconButton };
