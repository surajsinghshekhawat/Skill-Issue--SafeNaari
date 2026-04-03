/**
 * WebSocket Handler
 * 
 * Handles real-time updates for heatmap and incident reports
 * Provides instant updates when new incidents are reported
 * 
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import { Server as SocketIOServer, Socket } from "socket.io";

interface HeatmapUpdate {
  lat: number;
  lng: number;
  radius: number;
  heatmap: any;
  timestamp: string;
}

interface NewIncidentEvent {
  incidentId: string;
  latitude: number;
  longitude: number;
  type: "panic_alert" | "community_report";
  severity: number;
  timestamp: string;
  location?: {
    lat: number;
    lng: number;
  };
}

/**
 * Setup WebSocket handlers
 */
export function setupWebSocket(io: SocketIOServer) {
  console.log("🔌 Setting up WebSocket handlers...");

  io.on("connection", (socket: Socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // Identify user for user-targeted alerts (joins user:<userId> room)
    socket.on("identify:user", (data: { userId?: string }) => {
      const userId = data?.userId ? String(data.userId) : "";
      if (!userId || userId.length > 128) {
        return;
      }
      const roomId = `user:${userId}`;
      socket.join(roomId);
      console.log(`👤 Client ${socket.id} identified as ${roomId}`);
      socket.emit("identified", { room: roomId });
    });

    // Join room for location-based updates
    socket.on("subscribe:location", (data: { lat: number; lng: number; radius: number }) => {
      const { lat, lng, radius } = data;
      const roomId = `location:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
      socket.join(roomId);
      console.log(`📍 Client ${socket.id} subscribed to location: ${roomId}`);
      socket.emit("subscribed", { room: roomId });
    });

    // Leave location room
    socket.on("unsubscribe:location", (data: { lat: number; lng: number; radius: number }) => {
      const { lat, lng, radius } = data;
      const roomId = `location:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
      socket.leave(roomId);
      console.log(`📍 Client ${socket.id} unsubscribed from location: ${roomId}`);
    });

    // Subscribe to all incident updates
    socket.on("subscribe:incidents", () => {
      socket.join("incidents:all");
      console.log(`📢 Client ${socket.id} subscribed to all incidents`);
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  console.log("✅ WebSocket handlers set up successfully");
}

/**
 * Emit heatmap update to subscribers in a location
 */
export function emitHeatmapUpdate(
  io: SocketIOServer,
  data: HeatmapUpdate
) {
  const { lat, lng, radius } = data;
  const roomId = `location:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
  
  io.to(roomId).emit("heatmap:update", {
    ...data,
    timestamp: new Date().toISOString(),
  });
  
  console.log(`📡 Emitted heatmap update to room: ${roomId}`);
}

/**
 * Emit new incident event to subscribers
 */
export function emitNewIncident(io: SocketIOServer, incident: NewIncidentEvent) {
  const payload = {
    ...incident,
    timestamp: new Date().toISOString(),
  };

  // 1) Global incident channel (optional clients)
  io.to("incidents:all").emit("incident:new", payload);

  // 2) Location-room targeting: emit only to rooms whose center/radius covers this incident.
  // Room format: location:<lat4>:<lng4>:<radiusMetersInt>
  const rooms = io.of("/").adapter.rooms;

  function parseLocationRoom(roomId: string): { lat: number; lng: number; radius: number } | null {
    if (!roomId.startsWith("location:")) return null;
    const parts = roomId.split(":");
    if (parts.length !== 4) return null;
    const latStr = parts[1];
    const lngStr = parts[2];
    const radiusStr = parts[3];
    if (!latStr || !lngStr || !radiusStr) return null;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const radius = parseInt(radiusStr, 10);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || radius <= 0) return null;
    return { lat, lng, radius };
  }

  function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // meters
    const toRad = (d: number) => (d * Math.PI) / 180.0;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let targetedRooms = 0;
  for (const roomId of rooms.keys()) {
    const parsed = parseLocationRoom(roomId);
    if (!parsed) continue;
    const d = haversineMeters(parsed.lat, parsed.lng, incident.latitude, incident.longitude);
    if (d <= parsed.radius) {
      io.to(roomId).emit("incident:new", payload);
      targetedRooms += 1;
    }
  }

  console.log(
    `📡 Emitted new incident event: ${incident.incidentId} (targeted_rooms=${targetedRooms})`
  );
}

/**
 * Emit real-time risk alert
 */
export function emitRiskAlert(
  io: SocketIOServer,
  data: {
    userId: string;
    location: { lat: number; lng: number };
    riskScore: number;
    riskLevel: string;
    message: string;
  }
) {
  // Send to specific user if they're connected
  io.to(`user:${data.userId}`).emit("risk:alert", {
    ...data,
    timestamp: new Date().toISOString(),
  });

  console.log(`⚠️ Emitted risk alert to user: ${data.userId}`);
}