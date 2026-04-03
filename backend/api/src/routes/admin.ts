/**
 * Admin Dashboard Routes
 *
 * Real data from ML service: incidents, heatmap with clusters,
 * verify/reject moderation, analytics.
 *
 * @author Women Safety Analytics Team
 * @version 2.0.0
 */

import express from "express";
import { Request, Response } from "express";
import {
  getIncidentsAll,
  verifyIncident,
  rejectIncident,
  getHeatmap,
  checkMLServiceHealth,
} from "../services/mlService";
import { dbReady } from "../db/pool";
import { insertAuditEvent, listAuditEvents } from "../db/auditDb";

const router = express.Router();

/**
 * GET /api/admin/dashboard
 * Dashboard overview (counts, recent incidents from ML)
 */
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const mlHealthy = await checkMLServiceHealth();
    const incidentsRes = await getIncidentsAll({ limit: 100, offset: 0 });
    const incidents = incidentsRes.incidents || [];
    const total = incidentsRes.total ?? incidents.length;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const incidentsToday = incidents.filter(
      (i: any) => new Date(i.timestamp) >= todayStart
    ).length;
    const panicCount = incidents.filter((i: any) => i.type === "panic_alert").length;
    const verifiedCount = incidents.filter((i: any) => i.verified).length;
    const unverifiedCount = total - verifiedCount;

    res.status(200).json({
      success: true,
      dashboard: {
        mlServiceHealthy: mlHealthy,
        overview: {
          totalIncidents: total,
          incidentsToday,
          panicAlerts: panicCount,
          verifiedIncidents: verifiedCount,
          pendingVerification: unverifiedCount,
        },
        recentIncidents: incidents.slice(0, 10).map((i: any) => ({
          id: i.id,
          type: i.type,
          location: { lat: i.latitude, lng: i.longitude },
          timestamp: i.timestamp,
          verified: i.verified,
          severity: i.severity,
          category: i.category,
          user_id: i.user_id,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({
      error: "Failed to get dashboard data",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/admin/incidents
 * List incidents with filters (from ML)
 */
router.get("/incidents", async (req: Request, res: Response) => {
  try {
    const { status, type, limit = 50, offset = 0 } = req.query;
    const verifiedFilter =
      status === "verified" ? true : status === "pending" ? false : undefined;
    const params: any = {
      limit: Math.min(parseInt((limit as string) || "50"), 200),
      offset: parseInt((offset as string) || "0"),
    };
    if (verifiedFilter !== undefined) params.verified = verifiedFilter;
    if (type === "panic_alert" || type === "community_report") params.type = type;

    const result = await getIncidentsAll(params);
    const incidents = result.incidents || [];
    const total = result.total ?? incidents.length;

    res.status(200).json({
      success: true,
      incidents: incidents.map((i: any) => ({
        id: i.id,
        type: i.type,
        status: i.verified ? "verified" : "pending",
        location: {
          lat: i.latitude,
          lng: i.longitude,
        },
        timestamp: i.timestamp,
        severity: i.severity,
        category: i.category,
        verified: i.verified,
        moderation_reason: i.moderation_reason,
        user_id: i.user_id,
      })),
      pagination: {
        total,
        limit: params.limit,
        offset: params.offset,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Incidents error:", error);
    res.status(500).json({
      error: "Failed to get incidents",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/admin/incidents/:incidentId/verify
 * Verify incident (proxy to ML)
 */
router.post(
  "/incidents/:incidentId/verify",
  async (req: Request, res: Response) => {
    try {
      const incidentId = String(req.params.incidentId);
      const reason = req.body?.reason;
      const result = await verifyIncident(incidentId, reason);
      if (result.success) {
        if (await dbReady()) {
          await insertAuditEvent({
            actorId: String((req as any).admin?.sub || "admin"),
            actorRole: "admin",
            action: "incident_verify",
            entityType: "incident",
            entityId: incidentId,
            reason: reason ? String(reason) : null,
          });
        }
        return res.status(200).json({
          success: true,
          message: "Incident verified",
          incidentId,
          timestamp: new Date().toISOString(),
        });
      }
      if ((result as any).status === 404) {
        return res.status(404).json({ error: "Incident not found" });
      }
      return res.status(502).json({
        error: (result as any).error || "Failed to verify incident",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      if (err.response?.status === 404) {
        return res.status(404).json({ error: "Incident not found" });
      }
      console.error("Verify incident error:", err);
      res.status(500).json({
        error: "Failed to verify incident",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/admin/incidents/:incidentId/reject
 * Reject incident (proxy to ML)
 */
router.post(
  "/incidents/:incidentId/reject",
  async (req: Request, res: Response) => {
    try {
      const incidentId = String(req.params.incidentId);
      const reason = req.body?.reason;
      const result = await rejectIncident(incidentId, reason);
      if (result.success) {
        if (await dbReady()) {
          await insertAuditEvent({
            actorId: String((req as any).admin?.sub || "admin"),
            actorRole: "admin",
            action: "incident_reject",
            entityType: "incident",
            entityId: incidentId,
            reason: reason ? String(reason) : null,
          });
        }
        return res.status(200).json({
          success: true,
          message: "Incident rejected",
          incidentId,
          timestamp: new Date().toISOString(),
        });
      }
      if ((result as any).status === 404) {
        return res.status(404).json({ error: "Incident not found" });
      }
      return res.status(502).json({
        error: (result as any).error || "Failed to reject incident",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      if (err.response?.status === 404) {
        return res.status(404).json({ error: "Incident not found" });
      }
      console.error("Reject incident error:", err);
      res.status(500).json({
        error: "Failed to reject incident",
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/admin/heatmap
 * Admin heatmap with clusters (include_clusters=true)
 */
router.get("/heatmap", async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius = 3000, grid_size = 100, local_hour } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({
        error: "Missing required parameters: lat, lng",
        timestamp: new Date().toISOString(),
      });
    }
    const latNum = parseFloat(lat as string);
    const lngNum = parseFloat(lng as string);
    const radiusNum = parseInt(radius as string) || 3000;
    const gridSizeNum = parseInt(grid_size as string) || 100;
    const localHourNum =
      local_hour !== undefined ? parseInt(local_hour as string) : new Date().getHours();

    const mlResponse = await getHeatmap(
      latNum,
      lngNum,
      radiusNum,
      gridSizeNum,
      new Date().toISOString(),
      localHourNum,
      undefined,
      true // include_clusters for admin
    );

    if (!mlResponse || !mlResponse.success) {
      return res.status(200).json({
        success: true,
        heatmap: {
          center: { lat: latNum, lng: lngNum },
          radius: radiusNum,
          grid_size: gridSizeNum,
          cells: mlResponse?.heatmap?.cells || [],
          clusters: mlResponse?.heatmap?.clusters || [],
        },
        timestamp: new Date().toISOString(),
        warning: mlResponse?.error || "ML service unavailable",
      });
    }

    res.status(200).json({
      success: true,
      heatmap: mlResponse.heatmap,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin heatmap error:", error);
    res.status(500).json({
      error: "Failed to get admin heatmap",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/admin/analytics
 * Analytics (trends from incidents)
 */
router.get("/analytics", async (req: Request, res: Response) => {
  try {
    const { period = "7d" } = req.query;
    const days = period === "30d" ? 30 : 7;
    // ML service max limit is 1000 (per route validation)
    const result = await getIncidentsAll({ limit: 1000, offset: 0 });
    
    if (!result.success) {
      console.error("[Analytics] Failed to fetch incidents:", result.error);
      return res.status(502).json({
        error: "Failed to fetch incidents from ML service",
        timestamp: new Date().toISOString(),
      });
    }
    
    const incidents = result.incidents || [];
    const total = result.total ?? incidents.length;

    console.log(`[Analytics] Fetched ${incidents.length} incidents (total: ${total}, showing up to 1000)`);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0); // Start of day
    const inRange = incidents.filter((i: any) => {
      const incidentDate = new Date(i.timestamp);
      return incidentDate >= cutoff;
    });

    console.log(`[Analytics] Incidents in range (last ${days} days): ${inRange.length}`);

    const byDay: Record<string, number> = {};
    for (let d = 0; d < days; d++) {
      const dte = new Date(cutoff);
      dte.setDate(dte.getDate() + d);
      const key = dte.toISOString().slice(0, 10);
      byDay[key] = 0;
    }
    inRange.forEach((i: any) => {
      const key = new Date(i.timestamp).toISOString().slice(0, 10);
      if (byDay[key] !== undefined) byDay[key]++;
    });

    const byType: { panic_alert: number; community_report: number } = { panic_alert: 0, community_report: 0 };
    inRange.forEach((i: any) => {
      if (i.type === "panic_alert" || i.type === "community_report") {
        byType[i.type as keyof typeof byType]++;
      }
    });

    const bySeverity: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    inRange.forEach((i: any) => {
      const s = Number(i.severity);
      if (s >= 1 && s <= 5) bySeverity[s] = (bySeverity[s] || 0) + 1;
    });

    // By category
    const byCategory: Record<string, number> = {};
    inRange.forEach((i: any) => {
      const cat = i.category || "uncategorized";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // By hour of day (local time)
    const byHour: Record<number, number> = {};
    for (let h = 0; h < 24; h++) byHour[h] = 0;
    inRange.forEach((i: any) => {
      const hour = i.incident_local_hour;
      if (hour !== null && hour !== undefined && hour >= 0 && hour <= 23) {
        byHour[hour] = (byHour[hour] || 0) + 1;
      }
    });

    // Verification stats
    const verified = inRange.filter((i: any) => i.verified).length;
    const unverified = inRange.length - verified;
    const verificationRate = inRange.length > 0 ? (verified / inRange.length) * 100 : 0;

    res.status(200).json({
      success: true,
      analytics: {
        period: `${days}d`,
        metrics: {
          totalIncidents: total,
          incidentsInPeriod: inRange.length,
          panicAlerts: byType.panic_alert,
          communityReports: byType.community_report,
          verified,
          unverified,
          verificationRate: Math.round(verificationRate * 10) / 10,
        },
        trends: {
          incidentsByDay: Object.entries(byDay)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, count]) => ({ date, count })),
          bySeverity: Object.entries(bySeverity)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([sev, count]) => ({
              severity: parseInt(sev),
              count,
            })),
          byCategory: Object.entries(byCategory)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([category, count]) => ({ category, count })),
          byHour: Object.entries(byHour)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([hour, count]) => ({
              hour: parseInt(hour),
              count,
            })),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({
      error: "Failed to get analytics",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/admin/audit
 * Audit log (stub: last 50 moderation-style events from recent incidents)
 */
router.get("/audit", async (req: Request, res: Response) => {
  try {
    if (await dbReady()) {
      const rows = await listAuditEvents(200);
      if (rows.length > 0) {
        return res.status(200).json({
          success: true,
          audit: rows.map((r) => ({
            entityId: r.entityId,
            action: r.action,
            reason: r.reason,
            timestamp: r.timestamp,
            actorId: r.actorId,
            actorRole: r.actorRole,
            entityType: r.entityType,
          })),
          source: "database",
          timestamp: new Date().toISOString(),
        });
      }
    }

    const result = await getIncidentsAll({ limit: 100, offset: 0 });
    const incidents = result.incidents || [];
    const audit = incidents
      .filter((i: any) => i.moderation_reason != null || i.verified === true)
      .slice(0, 50)
      .map((i: any) => ({
        entityId: i.id,
        action: i.verified ? "verified" : "rejected",
        reason: i.moderation_reason,
        timestamp: i.timestamp,
      }));

    res.status(200).json({
      success: true,
      audit,
      source: "incidents_fallback",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Audit error:", error);
    res.status(500).json({
      error: "Failed to get audit log",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
