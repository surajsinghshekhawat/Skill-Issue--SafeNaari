import { API_BASE_URL } from "../services/api";

/** Resolve relative `/uploads/...` paths to a full http(s) URL for Image / fetch. */
export function resolveMediaUrl(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null;
  const s = String(mediaUrl).trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${API_BASE_URL.replace(/\/$/, "")}${path}`;
}
