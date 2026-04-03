import fs from "fs";
import path from "path";
import type { StoredComment } from "./reportInteractions";

export type StoredReport = {
  id: string;
  type: "community_report" | "panic_alert";
  category: string;
  description: string;
  severity: number;
  location: { latitude: number; longitude: number };
  timestamp: string;
  verified: boolean;
  user_id: string;
  media_url?: string | null;
  votes?: {
    up: number;
    down: number;
    by_user: Record<string, 1 | -1>;
  };
  comments?: Array<{
    id: string;
    user_id: string;
    text: string;
    created_at: string;
  }>;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const REPORTS_PATH = path.resolve(DATA_DIR, "reports.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): StoredReport[] {
  try {
    if (!fs.existsSync(REPORTS_PATH)) return [];
    const raw = fs.readFileSync(REPORTS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredReport[]) : [];
  } catch {
    return [];
  }
}

function writeAll(reports: StoredReport[]) {
  ensureDir();
  fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2), "utf-8");
}

export function addReport(report: StoredReport) {
  const existing = readAll();
  const normalized: StoredReport = {
    ...report,
    votes: report.votes ?? { up: 0, down: 0, by_user: {} },
    comments: report.comments ?? [],
  };
  existing.unshift(normalized);
  writeAll(existing.slice(0, 2000));
}

export function getReports(): StoredReport[] {
  // Ensure older records (pre-votes/comments) still return consistent shape
  return readAll().map((r) => ({
    ...r,
    votes: r.votes ?? { up: 0, down: 0, by_user: {} },
    comments: r.comments ?? [],
  }));
}

export function findReportById(reportId: string): StoredReport | null {
  const all = getReports();
  return all.find((r) => r.id === reportId) || null;
}

export function voteOnReport(opts: {
  reportId: string;
  userId: string;
  value: 1 | -1;
}): { ok: true; report: StoredReport } | { ok: false; error: string } {
  const { reportId, userId, value } = opts;
  if (!reportId || !userId) return { ok: false, error: "Missing reportId/userId" };

  const all = getReports();
  const idx = all.findIndex((r) => r.id === reportId);
  if (idx < 0) return { ok: false, error: "Report not found" };

  const report = all[idx];
  if (!report) return { ok: false, error: "Report not found" };
  const votes = report.votes ?? { up: 0, down: 0, by_user: {} };
  const prev = votes.by_user[userId];

  // Remove previous vote
  if (prev === 1) votes.up = Math.max(0, votes.up - 1);
  if (prev === -1) votes.down = Math.max(0, votes.down - 1);

  // Apply new vote
  votes.by_user[userId] = value;
  if (value === 1) votes.up += 1;
  if (value === -1) votes.down += 1;

  const updated: StoredReport = {
    ...report,
    votes,
    comments: report.comments ?? [],
  };

  all[idx] = updated;
  writeAll(all);
  return { ok: true, report: updated };
}

export function addCommentToReport(opts: {
  reportId: string;
  userId: string;
  text: string;
}):
  | { ok: true; commentId: string; comment: StoredComment }
  | { ok: false; error: string } {
  const { reportId, userId, text } = opts;
  const t = String(text || "").trim();
  if (!reportId || !userId) return { ok: false, error: "Missing reportId/userId" };
  if (!t) return { ok: false, error: "Comment cannot be empty" };
  if (t.length > 500) return { ok: false, error: "Comment too long (max 500 chars)" };

  const all = getReports();
  const idx = all.findIndex((r) => r.id === reportId);
  if (idx < 0) return { ok: false, error: "Report not found" };

  const report = all[idx];
  if (!report) return { ok: false, error: "Report not found" };
  const comments = report.comments ?? [];
  const id = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const created_at = new Date().toISOString();
  const comment = { id, user_id: userId, text: t, created_at };
  comments.push(comment);

  const updated: StoredReport = {
    ...report,
    votes: report.votes ?? { up: 0, down: 0, by_user: {} },
    comments,
  };
  all[idx] = updated;
  writeAll(all);

  return { ok: true, commentId: id, comment };
}

