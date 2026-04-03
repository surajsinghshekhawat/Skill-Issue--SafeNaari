/**
 * Panic Screen — SafeNaari
 * Emergency SOS and emergency contacts. Logic unchanged.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Alert,
  StatusBar,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { storage } from '../utils/storage';
import PanicButton from '../components/PanicButton';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { ShieldIcon, AlertIcon, CallIcon, TrashIcon, CloseIcon } from '../components/AppIcons';
import { getStoredUserId, triggerPanicAlert, updateLocation, cancelPanicAlert } from '../services/api';
import * as Location from 'expo-location';

const EMERGENCY_CONTACTS_KEY = '@emergency_contacts';

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship?: string;
}

export default function PanicScreen() {
  const lastPanicIdRef = useRef<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState<string[]>([]);
  const [contactsList, setContactsList] = useState<EmergencyContact[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phone: '', relationship: '' });

  useFocusEffect(React.useCallback(() => { loadEmergencyContacts(); }, []));
  useEffect(() => { loadEmergencyContacts(); }, []);

  const loadEmergencyContacts = async () => {
    try {
      const stored = await storage.getItem(EMERGENCY_CONTACTS_KEY);
      if (stored) {
        const contacts = JSON.parse(stored);
        setContactsList(contacts);
        setEmergencyContacts(contacts.map((c: any) => c.phone));
      } else {
        setContactsList([]);
        setEmergencyContacts([]);
      }
    } catch (error) {
      setContactsList([]);
      setEmergencyContacts([]);
    }
  };

  const saveContacts = async (updatedContacts: EmergencyContact[]) => {
    try {
      await storage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(updatedContacts));
      setContactsList(updatedContacts);
      setEmergencyContacts(updatedContacts.map((c) => c.phone));
    } catch (error) {
      Alert.alert('Error', 'Failed to save emergency contact');
    }
  };

  const handleAddContact = () => {
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      Alert.alert('Error', 'Please fill in name and phone number');
      return;
    }
    const contact: EmergencyContact = {
      id: Date.now().toString(),
      name: newContact.name.trim(),
      phone: newContact.phone.trim(),
      relationship: newContact.relationship.trim() || undefined,
    };
    saveContacts([...contactsList, contact]);
    setNewContact({ name: '', phone: '', relationship: '' });
    setShowAddForm(false);
    Alert.alert('Success', 'Emergency contact added');
  };

  const handleDeleteContact = (id: string) => {
    Alert.alert(
      'Delete Contact',
      'Are you sure you want to delete this emergency contact?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => saveContacts(contactsList.filter((c) => c.id !== id)) },
      ]
    );
  };

  const handlePanicTrigger = async () => {
    try {
      if (!emergencyContacts || emergencyContacts.length === 0) {
        Alert.alert('Add a contact first', 'Please add at least 1 emergency contact before using SOS.');
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for emergency alerts.');
        return;
      }
      const storedUserId = (await getStoredUserId()) || 'user_anon';
      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;
      const resp = await triggerPanicAlert(storedUserId, latitude, longitude, emergencyContacts);
      if (resp?.panicId) lastPanicIdRef.current = String(resp.panicId);
      setIsActive(true);
      startLocationTracking(latitude, longitude);
      const sent = resp?.actions?.contactsSmsSent ?? 0;
      const skipped = resp?.actions?.contactsSmsSkipped ?? 0;
      const failed = resp?.actions?.contactsSmsFailed ?? 0;
      Alert.alert('Emergency Alert', `SMS: sent ${sent}, skipped ${skipped}, failed ${failed}`, [
        { text: 'Cancel Alert', style: 'destructive', onPress: handleCancelPanic },
        { text: 'OK', style: 'default' },
      ]);
    } catch (error) {
      Alert.alert(
        'Error',
        (error as any)?.message || 'Failed to send emergency alert. Please try again.'
      );
    }
  };

  const startLocationTracking = async (_lat: number, _lng: number) => {
    const interval = setInterval(async () => {
      if (!isActive) { clearInterval(interval); return; }
      try {
        const storedUserId = (await getStoredUserId()) || 'user_anon';
        const loc = await Location.getCurrentPositionAsync({});
        await updateLocation(storedUserId, loc.coords.latitude, loc.coords.longitude);
      } catch (_e) {}
    }, 30000);
    return () => clearInterval(interval);
  };

  const handleCancelPanic = () => {
    Alert.alert('Cancel Emergency Alert', 'Are you sure you want to cancel?', [
      { text: 'No, Keep Active', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          setIsActive(false);
          setCountdown(null);
          const pid = lastPanicIdRef.current;
          const uid = (await getStoredUserId()) || undefined;
          if (pid) {
            try {
              await cancelPanicAlert(pid, uid);
            } catch {
              // API may be offline; local state still cleared
            }
            lastPanicIdRef.current = null;
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.content} showsVerticalScrollIndicator={true}>
        {/* Header — SafeNaari style */}
        <View style={styles.header}>
          <ShieldIcon size={28} />
          <View>
            <Text style={styles.title}>Emergency SOS</Text>
            <Text style={styles.subtitle}>Press the button to alert your contacts</Text>
          </View>
        </View>

        {/* Emergency Alert card */}
        <View style={styles.alertCard}>
          <View style={styles.alertIconWrap}>
            <AlertIcon size={28} />
          </View>
          <Text style={styles.alertTitle}>Emergency Alert</Text>
          <Text style={styles.alertDesc}>
            Your current location will be shared with all emergency contacts via SMS and they will receive a call notification.
          </Text>
          <View style={styles.sosWrap}>
            <PanicButton
              onPanicTrigger={handlePanicTrigger}
              emergencyContacts={emergencyContacts}
              isActive={isActive}
            />
          </View>
        </View>

        {/* Emergency Contacts */}
        <View style={styles.contactsSection}>
          <View style={styles.contactsHeader}>
            <Text style={styles.contactsTitle}>Emergency Contacts</Text>
            <TouchableOpacity style={styles.addContactButtonHeader} onPress={() => setShowAddForm(true)}>
              <Text style={styles.addContactButtonHeaderText}>+ Add Contact</Text>
            </TouchableOpacity>
          </View>

          {contactsList.length === 0 ? (
            <View style={styles.emptyContacts}>
              <Text style={styles.emptyText}>No emergency contacts</Text>
              <Text style={styles.emptySubtext}>Add contacts to notify them during emergencies</Text>
            </View>
          ) : (
            <View style={styles.contactsList}>
              {contactsList.map((item) => (
                <View key={item.id} style={styles.contactItem}>
                  <View style={styles.contactIconWrap}>
                    <CallIcon size={22} />
                  </View>
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactPhone}>{item.phone}</Text>
                    {item.relationship ? <Text style={styles.contactRelationship}>{item.relationship}</Text> : null}
                  </View>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteContact(item.id)}>
                    <TrashIcon size={20} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {isActive && (
          <View style={styles.emergencyStatus}>
            <Text style={styles.emergencyText}>Emergency mode active</Text>
            <Text style={styles.emergencySubtext}>Your location is being shared with {emergencyContacts.length} contact(s)</Text>
            <TouchableOpacity style={styles.cancelAlertBtn} onPress={handleCancelPanic}>
              <Text style={styles.cancelAlertBtnText}>Cancel Alert</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Add Emergency Contact Modal — Figma style */}
      <Modal visible={showAddForm} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddForm(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Emergency Contact</Text>
              <TouchableOpacity onPress={() => setShowAddForm(false)}>
                <CloseIcon size={24} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter name"
              placeholderTextColor={colors.textTertiary}
              value={newContact.name}
              onChangeText={(t) => setNewContact({ ...newContact, name: t })}
            />
            <Text style={styles.fieldLabel}>Phone Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="+91 XXXXX XXXXX"
              placeholderTextColor={colors.textTertiary}
              value={newContact.phone}
              onChangeText={(t) => setNewContact({ ...newContact, phone: t })}
              keyboardType="phone-pad"
            />
            <Text style={styles.fieldLabel}>Relationship (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Mother, Friend, Spouse"
              placeholderTextColor={colors.textTertiary}
              value={newContact.relationship}
              onChangeText={(t) => setNewContact({ ...newContact, relationship: t })}
            />
            <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddContact}>
              <Text style={styles.modalAddBtnText}>Add Contact</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => { setShowAddForm(false); setNewContact({ name: '', phone: '', relationship: '' }); }}
            >
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  logoIcon: { fontSize: 28 },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  alertCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alertIconWrap: { alignSelf: 'center', marginBottom: spacing.sm },
  alertIcon: { fontSize: 40 },
  alertTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  alertDesc: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  sosWrap: { alignItems: 'center' },
  contactsSection: { width: '100%' },
  contactsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  contactsTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  addContactButtonHeader: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  addContactButtonHeaderText: { fontSize: 14, color: colors.text },
  emptyContacts: { padding: spacing.lg, alignItems: 'center' },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  emptySubtext: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  contactsList: { marginBottom: spacing.md },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  contactIcon: { fontSize: 20 },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: '600', color: colors.text },
  contactPhone: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  contactRelationship: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  deleteBtn: { padding: spacing.sm },
  deleteBtnIcon: { fontSize: 18 },
  emergencyStatus: { marginTop: spacing.lg, padding: spacing.lg, backgroundColor: colors.danger, borderRadius: 12, alignItems: 'center' },
  emergencyText: { fontSize: 16, fontWeight: 'bold', color: colors.white },
  emergencySubtext: { fontSize: 14, color: colors.white, marginTop: spacing.xs },
  cancelAlertBtn: { marginTop: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.white, borderRadius: 8 },
  cancelAlertBtnText: { color: colors.danger, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.white, borderRadius: 16, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  modalClose: { fontSize: 22, color: colors.textSecondary },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  modalAddBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.sm },
  modalAddBtnText: { fontSize: 16, fontWeight: '600', color: colors.white },
  modalCancelBtn: { borderWidth: 1, borderColor: colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.sm },
  modalCancelBtnText: { fontSize: 16, fontWeight: '600', color: colors.primary },
});
