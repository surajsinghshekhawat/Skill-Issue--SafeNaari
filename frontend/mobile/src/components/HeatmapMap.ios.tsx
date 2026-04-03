/**
 * Heatmap Map Component (iOS Only)
 * 
 * iOS-specific version that uses react-native-maps
 * Android/Web versions should use HeatmapMapFallback instead
 * 
 * @author Women Safety Analytics Team
 * @version 2.0.0
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, Circle, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { fetchHeatmap, HeatmapCell, HeatmapData } from '../services/api';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { AlertIcon } from './AppIcons';

interface HeatmapMapProps {
  initialLatitude?: number;
  initialLongitude?: number;
  radius?: number;
  gridSize?: number;
  onError?: () => void;
  panToLocation?: { latitude: number; longitude: number } | null;
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
  if (allowed.length === 0) return prevGridSize;

  if (prevGridSize <= 50) {
    if (radiusMeters > 3000 && has(100)) return 100;
    return has(50) ? 50 : allowed[0];
  }

  if (prevGridSize <= 100) {
    if (radiusMeters < 2500 && has(50)) return 50;
    if (radiusMeters > 8000 && has(200)) return 200;
    return has(100) ? 100 : allowed[allowed.length - 1];
  }

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          const viewportRadius = (maxDim / 2.0) * 1.1;
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
        if (status !== 'granted') {
          setError('Location permission denied. Using Chennai center.');
          setLoading(false);
          // Use Chennai center as default
          applyRegionToQuery(
            {
              latitude: 13.0827,
              longitude: 80.2707,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            },
            true
          );
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
        console.error('Error getting location:', err);
      }
    })();
  }, []);

  // Pan to location when panToLocation changes (Android parity)
  useEffect(() => {
    if (panToLocation && mapRef.current) {
      const targetRegion: Region = {
        latitude: panToLocation.latitude,
        longitude: panToLocation.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
      mapRef.current.animateToRegion(targetRegion, 1000);
      applyRegionToQuery(targetRegion, true);
    }
  }, [panToLocation]);

  const loadHeatmap = useCallback(async (opts?: { background?: boolean }) => {
    try {
      const q = queryRef.current;
      const requestId = ++requestSeqRef.current;

      const isInitial = !heatmapDataRef.current;
      if (isInitial && !opts?.background) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      const response = await fetchHeatmap(
        q.latitude,
        q.longitude,
        q.radius,
        q.gridSize
      );

      if (requestId !== requestSeqRef.current) return;

      if (response.success && response.heatmap) {
        console.log('✅ Heatmap data received:', {
          cells: response.heatmap.cells?.length || 0,
          clusters: response.heatmap.clusters?.length || 0,
          center: response.heatmap.center,
          radius: response.heatmap.radius,
          gridSize: response.heatmap.grid_size,
        });
        setHeatmapData(response.heatmap);
      } else {
        console.warn('❌ Heatmap response failed:', response);
        setError('Failed to load heatmap data');
      }
    } catch (err: any) {
      console.error('Error loading heatmap:', err);
      setError(err.message || 'Failed to load heatmap. Check backend connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadHeatmap();
  }, [query.key, loadHeatmap]);

  // AUTO-REFRESH: Update heatmap every 60 seconds (stable interval; uses latest queryRef)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      loadHeatmap({ background: true });
    }, 60000);
    return () => clearInterval(refreshInterval);
  }, [loadHeatmap]);

  /**
   * iOS heatmap color mapping (matches Android)
   *
   * UI Bands:
   * - Medium:      1.0 - 2.0
   * - Medium-High: 2.0 - 4.0
   * - High:        4.0+
   *
   * NOTE: low-risk (<1.0) cells are not rendered (no green).
   */
  const interpolateColor = (
    riskScore: number
  ): { color: string; opacity: number } => {
    const clamped = Math.max(0, Math.min(5, riskScore));

    let r = 0,
      g = 0,
      b = 0;

    if (clamped < 2.0) {
      const t = Math.max(0, Math.min(1, (clamped - 1.0) / 1.0));
      // Yellow (#FACC15) -> Amber (#EAB308)
      r = Math.round(250 + (234 - 250) * t);
      g = Math.round(204 + (179 - 204) * t);
      b = Math.round(21 + (8 - 21) * t);
    } else if (clamped < 4.0) {
      const t = (clamped - 2.0) / 2.0;
      // Orange (#F97316) -> Red (#EF4444)
      r = Math.round(249 + (239 - 249) * t);
      g = Math.round(115 + (68 - 115) * t);
      b = Math.round(22 + (68 - 22) * t);
    } else {
      const t = Math.max(0, Math.min(1, (clamped - 4.0) / 1.0));
      // Red (#EF4444) -> Deep Red (#B91C1C)
      r = Math.round(239 + (185 - 239) * t);
      g = Math.round(68 + (28 - 68) * t);
      b = Math.round(68 + (28 - 68) * t);
    }

    const normalized = clamped / 5.0;
    const opacity = 0.22 + normalized * 0.48;

    return { color: `rgba(${r}, ${g}, ${b}, ${opacity})`, opacity };
  };

  const getCircleRadius = (): number => {
    return query.gridSize * 0.7;
  };

  if (mapError) {
    // If map fails, show error but don't crash
    return (
      <View style={styles.container}>
        <View style={styles.errorOverlay}>
          <AlertIcon size={32} color={colors.danger} />
          <Text style={styles.errorText}>Map unavailable. Please use list view.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {refreshing && (
        <View style={styles.refreshIndicator}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.refreshText}>Updating...</Text>
        </View>
      )}
      <MapView
        ref={mapRef}
        style={styles.map}
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

        {/* Smooth heatmap using overlapping circles (no green) */}
        {heatmapData?.cells
          ?.filter((cell: HeatmapCell) => cell.risk_score > 1.0)
          .map((cell: HeatmapCell, index: number) => {
            const { color, opacity } = interpolateColor(cell.risk_score);
            const circleRadius = getCircleRadius();
            return (
              <Circle
                key={`heatmap-cell-${cell.lat}-${cell.lng}-${index}`}
                center={{ latitude: cell.lat, longitude: cell.lng }}
                radius={circleRadius}
                fillColor={color}
                strokeColor={color}
                strokeWidth={0}
              />
            );
          })}

        {/* Cluster markers removed (consistent with Android) */}
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
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => loadHeatmap()}
          >
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
  refreshIndicator: {
    position: "absolute",
    top: spacing.md,
    left: "50%",
    transform: [{ translateX: -60 }],
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
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.white,
    marginTop: spacing.md,
    fontSize: 16,
    fontWeight: '600',
  },
  errorOverlay: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.danger,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
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
    textAlign: 'center',
    fontWeight: '500',
  },
  retryButton: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.danger,
    fontWeight: 'bold',
    fontSize: 14,
  },
});

export default HeatmapMap;

