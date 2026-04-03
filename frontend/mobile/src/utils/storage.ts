/**
 * Storage Utility
 * 
 * Provides a storage interface that works with or without AsyncStorage
 * Falls back to in-memory storage if AsyncStorage is unavailable
 */

// In-memory storage fallback (last resort)
const memoryStorage: { [key: string]: string } = {};

let AsyncStorage: any = null;
let SecureStore: any = null;

// Expo Go supports SecureStore; prefer it for auth/session.
try {
  SecureStore = require("expo-secure-store");
} catch {
  SecureStore = null;
}

// Try AsyncStorage next (should work in Expo Go if installed properly)
try {
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
} catch {
  AsyncStorage = null;
}

function canUseSecureStore() {
  return Boolean(SecureStore?.getItemAsync && SecureStore?.setItemAsync && SecureStore?.deleteItemAsync);
}

function canUseAsyncStorage() {
  return Boolean(AsyncStorage?.getItem && AsyncStorage?.setItem && AsyncStorage?.removeItem);
}

function toSecureStoreKey(key: string): string | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  // SecureStore keys must be alphanumeric or ".", "-", "_"
  const sanitized = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized) return null;
  // Avoid collisions by namespacing
  return `wsa.${sanitized}`;
}

export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (canUseSecureStore()) {
        const k = toSecureStoreKey(key);
        if (k) return await SecureStore.getItemAsync(k);
      }
      if (canUseAsyncStorage()) {
        return await AsyncStorage.getItem(key);
      }
      return memoryStorage[key] || null;
    } catch (error) {
      console.error('Storage getItem error:', error);
      return memoryStorage[key] || null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (canUseSecureStore()) {
        const k = toSecureStoreKey(key);
        if (k) {
          await SecureStore.setItemAsync(k, value);
          return;
        }
      }
      if (canUseAsyncStorage()) {
        await AsyncStorage.setItem(key, value);
        return;
      }
      memoryStorage[key] = value;
    } catch (error) {
      console.error('Storage setItem error:', error);
      memoryStorage[key] = value;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (canUseSecureStore()) {
        const k = toSecureStoreKey(key);
        if (k) {
          await SecureStore.deleteItemAsync(k);
          return;
        }
      }
      if (canUseAsyncStorage()) {
        await AsyncStorage.removeItem(key);
        return;
      }
      delete memoryStorage[key];
    } catch (error) {
      console.error('Storage removeItem error:', error);
      delete memoryStorage[key];
    }
  },
};


