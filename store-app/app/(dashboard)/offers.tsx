import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../lib/colors';
import { authHeaders } from '../../lib/api';
import { loadSession } from '../../lib/storage';

const BASE = 'https://wearealive.in';

type Offer = {
  id: string;
  productName: string;
  weight?: string;
  mrp: number;
  offerPrice: number;
  validUntil: string;
  storeId?: string;
};

const EMPTY_OFFER = { productName: '', weight: '', mrp: '', offerPrice: '', validUntil: '' };

export default function Offers() {
  const [storeId, setStoreId] = useState<string | undefined>();
  const [token, setToken] = useState<string | undefined>();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_OFFER);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadSession().then(async (s) => {
      setStoreId(s?.id);
      setToken(s?.token);
      await fetchOffers(s?.id, s?.token);
      setLoading(false);
    });
  }, []);

  const fetchOffers = async (id?: string, tok?: string) => {
    try {
      const qs = id ? `?storeId=${id}` : '';
      const res = await fetch(`${BASE}/api/stores/offers${qs}`, { headers: authHeaders(tok) });
      if (res.ok) setOffers(await res.json() as Offer[]);
    } catch { /* ignore */ }
  };

  const saveOffer = async () => {
    if (!form.productName.trim()) { Alert.alert('Required', 'Product name is required.'); return; }
    if (!form.offerPrice || Number(form.offerPrice) <= 0) { Alert.alert('Required', 'Enter a valid offer price.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/stores/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({
          storeId,
          productName: form.productName.trim(),
          weight: form.weight.trim() || undefined,
          mrp: form.mrp ? Number(form.mrp) : undefined,
          offerPrice: Number(form.offerPrice),
          validUntil: form.validUntil || undefined,
        }),
      });
      if (res.ok) {
        setForm(EMPTY_OFFER);
        await fetchOffers(storeId, token);
      } else {
        const d = await res.json() as { error?: string };
        Alert.alert('Error', d.error ?? 'Could not save offer.');
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteOffer = async (id: string) => {
    Alert.alert('Delete offer', 'Remove this offer?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeleting(id);
          try {
            await fetch(`${BASE}/api/stores/offers/${id}?storeId=${storeId ?? ''}`, { method: 'DELETE', headers: authHeaders(token) });
            setOffers((prev) => prev.filter((o) => o.id !== id));
          } catch { /* ignore */ } finally { setDeleting(null); }
        },
      },
    ]);
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>;

  return (
    <ScrollView style={s.bg} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

      {/* Add offer form */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Post a new offer</Text>
        <Text style={s.cardSub}>Offers appear on the ALIVE screen and on the deals page.</Text>

        <Text style={s.label}>Product name *</Text>
        <TextInput style={s.input} placeholder="e.g. Tata Salt 1kg" placeholderTextColor={C.textMuted}
          value={form.productName} onChangeText={(v) => setForm((p) => ({ ...p, productName: v }))} />

        <Text style={s.label}>Weight / quantity</Text>
        <TextInput style={s.input} placeholder="e.g. 1 kg, 500 ml" placeholderTextColor={C.textMuted}
          value={form.weight} onChangeText={(v) => setForm((p) => ({ ...p, weight: v }))} />

        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>MRP (₹)</Text>
            <TextInput style={s.input} placeholder="0" placeholderTextColor={C.textMuted}
              keyboardType="numeric" value={form.mrp}
              onChangeText={(v) => setForm((p) => ({ ...p, mrp: v.replace(/[^0-9.]/g, '') }))} />
          </View>
          <View style={{ width: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Offer price (₹) *</Text>
            <TextInput style={s.input} placeholder="0" placeholderTextColor={C.textMuted}
              keyboardType="numeric" value={form.offerPrice}
              onChangeText={(v) => setForm((p) => ({ ...p, offerPrice: v.replace(/[^0-9.]/g, '') }))} />
          </View>
        </View>

        <Text style={s.label}>Valid until (optional)</Text>
        <TextInput style={s.input} placeholder="e.g. 31 May 2025" placeholderTextColor={C.textMuted}
          value={form.validUntil} onChangeText={(v) => setForm((p) => ({ ...p, validUntil: v }))} />

        <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} onPress={saveOffer} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Post offer</Text>}
        </TouchableOpacity>
      </View>

      {/* Existing offers */}
      <Text style={s.sectionTitle}>Active offers ({offers.length})</Text>
      {offers.length === 0 && <Text style={s.emptyText}>No offers posted yet. Add one above.</Text>}
      {offers.map((o) => (
        <View key={o.id} style={s.offerCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.offerName}>{o.productName}{o.weight ? ` · ${o.weight}` : ''}</Text>
            <View style={s.priceRow}>
              {o.mrp ? <Text style={s.mrp}>₹{o.mrp}</Text> : null}
              <Text style={s.offerPrice}>₹{o.offerPrice}</Text>
            </View>
            {o.validUntil && <Text style={s.validUntil}>Until {o.validUntil}</Text>}
          </View>
          <TouchableOpacity onPress={() => deleteOffer(o.id)} disabled={deleting === o.id} style={s.deleteBtn}>
            {deleting === o.id
              ? <ActivityIndicator size="small" color={C.error} />
              : <Ionicons name="trash-outline" size={18} color={C.error} />
            }
          </TouchableOpacity>
        </View>
      ))}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 12, color: C.textSub, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '700', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 6 },
  input: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: C.text, marginTop: 4 },
  row: { flexDirection: 'row' },
  btn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: C.textSub, textTransform: 'uppercase', letterSpacing: 1 },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingVertical: 20 },
  offerCard: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center' },
  offerName: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mrp: { fontSize: 13, color: C.textMuted, textDecorationLine: 'line-through' },
  offerPrice: { fontSize: 16, fontWeight: '800', color: C.primary },
  validUntil: { fontSize: 11, color: C.textMuted, marginTop: 3 },
  deleteBtn: { padding: 8 },
});
