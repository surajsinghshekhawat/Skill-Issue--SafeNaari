/**
 * Home Screen — SafeNaari
 * Main screen with safety heatmap. Map logic unchanged.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, StatusBar, Platform, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { ShieldIcon, InfoIcon, LocationIcon, NavigateIcon } from '../components/AppIcons';
import HeatmapMapFallback from '../components/HeatmapMapFallback';
import { isSafetyAlertsEnabled, startSafetyAlerts, stopSafetyAlerts, subscribeToSafetyAlerts } from '../services/safetyAlerts';
import { startBackgroundSafetyTracking, stopBackgroundSafetyTracking } from '../services/locationTask';
import { getStoredUserId, updateLocation } from '../services/api';
import * as Location from 'expo-location';

let HeatmapMap: any = null;
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    if (Platform.OS === 'android') {
      HeatmapMap = require('../components/HeatmapMap.android').default;
    } else if (Platform.OS === 'ios') {
      HeatmapMap = require('../components/HeatmapMap.ios').default;
    }
  } catch (e) {
    console.warn('HeatmapMap not available, using fallback:', e);
  }
}

type HomeScreenRouteProp = RouteProp<{ params?: { panToLocation?: { latitude: number; longitude: number } } }, 'params'>;

export default function HomeScreen() {
  const [mapAvailable, setMapAvailable] = useState(true);
  const route = useRoute<HomeScreenRouteProp>();
  const navigation = useNavigation();
  const panToLocation = route.params?.panToLocation || null;
  const [alertsEnabled, setAlertsEnabled] = useState(isSafetyAlertsEnabled());
  const [currentAddress, setCurrentAddress] = useState<string>('Loading...');
  const [lastRiskScore, setLastRiskScore] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [riskBanner, setRiskBanner] = useState<{ visible: boolean; score: number; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setCurrentAddress('Location permission denied');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        // Reverse geocode is best-effort; always fall back to coordinates.
        let addr = `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`;
        try {
          const places = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          const p = places?.[0];
          const pretty = p ? [p.name, p.street, p.city, p.region].filter(Boolean).join(', ') : "";
          if (pretty) addr = pretty;
        } catch {
          // keep coords fallback
        }
        setCurrentAddress(addr);

        // Risk score requires a signed-in session when MOBILE_AUTH_REQUIRED is on.
        // Do not fail the whole location UI if this returns 401.
        try {
          const uid = (await getStoredUserId()) || 'user_anon';
          const res = await updateLocation(
            uid,
            loc.coords.latitude,
            loc.coords.longitude,
            loc.coords.accuracy ?? undefined
          );
          const score = res?.riskAssessment?.riskScore;
          if (typeof score === 'number') setLastRiskScore(score);
        } catch (e: any) {
          const msg = String(e?.message || '');
          if (msg.includes('401')) {
            setLastRiskScore(null);
          }
          console.warn('Home: risk/location API skipped:', msg);
        }
      } catch {
        setCurrentAddress('Current location unavailable');
      }
    })();
    const unsub = subscribeToSafetyAlerts((e) => {
      if (e.type === 'risk:update') {
        setLastRiskScore(e.riskScore);
        if (typeof e.riskScore === 'number' && e.riskScore >= 3.5) {
          setRiskBanner({
            visible: true,
            score: e.riskScore,
            message: 'You are in a high-risk zone. Consider changing route or moving to a safer area.',
          });
        }
      }
      if (e.type === 'risk:alert') {
        setRiskBanner({
          visible: true,
          score: e.alert.riskScore,
          message: e.alert.message || 'High-risk zone detected.',
        });
      }
    });
    return () => {
      // Stop on unmount to avoid unexpected tracking in dev sessions.
      stopSafetyAlerts();
      unsub();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* SafeNaari header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ShieldIcon size={28} />
          <View>
            <Text style={styles.title}>SafeNaari</Text>
            <Text style={styles.subtitle}>Your safety companion</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.infoButton}
          onPress={() => {}}
          accessibilityLabel="Info"
        >
          <InfoIcon size={22} />
        </TouchableOpacity>
      </View>

      {/* Map — same component and props, no changes to behaviour */}
      <View style={styles.mapContainer}>
        {!HeatmapMap || !mapAvailable ? (
          <HeatmapMapFallback radius={10000} gridSize={200} />
        ) : (
          <HeatmapMap
            radius={10000}
            gridSize={200}
            panToLocation={panToLocation}
            onError={() => {
              console.warn('Map component error, switching to fallback');
              setMapAvailable(false);
            }}
          />
        )}

        {/* Risk levels legend — over map */}
        <View style={styles.legendCard}>
          <Text style={styles.legendTitle}>Risk Levels</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.riskLow }]} />
            <Text style={styles.legendLabel}>Low</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.riskMedium }]} />
            <Text style={styles.legendLabel}>Medium</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.riskMediumHigh }]} />
            <Text style={styles.legendLabel}>High</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.riskHigh }]} />
            <Text style={styles.legendLabel}>Critical</Text>
          </View>
        </View>

        {riskBanner?.visible && (
          <View style={styles.riskBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.riskBannerTitle}>High Risk</Text>
              <Text style={styles.riskBannerBody} numberOfLines={2}>
                {riskBanner.message} (score {riskBanner.score.toFixed(2)})
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setRiskBanner(null)}
              style={styles.riskBannerClose}
              accessibilityLabel="Dismiss risk alert"
            >
              <Text style={styles.riskBannerCloseText}>×</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Bottom card: location + Plan Safe Route */}
      <View style={styles.bottomCard}>
        <View style={styles.locationRow}>
          <LocationIcon size={20} />
          <View style={styles.locationTextWrap}>
            <Text style={styles.locationLabel}>Current Location</Text>
            <Text style={styles.locationAddress} numberOfLines={2} ellipsizeMode="tail">
              {currentAddress}
            </Text>
            {typeof lastRiskScore === 'number' && (
              <Text style={[styles.locationAddress, { marginTop: 4, color: colors.textTertiary }]}>
                Risk score: {lastRiskScore.toFixed(2)}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.alertsButton, alertsEnabled && styles.alertsButtonOn]}
          onPress={async () => {
            try {
              if (alertsEnabled) {
                stopSafetyAlerts();
                void stopBackgroundSafetyTracking();
                setAlertsEnabled(false);
                return;
              }
              await startSafetyAlerts({ intervalMs: 15_000 });
              const bg = await startBackgroundSafetyTracking().catch(() => false);
              setAlertsEnabled(true);
              Alert.alert(
                'Safety Alerts Enabled',
                bg
                  ? 'Foreground + background location updates are on. You will be alerted when you enter a high-risk zone.'
                  : 'Foreground alerts are on. Allow “Always” location in Settings and use a dev build for background updates.'
              );
            } catch (e: any) {
              Alert.alert('Safety Alerts', e?.message || 'Failed to enable safety alerts.');
            }
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.alertsButtonText}>
            {alertsEnabled ? 'Safety Alerts: ON' : 'Safety Alerts: OFF'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.planRouteButton}
          onPress={() => navigation.navigate('Routes' as never)}
          activeOpacity={0.8}
        >
          <NavigateIcon size={20} color={colors.white} />
          <Text style={styles.planRouteText}>Plan Safe Route</Text>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'android' && !HeatmapMap && (
        <Text style={styles.androidNote}>Add Google Maps API key to app.json to enable map view</Text>
      )}
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoIcon: {
    fontSize: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.primary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  infoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIcon: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: 'bold',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  legendCard: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
  },
  riskBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: 14,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  riskBannerTitle: {
    color: colors.white,
    fontWeight: '900',
    fontSize: 14,
  },
  riskBannerBody: {
    color: colors.white,
    opacity: 0.95,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  riskBannerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskBannerCloseText: {
    color: colors.white,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '900',
  },
  legendTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  bottomCard: {
    backgroundColor: colors.backgroundSecondary,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  locationTextWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  locationIcon: {
    fontSize: 20,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  locationAddress: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    flexShrink: 1,
  },
  planRouteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 12,
    gap: spacing.sm,
  },
  planRouteIcon: {
    fontSize: 18,
  },
  planRouteText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
  alertsButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  alertsButtonOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '14',
  },
  alertsButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  androidNote: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 11,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});
