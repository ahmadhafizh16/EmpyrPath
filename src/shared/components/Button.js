"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-ink hover:bg-charcoal text-canvas disabled:bg-hairline disabled:text-stone",
  secondary: "bg-transparent text-ink border border-ink hover:bg-mm-surface disabled:opacity-50",
  outline: "border border-hairline text-ink hover:bg-mm-surface hover:border-ink",
  ghost: "text-steel hover:bg-mm-surface hover:text-ink",
  danger: "bg-danger hover:opacity-90 text-white disabled:bg-hairline disabled:text-stone",
  success: "bg-[var(--color-mm-success-text)] hover:opacity-90 text-white disabled:bg-hairline disabled:text-stone",
};

// All buttons are fully pill-shaped per DESIGN.md (rounded-full); only the
// height/padding/text-size step changes between sizes.
const sizes = {
  sm: "h-8 px-4 text-xs rounded-full",
  md: "h-10 px-5 text-sm rounded-full",
  lg: "h-11 px-6 text-sm rounded-full",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className="material-symbols-outlined text-[18px]">{iconRight}</span>
      )}
    </button>
  );
}
