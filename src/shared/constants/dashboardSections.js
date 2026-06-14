// Dashboard section identity — each top-level area gets its own brand color
// so the chrome (PageHero, sidebar dot, hover tints) encodes "where you are."
// Honors DESIGN.md's "product brand colors reserved for product-identity
// moments" rule by mapping each section to one assigned color.
//
// Color tokens map to MiniMax brand product colors registered in globals.css:
//   coral   → --color-brand-coral-mm    (#ff5b49)
//   magenta → --color-brand-magenta     (#e6308a)
//   blue    → --color-brand-blue-mm     (#2b6fff)
//   purple  → --color-brand-purple      (#7c3aed)
//   cyan    → --color-section-cyan      (#06b6d4) — added for dashboard use
//   ink     → --color-ink               (administrative / neutral surfaces)

export const SECTIONS = {
  endpoint: {
    color: "coral",
    eyebrow: "Endpoint",
    title: "API endpoint",
    description: "One URL for every model your agents can reach.",
    icon: "api",
  },
  providers: {
    color: "blue",
    eyebrow: "Providers",
    title: "Provider connections",
    description: "Authenticate, rotate keys, and balance traffic across upstreams.",
    icon: "dns",
  },
  combos: {
    color: "purple",
    eyebrow: "Combos",
    title: "Model combos",
    description: "Stack models with weighted fallback and round-robin.",
    icon: "layers",
  },
  usage: {
    color: "cyan",
    eyebrow: "Analytics",
    title: "Usage & analytics",
    description: "Token spend, request volume, and per-provider breakdowns.",
    icon: "bar_chart",
  },
  quota: {
    color: "coral",
    eyebrow: "Quota",
    title: "Quota tracker",
    description: "Watch limits per provider before you hit them.",
    icon: "data_usage",
  },
  mitm: {
    color: "magenta",
    eyebrow: "Network",
    title: "MITM proxy",
    description: "Intercept tool traffic and re-route it through 9Router.",
    icon: "security",
  },
  "cli-tools": {
    color: "purple",
    eyebrow: "Tooling",
    title: "CLI tools",
    description: "Wire Claude Code, Codex, Cursor and friends to this instance.",
    icon: "terminal",
  },
  "proxy-pools": {
    color: "blue",
    eyebrow: "Network",
    title: "Proxy pools",
    description: "Outbound proxy pools with health probes and rotation.",
    icon: "lan",
  },
  skills: {
    color: "magenta",
    eyebrow: "Extensions",
    title: "Agent skills",
    description: "Drop-in skills your AI can pick up without an install step.",
    icon: "extension",
  },
  users: {
    color: "ink",
    eyebrow: "Admin",
    title: "User management",
    description: "Provision and manage dashboard accounts and roles.",
    icon: "group",
  },
  subscriptions: {
    color: "purple",
    eyebrow: "Admin",
    title: "Subscriptions",
    description: "Define subscription plans and approve user purchase requests.",
    icon: "card_membership",
  },
  plans: {
    color: "magenta",
    eyebrow: "Subscriptions",
    title: "Plans",
    description: "Browse subscription plans and apply them to your API key.",
    icon: "shopping_bag",
  },
  "my-api-key": {
    color: "coral",
    eyebrow: "Endpoint",
    title: "My API Key",
    description: "Your endpoint URL, keys, models, and usage limits.",
    icon: "vpn_key",
  },
  profile: {
    color: "ink",
    eyebrow: "Settings",
    title: "Settings",
    description: "Manage your preferences and instance configuration.",
    icon: "settings",
  },
  "console-log": {
    color: "cyan",
    eyebrow: "Diagnostics",
    title: "Console log",
    description: "Live server output streamed straight from the running process.",
    icon: "monitor",
  },
  translator: {
    color: "purple",
    eyebrow: "Diagnostics",
    title: "Translator",
    description: "Inspect request/response translation between formats.",
    icon: "translate",
  },
  "media-providers": {
    color: "blue",
    eyebrow: "Providers",
    title: "Media providers",
    description: "Embeddings, image, audio, and search providers.",
    icon: "perm_media",
  },
};

// Resolve a section descriptor from a pathname. Falls back to a neutral
// "Dashboard" identity for the index and unknown routes.
export function getSectionForPath(pathname) {
  if (!pathname) return SECTIONS.endpoint;
  const after = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  if (!after) return SECTIONS.endpoint;
  return SECTIONS[after] || SECTIONS.endpoint;
}

// Convenience: list of all section keys in nav order. Drives the sidebar
// dot-encoding and any future "all sections" iterations.
export const SECTION_NAV_ORDER = [
  "endpoint",
  "providers",
  "combos",
  "usage",
  "quota",
  "mitm",
  "cli-tools",
  "media-providers",
  "proxy-pools",
  "skills",
  "users",
  "console-log",
  "translator",
  "profile",
];
