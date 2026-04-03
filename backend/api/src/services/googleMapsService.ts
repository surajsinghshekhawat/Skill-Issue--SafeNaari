/**
 * Google Maps Service
 *
 * Handles Google Maps Directions API calls for route planning
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import axios from "axios";

/** Read at call time so `.env` is loaded first (see `src/env.ts`). */
function googleMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || "").trim();
}

function logMapsKeyHint(context: string): void {
  const key = googleMapsApiKey();
  const ok = key.length > 0;
  console.warn(
    `[Google Maps] ${context} — key ${ok ? `set (${key.length} chars)` : "MISSING or empty"}`
  );
  if (!ok) {
    console.warn("[Google Maps] Add GOOGLE_MAPS_API_KEY to backend/api/.env (no quotes) and restart the API.");
  }
}

function logRequestDeniedHints(errorMessage?: string): void {
  console.warn("[Google Maps] REQUEST_DENIED — Google rejected this key for this request.");
  if (errorMessage) console.warn("[Google Maps] Detail:", errorMessage);
  console.warn(
    "[Google Maps] Fix checklist (same GCP project as the key): (1) APIs & Services → Enable “Places API” and “Geocoding API”. (2) Billing enabled on that project. (3) Credentials → your key → Application restrictions: use “None” for dev, or “IP addresses” with this machine’s public IP — not Android/iOS only (this server calls Google from Node, not the phone app). (4) API restrictions: “Don’t restrict” or include Places + Geocoding + Routes."
  );
}
// Routes API (new) - legacy Directions API is deprecated
const GOOGLE_MAPS_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_MAPS_PLACES_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const GOOGLE_MAPS_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
// Legacy Directions API fallback (returns more alternative routes in practice, even though deprecated).
const GOOGLE_MAPS_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

/**
 * Decode Google Maps encoded polyline
 * Based on algorithm from: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      lat: lat * 1e-5,
      lng: lng * 1e-5,
    });
  }

  return points;
}

export interface RouteInstruction {
  instruction: string;
  maneuver?: string;
  distanceMeters?: number;
}

export interface RouteOption {
  id: string;
  waypoints: Array<{ lat: number; lng: number }>;
  distance?: number; // meters
  duration?: number; // seconds
  summary?: string;
  instructions?: RouteInstruction[];
}

/**
 * Get route options from Google Routes API (replaces legacy Directions API)
 */
