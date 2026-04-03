import fs from "fs";
import path from "path";

type VoteState = {
  up: number;
  down: number;
  by_user: Record<string, 1 | -1>;
};

export type StoredComment = {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
};

type InteractionRecord = {
  votes: VoteState;
  comments: StoredComment[];
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const PATH = path.resolve(DATA_DIR, "report_interactions.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): Record<string, InteractionRecord> {
  try {
    if (!fs.existsSync(PATH)) return {};
    const raw = fs.readFileSync(PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, InteractionRecord>) {
  ensureDir();
  fs.writeFileSync(PATH, JSON.stringify(data, null, 2), "utf-8");
}

function defaultRecord(): InteractionRecord {
  return {
    votes: { up: 0, down: 0, by_user: {} },
    comments: [],
  };
}

/** Votes/comments for ML-only / non-local report IDs */
export function getInteraction(reportId: string): InteractionRecord {
  const all = readAll();
  const rec = all[reportId];
  if (!rec) return defaultRecord();
  return {
    votes: {
      up: rec.votes?.up ?? 0,
      down: rec.votes?.down ?? 0,
      by_user: { ...(rec.votes?.by_user || {}) },
    },
    comments: Array.isArray(rec.comments) ? rec.comments : [],
  };
}

export function voteExternalReport(opts: {
  reportId: string;
  userId: string;
  value: 1 | -1;
}): { ok: true; votes: { up: number; down: number } } | { ok: false; error: string } {
  const { reportId, userId, value } = opts;
  if (!reportId || !userId) return { ok: false, error: "Missing reportId/userId" };

  const all = readAll();
  const rec = all[reportId] || defaultRecord();
  const votes = {
    up: rec.votes?.up ?? 0,
    down: rec.votes?.down ?? 0,
    by_user: { ...(rec.votes?.by_user || {}) },
  };
  const prev = votes.by_user[userId];
  if (prev === 1) votes.up = Math.max(0, votes.up - 1);
  if (prev === -1) votes.down = Math.max(0, votes.down - 1);
  votes.by_user[userId] = value;
  if (value === 1) votes.up += 1;
  if (value === -1) votes.down += 1;

  all[reportId] = {
    votes,
    comments: Array.isArray(rec.comments) ? rec.comments : [],
  };
  writeAll(all);
  return { ok: true, votes: { up: votes.up, down: votes.down } };
}

export function addCommentExternalReport(opts: {
  reportId: string;
  userId: string;
  text: string;
}): { ok: true; commentId: string; comment: StoredComment } | { ok: false; error: string } {
  const { reportId, userId, text } = opts;
  const t = String(text || "").trim();
  if (!reportId || !userId) return { ok: false, error: "Missing reportId/userId" };
  if (!t) return { ok: false, error: "Comment cannot be empty" };
  if (t.length > 500) return { ok: false, error: "Comment too long (max 500 chars)" };

  const all = readAll();
  const rec = all[reportId] || defaultRecord();
  const comments = Array.isArray(rec.comments) ? [...rec.comments] : [];
  const id = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const created_at = new Date().toISOString();
  const comment: StoredComment = { id, user_id: userId, text: t, created_at };
  comments.push(comment);
  all[reportId] = { ...rec, votes: rec.votes || defaultRecord().votes, comments };
  writeAll(all);
  return { ok: true, commentId: id, comment };
}

export function listCommentsExternal(reportId: string): StoredComment[] {
  return getInteraction(reportId).comments;
}
