import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, Alert, Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../lib/colors';
import { authHeaders } from '../../lib/api';
import { loadSession } from '../../lib/storage';

const BASE = 'https://wearealive.in';

type Flyer = {
  id: string; storeName?: string; title: string; description: string; validUntil: string;
  imageBase64: string; createdAt: string;
};

function resolveImage(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('http')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

export default function Flyers() {
  const [storeName, setStoreName] = useState('');
  const [storeId, setStoreId] = useState<string | undefined>();
  const [token, setToken] = useState<string | undefined>();
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadSession().then(async (s) => {
      setStoreName(s?.storeName ?? '');
      setStoreId(s?.id);
      setToken(s?.token);
      await fetchFlyers(s?.storeName ?? '');
      setLoading(false);
    });
  }, []);

  const fetchFlyers = async (name: string) => {
    try {
      const res = await fetch(`${BASE}/api/flyers/save`);
      if (res.ok) {
        const all = await res.json() as Flyer[];
        setFlyers(all.filter((f) => f.storeName?.toLowerCase() === name.toLowerCase()));
      }
    } catch { /* ignore */ }
  };

  const pickAndUpload = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo access to upload flyers.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const { base64, mimeType } = result.assets[0];
    if (!base64) return;

    setUploading(true);
    try {
      const res = await fetch(`${BASE}/api/flyers/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({
          storeId,
          storeName,
          imageBase64: base64,
          mimeType: mimeType ?? 'image/jpeg',
          title: 'Store flyer',
          description: '',
          validUntil: '',
        }),
      });
      if (res.ok) {
        await fetchFlyers(storeName);
      } else {
        const d = await res.json() as { error?: string };
        Alert.alert('Upload failed', d.error ?? 'Please try again.');
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>;

  return (
    <ScrollView style={s.bg} contentContainerStyle={s.scroll}>

      <View style={s.card}>
        <Text style={s.cardTitle}>Upload a flyer</Text>
        <Text style={s.cardSub}>Flyers uploaded here are sent to your Alive manager for review before going live on screen.</Text>
        <TouchableOpacity style={[s.uploadBtn, uploading && { opacity: 0.5 }]} onPress={pickAndUpload} disabled={uploading}>
          {uploading
            ? <ActivityIndicator color={C.primary} size="small" />
            : <Ionicons name="cloud-upload-outline" size={20} color={C.primary} />
          }
          <Text style={s.uploadBtnText}>{uploading ? 'Uploading…' : 'Choose from gallery'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={s.waRow}
        onPress={() => Linking.openURL('https://wa.me/919741324448?text=Hi+Alive,+I+want+to+publish+a+flyer+for+my+store.')}
      >
        <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
        <Text style={s.waText}>Request a flyer via WhatsApp</Text>
        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
      </TouchableOpacity>

      <Text style={s.sectionTitle}>Active flyers ({flyers.length})</Text>
      {flyers.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="images-outline" size={36} color={C.textMuted} />
          <Text style={s.emptyText}>No active flyers yet.</Text>
          <Text style={s.emptySub}>Upload above or contact your Alive manager.</Text>
        </View>
      )}
      <View style={s.grid}>
        {flyers.map((f) => {
          const img = resolveImage(f.imageBase64);
          return (
            <View key={f.id} style={s.flyerCard}>
              {img ? (
                <Image source={{ uri: img }} style={s.flyerImg} resizeMode="cover" />
              ) : (
                <View style={[s.flyerImg, s.flyerPlaceholder]}>
                  <Ionicons name="image-outline" size={28} color={C.textMuted} />
                </View>
              )}
              <View style={s.flyerInfo}>
                <Text style={s.flyerTitle} numberOfLines={1}>{f.title}</Text>
                {f.validUntil && <Text style={s.flyerDate}>Until {f.validUntil}</Text>}
              </View>
            </View>
          );
        })}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 12, color: C.textSub, lineHeight: 17 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.primaryLight, borderWidth: 1, borderColor: C.primaryBorder, borderRadius: 12, padding: 14, justifyContent: 'center' },
  uploadBtnText: { fontSize: 14, fontWeight: '700', color: C.primary },
  waRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  waText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#25D366' },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: C.textSub, textTransform: 'uppercase', letterSpacing: 1 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  emptyText: { fontSize: 14, fontWeight: '600', color: C.textSub },
  emptySub: { fontSize: 12, color: C.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flyerCard: { width: '48%', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  flyerImg: { width: '100%', aspectRatio: 16 / 9 },
  flyerPlaceholder: { backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  flyerInfo: { padding: 8 },
  flyerTitle: { fontSize: 12, fontWeight: '600', color: C.text },
  flyerDate: { fontSize: 10, color: C.textMuted, marginTop: 1 },
});
