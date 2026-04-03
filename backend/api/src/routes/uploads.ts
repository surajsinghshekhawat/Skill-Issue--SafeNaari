import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { mobileAuthRequired, requireUserAuth } from "../middleware/userAuth";

const router = express.Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function safeExt(originalName: string): string {
  const ext = path.extname(originalName || "").toLowerCase();
  if (!ext) return "";
  // allow common image/video extensions only
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov"].includes(ext)) return ext;
  return "";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    } catch (e) {
      cb(e as any, UPLOAD_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = safeExt(file.originalname);
    const id = `media_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * POST /api/uploads/media
 * multipart/form-data: file=<image|video>
 */
router.post(
  "/media",
  (req, res, next) => (mobileAuthRequired() ? requireUserAuth(req, res, next) : next()),
  upload.single("file"),
  async (req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, error: "Missing file" });
    }
    const urlPath = `/uploads/${file.filename}`;
    return res.status(200).json({
      success: true,
      file: {
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url: urlPath,
      },
    });
  }
);

export default router;

