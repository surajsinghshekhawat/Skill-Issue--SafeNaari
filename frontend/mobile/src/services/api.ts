/**
 * API Service
 *
 * Handles all API calls to the backend
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import { storage } from "../utils/storage";

// API Base URL Configuration
// - Use your machine's LAN IP for physical device testing (same Wi‑Fi as backend)
// - Use 'localhost' for emulator/simulator if needed
export const API_BASE_URL = __DEV__
  ? "http://192.168.1.7:3001"
  : "https://api.womensafety.com"; // Production (update with actual URL)

export interface HeatmapCell {
  lat: number;
  lng: number;
  risk_score: number;
  risk_level: "low" | "medium" | "high";
}

export interface HeatmapData {
  center: {
    lat: number;
    lng: number;
  };
  radius: number;
  grid_size: number;
  cells: HeatmapCell[];
  clusters: Array<{
    id: string;
    center: { lat: number; lng: number };
    radius: number;
    risk_score: number;
    incident_count?: number;
  }>;
}

export interface HeatmapResponse {
  success: boolean;
  heatmap: HeatmapData;
  timestamp: string;
}

export interface RouteWaypoint {
  lat: number;
  lng: number;
}

export interface RouteSegment {
  start: RouteWaypoint;
  end: RouteWaypoint;
  risk_score: number;
}

export interface RouteInstruction {
  instruction: string;
  maneuver?: string;
  distanceMeters?: number;
}

export interface SafeRoute {
  id: string;
  safetyScore: number; // 0-1, higher is safer
  riskScore: number; // 0-5, lower is safer
  distance: number; // meters
  safeDistance: number; // meters through safe zones
  highRiskSegments: RouteSegment[];
  waypoints: RouteWaypoint[];
  duration?: number; // seconds
  instructions?: RouteInstruction[];
}

export interface SafeRoutesResponse {
  success: boolean;
  routes: {
    start: RouteWaypoint;
    end: RouteWaypoint;
    routes: SafeRoute[];
    recommendedRoute: string | null;
  };
  timestamp: string;
}

export interface RiskAssessment {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  isHighRisk: boolean;
}

export interface RiskAlert {
  triggered: boolean;
  riskScore: number;
  riskLevel: string;
  message: string;
  location: { lat: number; lng: number };
  cooldown_seconds: number;
}

export interface LocationUpdateResponse {
  success: boolean;
  message: string;
  timestamp: string;
  riskAssessment: RiskAssessment | null;
  riskAlert?: RiskAlert | null;
}

const USER_TOKEN_KEY = "safenaari:userToken";
const USER_ID_KEY = "safenaari:userId";
const USER_EMAIL_KEY = "safenaari:userEmail";

export async function getUserToken(): Promise<string | null> {
  return storage.getItem(USER_TOKEN_KEY);
}

export async function setUserToken(token: string): Promise<void> {
  await storage.setItem(USER_TOKEN_KEY, token);
}

export async function clearUserToken(): Promise<void> {
  await storage.removeItem(USER_TOKEN_KEY);
}

export async function getStoredUserId(): Promise<string | null> {
  return storage.getItem(USER_ID_KEY);
}

export async function clearStoredUser(): Promise<void> {
  await storage.removeItem(USER_ID_KEY);
  await storage.removeItem(USER_EMAIL_KEY);
}

async function setStoredUser(user: { id: string; email?: string | null }) {
  await storage.setItem(USER_ID_KEY, user.id);
  if (user.email) await storage.setItem(USER_EMAIL_KEY, user.email);
}

export async function logoutUser(): Promise<void> {
  await clearUserToken();
  await clearStoredUser();
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getUserToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(init?.headers || {}),
    ...(await authHeaders()),
  } as Record<string, string>;

  let response: Response;
  try {
    response = await fetch(url, { ...(init || {}), headers });
  } catch (e: any) {
    // React Native throws TypeError: Network request failed for connectivity/CORS/DNS issues.
    const hint =
      `Network request failed for ${url}. ` +
      `Check: phone & laptop on same Wi‑Fi, backend running at ${API_BASE_URL}, ` +
      `and Windows firewall allows port 3001.`;
    throw new Error(hint);
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `HTTP error! status: ${response.status} - ${errorData.error || "Unknown error"}`
    );
  }
  return (await response.json()) as T;
}

export type AuthResponse = {
  success: boolean;
  message: string;
  token: string;
  user: { id: string; email: string; name?: string; phoneNumber?: string | null };
  timestamp: string;
};

export async function registerUser(opts: {
  email: string;
  password: string;
  name: string;
  phoneNumber?: string;
}): Promise<AuthResponse> {
  const data = await fetchJson<AuthResponse>(`${API_BASE_URL}/api/auth/register`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
  if (data?.token) await setUserToken(data.token);
  if (data?.user?.id) await setStoredUser({ id: data.user.id, email: data.user.email });
  return data;
}

export async function loginUser(opts: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const data = await fetchJson<AuthResponse>(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
  if (data?.token) await setUserToken(data.token);
  if (data?.user?.id) await setStoredUser({ id: data.user.id, email: data.user.email });
  return data;
}

/**
 * Fetch heatmap data for a given area
 * NOW SUPPORTS TIME-BASED RISK CALCULATION WITH LOCAL TIME
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param radius - Search radius in meters (default: 1000)
 * @param gridSize - Grid size for heatmap (default: 100)
 * @param timestamp - ISO timestamp for time-based risk (default: current time)
 */
