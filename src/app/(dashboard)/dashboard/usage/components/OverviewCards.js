"use client";

import PropTypes from "prop-types";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

// Each metric card carries its own product-identity gradient + glyph,
// honoring DESIGN.md's "vibrant gradient product card" pattern.
// Color order is a deliberate cool→warm hue rotation:
//   blue → purple → magenta → coral
// ending on coral for the cost card — DESIGN.md flags coral as the
// brand's high-impact accent ("watch this" energy), which fits the
// metric users actually want eyes on.
const STATS = [
  {
    key: "totalRequests",
    label: "Total Requests",
    icon: "show_chart",
    gradient: "linear-gradient(135deg, var(--section-blue-from) 0%, var(--section-blue-to) 100%)",
    format: fmt,
    field: "totalRequests",
    sub: null,
  },
  {
    key: "totalPromptTokens",
    label: "Input Tokens",
    icon: "north_east",
    gradient: "linear-gradient(135deg, var(--section-purple-from) 0%, var(--section-purple-to) 100%)",
    format: fmt,
    field: "totalPromptTokens",
    sub: null,
  },
  {
    key: "totalCompletionTokens",
    label: "Output Tokens",
    icon: "south_west",
    gradient: "linear-gradient(135deg, var(--section-magenta-from) 0%, var(--section-magenta-to) 100%)",
    format: fmt,
    field: "totalCompletionTokens",
    sub: null,
  },
  {
    key: "totalCost",
    label: "Estimated Cost",
    icon: "savings",
    gradient: "linear-gradient(135deg, var(--section-coral-from) 0%, var(--section-coral-to) 100%)",
    format: (n) => `~${fmtCost(n)}`,
    field: "totalCost",
    sub: "Estimated, not actual billing",
  },
];

function StatCard({ label, icon, gradient, value, sub }) {
  return (
    <div
      className="relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-mm-xl p-5 text-white"
      style={{
        background: gradient,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* Atmospheric glow — pure CSS, no images */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 88% 12%, rgba(255,255,255,0.18), transparent 55%), radial-gradient(circle at 12% 92%, rgba(0,0,0,0.18), transparent 60%)",
        }}
      />

      {/* Header row: label + icon mark inline */}
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-white/85">{label}</span>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "rgba(255,255,255,0.18)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.25)",
          }}
        >
          <span className="material-symbols-outlined text-[18px] text-white">{icon}</span>
        </div>
      </div>

      {/* Value + optional sub */}
      <div className="relative flex flex-col gap-0.5">
        <span className="truncate text-[28px] font-semibold leading-[1.15] tracking-tight">
          {value}
        </span>
        {sub && <span className="text-[11px] text-white/65">{sub}</span>}
      </div>
    </div>
  );
}

StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  gradient: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  sub: PropTypes.string,
};

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
      {STATS.map((s) => (
        <StatCard
          key={s.key}
          label={s.label}
          icon={s.icon}
          gradient={s.gradient}
          value={s.format(stats[s.field])}
          sub={s.sub}
        />
      ))}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
