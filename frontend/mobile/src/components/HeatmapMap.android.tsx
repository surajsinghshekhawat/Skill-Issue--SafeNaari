/**
 * Heatmap Map Component (Android)
 *
 * Android-specific version that uses react-native-maps with Google Maps
 * Requires Google Maps API key in app.json
 *
 * @author Women Safety Analytics Team
 * @version 2.0.0
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from "react-native";
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from "react-native-maps";
import * as Location from "expo-location";
import { fetchHeatmap, HeatmapCell, HeatmapData } from "../services/api";
import {
  initWebSocket,
  subscribeToLocation,
  subscribeToIncidents,
  unsubscribeFromLocation,
  disconnectWebSocket,
} from "../services/websocket";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { AlertIcon } from "./AppIcons";

interface HeatmapMapProps {
  initialLatitude?: number;
  initialLongitude?: number;
  radius?: number;
  gridSize?: number;
  onError?: () => void;
  panToLocation?: { latitude: number; longitude: number } | null; // Location to pan to (for navigation from reports)
}

type HeatmapQuery = {
  latitude: number;
  longitude: number;
  radius: number;
  gridSize: number;
  key: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function metersFromRegion(region: Region): { widthMeters: number; heightMeters: number } {
  const metersPerDegreeLat = 111_000;
  const latRad = (region.latitude * Math.PI) / 180.0;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(latRad);
  return {
    heightMeters: Math.abs(region.latitudeDelta) * metersPerDegreeLat,
    widthMeters: Math.abs(region.longitudeDelta) * metersPerDegreeLng,
  };
}

function chooseGridSizeMeters(
  radiusMeters: number,
  prevGridSize: number,
  maxGridSize: number
): number {
  const allowed = [50, 100, 200].filter((g) => g <= maxGridSize);
  const has = (g: number) => allowed.includes(g);

  // Fallback if maxGridSize is unusually small.
  if (allowed.length === 0) return prevGridSize;

  // Hysteresis thresholds on radius (meters) to avoid flip-flopping.
  // Smaller radius => finer grid; larger radius => coarser grid.
  if (prevGridSize <= 50) {
    if (radiusMeters > 3000 && has(100)) return 100;
    return has(50) ? 50 : allowed[0];
  }

  if (prevGridSize <= 100) {
    if (radiusMeters < 2500 && has(50)) return 50;
    if (radiusMeters > 8000 && has(200)) return 200;
    return has(100) ? 100 : allowed[allowed.length - 1];
  }

  // prevGridSize ~ 200
  if (radiusMeters < 7000 && has(100)) return 100;
  return has(200) ? 200 : allowed[allowed.length - 1];
}

function makeQueryKey(
  latitude: number,
  longitude: number,
  radius: number,
  gridSize: number
): string {
  const latK = Number(latitude).toFixed(4);
  const lngK = Number(longitude).toFixed(4);
  const rK = Math.round(Number(radius));
  return `${latK}:${lngK}:${rK}:${gridSize}`;
}

const HeatmapMap: React.FC<HeatmapMapProps> = ({
  initialLatitude = 13.0827,
  initialLongitude = 80.2707,
  radius = 1000,
  gridSize = 100,
  onError,
  panToLocation,
}) => {
  // Zoom-based resolution settings:
  // - `radius` is treated as the maximum query radius
  // - `gridSize` is treated as the coarsest grid size (we may use smaller tiers when zoomed in)
  const maxRadius = radius;
  const maxGridSize = gridSize;

  const [query, setQuery] = useState<HeatmapQuery>(() => {
    const initial = {
      latitude: initialLatitude,
      longitude: initialLongitude,
      radius: clamp(maxRadius, 1000, maxRadius),
      gridSize: maxGridSize,
    };
    return { ...initial, key: makeQueryKey(initial.latitude, initial.longitude, initial.radius, initial.gridSize) };
  });
  const queryRef = useRef<HeatmapQuery>(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const heatmapDataRef = useRef<HeatmapData | null>(null);
  useEffect(() => {
    heatmapDataRef.current = heatmapData;
  }, [heatmapData]);

  const [loading, setLoading] = useState(true); // Initial load only
  const [refreshing, setRefreshing] = useState(false); // Background refresh indicator
  const [error, setError] = useState<string | null>(null);
  const [showReportedLocation, setShowReportedLocation] = useState(false); // Track if viewing reported location
  const [mapError, setMapError] = useState(false);
  const mapRef = useRef<MapView>(null);
  const regionDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRegionRef = useRef<Region | null>(null);
  const requestSeqRef = useRef(0);

  const applyRegionToQuery = useCallback(
    (region: Region, immediate: boolean = false) => {
      pendingRegionRef.current = region;

      const apply = () => {
        const r = pendingRegionRef.current;
        if (!r) return;

        setQuery((prev) => {
          const centerLat = Number(r.latitude.toFixed(4));
          const centerLng = Number(r.longitude.toFixed(4));
          const { widthMeters, heightMeters } = metersFromRegion(r);
          const maxDim = Math.max(widthMeters, heightMeters);
          const viewportRadius = (maxDim / 2.0) * 1.1; // margin to cover edges
          const nextRadius = clamp(roundToStep(viewportRadius, 250), 1000, maxRadius);

          const nextGridSize = chooseGridSizeMeters(nextRadius, prev.gridSize, maxGridSize);
          const nextKey = makeQueryKey(centerLat, centerLng, nextRadius, nextGridSize);

          if (prev.key === nextKey) return prev;
          return {
            latitude: centerLat,
            longitude: centerLng,
            radius: nextRadius,
            gridSize: nextGridSize,
            key: nextKey,
          };
        });
      };

      if (immediate) {
        if (regionDebounceTimerRef.current) {
          clearTimeout(regionDebounceTimerRef.current);
          regionDebounceTimerRef.current = null;
        }
        apply();
        return;
      }

      if (regionDebounceTimerRef.current) {
        clearTimeout(regionDebounceTimerRef.current);
      }
      regionDebounceTimerRef.current = setTimeout(apply, 450);
    },
    [maxRadius, maxGridSize]
  );

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setError("Location permission denied. Using Chennai center.");
          setLoading(false);
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({});
        // Store user location for marker
        setUserLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        });

        // Center map on Chennai to show all incident data
        const chennaiCenter = {
          latitude: 13.0827,
          longitude: 80.2707,
        };

        mapRef.current?.animateToRegion({
          latitude: chennaiCenter.latitude,
          longitude: chennaiCenter.longitude,
          latitudeDelta: 0.15, // Wider view to show more of Chennai
          longitudeDelta: 0.15,
        });
        // Seed query params immediately (then MapView events will keep it updated)
        applyRegionToQuery(
          {
            latitude: chennaiCenter.latitude,
            longitude: chennaiCenter.longitude,
            latitudeDelta: 0.15,
            longitudeDelta: 0.15,
          },
          true
        );
      } catch (err) {
        console.error("Error getting location:", err);
      }
    })();
  }, []);

  // Pan to location when panToLocation prop changes (e.g., from report submission)
  useEffect(() => {
    if (panToLocation && mapRef.current) {
      console.log("📍 Panning to reported location:", panToLocation);
      // Enable "reported location mode" - show only risky clusters
      setShowReportedLocation(true);
      // Pan map to reported location
      const targetRegion: Region = {
        latitude: panToLocation.latitude,
        longitude: panToLocation.longitude,
        latitudeDelta: 0.02, // Zoomed in view to see the reported area
        longitudeDelta: 0.02,
      };
      mapRef.current.animateToRegion(targetRegion, 1000);
      applyRegionToQuery(targetRegion, true);
    } else {
      // Reset when panToLocation is cleared
      setShowReportedLocation(false);
    }
  }, [panToLocation]);

  const loadHeatmap = useCallback(async (opts?: { background?: boolean }) => {
    try {
      const q = queryRef.current;
      const requestId = ++requestSeqRef.current;

      // For non-initial loads, avoid blocking UI; use subtle "refreshing" indicator.
      const isInitial = !heatmapDataRef.current;
      if (isInitial && !opts?.background) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      // Pass current timestamp for time-based risk calculation
      const currentTimestamp = new Date().toISOString();

      const response = await fetchHeatmap(
        q.latitude,
        q.longitude,
        q.radius,
        q.gridSize,
        currentTimestamp // Pass current time for real-time risk calculation
      );

      if (requestId !== requestSeqRef.current) {
        // A newer request completed first; ignore stale results.
        return;
      }

      if (response.success && response.heatmap) {
        console.log("✅ Heatmap data received:", {
          cells: response.heatmap.cells?.length || 0,
          clusters: response.heatmap.clusters?.length || 0,
          center: response.heatmap.center,
          radius: response.heatmap.radius,
          gridSize: response.heatmap.grid_size,
        });
        setHeatmapData(response.heatmap);
      } else {
        console.warn("❌ Heatmap response failed:", response);
        setError("Failed to load heatmap data");
      }
      console.log(
        "✅ Heatmap loaded (time-based risk calculated at:",
        currentTimestamp,
        ")"
      );
    } catch (err: any) {
      console.error("Error loading heatmap:", err);
      setError(
        err.message || "Failed to load heatmap. Check backend connection."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load heatmap when debounced query parameters change
  useEffect(() => {
    loadHeatmap();
  }, [query.key, loadHeatmap]);

  // WebSocket: initialize once + subscribe to incidents once
  useEffect(() => {
    // Initialize WebSocket connection (reuses existing if already connected)
    initWebSocket();

    // Subscribe to new incident notifications
    subscribeToIncidents((newIncident) => {
      console.log("📢 New incident reported nearby:", newIncident.incidentId);
      console.log("📍 Incident location:", newIncident.location);
      console.log("🔄 Refreshing heatmap in 2 seconds to show new report...");
      // Refresh heatmap when new incident is reported
      // 2-second delay allows ML service to process and store the incident
      setTimeout(() => {
        console.log("🔄 Refreshing heatmap now (new report should be visible)");
        loadHeatmap();
      }, 2000); // Small delay to let ML service process the incident
    });

    // Cleanup on unmount - but DON'T disconnect WebSocket (reuse across remounts)
    return () => {
      const q = queryRef.current;
      unsubscribeFromLocation(q.latitude, q.longitude, q.radius);
      // Don't disconnect WebSocket - let it persist across component remounts
      // disconnectWebSocket(); // Commented out to prevent reconnection spam
    };
  }, [loadHeatmap]);

  // WebSocket: subscribe to the current (debounced) location room when query changes.
  useEffect(() => {
    subscribeToLocation(query.latitude, query.longitude, query.radius, (data) => {
      console.log("📡 Real-time heatmap update received via WebSocket");
      setHeatmapData(data.heatmap);
    });
  }, [query.key]);

  // AUTO-REFRESH: Update heatmap every 60 seconds (stable interval; uses latest queryRef)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      loadHeatmap({ background: true });
    }, 60000);
    return () => clearInterval(refreshInterval);
  }, [loadHeatmap]);

  /**
   * Interpolate color based on risk score for smooth gradient
   *
   * UI Bands (requested):
   * - Medium:      1.0 - 2.0
   * - Medium-High: 2.0 - 4.0
   * - High:        4.0+
   *
   * NOTE: "Low" (<1.0) is not rendered at all (filtered out), so we intentionally
   * avoid green here and keep strong contrast between Medium vs Medium-High.
   */
  const interpolateColor = (
    riskScore: number
  ): { color: string; opacity: number } => {
    const clamped = Math.max(0, Math.min(5, riskScore));

    // Colors chosen for clear contrast:
    // - Medium: yellow (distinct from orange)
    // - Medium-High: orange -> red
    // - High: red -> deep red
    let r = 0,
      g = 0,
      b = 0;

    if (clamped < 2.0) {
      // Medium band: 1.0-2.0 (rendered); keep it clearly "yellow"
      const t = Math.max(0, Math.min(1, (clamped - 1.0) / 1.0));
      // Yellow (#FACC15) -> Amber (#EAB308) (subtle shift but stays yellow)
      r = Math.round(250 + (234 - 250) * t);
      g = Math.round(204 + (179 - 204) * t);
      b = Math.round(21 + (8 - 21) * t);
    } else if (clamped < 4.0) {
      // Medium-High band: Orange (#F97316) -> Red (#EF4444)
      const t = (clamped - 2.0) / 2.0;
      r = Math.round(249 + (239 - 249) * t);
      g = Math.round(115 + (68 - 115) * t);
      b = Math.round(22 + (68 - 22) * t);
    } else {
      // High band: Red (#EF4444) -> Deep Red (#B91C1C)
      const t = Math.max(0, Math.min(1, (clamped - 4.0) / 1.0));
      r = Math.round(239 + (185 - 239) * t);
      g = Math.round(68 + (28 - 68) * t);
      b = Math.round(68 + (28 - 68) * t);
    }

    // Opacity tuned for blending (no green shown anyway)
    const normalized = clamped / 5.0;
    const opacity = 0.22 + normalized * 0.48; // ~0.22..0.70

    return {
      color: `rgba(${r}, ${g}, ${b}, ${opacity})`,
      opacity,
    };
  };

  /**
   * Get circle radius in meters (overlapping for smooth blending)
   * Radius should be larger than cell size to create overlap
   */
  const getCircleRadius = (): number => {
    // Use 70% of grid size for radius - this creates 40% overlap between adjacent circles
    // This ensures smooth blending without too much visual noise
    return query.gridSize * 0.7;
  };

  if (mapError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorOverlay}>
          <AlertIcon size={32} color={colors.danger} />
          <Text style={styles.errorText}>
            Map unavailable. Please use list view.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Subtle refresh indicator (non-blocking) */}
      {refreshing && (
        <View style={styles.refreshIndicator}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.refreshText}>Updating...</Text>
        </View>
      )}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        onMapReady={() => {
          // If tiles stay gray/blank, check Google Cloud: enable "Maps SDK for Android",
          // billing, and API key restrictions (package + SHA-1) for this build.
          console.log("HeatmapMap: MapView ready (if base map is blank, fix native Maps API key / SDK)");
        }}
        initialRegion={{
          latitude: query.latitude,
          longitude: query.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
        mapType="standard"
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={true}
        zoomEnabled={true}
        onRegionChangeComplete={(region) => {
          // If user panned significantly away from reported location, reset mode
          if (showReportedLocation && panToLocation) {
            const reportedLatDiff = Math.abs(
              region.latitude - panToLocation.latitude
            );
            const reportedLngDiff = Math.abs(
              region.longitude - panToLocation.longitude
            );
            // If panned more than ~500m away, reset to normal view
            if (reportedLatDiff > 0.0045 || reportedLngDiff > 0.0045) {
              setShowReportedLocation(false);
            }
          }

          // Debounced + tiered zoom-based query update (prevents reload spam)
          applyRegionToQuery(region);
        }}
      >
        {/* Show user location marker if we have it */}
        {userLocation && (
          <Marker
            coordinate={{
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            }}
            title="Your Location"
            pinColor={colors.primary}
          />
        )}

        {/* Smooth heatmap using overlapping circles with continuous color interpolation */}
        {/* Only show risky cells - NO green safe cells */}
        {heatmapData?.cells && heatmapData.cells.length > 0
          ? (() => {
              // Pre-filter and validate cells before rendering to avoid MapView index issues
              const validCells = heatmapData.cells
                .filter((cell: HeatmapCell) => {
                  // NO GREEN CELLS - only show cells with significant risk
                  if (!cell || typeof cell.risk_score !== 'number' || cell.risk_score <= 1.0) {
                    return false;
                  }
                  // Validate coordinates
                  return (
                    typeof cell.lat === 'number' &&
                    typeof cell.lng === 'number' &&
                    !isNaN(cell.lat) &&
                    !isNaN(cell.lng) &&
                    isFinite(cell.lat) &&
                    isFinite(cell.lng) &&
                    cell.lat >= -90 &&
                    cell.lat <= 90 &&
                    cell.lng >= -180 &&
                    cell.lng <= 180
                  );
                })
                .slice(0, 1000); // Limit to prevent MapView overflow

              return validCells.map((cell: HeatmapCell, index: number) => {
                try {
                  const { color, opacity } = interpolateColor(cell.risk_score);
                  const circleRadius = getCircleRadius();

                  return (
                    <Circle
                      key={`heatmap-${cell.lat.toFixed(6)}-${cell.lng.toFixed(6)}-${index}`}
                      center={{
                        latitude: cell.lat,
                        longitude: cell.lng,
                      }}
                      radius={circleRadius}
                      fillColor={color}
                      strokeColor={color}
                      strokeWidth={0}
                    />
                  );
                } catch (error) {
                  console.warn('Error rendering heatmap cell:', error);
                  return null;
                }
              }).filter(Boolean);
            })()
          : null}

        {/* Cluster markers removed - only heatmap cells shown */}
      </MapView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading heatmap...</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.errorOverlay}>
          <AlertIcon size={32} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorSubtext}>
            Make sure ML service is running: cd backend/ml && uvicorn
            app.main:app
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadHeatmap()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: colors.white,
    marginTop: spacing.md,
    fontSize: 16,
    fontWeight: "600",
  },
  errorOverlay: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.danger,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  errorText: {
    color: colors.white,
    fontSize: 14,
    marginBottom: spacing.md,
    textAlign: "center",
    fontWeight: "500",
  },
  errorSubtext: {
    color: colors.white,
    fontSize: 12,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.danger,
    fontWeight: "bold",
    fontSize: 14,
  },
  refreshIndicator: {
    position: "absolute",
    top: spacing.md,
    left: "50%",
    transform: [{ translateX: -60 }], // Center horizontally
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  refreshText: {
    color: colors.text,
    fontSize: 12,
    marginLeft: spacing.xs,
    fontWeight: "500",
  },
  noDataOverlay: {
    position: "absolute",
    top: "50%",
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  noDataText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});

export default HeatmapMap;