export async function fetchHeatmap(
  lat: number,
  lng: number,
  radius: number = 1000,
  gridSize: number = 100,
  timestamp?: string // Current time for time-based risk calculation
): Promise<HeatmapResponse> {
  try {
    // Use current timestamp if not provided (for time-based risk calculation)
    const queryTimestamp = timestamp || new Date().toISOString();

    // Calculate LOCAL hour (0-23) for accurate time-of-day risk calculation
    // This ensures 9PM local = high risk, not UTC time
    const now = new Date();
    const localHour = now.getHours(); // 0-23 in user's local timezone
    // Minutes east of UTC (e.g., IST => +330). JS getTimezoneOffset() is minutes *behind* UTC.
    const timezoneOffsetMinutes = -now.getTimezoneOffset();

    // Add timestamp and local_hour to query params for time-based risk calculation
    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      radius: radius.toString(),
      grid_size: gridSize.toString(),
      timestamp: queryTimestamp, // ISO timestamp for logging/other purposes
      local_hour: localHour.toString(), // LOCAL hour (0-23) for time-of-day risk
      timezone_offset_minutes: timezoneOffsetMinutes.toString(),
    });

    return await fetchJson<HeatmapResponse>(
      `${API_BASE_URL}/api/location/heatmap?${params.toString()}`,
      { method: "GET" }
    );
  } catch (error) {
    console.error("Error fetching heatmap:", error);
    throw error;
  }
}

/**
 * Update user location
 */
/**
 * Fetch all community reports
 */
export async function fetchCommunityReports(): Promise<any> {
  try {
    return await fetchJson<any>(`${API_BASE_URL}/api/reports/all`, { method: "GET" });
  } catch (error) {
    console.error("Error fetching community reports:", error);
    throw error;
  }
}

