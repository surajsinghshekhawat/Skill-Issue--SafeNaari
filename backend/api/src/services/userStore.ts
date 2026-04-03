import fs from "fs";
import path from "path";

export type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const USERS_PATH = path.resolve(DATA_DIR, "users.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): StoredUser[] {
  try {
    if (!fs.existsSync(USERS_PATH)) return [];
    const raw = fs.readFileSync(USERS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch {
    return [];
  }
}

function writeAll(users: StoredUser[]) {
  ensureDataDir();
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), "utf-8");
}

export function findUserByEmail(email: string): StoredUser | null {
  const norm = email.trim().toLowerCase();
  return readAll().find((u) => u.email.toLowerCase() === norm) || null;
}

export function createUser(user: StoredUser): StoredUser {
  const users = readAll();
  users.push(user);
  writeAll(users);
  return user;
}

