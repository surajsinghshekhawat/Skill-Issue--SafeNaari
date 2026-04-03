import { Alert, Vibration } from "react-native";
import * as Location from "expo-location";
import { getStoredUserId, updateLocation, type RiskAlert } from "./api";
import { initWebSocket } from "./websocket";

let _enabled = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _inHighRisk = false;
let _lastAlertAtMs = 0;

function getNotifications(): any | null {
  try {
    // Use require() so the app can run even if the native module isn't in this runtime.
    return require("expo-notifications");
  } catch {
    return null;
  }
}

// User request: alert at >= 3.5
const ENTER_THRESHOLD = 3.5;
const EXIT_THRESHOLD = 3.2;
const COOLDOWN_MS = 5 * 60 * 1000;

export type SafetyAlertEvent =
  | {
      type: "risk:update";
      riskScore: number;
      riskLevel?: string | null;
      location?: { lat: number; lng: number } | null;
      at: string;
    }
  | {
      type: "risk:alert";
      alert: RiskAlert;
      at: string;
    };

const _subscribers = new Set<(e: SafetyAlertEvent) => void>();

export function subscribeToSafetyAlerts(cb: (e: SafetyAlertEvent) => void) {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

function emitEvent(e: SafetyAlertEvent) {
  for (const cb of _subscribers) {
    try {
      cb(e);
    } catch {
      // ignore
    }
  }
}

type StartOpts = {
  userId?: string;
  intervalMs?: number;
};

function shouldAlertFromRisk(riskScore: number): boolean {
  const nextInHighRisk = _inHighRisk
    ? riskScore >= EXIT_THRESHOLD
    : riskScore >= ENTER_THRESHOLD;
  const entering = !_inHighRisk && nextInHighRisk;
  _inHighRisk = nextInHighRisk;

  if (!entering) return false;
  const nowMs = Date.now();
  if (nowMs - _lastAlertAtMs < COOLDOWN_MS) return false;
  _lastAlertAtMs = nowMs;
  return true;
}

function showRiskAlert(alert: RiskAlert) {
  // Immediate attention even if app is backgrounded or user is in Maps.
  try {
    Vibration.vibrate([0, 500, 200, 500]);
  } catch {}
  try {
    const Notifications = getNotifications();
    if (Notifications?.scheduleNotificationAsync) {
      Notifications.scheduleNotificationAsync({
        content: {
          title: "High Risk Zone",
          body: alert.message || "High-risk zone detected.",
          sound: true,
          priority: Notifications.AndroidNotificationPriority?.MAX,
        },
        trigger: null,
      });
    }
  } catch {}

  // In-app fallback
  Alert.alert("High Risk Zone", alert.message || "High-risk zone detected.", [{ text: "OK" }]);
}

function handleTriggeredAlert(alert: RiskAlert) {
  const nowMs = Date.now();
  if (nowMs - _lastAlertAtMs < COOLDOWN_MS) return;
  _lastAlertAtMs = nowMs;
  _inHighRisk = true;
  emitEvent({ type: "risk:alert", alert, at: new Date().toISOString() });
  showRiskAlert(alert);
}

async function tick(userId: string) {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const res = await updateLocation(
      userId,
      loc.coords.latitude,
      loc.coords.longitude,
      loc.coords.accuracy ?? undefined
    );

    const riskScore = res.riskAssessment?.riskScore;
    if (typeof riskScore === "number") {
      emitEvent({
        type: "risk:update",
        riskScore,
        riskLevel: res.riskAssessment?.riskLevel || null,
        location: { lat: loc.coords.latitude, lng: loc.coords.longitude },
        at: new Date().toISOString(),
      });
    }

    // Preferred: server-side alert (entry detection + cooldown)
    if (res.riskAlert?.triggered) {
      handleTriggeredAlert(res.riskAlert);
      return;
    }

    // Fallback: client-side detection based on riskAssessment
    if (typeof riskScore === "number" && shouldAlertFromRisk(riskScore)) {
      handleTriggeredAlert({
        triggered: true,
        riskScore,
        riskLevel: res.riskAssessment?.riskLevel || "high",
        message:
          "High-risk zone detected. Consider changing route or moving to a crowded, well-lit area.",
        location: { lat: loc.coords.latitude, lng: loc.coords.longitude },
        cooldown_seconds: Math.round(COOLDOWN_MS / 1000),
      });
    }
  } catch {
    // keep silent; alerts are best-effort
  }
}

export async function startSafetyAlerts(opts: StartOpts) {
  if (_enabled) return;
  _enabled = true;

  const intervalMs = Math.max(5_000, opts.intervalMs ?? 15_000);
  const userId = opts.userId || (await getStoredUserId()) || "user_anon";

  // Notifications permission (best effort; Expo Go supported)
  try {
    const Notifications = getNotifications();
    if (Notifications?.getPermissionsAsync && Notifications?.requestPermissionsAsync) {
      const perms = await Notifications.getPermissionsAsync();
      if (perms?.status && perms.status !== "granted") {
        await Notifications.requestPermissionsAsync();
      }
    }
  } catch {
    // ignore
  }

  // WebSocket is optional, but identifying enables user-targeted risk alerts.
  try {
    const socket = initWebSocket();
    // Listen for server-triggered user alerts
    socket?.on?.("risk:alert", (data: any) => {
      const riskScore = Number(data?.riskScore);
      if (!Number.isFinite(riskScore)) return;
      handleTriggeredAlert({
        triggered: true,
        riskScore,
        riskLevel: String(data?.riskLevel || "high"),
        message: String(data?.message || "High-risk zone detected."),
        location: {
          lat: Number(data?.location?.lat),
          lng: Number(data?.location?.lng),
        },
        cooldown_seconds: Math.round(COOLDOWN_MS / 1000),
      });
    });
    if (socket && socket.connected) {
      socket.emit("identify:user", { userId });
    } else {
      socket?.on?.("connect", () => {
        try {
          socket.emit("identify:user", { userId });
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    _enabled = false;
    throw new Error("Location permission denied");
  }

  // Immediate tick, then interval.
  await tick(userId);
  _timer = setInterval(() => {
    if (!_enabled) return;
    tick(userId);
  }, intervalMs);
}

export function stopSafetyAlerts() {
  _enabled = false;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _inHighRisk = false;
}

export function isSafetyAlertsEnabled() {
  return _enabled;
}

