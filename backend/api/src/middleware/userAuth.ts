import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const USER_JWT_SECRET =
  process.env.USER_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "change-me-in-production";

export type UserPayload = {
  sub: string;
  email: string;
  role: "user";
  iat?: number;
  exp?: number;
};

export function signUserToken(payload: { sub: string; email: string }): string {
  const data: UserPayload = { sub: payload.sub, email: payload.email, role: "user" };
  return jwt.sign(data, USER_JWT_SECRET, { expiresIn: "30d" });
}

export function requireUserAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header",
    });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, USER_JWT_SECRET) as UserPayload;
    if (decoded.role !== "user") {
      return res.status(403).json({ error: "Forbidden", message: "User role required" });
    }
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}

export function mobileAuthRequired(): boolean {
  return String(process.env.MOBILE_AUTH_REQUIRED || "false").toLowerCase() === "true";
}

