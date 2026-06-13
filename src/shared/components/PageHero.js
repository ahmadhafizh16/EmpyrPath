"use client";

import PropTypes from "prop-types";
import { translate } from "@/i18n/runtime";

/**
 * PageHero — vibrant gradient identity card that opens every dashboard page.
 *
 * DESIGN.md alignment:
 *   - 32px corner softening (rounded-hero) + atmospheric glow → product-card pattern
 *   - Per-section brand color via `data-section` (resolved through globals.css
 *     section-color variables). Color is applied as the gradient fill, not as
 *     buttons or text — keeps brand colors in product-identity moments only.
 *   - Hero typography: 40px (md) → 32px (sm) heading, tight tracking.
 *   - Optional `stats` array renders the 3-stat strip from DESIGN.md.
 *
 * Props
 *   section:     "coral" | "magenta" | "blue" | "purple" | "cyan" | "ink"
 *   eyebrow:     short uppercase chip text (default: section eyebrow)
 *   title:       page title (display-md weight 600, tracking -0.02em)
 *   description: one-line subtitle, white/85
 *   icon:        material-symbols name shown in a glass mark
 *   stats:       Array<{ label, value }> — optional 3-up tile strip
 *   actions:     ReactNode — right-aligned action area (CTAs, badges, etc.)
 */
export default function PageHero({
  section = "ink",
  eyebrow,
  title,
  description,
  icon,
  stats,
  actions,
}) {
  return (
    <section
      data-section={section}
      className="section-hero relative overflow-hidden rounded-hero px-6 py-7 sm:px-9 sm:py-10"
    >
      {/* Atmospheric depth + dot grid (DESIGN.md vibrant card pattern). */}
      <div aria-hidden="true" className="section-glow-1 pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.95) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          {icon && (
            <span className="hidden sm:inline-flex items-center justify-center size-12 shrink-0 rounded-2xl bg-white/15 backdrop-blur text-white">
              <span className="material-symbols-outlined text-[24px]">{icon}</span>
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {translate(eyebrow)}
              </span>
            )}
            {title && (
              <h1 className="mt-3 text-[28px] sm:text-[40px] font-semibold leading-[1.1] tracking-[-0.02em] text-white">
                {translate(title)}
              </h1>
            )}
            {description && (
              <p className="mt-2 max-w-xl text-sm sm:text-base leading-relaxed text-white/85">
                {translate(description)}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="shrink-0 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {Array.isArray(stats) && stats.length > 0 && (
        <ul className="relative z-10 mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {stats.slice(0, 3).map((s) => (
            <li
              key={s.label}
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur"
            >
              <p className="text-2xl font-semibold leading-none text-white">{s.value}</p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/75">
                {s.label}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

PageHero.propTypes = {
  section: PropTypes.oneOf(["coral", "magenta", "blue", "purple", "cyan", "ink"]),
  eyebrow: PropTypes.string,
  title: PropTypes.string,
  description: PropTypes.string,
  icon: PropTypes.string,
  stats: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    }),
  ),
  actions: PropTypes.node,
};
