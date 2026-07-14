import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Linking,
  StyleSheet, ActivityIndicator, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { C } from '../../lib/colors';
import { loadSession, saveSession } from '../../lib/storage';
import { getStoreMe, type StoreSession } from '../../lib/api';

type Stage = 'new' | 'contacted' | 'visited' | 'installed' | 'live' | string;

function buildTimeline(store: StoreSession) {
  const stage: Stage = store.onboardingStage ?? 'new';
  const isLive = stage === 'live' || !!store.liveAt;
  const isInstalled = ['installed', 'live'].includes(stage) || (store.deviceCount ?? 0) > 0;
  const isContacted = ['contacted', 'visited', 'installed', 'live'].includes(stage);
  return [
    { label: 'Registration received', desc: 'Your details are saved successfully.', done: true, active: false },
    { label: 'Team verification', desc: 'Our team will call you within 24 hours.', done: isContacted, active: !isContacted },
    { label: 'Site visit & install', desc: 'Free screen installed at your store.', done: isInstalled, active: isContacted && !isInstalled },
    { label: 'Screen goes live', desc: 'Ads start running — you start earning!', done: isLive, active: isInstalled && !isLive },
  ];
}

export default function Overview() {
  const [store, setStore] = useState<StoreSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadSession().then(async (local) => {
      if (local) setStore(local);
      try {
        const fresh = await getStoreMe(local?.id);
        setStore(fresh);
        await saveSession(fresh);
      } catch { /* use cached */ }
      setLoading(false);
    });
  }, []);

  if (loading && !store) {
    return <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>;
  }
  if (!store) {
    return <View style={s.center}><Text style={s.empty}>Could not load store data.</Text></View>;
  }

  const timeline = buildTimeline(store);
  const displayName = store.ownerName?.split(' ')[0] ?? 'Partner';
  const code = store.referralCode ?? '—';

  const shareCode = async () => {
    await Share.share({ message: `Join ALIVE as a store partner and earn ₹500/month! Use my referral code: ${code}. Register at https://wearealive.in/store` });
  };

  const copyCode = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ScrollView style={s.bg} contentContainerStyle={s.scroll}>

      {/* Welcome banner */}
      <View style={s.banner}>
        <View>
          <Text style={s.bannerEye}>Store Partner</Text>
          <Text style={s.bannerName}>Welcome, {displayName}!</Text>
          {store.locality && (
            <Text style={s.bannerSub}>
              {store.storeName} · {store.locality}{store.city ? `, ${store.city}` : ''}
            </Text>
          )}
        </View>
        <View style={s.bannerBadges}>
          <View style={s.badge}>
            <Text style={s.badgeVal}>₹500</Text>
            <Text style={s.badgeLbl}>/month</Text>
          </View>
          {store.liveAt ? (
            <View style={[s.badge, s.badgeLive]}>
              <Text style={[s.badgeVal, { color: C.success }]}>Live</Text>
              <Text style={[s.badgeLbl, { color: '#16a34a' }]}>{store.deviceCount ?? 0} screen{(store.deviceCount ?? 1) !== 1 ? 's' : ''}</Text>
            </View>
          ) : (
            <View style={[s.badge, s.badgePending]}>
              <Text style={[s.badgeVal, { color: C.primary }]}>48h</Text>
              <Text style={[s.badgeLbl, { color: C.primary }]}>To live</Text>
            </View>
          )}
        </View>
      </View>

      {/* Status strip */}
      <View style={s.statusStrip}>
        <View style={[s.dot, store.liveAt ? s.dotGreen : s.dotYellow]} />
        <Text style={s.statusText}>
          {store.liveAt
            ? 'Screen is live — ads are running and you’re earning.'
            : `Registration received — our team will call +91 ${store.whatsapp} within 24h.`
          }
        </Text>
      </View>

      {/* Onboarding timeline */}
      <View style={s.card}>
        <Text style={s.cardTitle}>{timeline.every((t) => t.done) ? 'Your store is live! ✓' : 'What happens next'}</Text>
        {timeline.map((item, i) => (
          <View key={item.label} style={s.timelineRow}>
            <View style={s.timelineLeft}>
              <View style={[
                s.dot24,
                item.done ? s.dot24Done : item.active ? s.dot24Active : s.dot24Idle,
              ]}>
                {item.done
                  ? <Ionicons name="checkmark" size={12} color="#fff" />
                  : item.active
                    ? <Ionicons name="time" size={12} color={C.primary} />
                    : <Text style={s.dot24Num}>{i + 1}</Text>
                }
              </View>
              {i < timeline.length - 1 && (
                <View style={[s.connector, item.done && { backgroundColor: C.primary }]} />
              )}
            </View>
            <View style={s.timelineContent}>
              <Text style={[s.timelineLabel, item.active && { color: C.primary }]}>{item.label}</Text>
              <Text style={s.timelineDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Referral */}
      <View style={s.card}>
        <View style={s.cardRow}>
          <View>
            <Text style={s.cardTitle}>Your referral code</Text>
            <Text style={s.cardSub}>Earn ₹500 for every partner who joins using your code.</Text>
          </View>
          <Ionicons name="gift-outline" size={20} color={C.textMuted} />
        </View>
        <View style={s.codeRow}>
          <Text style={s.code}>{code}</Text>
          <TouchableOpacity style={s.copyBtn} onPress={copyCode}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? C.success : C.textSub} />
            <Text style={[s.copyBtnText, copied && { color: C.success }]}>{copied ? 'Copied' : 'Copy'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={s.shareBtn} onPress={shareCode}>
          <Ionicons name="share-social-outline" size={16} color={C.primary} />
          <Text style={s.shareBtnText}>Share on WhatsApp</Text>
        </TouchableOpacity>
      </View>

      {/* Quick actions */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Quick actions</Text>
        {[
          { icon: 'logo-whatsapp', label: 'WhatsApp support', sub: 'Chat with our team', color: '#25D366', href: 'https://wa.me/919741324448?text=Hi+Alive+team,+I+am+a+registered+store+partner.' },
          { icon: 'call-outline', label: 'Call us', sub: '+91 74113 24448', color: C.primary, href: 'tel:+917411324448' },
        ].map((a) => (
          <TouchableOpacity key={a.label} style={s.actionRow} onPress={() => Linking.openURL(a.href)}>
            <Ionicons name={a.icon as 'call-outline'} size={20} color={a.color} />
            <View style={{ flex: 1 }}>
              <Text style={s.actionLabel}>{a.label}</Text>
              <Text style={s.actionSub}>{a.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Agreement summary */}
      <View style={s.card}>
        <View style={s.cardRow}>
          <Text style={s.cardTitle}>Your agreement</Text>
          <Ionicons name="shield-checkmark-outline" size={18} color={C.textMuted} />
        </View>
        {store.agreedAt && (
          <Text style={s.cardSub}>Signed on {new Date(store.agreedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</Text>
        )}
        {[
          { t: 'Remuneration', d: '₹500/month per screen, paid within 10 working days.' },
          { t: 'Equipment', d: 'Screen installed free. Remains ALIVE property.' },
          { t: 'Exit', d: '30 days notice by either party.' },
        ].map(({ t, d }) => (
          <View key={t} style={s.termRow}>
            <Text style={s.termKey}>{t}</Text>
            <Text style={s.termVal}>{d}</Text>
          </View>
        ))}
      </View>

      {/* FAQ */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Common questions</Text>
        {[
          { q: 'When will my screen be installed?', a: 'Our team will visit within 48–72 hours of verification. Installation takes ~2 hours.' },
          { q: 'When do I receive my first payout?', a: 'Payouts are processed monthly, 10 days after month end via UPI/NEFT.' },
          { q: 'What if the screen has a problem?', a: 'We monitor screens 24/7 remotely. Hardware issues are resolved within 24 hours.' },
          { q: 'Can I host more than one screen?', a: 'Yes! Tell your relationship manager when they call.' },
        ].map(({ q, a }) => (
          <View key={q} style={s.faqRow}>
            <Text style={s.faqQ}>{q}</Text>
            <Text style={s.faqA}>{a}</Text>
          </View>
        ))}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.textSub, fontSize: 14 },
  banner: {
    backgroundColor: '#1a0505', borderRadius: 18, padding: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  bannerEye: { fontSize: 9, fontWeight: '700', color: '#ef444466', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 },
  bannerName: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 3 },
  bannerSub: { fontSize: 11, color: '#ffffff55' },
  bannerBadges: { flexDirection: 'row', gap: 8 },
  badge: { backgroundColor: '#ffffff10', borderRadius: 10, padding: 10, alignItems: 'center', minWidth: 52 },
  badgeLive: { borderWidth: 1, borderColor: '#22c55e44', backgroundColor: '#22c55e10' },
  badgePending: { borderWidth: 1, borderColor: '#ef444444', backgroundColor: '#ef444410' },
  badgeVal: { fontSize: 14, fontWeight: '800', color: '#fff' },
  badgeLbl: { fontSize: 9, color: '#ffffff55', marginTop: 1 },
  statusStrip: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen: { backgroundColor: C.success },
  dotYellow: { backgroundColor: C.warn },
  statusText: { flex: 1, fontSize: 12, color: C.textSub, lineHeight: 17 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 10 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 11, color: C.textSub, lineHeight: 16 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineLeft: { alignItems: 'center', width: 24 },
  dot24: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot24Done: { backgroundColor: C.primary },
  dot24Active: { borderWidth: 2, borderColor: C.primary, backgroundColor: C.primaryLight },
  dot24Idle: { borderWidth: 2, borderColor: C.border, backgroundColor: C.card },
  dot24Num: { fontSize: 10, fontWeight: '700', color: C.textMuted },
  connector: { width: 2, flex: 1, backgroundColor: C.border, marginTop: 2, marginBottom: 2 },
  timelineContent: { flex: 1, paddingBottom: 14 },
  timelineLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  timelineDesc: { fontSize: 11, color: C.textSub, marginTop: 1 },
  codeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  code: { flex: 1, fontSize: 22, fontWeight: '900', letterSpacing: 4, color: C.text, fontFamily: 'monospace' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  copyBtnText: { fontSize: 12, fontWeight: '600', color: C.textSub },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryLight, borderWidth: 1, borderColor: C.primaryBorder, borderRadius: 10, padding: 10, justifyContent: 'center' },
  shareBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  actionLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  actionSub: { fontSize: 11, color: C.textSub },
  termRow: { flexDirection: 'row', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  termKey: { width: 90, fontSize: 11, fontWeight: '700', color: C.text },
  termVal: { flex: 1, fontSize: 11, color: C.textSub, lineHeight: 16 },
  faqRow: { gap: 3, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  faqQ: { fontSize: 12, fontWeight: '700', color: C.text },
  faqA: { fontSize: 12, color: C.textSub, lineHeight: 17 },
});
