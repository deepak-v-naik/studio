import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../lib/colors';
import { loadSession } from '../../lib/storage';
import { authHeaders, type StoreSession } from '../../lib/api';
import { API_BASE_URL } from '@shared/constants';

type PaymentRecord = {
  month: string; status: string; amountPaise: number; paidAt: string | null; payRef: string | null;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function proRateFirstMonth(onboardedAt: Date, monthStart: Date): number {
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const totalDays = (monthEnd.getTime() - monthStart.getTime()) / 86400000;
  const daysActive = (monthEnd.getTime() - onboardedAt.getTime()) / 86400000;
  const fraction = Math.min(1, Math.max(0, daysActive / totalDays));
  return Math.round(500 * fraction * 100);
}

export default function Earnings() {
  const [store, setStore] = useState<StoreSession | null>(null);
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimModal, setClaimModal] = useState<{ monthKey: string; amountPaise: number } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [claimErr, setClaimErr] = useState('');

  useEffect(() => {
    loadSession().then(async (s) => {
      setStore(s);
      try {
        const res = await fetch(`${API_BASE_URL}/api/stores/payments?storeId=${s?.id ?? ''}`, { headers: authHeaders(s?.token) });
        if (res.ok) setRecords(await res.json() as PaymentRecord[]);
      } catch { /* no records */ }
      setLoading(false);
    });
  }, []);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>;
  if (!store) return <View style={s.center}><Text style={s.empty}>No session found.</Text></View>;

  const now = new Date();
  const claimableBefore = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const onboardDate = store.liveAt ?? store.agreedAt;
  const onboardedAt = onboardDate ? new Date(onboardDate) : null;
  const startMonth = onboardedAt
    ? new Date(onboardedAt.getFullYear(), onboardedAt.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() - 4, 1);

  const months: {
    label: string; isPast: boolean; isCur: boolean;
    amountPaise: number; mk: string; isFirst: boolean;
  }[] = [];
  const cur = new Date(startMonth);
  const endCal = new Date(now.getFullYear(), now.getMonth(), 1);
  let firstDone = false;
  while (cur <= endCal) {
    const start = new Date(cur);
    const isPast = start.getTime() < claimableBefore;
    const isCur = start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
    const isFirst = !firstDone;
    const amountPaise = isFirst && onboardedAt ? proRateFirstMonth(onboardedAt, start) : 50000;
    if (isFirst) firstDone = true;
    months.push({ label: start.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), isPast, isCur, amountPaise, mk: monthKey(start), isFirst });
    cur.setMonth(cur.getMonth() + 1);
  }

  const submitClaim = async () => {
    if (!claimModal) return;
    setClaimBusy(true); setClaimErr('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/payout-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(store.token) },
        body: JSON.stringify({ storeId: store.id, month: claimModal.monthKey, amountPaise: claimModal.amountPaise }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error); }
      setClaimDone(true);
    } catch (e) {
      setClaimErr((e as Error).message ?? 'Failed. Try again.');
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <ScrollView style={s.bg} contentContainerStyle={s.scroll}>

      {/* Stats */}
      <View style={s.statsRow}>
        {[{ label: 'This month', value: '₹500', accent: true }, { label: 'Per referral', value: '₹500', accent: false }, { label: 'Total earned', value: '₹0', accent: false }].map((st) => (
          <View key={st.label} style={s.stat}>
            <Text style={[s.statVal, st.accent && { color: C.primary }]}>{st.value}</Text>
            <Text style={s.statLbl}>{st.label}</Text>
          </View>
        ))}
      </View>

      {/* Payment timeline */}
      <View style={s.card}>
        <View style={s.cardRow}>
          <Text style={s.cardTitle}>Payment timeline</Text>
          <Ionicons name="calendar-outline" size={16} color={C.textMuted} />
        </View>
        <Text style={s.cardSub}>₹500 + electricity per month · paid by 10th of following month</Text>
        {months.map((m) => {
          const rec = records.find((r) => r.month === m.mk);
          const isPaid = rec?.status === 'paid';
          return (
            <View key={m.mk} style={[s.monthRow, m.isCur && s.monthRowActive]}>
              <View style={[s.monthDot, m.isCur ? s.dotPrimary : isPaid ? s.dotGreen : m.isPast ? s.dotWarn : s.dotIdle]} />
              <View style={{ flex: 1 }}>
                <Text style={[s.monthLabel, m.isCur && { color: C.primary }]}>{m.label}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {isPaid ? (
                  <>
                    <Text style={s.paidAmt}>₹{((rec?.amountPaise ?? m.amountPaise) / 100).toLocaleString('en-IN')}</Text>
                    <Ionicons name="checkmark-circle" size={14} color={C.success} />
                  </>
                ) : m.isCur ? (
                  <Text style={[s.monthLabel, { color: C.primary }]}>₹{(m.amountPaise / 100).toLocaleString('en-IN')} in progress</Text>
                ) : m.isPast ? (
                  <TouchableOpacity style={s.claimBtn} onPress={() => { setClaimModal({ monthKey: m.mk, amountPaise: m.amountPaise }); setClaimDone(false); setClaimErr(''); }}>
                    <Ionicons name="arrow-down-circle-outline" size={13} color="#fff" />
                    <Text style={s.claimBtnText}>Claim ₹{(m.amountPaise / 100).toLocaleString('en-IN')}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.upcoming}>Upcoming</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Claim modal */}
      <Modal visible={!!claimModal} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            {claimDone ? (
              <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                <View style={s.successCircle}><Ionicons name="checkmark" size={28} color={C.success} /></View>
                <Text style={s.modalTitle}>Claim submitted!</Text>
                <Text style={s.modalSub}>Our team will process your payout within 3–5 business days via UPI to +91 {store.whatsapp}.</Text>
                <TouchableOpacity style={s.btn} onPress={() => setClaimModal(null)}><Text style={s.btnText}>Done</Text></TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={s.modalTitle}>Claim monthly reward</Text>
                <View style={s.modalDetail}>
                  <Text style={s.modalDetailLbl}>Amount</Text>
                  <Text style={[s.modalDetailVal, { color: C.success }]}>₹{((claimModal?.amountPaise ?? 0) / 100).toLocaleString('en-IN')} + electricity</Text>
                </View>
                <View style={s.modalDetail}>
                  <Text style={s.modalDetailLbl}>UPI / WhatsApp</Text>
                  <Text style={s.modalDetailVal}>+91 {store.whatsapp}</Text>
                </View>
                <Text style={s.modalNote}>Actual payout calculated based on verified screen uptime. Final amount may vary.</Text>
                {claimErr ? <Text style={s.errText}>{claimErr}</Text> : null}
                <View style={s.modalBtns}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setClaimModal(null)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={submitClaim} disabled={claimBusy}>
                    {claimBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Submit claim</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.textSub },
  statsRow: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', padding: 14, borderRightWidth: 1, borderRightColor: C.border },
  statVal: { fontSize: 16, fontWeight: '900', color: C.text },
  statLbl: { fontSize: 10, color: C.textSub, marginTop: 2 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 11, color: C.textSub },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6', borderRadius: 8 },
  monthRowActive: { backgroundColor: C.primaryLight, paddingHorizontal: 8, borderTopColor: 'transparent', borderWidth: 1, borderColor: C.primaryBorder },
  monthDot: { width: 8, height: 8, borderRadius: 4 },
  dotPrimary: { backgroundColor: C.primary },
  dotGreen: { backgroundColor: C.success },
  dotWarn: { backgroundColor: C.warn },
  dotIdle: { backgroundColor: C.border },
  monthLabel: { fontSize: 12, fontWeight: '600', color: C.text },
  paidAmt: { fontSize: 12, fontWeight: '700', color: C.success },
  claimBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.warn, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  claimBtnText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  upcoming: { fontSize: 11, color: C.textMuted },
  modalBg: { flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  modalSub: { fontSize: 13, color: C.textSub, lineHeight: 19, textAlign: 'center' },
  modalDetail: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f9fafb', borderRadius: 10, padding: 12 },
  modalDetailLbl: { fontSize: 12, color: C.textSub },
  modalDetailVal: { fontSize: 12, fontWeight: '700', color: C.text },
  modalNote: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  btn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: C.textSub },
  errText: { fontSize: 12, color: C.error },
  successCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.successLight, alignItems: 'center', justifyContent: 'center' },
});
