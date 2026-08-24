import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../../lib/colors';
import { clearSession, loadSession } from '../../lib/storage';
import { unregisterPush } from '../../lib/notifications';

const TABS = [
  { name: 'index',      title: 'Overview', icon: 'grid-outline'        },
  { name: 'earnings',   title: 'Earnings', icon: 'cash-outline'        },
  { name: 'offers',     title: 'Offers',   icon: 'pricetag-outline'    },
  { name: 'flyers',     title: 'Flyers',   icon: 'image-outline'       },
  { name: 'kyc',        title: 'KYC',      icon: 'shield-checkmark-outline' },
] as const;

export default function DashboardLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const logout = async () => {
    // Read the session BEFORE clearing it — unregisterPush needs the signed
    // token for auth. The network call itself is fire-and-forget so sign-out
    // never waits on it.
    const session = await loadSession();
    void unregisterPush(session);
    await clearSession();
    router.replace('/(auth)/sign-in');
  };

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: C.card },
        headerTitleStyle: { fontSize: 16, fontWeight: '700', color: C.text },
        headerShadowVisible: false,
        headerRight: () => (
          <TouchableOpacity onPress={logout} style={{ marginRight: 16 }}>
            <Text style={s.signOut}>Sign out</Text>
          </TouchableOpacity>
        ),
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarStyle: { paddingBottom: insets.bottom > 0 ? insets.bottom : 8, height: 60 + (insets.bottom > 0 ? insets.bottom : 8) },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => {
          const tab = TABS.find((t) => t.name === route.name);
          return <Ionicons name={(tab?.icon ?? 'grid-outline') as 'grid-outline'} size={size - 2} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index"    options={{ title: 'Overview' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="offers"   options={{ title: 'Offers'   }} />
      <Tabs.Screen name="flyers"   options={{ title: 'Flyers'   }} />
      <Tabs.Screen name="kyc"      options={{ title: 'KYC'      }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  signOut: { fontSize: 13, color: C.textSub, fontWeight: '600' },
});
