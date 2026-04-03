/**
 * Panic/SOS Button Component
 *
 * Core safety feature - allows users to trigger emergency alerts
 * Supports manual trigger, gesture activation, and optional voice
 *
 * @author Women Safety Analytics Team
 * @version 1.0.0
 */

import React, { useState, useRef } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  Animated,
  Vibration,
} from "react-native";
import { AlertIcon } from "./AppIcons";
import { colors } from "../theme/colors";

interface PanicButtonProps {
  onPanicTrigger: () => void;
  /** Fired if user taps CANCEL on the pre-send confirmation (no SMS yet). */
  onCancelBeforeSend?: () => void;
  emergencyContacts: string[];
  isActive: boolean;
}

export const PanicButton: React.FC<PanicButtonProps> = ({
  onPanicTrigger,
  onCancelBeforeSend,
  emergencyContacts,
  isActive,
}) => {
  const [isPressed, setIsPressed] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  /**
   * Handle manual panic button press
   */
  const handleManualPress = () => {
    triggerPanicAlert();
  };

  /**
   * Main panic alert trigger function
   */
  const triggerPanicAlert = () => {
    // Visual feedback
    Vibration.vibrate([0, 500, 200, 500]);

    // Animation feedback
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1.1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Show confirmation alert
    Alert.alert(
      "EMERGENCY ALERT",
      `Panic button activated! Notifying ${emergencyContacts.length} emergency contacts and authorities.`,
      [
        {
          text: "CANCEL",
          style: "cancel",
          onPress: () => {
            onCancelBeforeSend?.();
          },
        },
        {
          text: "CONFIRM",
          style: "destructive",
          onPress: () => {
            // Trigger the panic action
            onPanicTrigger();
          },
        },
      ],
      { cancelable: false }
    );
  };

  /**
   * Start pulse animation when button is active
   */
  React.useEffect(() => {
    if (isActive) {
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.start();

      return () => pulseAnimation.stop();
    }
  }, [isActive, pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ scale: scaleAnim }, { scale: pulseAnim }],
        },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.panicButton,
          isActive && styles.activeButton,
          isPressed && styles.pressedButton,
        ]}
        onPress={handleManualPress}
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        activeOpacity={0.8}
      >
        <View style={styles.panicIconWrap}>
          <AlertIcon size={36} color={colors.white} />
        </View>
        <Text style={[styles.panicText, isActive && styles.activeText]}>
          SOS
        </Text>
        <Text style={[styles.subText, isActive && styles.activeSubText]}>
          {isActive ? "ACTIVE" : "HOLD FOR EMERGENCY"}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 20,
  },
  panicButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "#ff4444",
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  activeButton: {
    backgroundColor: "#ff0000",
    borderColor: "#ffff00",
    borderWidth: 4,
  },
  pressedButton: {
    transform: [{ scale: 0.95 }],
  },
  panicIconWrap: {
    marginBottom: 4,
  },
  panicText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
    textAlign: "center",
  },
  activeText: {
    color: "#ffff00",
    fontSize: 28,
  },
  subText: {
    fontSize: 12,
    color: "#ffffff",
    marginTop: 4,
    textAlign: "center",
    fontWeight: "600",
  },
  activeSubText: {
    color: "#ffff00",
    fontWeight: "bold",
  },
});

export default PanicButton;
