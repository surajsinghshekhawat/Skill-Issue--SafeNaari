/**
 * Route Planning Screen
 * 
 * Allows users to plan safe routes between two locations with location search
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Platform,
  Modal,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { getSafeRoutes, SafeRoute, RouteWaypoint, searchPlaces, getPlaceCoordinates } from '../services/api';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { ShieldIcon, LocationIcon, MapIcon, OpenIcon, AlertIcon, CloseIcon } from '../components/AppIcons';

function getNotifications(): any | null {
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

export default function RoutePlanningScreen() {
  const [startLocation, setStartLocation] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [endLocation, setEndLocation] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [routes, setRoutes] = useState<SafeRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ placeId: string; description: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [searchType, setSearchType] = useState<'start' | 'end' | null>(null);
  const mapRef = useRef<MapView>(null);

  // Get current location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location permission is required for route planning');
          return;
        }

        const location = await Location.getCurrentPositionAsync({});
        const loc = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          name: 'Current Location',
        };
        setCurrentLocation(loc);
        setStartLocation(loc);

        // Center map on current location
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: loc.lat,
            longitude: loc.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }
      } catch (error) {
        console.error('Error getting location:', error);
      }
    })();
  }, []);


  const handleSearch = async (query: string, type: 'start' | 'end') => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setSearchType(type);
    try {
      console.log('🔍 Searching places for:', query, 'type:', type);
      const results = await searchPlaces(query, currentLocation || undefined);
      console.log('🔍 Search results received:', results.length, 'results');
      setSearchResults(results);
      if (results.length === 0 && query.length >= 3) {
        console.warn('⚠️ No results found for query:', query);
      }
    } catch (error) {
      console.error('❌ Error searching places:', error);
      Alert.alert('Error', 'Failed to search locations. Please check your internet connection.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPlace = async (place: { placeId: string; description: string }) => {
    try {
      const coordinates = await getPlaceCoordinates(place.placeId);
      const location = {
        lat: coordinates.lat,
        lng: coordinates.lng,
        name: place.description,
      };

      if (searchType === 'start') {
        setStartLocation(location);
      } else {
        setEndLocation(location);
      }

      setSearchQuery('');
      setSearchResults([]);
      setSearchType(null);

      // Pan map to selected location
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: location.lat,
          longitude: location.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } catch (error) {
      console.error('Error getting place coordinates:', error);
      Alert.alert('Error', 'Failed to get location coordinates');
    }
  };

  const handleUseCurrentLocation = (type: 'start' | 'end') => {
    if (currentLocation) {
      const loc = { ...currentLocation, name: 'Current Location' };
      if (type === 'start') {
        setStartLocation(loc);
      } else {
        setEndLocation(loc);
      }
    }
  };

  const handleFindRoutes = async () => {
    if (!startLocation || !endLocation) {
      Alert.alert('Missing Locations', 'Please select both start and end locations');
      return;
    }

    setLoading(true);
    setRoutes([]);
    setSelectedRoute(null);

    try {
      const response = await getSafeRoutes(
        startLocation.lat,
        startLocation.lng,
        endLocation.lat,
        endLocation.lng
      );

      if (response.success && response.routes.routes.length > 0) {
        setRoutes(response.routes.routes);
        setSelectedRoute(response.routes.recommendedRoute || response.routes.routes[0].id);

        // Fit map to show both locations and routes
        if (mapRef.current && response.routes.routes.length > 0) {
          const allWaypoints: RouteWaypoint[] = [];
          response.routes.routes.forEach((route) => {
            if (route && route.waypoints && Array.isArray(route.waypoints)) {
              allWaypoints.push(...route.waypoints.filter(
                (w) => w && typeof w.lat === 'number' && typeof w.lng === 'number' &&
                       !isNaN(w.lat) && !isNaN(w.lng)
              ));
            }
          });

          const validCoordinates = allWaypoints
            .filter((w) => w.lat >= -90 && w.lat <= 90 && w.lng >= -180 && w.lng <= 180)
            .map((w) => ({ latitude: w.lat, longitude: w.lng }));

          if (validCoordinates.length > 0) {
            try {
              mapRef.current.fitToCoordinates(validCoordinates, {
                edgePadding: { top: 100, right: 50, bottom: 200, left: 50 },
                animated: true,
              });
            } catch (error) {
              console.error('Error fitting map to coordinates:', error);
            }
          }
        }

      } else {
        Alert.alert('No Routes Found', 'Could not find routes between the selected locations');
      }
    } catch (error: any) {
      console.error('Error finding routes:', error);
      Alert.alert('Error', error.message || 'Failed to find routes');
    } finally {
      setLoading(false);
    }
  };

  const getRouteColor = (route: SafeRoute): string => {
    if (route.id === selectedRoute) {
      return colors.primary; // Selected route - primary color
    }
    // Color based on safety score
    if (route.safetyScore >= 0.7) return '#4CAF50'; // Green - safe
    if (route.safetyScore >= 0.4) return '#FF9800'; // Orange - moderate
    return '#F44336'; // Red - risky
  };


  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds} sec`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `~${mins} min`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (remainMins === 0) return `~${hrs} hr`;
    return `~${hrs}h ${remainMins}m`;
  };

  const formatSafetyScore = (score: number): string => {
    return `${Math.round(score * 100)}%`;
  };

  const openRouteInGoogleMaps = () => {
    const route = routes.find((r) => r.id === selectedRoute);
    if (!route || !route.waypoints || route.waypoints.length < 2 || !startLocation || !endLocation) {
      Alert.alert('No Route', 'Please select a route first');
      return;
    }
    const isRisky = (route.riskScore ?? 0) >= 3.5 || (route.highRiskSegments?.length || 0) > 0;

    const proceed = async () => {
      if (isRisky) {
        try {
          const Notifications = getNotifications();
          if (Notifications?.scheduleNotificationAsync) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'Route warning',
                body: 'This route includes high-risk segments. Stay alert and consider alternatives.',
                sound: true,
                priority: Notifications.AndroidNotificationPriority?.HIGH,
              },
              trigger: null,
            });
          }
        } catch {
          // ignore
        }
      }

      const maxWaypoints = 25;
      const pts = route.waypoints;
      let waypointsStr = '';
      if (pts.length > 2) {
        const step = Math.max(1, Math.floor((pts.length - 2) / (maxWaypoints - 2)));
        const sampled: typeof pts = [];
        for (let i = 1; i < pts.length - 1; i += step) {
          sampled.push(pts[i]);
          if (sampled.length >= maxWaypoints - 2) break;
        }
        waypointsStr = sampled.map((p) => `${p.lat},${p.lng}`).join('|');
      }
      const origin = `${startLocation.lat},${startLocation.lng}`;
      const dest = `${endLocation.lat},${endLocation.lng}`;
      const base = 'https://www.google.com/maps/dir/?api=1';
      const params = new URLSearchParams({
        origin,
        destination: dest,
        travelmode: 'driving',
      });
      if (waypointsStr) params.set('waypoints', waypointsStr);
      const url = `${base}&${params.toString()}`;
      Linking.openURL(url).catch(() => {
        Alert.alert('Error', 'Could not open Google Maps');
      });
    };

    if (isRisky) {
      Alert.alert(
        'Route warning',
        'This route includes high-risk segments. Do you still want to open it in Google Maps?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open anyway', style: 'destructive', onPress: () => void proceed() },
        ]
      );
      return;
    }
    void proceed();
  };

  // Helper function to validate coordinates
  const isValidCoordinate = (lat: number, lng: number): boolean => {
    return (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      !isNaN(lat) &&
      !isNaN(lng) &&
      isFinite(lat) &&
      isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  };

  // Pre-process routes to avoid conditional rendering issues
  const renderRoutes = () => {
    if (!routes || routes.length === 0) return [];

    const validRoutes: Array<{ route: SafeRoute; coordinates: Array<{ latitude: number; longitude: number }> }> = [];

    for (const route of routes.slice(0, 5)) {
      if (!route || !route.id || !route.waypoints || !Array.isArray(route.waypoints) || route.waypoints.length < 2) {
        continue;
      }

      try {
        const validCoordinates = route.waypoints
          .filter((w) => w && typeof w === 'object' && isValidCoordinate(w.lat, w.lng))
          .slice(0, 500)
          .map((w) => ({
            latitude: Number(w.lat),
            longitude: Number(w.lng),
          }));

        if (validCoordinates.length >= 2) {
          validRoutes.push({ route, coordinates: validCoordinates });
        }
      } catch (error) {
        console.warn('Error processing route:', error);
        continue;
      }
    }

    return validRoutes.map((item, index) => (
      <Polyline
        key={`route-${item.route.id}-${index}`}
        coordinates={item.coordinates}
        strokeColor={getRouteColor(item.route)}
        strokeWidth={item.route.id === selectedRoute ? 5 : 3}
        lineDashPattern={item.route.id === selectedRoute ? undefined : [5, 5]}
      />
    ));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* SafeNaari header */}
      <View style={styles.header}>
        <ShieldIcon size={28} />
        <View>
          <Text style={styles.headerTitle}>Safe Routes</Text>
          <Text style={styles.headerSubtitle}>Find the safest path to your destination</Text>
        </View>
      </View>
      
      {/* Search inputs at top */}
      <View style={styles.searchContainer}>
        {/* Start location search */}
        <View style={styles.searchCard}>
          <View style={styles.searchIconContainer}>
            <LocationIcon size={20} />
          </View>
          <View style={styles.searchInputContainer}>
            <Text style={styles.searchLabel}>From</Text>
            <TextInput
              style={styles.searchInputTop}
              placeholder="Current Location"
              placeholderTextColor={colors.textTertiary}
              value={searchType === 'start' ? searchQuery : (startLocation?.name || 'Your location')}
              onChangeText={(text) => {
                setSearchQuery(text);
                handleSearch(text, 'start');
              }}
              onFocus={() => {
                setSearchType('start');
                setSearchQuery('');
              }}
            />
          </View>
          {!startLocation && currentLocation && (
            <TouchableOpacity
              style={styles.useCurrentButtonTop}
              onPress={() => handleUseCurrentLocation('start')}
            >
              <LocationIcon size={16} />
            </TouchableOpacity>
          )}
          {startLocation && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setStartLocation(null)}
            >
              <CloseIcon size={20} />
            </TouchableOpacity>
          )}
        </View>

        {/* End location search */}
        <View style={styles.searchCard}>
          <View style={styles.searchIconContainer}>
            <MapIcon size={20} />
          </View>
          <View style={styles.searchInputContainer}>
            <Text style={styles.searchLabel}>To</Text>
            <TextInput
              style={styles.searchInputTop}
              placeholder="Where to?"
              placeholderTextColor={colors.textTertiary}
              value={searchType === 'end' ? searchQuery : (endLocation?.name || '')}
              onChangeText={(text) => {
                setSearchQuery(text);
                handleSearch(text, 'end');
              }}
              onFocus={() => {
                setSearchType('end');
                setSearchQuery('');
              }}
            />
          </View>
          {!endLocation && currentLocation && (
            <TouchableOpacity
              style={styles.useCurrentButtonTop}
              onPress={() => handleUseCurrentLocation('end')}
            >
              <LocationIcon size={16} />
            </TouchableOpacity>
          )}
          {endLocation && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setEndLocation(null)}
            >
              <CloseIcon size={20} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search results dropdown */}
        {searchType && searchResults.length > 0 && (
          <View style={styles.searchResultsTop}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.placeId}
                style={styles.searchResultItemTop}
                onPress={() => handleSelectPlace(item)}
              >
                <Text style={styles.searchResultTextTop}>{item.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        {/* Show error message if Google Places API fails */}
        {searchType && searchQuery.length >= 2 && searchResults.length === 0 && searching === false && (
          <View style={styles.errorMessage}>
            <AlertIcon size={18} color={colors.warning} />
            <Text style={styles.errorText}>
              Location search unavailable. Please enable billing for Google Places API or use map pins to select locations.
            </Text>
          </View>
        )}

      </View>

      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={
            currentLocation
              ? {
                  latitude: currentLocation.lat,
                  longitude: currentLocation.lng,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }
              : undefined
          }
        >
          {/* Start marker - draggable */}
          {startLocation &&
            typeof startLocation.lat === 'number' &&
            typeof startLocation.lng === 'number' &&
            !isNaN(startLocation.lat) &&
            !isNaN(startLocation.lng) &&
            isFinite(startLocation.lat) &&
            isFinite(startLocation.lng) &&
            startLocation.lat >= -90 &&
            startLocation.lat <= 90 &&
            startLocation.lng >= -180 &&
            startLocation.lng <= 180 && (
              <Marker
                coordinate={{ latitude: startLocation.lat, longitude: startLocation.lng }}
                pinColor={colors.success}
                title="Start"
                description={startLocation.name || 'Start Location'}
                draggable
                onDragEnd={(e) => {
                  const newLocation = {
                    lat: e.nativeEvent.coordinate.latitude,
                    lng: e.nativeEvent.coordinate.longitude,
                    name: startLocation.name || 'Start Location',
                  };
                  setStartLocation(newLocation);
                }}
              />
            )}

          {/* End marker - draggable */}
          {endLocation &&
            typeof endLocation.lat === 'number' &&
            typeof endLocation.lng === 'number' &&
            !isNaN(endLocation.lat) &&
            !isNaN(endLocation.lng) &&
            isFinite(endLocation.lat) &&
            isFinite(endLocation.lng) &&
            endLocation.lat >= -90 &&
            endLocation.lat <= 90 &&
            endLocation.lng >= -180 &&
            endLocation.lng <= 180 && (
              <Marker
                coordinate={{ latitude: endLocation.lat, longitude: endLocation.lng }}
                pinColor={colors.danger}
                title="End"
                description={endLocation.name || 'End Location'}
                draggable
                onDragEnd={(e) => {
                  const newLocation = {
                    lat: e.nativeEvent.coordinate.latitude,
                    lng: e.nativeEvent.coordinate.longitude,
                    name: endLocation.name || 'End Location',
                  };
                  setEndLocation(newLocation);
                }}
              />
            )}

          {/* Route polylines */}
          {renderRoutes()}
        </MapView>
      </View>

      <View style={styles.controlsContainer}>
        <ScrollView style={styles.controls} showsVerticalScrollIndicator={false}>
          {/* Find routes button */}
          <TouchableOpacity
            style={[styles.findButton, (!startLocation || !endLocation) && styles.findButtonDisabled]}
            onPress={handleFindRoutes}
            disabled={!startLocation || !endLocation || loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.findButtonText}>Find Safe Routes</Text>
            )}
          </TouchableOpacity>

          {/* Route options only - no directions inside cards */}
          {routes.length > 0 && (
            <View style={styles.routesContainer}>
              <Text style={styles.routesTitle}>Route Options ({routes.length})</Text>
              {routes.map((route) => (
                <TouchableOpacity
                  key={route.id}
                  style={[
                    styles.routeCard,
                    route.id === selectedRoute && styles.routeCardSelected,
                  ]}
                  onPress={() => setSelectedRoute(route.id)}
                >
                  <View style={styles.routeHeader}>
                    <Text style={styles.routeId}>
                      {route.id === selectedRoute ? '✓ ' : ''}
                      {route.id.replace('route_', 'Route ').replace('_', ' ')}
                    </Text>
                    {route.id === (routes.find((r) => r.safetyScore === Math.max(...routes.map((r) => r.safetyScore)))?.id) && (
                      <Text style={styles.recommendedBadge}>Recommended</Text>
                    )}
                  </View>
                  <View style={styles.routeMetrics}>
                    <View style={styles.metric}>
                      <Text style={styles.metricLabel}>Safety</Text>
                      <Text style={[styles.metricValue, { color: getRouteColor(route) }]}>
                        {formatSafetyScore(route.safetyScore)}
                      </Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.metricLabel}>Distance</Text>
                      <Text style={styles.metricValue}>{formatDistance(route.distance)}</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.metricLabel}>Time</Text>
                      <Text style={styles.metricValue}>
                        {route.duration ? formatDuration(route.duration) : '—'}
                      </Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.metricLabel}>Risk</Text>
                      <Text style={styles.metricValue}>{route.riskScore.toFixed(1)}/5</Text>
                    </View>
                  </View>
                  {route.highRiskSegments.length > 0 && (
                    <View style={styles.warningRow}>
                      <AlertIcon size={16} color={colors.warning} />
                      <Text style={styles.warningText}>
                        {route.highRiskSegments.length} high-risk segment(s)
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Directions for selected route - only after user selects a route */}
          {routes.length > 0 && selectedRoute && (() => {
            const route = routes.find((r) => r.id === selectedRoute);
            if (!route || !route.instructions || route.instructions.length === 0) return null;
            return (
              <View style={styles.directionsBlock}>
                <View style={styles.directionsTitleRow}>
                  <LocationIcon size={16} />
                  <Text style={styles.directionsTitle}>Directions</Text>
                </View>
                {route.instructions.slice(0, 15).map((step, idx) => (
                  <View key={idx} style={styles.directionStep}>
                    <Text style={styles.directionNumber}>{idx + 1}.</Text>
                    <Text style={styles.directionText}>{step.instruction}</Text>
                    {step.distanceMeters != null && (
                      <Text style={styles.directionDistance}>
                        {formatDistance(step.distanceMeters)}
                      </Text>
                    )}
                  </View>
                ))}
                {route.instructions.length > 15 && (
                  <Text style={styles.directionMore}>
                    +{route.instructions.length - 15} more steps
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.navigateButton}
                  onPress={openRouteInGoogleMaps}
                >
                  <OpenIcon size={20} color={colors.primary} />
                  <View>
                    <Text style={styles.navigateButtonText}>Navigate in Google Maps</Text>
                    <Text style={styles.navigateButtonSubtext}>Opens this exact safe route</Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })()}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logoIcon: { fontSize: 28 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: colors.primary },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  searchContainer: {
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIconContainer: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  searchIcon: {
    fontSize: 20,
  },
  searchInputContainer: {
    flex: 1,
  },
  searchLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  searchInputTop: {
    fontSize: 16,
    color: colors.text,
    padding: 0,
  },
  clearButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  clearButtonText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  searchResultsTop: {
    maxHeight: 200,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  errorMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning + '20',
    borderRadius: 8,
    padding: spacing.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.warning,
    marginLeft: spacing.sm,
  },
  searchResultItemTop: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultTextTop: {
    fontSize: 14,
    color: colors.text,
  },
  useCurrentButtonTop: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    marginLeft: spacing.xs,
  },
  useCurrentTextTop: {
    fontSize: 16,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  controlsContainer: {
    maxHeight: 350,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  controls: {
    padding: spacing.md,
  },
  findButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  findButtonDisabled: {
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  findButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  navigateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#34A853',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  navigateButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  navigateButtonSubtext: {
    color: colors.text,
    fontSize: 12,
    opacity: 0.9,
    marginTop: 2,
  },
  routesContainer: {
    marginTop: spacing.xs,
  },
  routesTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  routeCard: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: colors.border,
  },
  routeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.backgroundSecondary,
  },
  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  routeId: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  recommendedBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
    backgroundColor: colors.success + '20',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  routeMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xs,
  },
  metric: {
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  warningText: {
    fontSize: 12,
    color: colors.danger,
  },
  directionsSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  directionsBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  directionsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  directionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  directionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  directionNumber: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 20,
  },
  directionText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  directionDistance: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: spacing.xs,
  },
  directionMore: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
});
