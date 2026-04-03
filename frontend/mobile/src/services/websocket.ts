/**
 * WebSocket Service
 *
 * Handles real-time updates for heatmap and incidents
 * Connects to backend WebSocket server for instant updates
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

// Use require() for React Native compatibility with socket.io-client
// This avoids ESM module resolution issues in Metro bundler
// Type definitions maintained via @types/socket.io-client
const socketIO = require("socket.io-client");
// socket.io-client exports io as the default function
const io =
  typeof socketIO === "function"
    ? socketIO
    : socketIO.io || socketIO.default || socketIO;
const Socket = socketIO.Socket;

// Import API_BASE_URL from api.ts (using same config)
import { API_BASE_URL } from "./api";

let socket: ReturnType<typeof io> | null = null;
let isConnected = false;

// Prevent duplicate event handler registration + subscribe spam
let currentLocationSub:
  | { lat: number; lng: number; radius: number; key: string }
  | null = null;
let heatmapUpdateCallback: ((heatmapData: any) => void) | null = null;
let incidentCallback: ((incident: any) => void) | null = null;

const _pendingWsLog = new Set<string>();
function logWsPendingOnce(channel: string, detail: string) {
  if (_pendingWsLog.has(channel)) return;
  _pendingWsLog.add(channel);
  console.log(`🔌 WebSocket still handshaking — ${detail} (will subscribe when ready)`);
}

// Deduplicate incident events (can arrive via multiple rooms/channels)
const _recentIncidentIds = new Map<string, number>(); // incidentId -> lastSeenMs
const _INCIDENT_DEDUP_WINDOW_MS = 10_000;

function _locationKey(lat: number, lng: number, radius: number): string {
  // Round to avoid tiny float changes causing resubscribe spam
  const latK = Number(lat).toFixed(4);
  const lngK = Number(lng).toFixed(4);
  const rK = Math.round(Number(radius));
  return `location:${latK}:${lngK}:${rK}`;
}

function _ensureSocketHandlersBound() {
  if (!socket) return;
  const s: any = socket;

  if (s._wsaHandlersBound) return;
  s._wsaHandlersBound = true;

  // Single heatmap update handler that forwards to latest callback
  socket.on("heatmap:update", (data: any) => {
    if (heatmapUpdateCallback) {
      console.log("📡 Received heatmap update via WebSocket");
      heatmapUpdateCallback(data);
    }
  });

  // Single incident handler that forwards to latest callback
  socket.on("incident:new", (data: any) => {
    const nowMs = Date.now();
    const id = data?.incidentId ? String(data.incidentId) : null;
    if (id) {
      const last = _recentIncidentIds.get(id);
      if (last && nowMs - last < _INCIDENT_DEDUP_WINDOW_MS) {
        return;
      }
      _recentIncidentIds.set(id, nowMs);
      // Prevent unbounded growth
      if (_recentIncidentIds.size > 200) {
        for (const [k, v] of _recentIncidentIds) {
          if (nowMs - v > _INCIDENT_DEDUP_WINDOW_MS) _recentIncidentIds.delete(k);
        }
      }
    }

    if (incidentCallback) {
      console.log("📡 Received new incident via WebSocket:", data.incidentId);
      incidentCallback(data);
    }
  });

  // Log subscription acknowledgements without duplicating
  socket.on("subscribed", (data: any) => {
    const room = data?.room;
    if (room && s._wsaLastSubscribedRoom !== room) {
      console.log("📍 Subscribed to location room:", room);
      s._wsaLastSubscribedRoom = room;
    }
  });
}

/**
 * Initialize WebSocket connection
 * Returns socket but doesn't block if connection fails - app continues to work
 */