export async function getRouteOptions(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  alternatives: boolean = true
): Promise<RouteOption[]> {
  try {
    if (!googleMapsApiKey()) {
      logMapsKeyHint("getRouteOptions");
      return [
        {
          id: "route_direct",
          waypoints: [
            { lat: startLat, lng: startLng },
            { lat: endLat, lng: endLng },
          ],
        },
      ];
    }

    console.log("🗺️ Requesting route from Google Routes API:", {
      origin: `${startLat},${startLng}`,
      destination: `${endLat},${endLng}`,
      mode: "DRIVE",
      alternatives,
    });

    const response = await axios.post(
      GOOGLE_MAPS_ROUTES_URL,
      {
        origin: {
          location: { latLng: { latitude: startLat, longitude: startLng } },
        },
        destination: {
          location: { latLng: { latitude: endLat, longitude: endLng } },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: alternatives,
        polylineQuality: "OVERVIEW",
        polylineEncoding: "ENCODED_POLYLINE",
        languageCode: "en-IN",
        units: "METRIC",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleMapsApiKey(),
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs,routes.localizedValues,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters",
        },
        timeout: 15000,
      }
    );

    const routeData = response.data.routes || [];
    console.log(`🗺️ Routes API: received ${routeData.length} route(s)`);

    if (routeData.length === 0) {
      console.warn("⚠️ No routes returned, using direct line fallback");
      return [
        {
          id: "route_direct",
          waypoints: [
            { lat: startLat, lng: startLng },
            { lat: endLat, lng: endLng },
          ],
        },
      ];
    }

    const routes: RouteOption[] = [];

    for (let i = 0; i < routeData.length; i++) {
      const route = routeData[i];
      let waypoints: Array<{ lat: number; lng: number }> = [];

      // Routes API returns polyline in routes[].polyline.encodedPolyline
      const encodedPolyline = route.polyline?.encodedPolyline;
      if (encodedPolyline) {
        waypoints = decodePolyline(encodedPolyline);
        console.log(`🗺️ Route ${i + 1}: Decoded ${waypoints.length} waypoints from polyline`);
      }

      if (waypoints.length === 0) {
        waypoints = [
          { lat: startLat, lng: startLng },
          { lat: endLat, lng: endLng },
        ];
      }

      // Parse duration (e.g. "165s" -> seconds)
      let durationSeconds: number | undefined;
      if (route.duration && typeof route.duration === "string") {
        durationSeconds = parseInt(route.duration.replace("s", ""), 10);
      }

      // Extract turn-by-turn instructions from legs/steps
      const instructions: RouteInstruction[] = [];
      const legs = route.legs || [];
      for (const leg of legs) {
        const steps = leg.steps || [];
        for (const step of steps) {
          const nav = step.navigationInstruction;
          if (nav?.instructions) {
            instructions.push({
              instruction: nav.instructions,
              maneuver: nav.maneuver,
              distanceMeters: step.distanceMeters,
            });
          }
        }
      }

      const routeId = `route_${i === 0 ? "primary" : `alternative_${i}`}`;
      const routeOption: RouteOption = {
        id: routeId,
        waypoints,
        distance: route.distanceMeters,
        summary: route.description || `Route ${i + 1}`,
      };
      if (durationSeconds !== undefined) routeOption.duration = durationSeconds;
      if (instructions.length > 0) routeOption.instructions = instructions;
      routes.push(routeOption);

      console.log(
        `✅ Route ${i + 1} (${routeId}): ${waypoints.length} waypoints, ${route.distanceMeters || 0}m`
      );
    }

    // Google Routes API does not guarantee alternatives even when requested.
    // If only 1 route is returned, try legacy Directions API with alternatives=true to surface more options.
    if (alternatives && routes.length < 2) {
      const legacy = await getLegacyDirectionsAlternatives(startLat, startLng, endLat, endLng).catch(() => []);
      if (legacy.length > 0) {
        const seen = new Set<string>(routes.map((r) => r.id));
        for (const r of legacy) {
          if (!seen.has(r.id)) routes.push(r);
        }
        console.log(`🧭 Directions API fallback added ${legacy.length} route(s); total now ${routes.length}`);
      }
    }

    return routes;
  } catch (error: any) {
    console.error("Google Routes API request failed:", error.message);
    if (error.response?.data) {
      console.error("Routes API error details:", JSON.stringify(error.response.data));
    }
    // Fallback to simple direct route
    return [
      {
        id: "route_direct",
        waypoints: [
          { lat: startLat, lng: startLng },
          { lat: endLat, lng: endLng },
        ],
      },
    ];
  }
}

