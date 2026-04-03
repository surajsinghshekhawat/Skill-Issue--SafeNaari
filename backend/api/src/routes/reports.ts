/**
 * Reports Routes
 *
 * Handles community incident reporting
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import express from "express";
import { Request, Response } from "express";
import { processIncident } from "../services/mlService";
import { emitNewIncident } from "../websocket/socketHandler";
import { mobileAuthRequired, requireUserAuth } from "../middleware/userAuth";
import {
  addCommentToReport,
  addReport,
  findReportById,
  getReports,
  voteOnReport,
} from "../services/reportStore";
import {
  addCommentExternalReport,
  getInteraction,
  listCommentsExternal,
  voteExternalReport,
  type StoredComment,
} from "../services/reportInteractions";
import { dbReady } from "../db/pool";
import {
  insertUserSubmittedReport,
  listUserSubmittedReportsDb,
} from "../db/userSubmittedReportsDb";
import rateLimit from "express-rate-limit";

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many report submissions. Try again in a minute." },
});
const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const commentPostLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/reports/submit
 * Submit a community incident report
 */
router.post(
  "/submit",
  submitLimiter,
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
  try {
    const {
      userId,
      type,
      category,
      description,
      severity,
      location,
      media_url,
      timestamp,
      timezone_offset_minutes,
    } = req.body;

    const authedUserId = (req as any).user?.sub;
    const effectiveUserId = mobileAuthRequired() ? authedUserId : userId;

    // Validate required fields
    if (!effectiveUserId || !type || !category || !description || !location) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["userId (or auth)", "type", "category", "description", "location"],
      });
    }

    // Validate location
    if (!location.latitude || !location.longitude) {
      return res.status(400).json({
        error: "Invalid location data",
      });
    }

    // Validate severity (1-5)
    if (severity && (severity < 1 || severity > 5)) {
      return res.status(400).json({
        error: "Severity must be between 1 and 5",
      });
    }

    console.log("📝 Community report received:", {
      userId: effectiveUserId,
      type,
      category,
      severity: severity || 3,
      location,
    });

    // Process incident through ML service
    try {
      // Validate type is one of the allowed values
      const incidentType: "panic_alert" | "community_report" = 
        type === "panic_alert" || type === "community_report" 
          ? type 
          : "community_report";

      const incidentData = {
        id: `report_${Date.now()}_${effectiveUserId}`,
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: timestamp || new Date().toISOString(),
        type: incidentType,
        severity: severity || 3,
        category: category,
        verified: false,
        user_id: effectiveUserId,
      };

      // Always store locally so Community tab works even if DB/ML is down.
      addReport({
        id: incidentData.id,
        type: incidentType,
        category: String(category || "General"),
        description: String(description || ""),
        severity: Number(severity || 3),
        location: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        timestamp: String(incidentData.timestamp),
        verified: false,
        user_id: String(effectiveUserId),
        media_url: media_url ? String(media_url) : null,
      });

      if (await dbReady()) {
        await insertUserSubmittedReport({
          id: incidentData.id,
          userId: String(effectiveUserId),
          type: incidentType,
          category: String(category || "General"),
          description: String(description || ""),
          severity: Number(severity || 3),
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          mediaUrl: media_url ? String(media_url) : null,
          createdAtIso: String(incidentData.timestamp),
        });
      }

      // With exactOptionalPropertyTypes, omit optional fields instead of setting `undefined`.
      if (timezone_offset_minutes !== undefined) {
        (incidentData as any).timezone_offset_minutes = Number(
          timezone_offset_minutes
        );
      }

      const mlResponse = await processIncident(incidentData);

      // Emit WebSocket event for real-time updates
      const io = req.app.locals?.io;
      if (io) {
        console.log('📡 Emitting WebSocket event for new incident:', incidentData.id);
        emitNewIncident(io, {
          incidentId: incidentData.id,
          latitude: location.latitude,
          longitude: location.longitude,
          type: incidentType,
          severity: severity || 3,
          timestamp: incidentData.timestamp,
          location: {
            lat: location.latitude,
            lng: location.longitude,
          },
        });
      } else {
        console.warn('⚠️ WebSocket io not available in app.locals');
      }

      return res.status(200).json({
        success: true,
        message: "Report submitted successfully",
        reportId: incidentData.id,
        timestamp: new Date().toISOString(),
        mlProcessed: mlResponse.success || false,
      });
    } catch (mlError) {
      console.error("ML service error:", mlError);
      // Still return success if ML service fails (report is logged)
      return res.status(200).json({
        success: true,
        message: "Report submitted (ML processing pending)",
        timestamp: new Date().toISOString(),
        warning: "ML service temporarily unavailable",
      });
    }
  } catch (error) {
    console.error("Report submission error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to submit report",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/reports/user/:userId
 * Reports for a user: Postgres `user_submitted_reports` + local `reports.json` (deduped).
 */
router.get(
  "/user/:userId",
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || "");
      if (mobileAuthRequired()) {
        const sub = String((req as any).user?.sub || "");
        if (!sub || sub !== userId) {
          return res.status(403).json({
            success: false,
            error: "Forbidden",
            timestamp: new Date().toISOString(),
          });
        }
      }

      const fromDb = (await dbReady()) ? await listUserSubmittedReportsDb(userId) : [];
      const fromFile = getReports()
        .filter((r) => r.user_id === userId)
        .map((r) => ({
          id: r.id,
          type: r.type,
          category: r.category,
          description: r.description,
          severity: r.severity,
          location: r.location,
          timestamp: r.timestamp,
          verified: r.verified,
          media_url: r.media_url ?? null,
        }));

      const seen = new Set<string>();
      const merged: typeof fromFile = [];
      for (const r of fromDb) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const t =
          r.type === "panic_alert" || r.type === "community_report"
            ? r.type
            : "community_report";
        merged.push({
          id: r.id,
          type: t,
          category: r.category,
          description: r.description,
          severity: r.severity,
          location: r.location,
          timestamp: r.timestamp,
          verified: r.verified,
          media_url: r.media_url,
        });
      }
      for (const r of fromFile) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
      }

      merged.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return res.status(200).json({
        success: true,
        reports: merged,
        count: merged.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Get reports error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get reports",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/reports/all
 * Get all community reports (for viewing)
 */
function normalizeServiceUrl(raw: string | undefined): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  // Guard against accidental "ML_SERVICE_URL=http://..." being pasted as the value.
  const idx = v.indexOf("http");
  return idx >= 0 ? v.slice(idx) : v;
}

function mergeCommentsForReport(reportId: string): StoredComment[] {
  const local = findReportById(reportId);
  const localList = local?.comments ?? [];
  const external = listCommentsExternal(reportId);
  const byId = new Map<string, StoredComment>();
  for (const c of localList) byId.set(c.id, c);
  for (const c of external) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

router.get("/all", async (req: Request, res: Response) => {
  try {
    // Query ML service to get all incidents
    const mlServiceUrl =
      normalizeServiceUrl(process.env.ML_SERVICE_URL) || "http://192.168.1.7:8000";

    let allIncidents: any[] = [];

    // Keep Community tab fast: if ML service is slow/down, fall back to local reports quickly.
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 2500);
      const mlResponse = await fetch(`${mlServiceUrl}/ml/incidents/all`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: ac.signal,
      }).finally(() => clearTimeout(timeout));

      if (mlResponse.ok) {
        const data = (await mlResponse.json()) as {
          incidents?: any[];
          success?: boolean;
          count?: number;
        };
        allIncidents = data.incidents || [];
      } else {
        const errorText = await mlResponse.text().catch(() => "Unknown error");
        console.warn(`❌ ML service unavailable (${mlResponse.status}):`, errorText);
      }
    } catch (e: any) {
      const msg = String(e?.name || e?.message || e);
      console.warn(`❌ ML incidents fetch failed (${msg}); using local reports only`);
    }
    
    const localReports = getReports();

    // Filter to only community reports (merge ML + local; de-dupe by id)
    const merged = [
      ...allIncidents.map((i) => ({
        id: i.id,
        type: i.type,
        category: i.category || "General",
        description: i.description || (i.category ? `${i.category} incident reported` : ""),
        severity: i.severity || 3,
        location: { latitude: parseFloat(i.latitude) || 0, longitude: parseFloat(i.longitude) || 0 },
        timestamp: i.timestamp,
        verified: i.verified || false,
        media_url: i.media_url || null,
      })),
      ...localReports.map((r) => ({
        id: r.id,
        type: r.type,
        category: r.category,
        description: r.description,
        severity: r.severity,
        location: r.location,
        timestamp: r.timestamp,
        verified: r.verified,
        media_url: (r as any).media_url || null,
        votes: (r as any).votes || { up: 0, down: 0 },
        comment_count: Array.isArray((r as any).comments) ? (r as any).comments.length : 0,
      })),
    ];

    const seen = new Set<string>();
    const deduped = merged.filter((r) => {
      if (!r?.id) return false;
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    const enrichRow = (row: any) => {
      const id = String(row.id);
      const local = findReportById(id);
      const mergedComments = mergeCommentsForReport(id);
      if (local) {
        return {
          ...row,
          votes: {
            up: local.votes?.up ?? 0,
            down: local.votes?.down ?? 0,
          },
          comment_count: mergedComments.length,
          media_url: row.media_url ?? local.media_url ?? null,
        };
      }
      const ext = getInteraction(id);
      return {
        ...row,
        votes: { up: ext.votes.up, down: ext.votes.down },
        comment_count: mergedComments.length,
      };
    };

    const communityReports = deduped
      .filter((incident: any) => incident.type === "community_report")
      .map(enrichRow)
      .sort(
        (a: any, b: any) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    
    // Single summary log instead of per-item logs
    const panicAlerts = deduped.filter((inc: any) => inc.type === "panic_alert").length;
    console.log(
      `✅ Processed ${deduped.length} total incidents (ML:${allIncidents.length} + local:${localReports.length}): ${communityReports.length} community reports, ${panicAlerts} panic alerts`
    );

    return res.status(200).json({
      success: true,
      reports: communityReports,
      count: communityReports.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Get all reports error:", error);
    // Return empty array if error (don't fail completely)
    return res.status(200).json({
      success: true,
      reports: [],
      count: 0,
      timestamp: new Date().toISOString(),
      error: "Failed to load reports from database",
    });
  }
});

/**
 * POST /api/reports/:id/vote
 * body: { value: 1 | -1 }
 */
router.post(
  "/:id/vote",
  voteLimiter,
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
    try {
      const reportId = String(req.params.id || "");
      const valueRaw = req.body?.value;
      const value: 1 | -1 = valueRaw === -1 || valueRaw === "-1" ? -1 : 1;
      const authedUserId = (req as any).user?.sub;
      const userId = mobileAuthRequired() ? authedUserId : String(req.body?.userId || "");
      if (!userId) return res.status(400).json({ success: false, error: "Missing userId" });

      const local = findReportById(reportId);
      if (local) {
        const result = voteOnReport({ reportId, userId, value });
        if (!result.ok)
          return res.status(404).json({ success: false, error: result.error });
        return res.status(200).json({
          success: true,
          reportId,
          votes: {
            up: result.report.votes?.up ?? 0,
            down: result.report.votes?.down ?? 0,
          },
        });
      }
      const ext = voteExternalReport({ reportId, userId, value });
      if (!ext.ok) return res.status(400).json({ success: false, error: ext.error });
      return res.status(200).json({
        success: true,
        reportId,
        votes: ext.votes,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e?.message || "Vote failed" });
    }
  }
);

/**
 * GET /api/reports/:id/comments
 */
router.get("/:id/comments", async (req: Request, res: Response) => {
  try {
    const reportId = String(req.params.id || "");
    return res.status(200).json({
      success: true,
      comments: mergeCommentsForReport(reportId),
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || "Failed to load comments" });
  }
});

/**
 * POST /api/reports/:id/comments
 * body: { text: string }
 */
router.post(
  "/:id/comments",
  commentPostLimiter,
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
    try {
      const reportId = String(req.params.id || "");
      const text = String(req.body?.text || "");
      const authedUserId = (req as any).user?.sub;
      const userId = mobileAuthRequired() ? authedUserId : String(req.body?.userId || "");
      if (!userId) return res.status(400).json({ success: false, error: "Missing userId" });

      if (findReportById(reportId)) {
        const result = addCommentToReport({ reportId, userId, text });
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        return res.status(200).json({
          success: true,
          reportId,
          commentId: result.commentId,
          comment: result.comment,
        });
      }
      const ext = addCommentExternalReport({ reportId, userId, text });
      if (!ext.ok) return res.status(400).json({ success: false, error: ext.error });
      return res.status(200).json({
        success: true,
        reportId,
        commentId: ext.commentId,
        comment: ext.comment,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e?.message || "Comment failed" });
    }
  }
);

export default router;


