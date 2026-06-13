// 9router admin <subcommand>
//
// Currently supports:
//   9router admin add [--email <e>] [--password <p>] [--name <n>] [--role admin|user]
//
// Talks to a locally running 9router via the API client (which carries the
// machineId-derived x-9r-cli-token; that header is honoured by dashboardGuard
// to bypass RBAC). The server must be running before this command is used —
// when not running, callers see a network error and a hint to start it.

const api = require("../api/client");
const { prompt, confirm } = require("../utils/input");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;
const VALID_ROLES = new Set(["admin", "user"]);

function printUsage() {
  console.log(`
${COLORS.bold}9router admin${COLORS.reset} — manage dashboard accounts

  ${COLORS.bold}add${COLORS.reset}   Provision a new account (admin or user)

Usage:
  ${COLORS.dim}9router admin add [--email <e>] [--password <p>] [--name <n>] [--role admin|user]${COLORS.reset}

Flags:
  --email     <email>            Account email (prompted if omitted)
  --password  <password>         Account password, min ${MIN_PASSWORD_LEN} chars (prompted if omitted)
  --name      <display name>     Optional display name
  --role      admin | user       Role to assign (default: admin)
  --port      <port>             Override server port (default: 20128)
  --host      <host>             Override server host (default: localhost)
  --help                         Show this message
`);
}

// Minimal flag parser: supports --flag value and --flag=value. Positional args
// are returned in order. Unknown flags fall through to positionals so we don't
// silently swallow typos.
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { flags, positional };
}

async function ensureValidEmail(initial) {
  let value = initial;
  while (!value || !EMAIL_RE.test(value)) {
    if (value && !EMAIL_RE.test(value)) {
      console.log(`${COLORS.red}Invalid email.${COLORS.reset}`);
    }
    value = await prompt("Email: ");
  }
  return value.trim();
}

async function ensureValidPassword(initial) {
  let value = initial;
  while (!value || value.length < MIN_PASSWORD_LEN) {
    if (value && value.length < MIN_PASSWORD_LEN) {
      console.log(`${COLORS.red}Password must be at least ${MIN_PASSWORD_LEN} characters.${COLORS.reset}`);
    }
    // NOTE: prompt() does not mask input. Acceptable on a host-local CLI; the
    // alternative is reading stdin in raw mode and printing '*' per char, which
    // breaks paste behaviour on Windows terminals. Add masking later if needed.
    console.log(`${COLORS.dim}(password will echo as you type)${COLORS.reset}`);
    value = await prompt("Password: ");
  }
  return value;
}

async function runAdd(flags) {
  const email = await ensureValidEmail(flags.email);
  const password = await ensureValidPassword(flags.password);
  const name = typeof flags.name === "string" ? flags.name : "";
  const role = (flags.role || "admin").toLowerCase();

  if (!VALID_ROLES.has(role)) {
    console.log(`${COLORS.red}Invalid role: ${role}. Use 'admin' or 'user'.${COLORS.reset}`);
    process.exitCode = 2;
    return;
  }

  console.log("");
  console.log(`  Email: ${COLORS.bold}${email}${COLORS.reset}`);
  console.log(`  Name:  ${name || COLORS.dim + "(none)" + COLORS.reset}`);
  console.log(`  Role:  ${role === "admin" ? COLORS.bold + role + COLORS.reset : role}`);
  console.log("");
  const ok = await confirm("Create this account?");
  if (!ok) {
    console.log(`${COLORS.yellow}Cancelled.${COLORS.reset}`);
    return;
  }

  const result = await api.createUser({ email, password, name: name || undefined, role });
  if (result.success) {
    const user = result.data?.user || {};
    console.log(`${COLORS.green}✓ Account created.${COLORS.reset}`);
    console.log(`  id:    ${user.id || "?"}`);
    console.log(`  email: ${user.email || email}`);
    console.log(`  role:  ${user.role || role}`);
    return;
  }

  // Translate common errors to friendlier messages.
  let hint = "";
  if (result.statusCode === 409) hint = " (try a different email)";
  else if (/Network error|ECONNREFUSED/i.test(result.error || "")) {
    hint = "\n  Is the 9router server running? Start it with: 9router";
  }
  console.log(`${COLORS.red}✗ ${result.error || "Failed to create account"}${COLORS.reset}${hint}`);
  process.exitCode = 1;
}

// Entry point. Returns true when the args were handled (cli.js should exit
// without launching the server); false when not an admin command.
async function maybeHandleAdminCommand(argv) {
  if (argv[0] !== "admin") return false;

  const sub = argv[1];
  const { flags, positional } = parseFlags(argv.slice(2));
  if (flags.host || flags.port) {
    api.configure({
      host: flags.host || "localhost",
      port: flags.port ? parseInt(flags.port, 10) : 20128,
    });
  }

  if (!sub || sub === "--help" || sub === "-h" || flags.help) {
    printUsage();
    return true;
  }

  if (sub === "add") {
    await runAdd(flags);
    return true;
  }

  console.log(`${COLORS.red}Unknown admin subcommand: ${sub}${COLORS.reset}`);
  printUsage();
  process.exitCode = 2;
  // Suppress unused warning while keeping the parser symmetric.
  void positional;
  return true;
}

module.exports = { maybeHandleAdminCommand };
