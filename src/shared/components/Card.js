"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  section,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      data-section={section || undefined}
      className={cn(
        // DESIGN.md elevation 0: flat, hairline border, no shadow on default cards.
        // Optional `elev` keeps the inset highlight for floating panels.
        "bg-canvas border border-hairline rounded-mm-xl",
        elev && "shadow-[var(--shadow-elev)]",
        // `section` opts into the vibrant section-colored hover (border + tint).
        section ? "section-hover-card" : hover && "hover:border-ink/30 transition-colors cursor-pointer",
        section && hover && "cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className={cn(
                  "p-2 rounded-mm-xl",
                  section ? "section-mark" : "bg-mm-surface text-steel"
                )}
              >
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div>
              {title && (
                <h3 className="text-ink font-semibold tracking-tight">{title}</h3>
              )}
              {subtitle && (
                <p className="text-sm text-steel">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-4 rounded-[10px] bg-mm-surface border border-hairline-soft",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3 transition-colors",
        "border-b border-hairline-soft last:border-b-0",
        "hover:bg-mm-surface",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3 -mx-3 px-3",
        "border-b border-hairline-soft last:border-b-0",
        "hover:bg-mm-surface transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};
