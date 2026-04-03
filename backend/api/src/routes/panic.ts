/**
 * Panic Alert Routes
 *
 * Handles emergency panic button triggers, location sharing,
 * and emergency contact notifications
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import express from "express";
import { Request, Response } from "express";
import { processIncident } from "../services/mlService";
import { sendSms } from "../services/notificationService";
import { mobileAuthRequired, requireUserAuth } from "../middleware/userAuth";
import { dbReady } from "../db/pool";
import {
  cancelPanicRecord,
  createPanicRecord,
  getActivePanicForUser,
} from "../db/panicDb";
import rateLimit from "express-rate-limit";

const panicTriggerLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many panic requests, try again shortly." },
});

const router = express.Router();

/**
 * POST /api/panic/trigger
 * Trigger emergency panic alert
 */
router.post(
  "/trigger",
  panicTriggerLimiter,
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
  try {
    const { userId, location, emergencyContacts, panicType, timezone_offset_minutes } =
      req.body;

    const authedUserId = (req as any).user?.sub;
    const effectiveUserId = mobileAuthRequired() ? authedUserId : userId;

    // Validate required fields
    if (!effectiveUserId || !location || !emergencyContacts) {
      return res.status(400).json({
        error: "Missing required fields: userId (or auth), location, emergencyContacts",
      });
    }

    console.log("🚨 PANIC ALERT RECEIVED:", {
      userId: effectiveUserId,
      location,
      panicType: panicType || "manual",
      timestamp: new Date().toISOString(),
    });

    const panicId = `panic_${Date.now()}_${effectiveUserId}`;
    const incidentTimestamp = new Date().toISOString();

    // Send SMS notifications to emergency contacts (best-effort)
    const lat = location.latitude || location.lat;
    const lng = location.longitude || location.lng;
    const mapsUrl =
      lat != null && lng != null
        ? `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
        : null;

    const smsBody =
      `SafeNaari SOS: ${String(effectiveUserId)} triggered an emergency alert.` +
      (mapsUrl ? ` Location: ${mapsUrl}` : "");

    const contacts: string[] = Array.isArray(emergencyContacts)
      ? emergencyContacts.map((x: any) => String(x))
      : [];

    const smsResults = await Promise.all(
      contacts.map((to) => sendSms(to, smsBody))
    );

    const smsSent = smsResults.filter((r) => r.status === "sent").length;
    const smsSkipped = smsResults.filter((r) => r.status === "skipped").length;
    const smsFailed = smsResults.filter((r) => r.status === "failed").length;

    if (smsFailed > 0) {
      console.warn("📨 [SMS] Some messages failed", {
        failed: smsResults
          .filter((r) => r.status === "failed")
          .map((r) => ({ to: r.to, errorCode: (r as any).errorCode, error: r.error })),
      });
    }

    if (await dbReady()) {
      await createPanicRecord({
        id: panicId,
        userId: effectiveUserId,
        latitude: lat != null ? Number(lat) : null,
        longitude: lng != null ? Number(lng) : null,
        meta: {
          contactsRequested: contacts.length,
          smsSent,
          smsFailed,
        },
      });
    }

    // Process incident through ML service
    let mlResponse = null;
    try {
      const incidentData: any = {
        id: panicId,
        latitude: lat,
        longitude: lng,
        timestamp: incidentTimestamp,
        type: "panic_alert",
        severity: 5, // Panic alerts are always high severity
        category: "emergency",
        verified: true,
        user_id: effectiveUserId,
      };

      // With exactOptionalPropertyTypes, omit optional fields instead of setting `undefined`.
      if (timezone_offset_minutes !== undefined) {
        incidentData.timezone_offset_minutes = Number(timezone_offset_minutes);
      }

      mlResponse = await processIncident(incidentData);
    } catch (error) {
      console.error("ML Service incident processing failed:", error);
      // Continue even if ML service fails
    }

    return res.status(200).json({
      success: true,
      panicId,
      message: "Emergency alert triggered successfully",
      timestamp: incidentTimestamp,
      actions: {
        contactsRequested: contacts.length,
        contactsSmsSent: smsSent,
        contactsSmsSkipped: smsSkipped,
        contactsSmsFailed: smsFailed,
        authoritiesAlerted: false,
        locationTrackingStarted: true,
      },
      notifications: {
        provider: process.env.TWILIO_ACCOUNT_SID ? "twilio" : "unconfigured",
        sms: smsResults,
      },
      mlProcessing: mlResponse
        ? {
            affectedZones: mlResponse.affected_zones || [],
            modelUpdated: mlResponse.model_updated || false,
          }
        : null,
    });
  } catch (error) {
    console.error("Panic trigger error:", error);
    return res.status(500).json({
      error: "Failed to process panic alert",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/panic/cancel
 * Cancel active panic alert
 */
router.post(
  "/cancel",
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
    try {
      const panicId = String(req.body?.panicId || "");
      const authedUserId = (req as any).user?.sub;
      const effectiveUserId = mobileAuthRequired()
        ? authedUserId
        : String(req.body?.userId || "");

      if (!panicId || !effectiveUserId) {
        return res.status(400).json({
          error: "Missing required fields: panicId (and userId when auth is off)",
        });
      }

      let cancelled = true;
      if (await dbReady()) {
        cancelled = await cancelPanicRecord(panicId, effectiveUserId);
      }

      console.log("✅ PANIC CANCEL REQUEST:", {
        userId: effectiveUserId,
        panicId,
        cancelled,
        timestamp: new Date().toISOString(),
      });

    return res.status(200).json({
      success: true,
      cancelled,
      message: cancelled
        ? "Panic alert cancelled successfully"
        : "No active panic matched (may already be cleared)",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Panic cancellation error:", error);
    return res.status(500).json({
      error: "Failed to cancel panic alert",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/panic/status/:userId
 * Get current panic status for user
 */
router.get("/status/:userId", async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || "");

    let active: Awaited<ReturnType<typeof getActivePanicForUser>> = null;
    if (await dbReady()) {
      active = await getActivePanicForUser(userId);
    }

    res.status(200).json({
      hasActivePanic: !!active,
      panicId: active?.panicId ?? null,
      lastPanicTime: active?.startedAt ?? null,
      location:
        active?.latitude != null && active?.longitude != null
          ? { lat: active.latitude, lng: active.longitude }
          : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Panic status error:", error);
    res.status(500).json({
      error: "Failed to get panic status",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;




