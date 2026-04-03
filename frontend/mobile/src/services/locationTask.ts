/**
 * Background location updates for safety.
 * Native `expo-task-manager` is not included in Expo Go — use a dev client
 * (`expo run:android` / `expo run:ios` or EAS). Foreground safety alerts still work in Go.
 */
import Constants from "expo-constants";
import * as Location from "expo-location";
import { getStoredUserId, updateLocation } from "./api";

export const SAFENAARI_BG_LOCATION_TASK = "safenaari-bg-location";

type TaskManagerModule = typeof import("expo-task-manager");

let tmResolved: TaskManagerModule | null | undefined;

function getTaskManager(): TaskManagerModule | null {
  if (tmResolved !== undefined) return tmResolved;
  if (Constants.appOwnership === "expo") {
    tmResolved = null;
    return null;
  }
  try {
    const tm = require("expo-task-manager") as TaskManagerModule;
    // Some runtimes may have the JS package but not the native module (common when not rebuilt).
    // Probe a lightweight call that touches the native module; if it throws, treat as unavailable.
    try {
      if (typeof (tm as any)?.isTaskDefined !== "function") throw new Error("TaskManager missing isTaskDefined()");
      (tm as any).isTaskDefined("__safenaari_probe__");
    } catch {
      tmResolved = null;
      return null;
    }
    tmResolved = tm;
  } catch {
    tmResolved = null;
  }
  return tmResolved;
}

let taskDefined = false;

function ensureTaskDefined(): boolean {
  const tm = getTaskManager();
  if (!tm) return false;
  if (taskDefined) return true;
  if (!tm.isTaskDefined(SAFENAARI_BG_LOCATION_TASK)) {
    tm.defineTask(SAFENAARI_BG_LOCATION_TASK, async ({ data, error }) => {
      if (error) return;
      const payload = data as { locations?: Location.LocationObject[] };
      const loc = payload?.locations?.[0];
      if (!loc?.coords) return;
      const userId = (await getStoredUserId()) || "user_anon";
      try {
        await updateLocation(
          userId,
          loc.coords.latitude,
          loc.coords.longitude,
          loc.coords.accuracy ?? undefined
        );
      } catch {
        // offline / API down
      }
    });
  }
  taskDefined = true;
  return true;
}

export async function startBackgroundSafetyTracking(): Promise<boolean> {
  try {
    if (!ensureTaskDefined()) return false;
  } catch (e: any) {
    console.warn("Background location task unavailable in this runtime:", e?.message || e);
    return false;
  }

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return false;

  try {
    const started = await Location.hasStartedLocationUpdatesAsync(SAFENAARI_BG_LOCATION_TASK);
    if (started) return true;

    await Location.startLocationUpdatesAsync(SAFENAARI_BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 60_000,
      distanceInterval: 75,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "SafeNaari",
        notificationBody: "Background safety monitoring is on.",
      },
    });
    return true;
  } catch (e: any) {
    // ExpoTaskManager missing / not rebuilt / permissions mismatch.
    console.warn("Failed to start background location updates:", e?.message || e);
    return false;
  }
}

export async function stopBackgroundSafetyTracking(): Promise<void> {
  if (!getTaskManager()) return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(SAFENAARI_BG_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(SAFENAARI_BG_LOCATION_TASK);
    }
  } catch {
    // ignore
  }
}
