"use client";

import { cn } from "@/shared/utils/cn";

// Badge variants align with DESIGN.md badge taxonomy:
//   default → neutral pill on mm-surface
//   primary → ink/canvas (replaces the old coral); for "Recommended" / "Live"
//   success/warning/error/info keep semantic palette but use the registered
//   --color-* tokens (which were remapped) so dark mode flips automatically.
const variants = {
  default: "bg-mm-surface text-steel border border-hairline",
  primary: "bg-ink text-canvas",
  success: "bg-[var(--color-mm-success-bg)] text-[var(--color-mm-success-text)]",
  warning: "bg-warning/10 text-warning",
  error: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
};

const sizes = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  icon,
  className,
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold tracking-wide",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "success" && "bg-[var(--color-mm-success-text)]",
            variant === "warning" && "bg-warning",
            variant === "error" && "bg-danger",
            variant === "info" && "bg-info",
            variant === "primary" && "bg-canvas",
            variant === "default" && "bg-steel"
          )}
        />
      )}
      {icon && <span className="material-symbols-outlined text-[14px]">{icon}</span>}
      {children}
    </span>
  );
}
