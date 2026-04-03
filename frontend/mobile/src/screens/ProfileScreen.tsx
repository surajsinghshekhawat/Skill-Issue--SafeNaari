import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { getStoredUserId, getUserToken, logoutUser } from "../services/api";
import { ShieldIcon } from "../components/AppIcons";

export default function ProfileScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    (async () => {
      const [id, token] = await Promise.all([getStoredUserId(), getUserToken()]);
      setUserId(id);
      setHasToken(Boolean(token));
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <ShieldIcon size={28} />
        <View>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Account & security</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.rowLabel}>User ID</Text>
        <Text style={styles.rowValue}>{userId || "Not set"}</Text>

        <Text style={[styles.rowLabel, { marginTop: spacing.md }]}>Session</Text>
        <Text style={styles.rowValue}>{hasToken ? "Logged in" : "Logged out"}</Text>
      </View>

      <TouchableOpacity
        style={[styles.logoutBtn, !hasToken && styles.logoutBtnDisabled]}
        disabled={!hasToken}
        onPress={async () => {
          await logoutUser();
          Alert.alert("Logged out", "You have been logged out.");
        }}
      >
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <View style={styles.hintCard}>
        <Text style={styles.hintTitle}>If routes search shows “unavailable”</Text>
        <Text style={styles.hintText}>
          Enable Google Places API (and billing) for your Google Maps key. Without it, location
          autocomplete won’t return results.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  card: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowLabel: { fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 6 },
  logoutBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.danger,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  logoutBtnDisabled: { opacity: 0.5 },
  logoutText: { color: "white", fontWeight: "900" },
  hintCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintTitle: { fontSize: 14, fontWeight: "900", color: colors.text },
  hintText: { marginTop: 6, fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
});

