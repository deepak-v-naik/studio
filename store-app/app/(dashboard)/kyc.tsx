import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../lib/colors';
import { loadSession } from '../../lib/storage';
import { API_BASE_URL } from '@shared/constants';

type DocType = 'pan' | 'aadhaar' | 'selfie';
type KycStatus = 'not_started' | 'submitted' | 'approved' | 'rejected';

type KycData = {
  status: KycStatus;
  panUrl: string | null;
  aadhaarUrl: string | null;
  selfieUrl: string | null;
  rejectedReason: string | null;
};

const DOCS: { key: DocType; label: string; hint: string; icon: string }[] = [
  { key: 'pan',     label: 'PAN card',          hint: 'Photo of your PAN card (front)',               icon: 'card-outline' },
  { key: 'aadhaar', label: 'Aadhaar card',       hint: 'Photo of your Aadhaar card (front & back)',   icon: 'id-card-outline' },
  { key: 'selfie',  label: 'Selfie',             hint: 'Clear selfie of your face',                   icon: 'person-outline' },
];

export default function KYC() {
  const [storeId, setStoreId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<KycStatus>('not_started');
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Partial<Record<DocType, string>>>({});
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSession().then(async (s) => {
      setStoreId(s?.id);
      try {
        const res = await fetch(`${API_BASE_URL}/api/stores/kyc?storeId=${s?.id ?? ''}`);
        if (res.ok) {
          const d = await res.json() as KycData;
          setStatus(d.status);
          setRejectedReason(d.rejectedReason);
          setUploads({
            pan:     d.panUrl     ?? undefined,
            aadhaar: d.aadhaarUrl ?? undefined,
            selfie:  d.selfieUrl  ?? undefined,
          });
        }
      } catch { /* start from empty state */ }
      setLoading(false);
    });
  }, []);

  const pick = async (doc: DocType) => {
    if (doc === 'selfie') {
      const { status: permStatus } = await ImagePicker.requestCameraPermissionsAsync();
      if (permStatus !== 'granted') { Alert.alert('Permission required', 'Camera access needed for selfie.'); return; }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (res.canceled || !res.assets[0]) return;
      await upload(doc, res.assets[0].uri, res.assets[0].mimeType ?? 'image/jpeg');
    } else {
      const { status: permStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permStatus !== 'granted') { Alert.alert('Permission required', 'Gallery access needed.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (res.canceled || !res.assets[0]) return;
      await upload(doc, res.assets[0].uri, res.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  const upload = async (doc: DocType, uri: string, mimeType: string) => {
    setUploading(doc);
    try {
      const form = new FormData();
      form.append('storeId', storeId ?? '');
      form.append('file', { uri, name: `${doc}.jpg`, type: mimeType } as unknown as Blob);
      const res = await fetch(`${API_BASE_URL}/api/stores/upload`, { method: 'POST', body: form });
      const d = await res.json() as { url?: string; error?: string };
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Upload failed');
      setUploads((prev) => ({ ...prev, [doc]: d.url }));
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message ?? 'Please try again.');
    } finally {
      setUploading(null);
    }
  };

  const submitKYC = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/stores/kyc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          panUrl: uploads.pan,
          aadhaarUrl: uploads.aadhaar,
          selfieUrl: uploads.selfie,
        }),
      });
      if (res.ok) {
        setStatus('submitted');
      } else {
        const d = await res.json() as { error?: string };
        Alert.alert('Error', d.error ?? 'Could not submit KYC. Please try again.');
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>;
  }

  if (status === 'submitted' || status === 'approved') {
    return (
      <View style={s.center}>
        <View style={s.successCircle}>
          <Ionicons name={status === 'approved' ? 'checkmark-done' : 'checkmark'} size={32} color={C.success} />
        </View>
        <Text style={s.successTitle}>{status === 'approved' ? 'KYC verified!' : 'KYC submitted!'}</Text>
        <Text style={s.successSub}>
          {status === 'approved'
            ? 'Your documents are verified. Payouts are unlocked.'
            : 'Our team will verify your documents within 24–48 hours.'}
        </Text>
      </View>
    );
  }

  const allUploaded = DOCS.every((d) => uploads[d.key]);

  return (
    <ScrollView style={s.bg} contentContainerStyle={s.scroll}>

      <View style={s.card}>
        <View style={s.cardRow}>
          <Ionicons name="shield-checkmark-outline" size={20} color={C.primary} />
          <Text style={s.cardTitle}>KYC Verification</Text>
        </View>
        <Text style={s.cardSub}>
          Upload your PAN, Aadhaar, and a selfie to complete KYC. Required for receiving payouts.
        </Text>
        {status === 'rejected' && rejectedReason && (
          <View style={s.rejectBox}>
            <Ionicons name="alert-circle" size={14} color={C.error} />
            <Text style={s.rejectText}>{rejectedReason}</Text>
          </View>
        )}
      </View>

      {DOCS.map((doc) => (
        <View key={doc.key} style={s.docCard}>
          <View style={s.docHeader}>
            <View style={s.docIconWrap}>
              <Ionicons name={doc.icon as 'card-outline'} size={20} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.docLabel}>{doc.label}</Text>
              <Text style={s.docHint}>{doc.hint}</Text>
            </View>
            {uploads[doc.key] && (
              <Ionicons name="checkmark-circle" size={20} color={C.success} />
            )}
          </View>

          {uploads[doc.key] && (
            <Image source={{ uri: uploads[doc.key] }} style={s.preview} resizeMode="cover" />
          )}

          <TouchableOpacity
            style={[s.uploadBtn, uploading === doc.key && { opacity: 0.5 }]}
            onPress={() => pick(doc.key)}
            disabled={uploading !== null}
          >
            {uploading === doc.key
              ? <ActivityIndicator color={C.primary} size="small" />
              : <Ionicons name={uploads[doc.key] ? 'refresh-outline' : 'camera-outline'} size={16} color={C.primary} />
            }
            <Text style={s.uploadBtnText}>
              {uploads[doc.key] ? 'Re-upload' : doc.key === 'selfie' ? 'Take selfie' : 'Upload photo'}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      {allUploaded && (
        <TouchableOpacity
          style={[s.submitBtn, submitting && { opacity: 0.5 }]}
          onPress={submitKYC}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={s.submitBtnText}>Submit KYC</Text>
              </>
          }
        </TouchableOpacity>
      )}

      <Text style={s.note}>
        Documents are encrypted and stored securely. Used only for identity verification and payout processing.
      </Text>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 12, color: C.textSub, lineHeight: 17 },
  rejectBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.errorLight, borderWidth: 1, borderColor: C.primaryBorder, borderRadius: 10, padding: 12, marginTop: 4 },
  rejectText: { flex: 1, fontSize: 12, color: C.error, lineHeight: 18 },
  docCard: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, gap: 10 },
  docHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  docIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' },
  docLabel: { fontSize: 13, fontWeight: '700', color: C.text },
  docHint: { fontSize: 11, color: C.textSub, marginTop: 1 },
  preview: { width: '100%', height: 140, borderRadius: 10, backgroundColor: '#f3f4f6' },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.primaryBorder, borderRadius: 10, padding: 11, justifyContent: 'center', backgroundColor: C.primaryLight },
  uploadBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
  submitBtn: { backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  note: { fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 16 },
  successCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.successLight, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  successSub: { fontSize: 13, color: C.textSub, textAlign: 'center', lineHeight: 19 },
});
