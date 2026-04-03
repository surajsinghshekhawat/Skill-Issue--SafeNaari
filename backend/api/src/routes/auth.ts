/**
 * Authentication Routes
 *
 * Handles user authentication, registration,
 * admin login (JWT), and emergency contact management
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import express from "express";
import { Request, Response } from "express";
import { signAdminToken } from "../middleware/auth";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail } from "../services/userStore";
import {
  mobileAuthRequired,
  requireUserAuth,
  signUserToken,
} from "../middleware/userAuth";
import { createUserDb, findUserByEmailDb, findUserByIdDb } from "../services/userDb";
import { dbReady } from "../db/pool";
import { listEmergencyContacts, replaceEmergencyContacts } from "../db/contactsDb";
import rateLimit from "express-rate-limit";

const router = express.Router();

const authWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

/**
 * POST /api/auth/admin-login
 * Admin login: returns JWT for admin dashboard.
 * Body: { email, password } or { username, password }
 * Env: ADMIN_EMAIL + ADMIN_PASSWORD, or ADMIN_SECRET (password for username "admin")
 */
router.post("/admin-login", authWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, username } = req.body;
    const loginId = email || username;
    if (!loginId || !password) {
      return res.status(400).json({
        error: "Missing required fields: email (or username) and password",
      });
    }

    const adminSecret = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(503).json({
        error: "Admin login is not configured. Set ADMIN_PASSWORD or ADMIN_SECRET in the API .env.",
        timestamp: new Date().toISOString(),
      });
    }

    const adminEmail = process.env.ADMIN_EMAIL || "admin@womensafety.local";
    const ok =
      (loginId === adminEmail && password === adminSecret) ||
      (loginId === "admin" && password === adminSecret);

    if (!ok) {
      return res.status(401).json({
        error: "Invalid credentials",
        timestamp: new Date().toISOString(),
      });
    }

    const token = signAdminToken(loginId, "admin");
    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: { id: "admin", email: loginId, role: "admin" },
      expiresIn: "7d",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({
      error: "Failed to authenticate",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/auth/register
 * Register new user
 */
router.post("/register", authWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, name, phoneNumber } = req.body;

    // Validate required fields
    if (!email || !password || !name) {
      return res.status(400).json({
        error: "Missing required fields: email, password, name",
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    if (!emailNorm.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const useDb = await dbReady();
    const existing = useDb ? await findUserByEmailDb(emailNorm) : findUserByEmail(emailNorm);
    if (existing) return res.status(409).json({ error: "User already exists" });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const userId = `user_${Date.now()}`;
    if (useDb) {
      await createUserDb({
        id: userId,
        email: emailNorm,
        passwordHash,
        name: String(name),
        phoneNumber: phoneNumber ? String(phoneNumber) : null,
      });
    } else {
      createUser({
        id: userId,
        email: emailNorm,
        passwordHash,
        createdAt: new Date().toISOString(),
      });
    }

    const token = signUserToken({ sub: userId, email: emailNorm });
    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: { id: userId, email: emailNorm, name, phoneNumber: phoneNumber || null },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      error: "Failed to register user",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/auth/login
 * User login
 */
router.post("/login", authWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Missing required fields: email, password",
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const useDb = await dbReady();
    const user = useDb ? await findUserByEmailDb(emailNorm) : findUserByEmail(emailNorm);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signUserToken({ sub: user.id, email: user.email });
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      error: "Failed to authenticate user",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/auth/me
 * Return current user from JWT.
 */
router.get("/me", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const payload = (req as any).user as { sub: string; email: string };
    const userId = String(payload.sub);
    const useDb = await dbReady();
    const user = useDb ? await findUserByIdDb(userId) : null;
    let emergencyContacts: Array<{ name: string; phone: string }> = [];
    if (useDb) {
      const rows = await listEmergencyContacts(userId);
      emergencyContacts = rows.map((r) => ({ name: r.name, phone: r.phone }));
    }
    return res.status(200).json({
      success: true,
      user: {
        ...(user || { id: userId, email: payload.email, name: null, phoneNumber: null, createdAt: null }),
        emergencyContacts,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load user", timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/auth/profile/:userId
 * Get user profile
 */
router.get("/profile/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (await dbReady()) {
      const uid = String(userId || "");
      const user = await findUserByIdDb(uid);
      if (!user) {
        return res.status(404).json({
          error: "User not found",
          timestamp: new Date().toISOString(),
        });
      }
      const rows = await listEmergencyContacts(uid);
      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber,
          emergencyContacts: rows.map((r) => ({ name: r.name, phone: r.phone })),
          createdAt: user.createdAt,
        },
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: userId,
        name: "Unknown (DB offline)",
        email: "unknown@local",
        phoneNumber: null,
        emergencyContacts: [],
        createdAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({
      error: "Failed to get user profile",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PUT /api/auth/emergency-contacts
 * Update emergency contacts
 */
router.put(
  "/emergency-contacts",
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  async (req: Request, res: Response) => {
  try {
    const emergencyContacts = req.body?.emergencyContacts ?? req.body?.contacts;
    const authedUserId = (req as any).user?.sub;
    const effectiveUserId = mobileAuthRequired()
      ? String(authedUserId || "")
      : String(req.body?.userId || "");

    if (!effectiveUserId || !Array.isArray(emergencyContacts)) {
      return res.status(400).json({
        error: "Missing required fields: emergencyContacts[] (and userId when auth is off)",
      });
    }

    const normalized = emergencyContacts
      .map((c: any) => ({
        name: String(c?.name || "").trim(),
        phone: String(c?.phone || c?.phoneNumber || "").trim(),
      }))
      .filter((c: { name: string; phone: string }) => c.name && c.phone);

    console.log("📞 Emergency contacts update:", {
      userId: effectiveUserId,
      contactCount: normalized.length,
      timestamp: new Date().toISOString(),
    });

    if (await dbReady()) {
      await replaceEmergencyContacts(effectiveUserId, normalized);
    }

    res.status(200).json({
      success: true,
      message: "Emergency contacts updated successfully",
      emergencyContacts: normalized,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Emergency contacts error:", error);
    res.status(500).json({
      error: "Failed to update emergency contacts",
      timestamp: new Date().toISOString(),
    });
  }
  }
);

export default router;