export async function voteOnReport(reportId: string, value: 1 | -1): Promise<any> {
  return await fetchJson<any>(`${API_BASE_URL}/api/reports/${encodeURIComponent(reportId)}/vote`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function fetchReportComments(reportId: string): Promise<any> {
  return await fetchJson<any>(
    `${API_BASE_URL}/api/reports/${encodeURIComponent(reportId)}/comments`,
    { method: "GET" }
  );
}

export async function addReportComment(reportId: string, text: string): Promise<any> {
  return await fetchJson<any>(
    `${API_BASE_URL}/api/reports/${encodeURIComponent(reportId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    }
  );
}

export async function updateLocation(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy?: number
): Promise<LocationUpdateResponse> {
  try {
    const now = new Date();
    const tzOffsetMinutes = -now.getTimezoneOffset();
    const localHour = now.getHours();
    return await fetchJson<LocationUpdateResponse>(`${API_BASE_URL}/api/location/update`, {
      method: "POST",
      body: JSON.stringify({
        userId, // ignored by backend once MOBILE_AUTH_REQUIRED=true
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
        timezone_offset_minutes: tzOffsetMinutes,
        local_hour: localHour,
        accuracy,
      }),
    });
  } catch (error) {
    console.error("Error updating location:", error);
    throw error;
  }
}

/**
 * Trigger panic alert
 */
export async function triggerPanicAlert(
  userId: string,
  latitude: number,
  longitude: number,
  emergencyContacts: string[] = []
): Promise<any> {
  try {
    const tzOffsetMinutes = -new Date().getTimezoneOffset();
    return await fetchJson<any>(`${API_BASE_URL}/api/panic/trigger`, {
      method: "POST",
      body: JSON.stringify({
        userId, // ignored by backend once MOBILE_AUTH_REQUIRED=true
        location: { latitude, longitude },
        emergencyContacts: emergencyContacts.length > 0 ? emergencyContacts : [],
        timestamp: new Date().toISOString(),
        timezone_offset_minutes: tzOffsetMinutes,
      }),
    });
  } catch (error) {
    console.error("Error triggering panic alert:", error);
    throw error;
  }
}

export async function cancelPanicAlert(panicId: string, userId?: string): Promise<any> {
  return await fetchJson<any>(`${API_BASE_URL}/api/panic/cancel`, {
    method: "POST",
    body: JSON.stringify({
      panicId,
      ...(userId ? { userId } : {}),
    }),
  });
}

/**
 * Search for places using Google Places Autocomplete
 */
export async function searchPlaces(
  query: string,
  location?: { lat: number; lng: number }
): Promise<Array<{ placeId: string; description: string }>> {
  try {
    const params = new URLSearchParams({
      query,
    });
    if (location) {
      params.append("lat", location.lat.toString());
      params.append("lng", location.lng.toString());
    }

    const data = await fetchJson<any>(
      `${API_BASE_URL}/api/location/search-places?${params.toString()}`,
      { method: "GET" }
    );
    return data?.places || [];
  } catch (error) {
    console.error("Error searching places:", error);
    throw error;
  }
}

/**
 * Get coordinates from place ID
 */
export async function getPlaceCoordinates(
  placeId: string
): Promise<{ lat: number; lng: number }> {
  try {
    const params = new URLSearchParams({
      placeId,
    });

    const data = await fetchJson<any>(
      `${API_BASE_URL}/api/location/place-coordinates?${params.toString()}`,
      { method: "GET" }
    );
    return data.location;
  } catch (error) {
    console.error("Error getting place coordinates:", error);
    throw error;
  }
}

/**
 * Get safe route recommendations
 */
export async function getSafeRoutes(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<SafeRoutesResponse> {
  try {
    const params = new URLSearchParams({
      startLat: startLat.toString(),
      startLng: startLng.toString(),
      endLat: endLat.toString(),
      endLng: endLng.toString(),
    });

    return await fetchJson<SafeRoutesResponse>(
      `${API_BASE_URL}/api/location/safe-routes?${params.toString()}`,
      { method: "GET" }
    );
  } catch (error) {
    console.error("Error getting safe routes:", error);
    throw error;
  }
}

export type SubmitReportRequest = {
  type: "community_report";
  category: string;
  description: string;
  severity: number;
  location: { latitude: number; longitude: number };
  media?: { uri: string; type: "image" | "video" } | null;
};

export async function uploadMedia(localUri: string): Promise<{ url: string }> {
  const token = await getUserToken();
  const form = new FormData();
  const filename = localUri.split("/").pop() || `media_${Date.now()}.jpg`;
  const lower = filename.toLowerCase();
  const mime =
    lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".gif")
          ? "image/gif"
          : lower.endsWith(".mp4")
            ? "video/mp4"
            : "image/jpeg";

  form.append("file", {
    uri: localUri,
    name: filename,
    type: mime,
  } as any);

  const res = await fetch(`${API_BASE_URL}/api/uploads/media`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Let fetch set the multipart boundary automatically
    } as any,
    body: form as any,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Upload failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  const url = data?.file?.url ? String(data.file.url) : "";
  if (!url) throw new Error("Upload failed (missing url)");
  return { url };
}

export async function submitCommunityReport(req: SubmitReportRequest): Promise<any> {
  let mediaUrl: string | null = null;
  if (req.media?.uri) {
    const uploaded = await uploadMedia(req.media.uri);
    mediaUrl = uploaded.url;
  }
  return await fetchJson<any>(`${API_BASE_URL}/api/reports/submit`, {
    method: "POST",
    body: JSON.stringify({
      // userId is ignored by backend when MOBILE_AUTH_REQUIRED=true,
      // but still included for backwards compatibility.
      userId: (await getStoredUserId()) || "user_anon",
      type: req.type,
      category: req.category,
      description: req.description,
      severity: req.severity,
      location: req.location,
      timestamp: new Date().toISOString(),
      timezone_offset_minutes: -new Date().getTimezoneOffset(),
      media_url: mediaUrl,
    }),
  });
}
