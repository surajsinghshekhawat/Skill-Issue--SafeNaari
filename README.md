# SafeNaari

Women’s safety companion: **risk heatmaps**, **community reports**, **safe route suggestions** (Google routes + ML scoring), **panic flow**, and an **admin** dashboard for moderation.

> Hackathon / portfolio repo — configure your own API keys and database locally (see below).

## Architecture

| Layer | Tech | Role |
|--------|------|------|
| Mobile | Expo / React Native | Heatmap, reports, panic, routes, auth |
| Admin | React + Vite | Incidents, audit, analytics |
| API | Node.js + Express | Auth, reports, location, Google proxy, WebSockets |
| ML | Python + FastAPI | Heatmap, clustering, route risk analysis |

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **Python** 3.11+ (for ML)
- **PostgreSQL** (optional; API can run with reduced features without it)
- **Google Cloud** project with billing (Places, Geocoding, Routes; separate Maps SDK keys for map **tiles** on device)

## Quick start

### 1. ML service (`backend/ml`)

```bash
cd backend/ml
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. API (`backend/api`)

```bash
cd backend/api
cp .env.example .env
# Edit .env: GOOGLE_MAPS_API_KEY, ML_SERVICE_URL, optional DATABASE_URL / Twilio
npm install
npm run dev
```

API listens on **3001** by default (`http://localhost:3001`). Health: `GET /health`.

### 3. Admin (`frontend/admin`)

```bash
cd frontend/admin
npm install
```

Point Vite at your API: in `vite.config.ts`, set the `server.proxy` target to your machine’s LAN IP if testing from another device (e.g. `http://192.168.x.x:3001`).

```bash
npm run dev
```

### 4. Mobile (`frontend/mobile`)

```bash
cd frontend/mobile
npm install
```

In `src/services/api.ts`, set **`API_BASE_URL`** in the `__DEV__` branch to your computer’s **LAN IP** and port **3001** (same Wi‑Fi as the phone), or use Expo tunnel + a reachable host.

```bash
npx expo start
```

**Map tiles (Google):** enable **Maps SDK for Android / iOS** and use an app-restricted key in `app.json` (`android.config.googleMaps`, `ios.config.googleMapsApiKey`). Backend Places/Routes/Geocode use a **separate** server-friendly key in `.env`.

**Dev client / native modules:** use `expo run:android` or an EAS development build after changing native config.

## Environment variables (API)

See `backend/api/.env.example`. Important:

- **`GOOGLE_MAPS_API_KEY`** — server calls (Places, Geocoding, Routes, Directions fallback).
- **`ML_SERVICE_URL`** — e.g. `http://localhost:8000` or `http://<LAN-IP>:8000`.
- **`MOBILE_AUTH_REQUIRED`** — when `true`, mobile must send `Authorization: Bearer <token>` from login/register.
- **`DATABASE_URL`** — optional Postgres; URL-encode special characters in passwords (`@` → `%40`).

## Project layout

```
backend/api/     Express API + Socket.IO
backend/ml/      FastAPI ML service
frontend/mobile/ Expo app
frontend/admin/  Vite admin SPA
```

## Scripts (optional)

- `backend/api`: `npm run build`, `npm start` (compiled `dist/`)
- `backend/api/scripts/free-port.js` — used by `nodemon` on Windows to free port 3001 before restart

## License

MIT (see repository if `LICENSE` is added).
