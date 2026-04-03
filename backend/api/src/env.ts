/**
 * Load `.env` before any other app modules read process.env.
 * (Imports are hoisted/evaluated before inline code in app.ts, so dotenv.config()
 * at the bottom of app.ts ran too late for services that cache env at load time.)
 */
import dotenv from "dotenv";
import path from "path";

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath, override: true });
