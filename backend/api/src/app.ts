/**
 * Women Safety Analytics - Backend API
 *
 * Main Express server for handling panic alerts, location tracking,
 * emergency contacts, and admin dashboard data
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import "./env";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

// Import route handlers
import panicRoutes from "./routes/panic";
import locationRoutes from "./routes/location";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import reportsRoutes from "./routes/reports";
import uploadsRoutes from "./routes/uploads";
import { requireAdmin } from "./middleware/auth";
import path from "path";

// Import WebSocket handlers
import { setupWebSocket } from "./websocket/socketHandler";
import { runMigrations } from "./db/migrations";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// Create HTTP server for Socket.io
const server = http.createServer(app);

// Initialize Socket.io with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: "*", // Allow all origins for development (React Native needs this)
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"], // Support both transports
  allowEIO3: true, // Allow Engine.IO v3 clients for better compatibility
  // Note: Socket.IO v4 automatically supports Engine.IO v4 (no need for allowEIO4)
  pingTimeout: 60000, // Increase ping timeout for mobile connections (60 seconds)
  pingInterval: 25000, // Standard ping interval (25 seconds)
  connectTimeout: 45000, // Connection timeout for mobile (45 seconds)
});

// Make io accessible to routes via app.locals
app.locals.io = io;

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: "*", // Allow all origins for development (restrict in production)
    credentials: true,
  })
);

// Logging middleware (only in development)
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("combined"));
}

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded media
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Women Safety Analytics API",
    version: "1.0.0",
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/panic", panicRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/uploads", uploadsRoutes);

// 404 handler (catch-all for unmatched routes)
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Global error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("API Error:", err);

    res.status(err.status || 500).json({
      error:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
      timestamp: new Date().toISOString(),
    });
  }
);

// Setup WebSocket handlers
setupWebSocket(io);

async function start() {
  try {
    await runMigrations();
  } catch (e) {
    console.warn("⚠️ DB migrations failed (continuing):", (e as any)?.message || e);
  }

  // Start server - listen on all interfaces (0.0.0.0) to allow network access
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Women Safety Analytics API running on port ${PORT}`);
    console.log(`📊 Health check: http://192.168.1.7:${PORT}/health`);
    console.log(`🌐 Network access: http://192.168.1.7:${PORT}/health`);
    console.log(`🔌 WebSocket server ready for real-time updates`);
    console.log(
      `⚠️  Make sure Windows Firewall allows connections on port ${PORT}`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — closing server…`);
    io.close(() => {
      server.close((err) => {
        if (err) console.error("server.close:", err);
        process.exit(err ? 1 : 0);
      });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGUSR2", () => shutdown("SIGUSR2"));
}

void start();

export default app;
export { io }; // Export io for use in routes