async function getLegacyDirectionsAlternatives(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<RouteOption[]> {
  const key = googleMapsApiKey();
  if (!key) return [];

  console.log("🧭 Fallback: requesting alternatives from legacy Directions API");
  const response = await axios.get(GOOGLE_MAPS_DIRECTIONS_URL, {
    params: {
      origin: `${startLat},${startLng}`,
      destination: `${endLat},${endLng}`,
      alternatives: "true",
      mode: "driving",
      key,
    },
    timeout: 15000,
  });

  const status = response?.data?.status;
  const routes = Array.isArray(response?.data?.routes) ? response.data.routes : [];
  if (status !== "OK" || routes.length === 0) {
    console.warn("🧭 Directions API returned no routes:", status, response?.data?.error_message);
    return [];
  }

  const out: RouteOption[] = [];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const encoded = r?.overview_polyline?.points;
    const waypoints = encoded ? decodePolyline(String(encoded)) : [{ lat: startLat, lng: startLng }, { lat: endLat, lng: endLng }];

    // Directions duration is in seconds inside legs[].duration.value
    let durationSeconds: number | undefined;
    let distanceMeters: number | undefined;
    const legs = Array.isArray(r?.legs) ? r.legs : [];
    if (legs[0]?.duration?.value) durationSeconds = Number(legs[0].duration.value);
    if (legs[0]?.distance?.value) distanceMeters = Number(legs[0].distance.value);

    // Lightweight instructions: strip HTML from steps.
    const instructions: RouteInstruction[] = [];
    const steps = Array.isArray(legs[0]?.steps) ? legs[0].steps : [];
    for (const s of steps) {
      const html = s?.html_instructions ? String(s.html_instructions) : "";
      const text = html ? html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      if (!text) continue;
      const ri: RouteInstruction = { instruction: text };
      if (s?.distance?.value) ri.distanceMeters = Number(s.distance.value);
      instructions.push(ri);
    }

    const opt: RouteOption = {
      id: `route_directions_${i === 0 ? "primary" : `alternative_${i}`}`,
      waypoints,
      summary: r?.summary ? String(r.summary) : `Directions route ${i + 1}`,
    };
    if (typeof distanceMeters === "number" && Number.isFinite(distanceMeters)) opt.distance = distanceMeters;
    if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) opt.duration = durationSeconds;
    if (instructions.length) opt.instructions = instructions;
    out.push(opt);
  }

  return out;
}

/**
 * Search for places using Google Places Autocomplete
 */
export async function searchPlaces(query: string, location?: { lat: number; lng: number }): Promise<Array<{ placeId: string; description: string; lat?: number; lng?: number }>> {
  try {
    if (!googleMapsApiKey()) {
      logMapsKeyHint("searchPlaces");
      return [];
    }

    const params: any = {
      input: query,
      key: googleMapsApiKey(),
      // Remove types restriction to get all results like Google Maps app
      // This will return establishments, addresses, and points of interest
    };

    // Add location bias if provided (prioritize results near user)
    if (location) {
      params.location = `${location.lat},${location.lng}`;
      params.radius = 50000; // 50km radius
    }

    const response = await axios.get(GOOGLE_MAPS_PLACES_URL, {
      params,
      timeout: 10000, // Increased timeout
    });

    console.log("Google Places API response status:", response.data.status);
    console.log("Google Places API predictions count:", response.data.predictions?.length || 0);

    if (response.data.status !== "OK" && response.data.status !== "ZERO_RESULTS") {
      console.error("Google Places API error:", response.data.status, response.data.error_message);
      if (response.data.status === "REQUEST_DENIED") {
        logMapsKeyHint("after REQUEST_DENIED");
        logRequestDeniedHints(response.data.error_message);
      }
      return [];
    }

    const results = (response.data.predictions || []).map((prediction: any) => ({
      placeId: prediction.place_id,
      description: prediction.description,
    }));

    console.log("Google Places API returning", results.length, "results");
    return results;
  } catch (error: any) {
    console.error("Google Places API request failed:", error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
    }
    return [];
  }
}

/**
 * Get coordinates from place ID
 */
export async function getPlaceCoordinates(placeId: string): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!googleMapsApiKey()) {
      logMapsKeyHint("getPlaceCoordinates");
      return null;
    }

    const response = await axios.get(GOOGLE_MAPS_GEOCODE_URL, {
      params: {
        place_id: placeId,
        key: googleMapsApiKey(),
      },
      timeout: 5000,
    });

    if (response.data.status !== "OK" || !response.data.results || response.data.results.length === 0) {
      return null;
    }

    const location = response.data.results[0].geometry?.location;
    if (location) {
      return {
        lat: location.lat,
        lng: location.lng,
      };
    }

    return null;
  } catch (error: any) {
    console.error("Google Geocoding API request failed:", error.message);
    return null;
  }
}
