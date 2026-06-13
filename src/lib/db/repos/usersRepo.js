import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

// Roles: 'admin' (full dashboard access) | 'user' (restricted; RBAC TBD).
// Web self-registration always creates 'user'. Admin accounts are provisioned
// out-of-band (planned: a 9router CLI command) by calling createUser with an
// explicit role: 'admin'.
const VALID_ROLES = new Set(["admin", "user"]);
const BCRYPT_ROUNDS = 10;

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    name: row.name,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Strip secret fields before sending to clients.
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function countUsers() {
  const db = await getAdapter();
  const row = db.get(`SELECT COUNT(*) AS c FROM users`);
  return row?.c ?? 0;
}

export async function listUsers() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM users ORDER BY createdAt ASC`);
  return rows.map(rowToUser);
}

export async function getUserById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
  return rowToUser(row);
}

export async function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM users WHERE email = ?`, [normalized]);
  return rowToUser(row);
}

// Create a new user. The role defaults to 'user' (web self-registration); pass
// an explicit role: 'admin' to provision an admin account out-of-band (CLI).
// Throws on duplicate email — caller should map to a 409.
export async function createUser({ email, password, name = null, role = null }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email is required");
  if (!password || typeof password !== "string") throw new Error("password is required");

  const db = await getAdapter();
  const existing = db.get(`SELECT id FROM users WHERE email = ?`, [normalized]);
  if (existing) {
    const err = new Error("email already registered");
    err.code = "EMAIL_TAKEN";
    throw err;
  }

  const finalRole = role && VALID_ROLES.has(role) ? role : "user";

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    email: normalized,
    passwordHash,
    role: finalRole,
    name: name ? String(name).trim() : null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO users(id, email, passwordHash, role, name, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.email, user.passwordHash, user.role, user.name, 1, user.createdAt, user.updatedAt]
  );
  return user;
}

// Verify (email, password) against the users table. Returns the user on success,
// null on any failure (no email match / inactive / wrong password). Constant-time
// behaviour is approximated via bcrypt.compare against a dummy hash on miss to
// avoid leaking which emails exist via timing.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8bF.yLvZcW9qMOJrR0qgU8qBjqrQyW";
export async function verifyUserCredentials(email, password) {
  const user = await getUserByEmail(email);
  if (!user || !user.isActive) {
    await bcrypt.compare(password || "", DUMMY_HASH);
    return null;
  }
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  return ok ? user : null;
}

export async function updateUserPassword(id, newPassword) {
  if (!newPassword || typeof newPassword !== "string") {
    throw new Error("newPassword is required");
  }
  const db = await getAdapter();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const updatedAt = new Date().toISOString();
  const res = db.run(
    `UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?`,
    [passwordHash, updatedAt, id]
  );
  return (res?.changes ?? 0) > 0;
}

export async function setUserRole(id, role) {
  if (!VALID_ROLES.has(role)) throw new Error(`invalid role: ${role}`);
  const db = await getAdapter();
  const updatedAt = new Date().toISOString();
  const res = db.run(
    `UPDATE users SET role = ?, updatedAt = ? WHERE id = ?`,
    [role, updatedAt, id]
  );
  return (res?.changes ?? 0) > 0;
}

export async function setUserActive(id, isActive) {
  const db = await getAdapter();
  const updatedAt = new Date().toISOString();
  const res = db.run(
    `UPDATE users SET isActive = ?, updatedAt = ? WHERE id = ?`,
    [isActive ? 1 : 0, updatedAt, id]
  );
  return (res?.changes ?? 0) > 0;
}

export async function deleteUser(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM users WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
