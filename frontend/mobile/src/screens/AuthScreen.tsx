import React, { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { loginUser, registerUser } from "../services/api";

type Props = {
  onAuthed: () => void;
};

export default function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    if (!email.trim() || !password) return false;
    if (mode === "register" && !name.trim()) return false;
    return true;
  }, [email, password, name, mode]);

  async function submit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      if (mode === "login") {
        await loginUser({ email: email.trim(), password });
      } else {
        await registerUser({
          email: email.trim(),
          password,
          name: name.trim(),
          phoneNumber: phoneNumber.trim() || undefined,
        });
      }
      onAuthed();
    } catch (e: any) {
      Alert.alert("Auth failed", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.card}>
        <Text style={styles.title}>SafeNaari</Text>
        <Text style={styles.subtitle}>
          {mode === "login" ? "Login to continue" : "Create your account"}
        </Text>

        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === "login" && styles.toggleBtnActive]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.toggleText, mode === "login" && styles.toggleTextActive]}>
              Login
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === "register" && styles.toggleBtnActive]}
            onPress={() => setMode("register")}
          >
            <Text style={[styles.toggleText, mode === "register" && styles.toggleTextActive]}>
              Register
            </Text>
          </TouchableOpacity>
        </View>

        {mode === "register" && (
          <>
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              autoCapitalize="words"
            />

            <Text style={styles.label}>Phone (optional)</Text>
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="+91..."
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              keyboardType="phone-pad"
            />
          </>
        )}

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="••••••"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
          onPress={submit}
          activeOpacity={0.85}
        >
          <Text style={styles.submitText}>
            {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          After you login, you can turn on Safety Alerts and the backend can enforce auth.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: spacing.md,
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: spacing.md,
  },
  toggleBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
  },
  toggleBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleText: {
    color: colors.textSecondary,
    fontWeight: "800",
  },
  toggleTextActive: {
    color: "white",
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  submitBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "white",
    fontWeight: "900",
    fontSize: 14,
  },
  hint: {
    marginTop: spacing.md,
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 16,
  },
});