export function initWebSocket(): ReturnType<typeof io> {
  // Reuse existing socket if already connected or connecting
  if (socket?.connected) {
    return socket; // Already connected, reuse
  }
  if (socket && !socket.disconnected) {
    return socket; // Already connecting, reuse
  }

  // Don't block - try to connect but continue if it fails
  try {
    console.log("🔌 Initializing WebSocket connection to:", API_BASE_URL);
    socket = io(API_BASE_URL, {
      transports: ["polling", "websocket"], // Try polling first (more reliable on mobile networks)
      reconnection: true,
      reconnectionDelay: 3000, // Wait 3 seconds between reconnection attempts
      reconnectionAttempts: 5, // Retry a few times (e.g. after backend starts)
      forceNew: false,
      upgrade: true, // Allow transport upgrade from polling to websocket
      rememberUpgrade: false, // Don't remember upgrade for mobile networks
      timeout: 10000, // Reduced timeout to 10 seconds (fail faster, retry if needed)
      autoConnect: true,
      // Additional options for better mobile compatibility
      jsonp: false, // Disable JSONP polling
      forceBase64: false, // Use native binary
    });

    socket.on("connect", () => {
      isConnected = true;
      // Socket id is assigned synchronously on connect; log next tick if ever missing in a client build.
      if (!socket?._hasLoggedConnect) {
        const sid = (socket as any)?.id;
        if (sid) {
          console.log("✅ WebSocket connected:", sid);
        } else {
          Promise.resolve().then(() => {
            console.log("✅ WebSocket connected:", (socket as any)?.id || "(id pending)");
          });
        }
        socket._hasLoggedConnect = true;
      }

      // Bind handlers once per socket instance and resubscribe to last room (if any)
      _ensureSocketHandlersBound();
      if (currentLocationSub) {
        try {
          socket.emit("subscribe:location", {
            lat: currentLocationSub.lat,
            lng: currentLocationSub.lng,
            radius: currentLocationSub.radius,
          });
        } catch {
          // ignore
        }
      }
      if (incidentCallback) {
        try {
          socket.emit("subscribe:incidents");
        } catch {
          // ignore
        }
      }
    });

    socket.on("disconnect", () => {
      isConnected = false;
      // Only log disconnect if it wasn't intentional
      if (socket?._hasLoggedConnect) {
        console.log(
          "❌ WebSocket disconnected (app continues with HTTP polling)"
        );
        socket._hasLoggedConnect = false;
      }
    });

    socket.on("connect_error", (error: any) => {
      isConnected = false;
      // Log reason once to help debug (e.g. connection refused, timeout)
      if (!socket?._hasLoggedConnectError) {
        socket._hasLoggedConnectError = true;
        console.warn(
          "⚠️ WebSocket unavailable - using HTTP polling. Reason:",
          error?.message || error
        );
      }
    });

    socket.on("error", (error: any) => {
      isConnected = false;
      // WebSocket is optional - app continues without it
    });

    // Set a flag to prevent multiple connection attempts
    if (!socket._reconnecting) {
      socket._reconnecting = false;
    }
  } catch (error) {
    console.warn(
      "⚠️ WebSocket initialization failed - app will use HTTP polling:",
      error
    );
    // Continue without WebSocket - app still works
  }

  return socket || ({} as any); // Return empty object if socket is null to prevent errors
}

/**
 * Subscribe to location-based heatmap updates
 * Gracefully handles WebSocket failures - app continues without real-time updates
 */
export function subscribeToLocation(
  lat: number,
  lng: number,
  radius: number,
  onUpdate: (heatmapData: any) => void
) {
  if (!socket || !socket.connected) {
    socket = initWebSocket();
  }

  heatmapUpdateCallback = onUpdate;
  _ensureSocketHandlersBound();

  const key = _locationKey(lat, lng, radius);
  if (currentLocationSub?.key === key && socket?.connected) {
    return;
  }

  if (currentLocationSub && currentLocationSub.key !== key && socket?.connected) {
    try {
      socket.emit("unsubscribe:location", {
        lat: currentLocationSub.lat,
        lng: currentLocationSub.lng,
        radius: currentLocationSub.radius,
      });
    } catch {
      // ignore
    }
  }

  currentLocationSub = { lat, lng, radius, key };

  if (socket && socket.connected) {
    try {
      socket.emit("subscribe:location", { lat, lng, radius });
    } catch (error) {
      console.warn("⚠️ WebSocket subscribe:location failed:", error);
    }
  } else {
    logWsPendingOnce(
      "heatmap",
      "heatmap will use HTTP until connected; live updates apply after connect"
    );
  }
}

/**
 * Subscribe to all incident updates
 * Gracefully handles WebSocket failures - app continues without real-time updates
 */
export function subscribeToIncidents(onNewIncident: (incident: any) => void) {
  if (!socket || !socket.connected) {
    socket = initWebSocket();
  }

  incidentCallback = onNewIncident;
  _ensureSocketHandlersBound();

  if (socket && socket.connected) {
    try {
      socket.emit("subscribe:incidents");
    } catch (error) {
      console.warn("⚠️ WebSocket subscribe:incidents failed:", error);
    }
  } else {
    logWsPendingOnce(
      "incidents",
      "incidents will use HTTP until connected; live updates apply after connect"
    );
  }
}

/**
 * Unsubscribe from location updates
 */
export function unsubscribeFromLocation(
  lat: number,
  lng: number,
  radius: number
) {
  if (socket) {
    socket.emit("unsubscribe:location", { lat, lng, radius });
    // Keep handlers bound; just clear callback + subscription key so we can resubscribe later.
    heatmapUpdateCallback = null;
    currentLocationSub = null;
    console.log("📍 Unsubscribed from location updates");
  }
}

/**
 * Disconnect WebSocket
 */
export function disconnectWebSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    isConnected = false;
    currentLocationSub = null;
    heatmapUpdateCallback = null;
    incidentCallback = null;
    console.log("🔌 WebSocket disconnected");
  }
}

/**
 * Check if WebSocket is connected
 */
export function isWebSocketConnected(): boolean {
  return isConnected && socket?.connected === true;
}

export { socket };
