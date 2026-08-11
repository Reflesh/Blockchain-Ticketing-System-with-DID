import { useWallet } from '@/context/WalletContext';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const TICKET_API_URL = 'http://13.124.21.176:8000/api';

type BookingItem = {
  booking_item_id: number;
  seat_code: string;
  token_id: number | null;
  ticket_status: string;
};

type Booking = {
  id: number;
  booking_no: string;
  title: string;
  venue: string;
  display_time_text: string;
  poster_color: string;
  items: BookingItem[];
};

const MOCK_BOOKINGS: Booking[] = [
  {
    id: 1,
    booking_no: 'TP-2026-0001',
    title: '아이유 콘서트 : The Golden Hour',
    venue: '상암 월드컵 경기장',
    display_time_text: '2026.09.15 (화) 19:00',
    poster_color: '#C4192F',
    items: [
      { booking_item_id: 1, seat_code: 'R구역 3열 12번', token_id: 42, ticket_status: 'minted' },
    ],
  },
  {
    id: 2,
    booking_no: 'TP-2026-0002',
    title: '싸이 흠뻑쇼 SUMMER SWAG 2026',
    venue: '부경대학교 대운동장',
    display_time_text: '2026.08.20 (목) 18:00',
    poster_color: '#5B21B6',
    items: [
      { booking_item_id: 2, seat_code: 'A구역 1열 5번', token_id: 43, ticket_status: 'minted' },
      { booking_item_id: 3, seat_code: 'A구역 1열 6번', token_id: null, ticket_status: 'pending' },
    ],
  },
];

export default function MyPageScreen() {
  const { address, accessToken, logout } = useWallet();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBookings = useCallback(async () => {
    if (!address) return;
    if (!accessToken) {
      setBookings(MOCK_BOOKINGS);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await fetch(`${TICKET_API_URL}/users/${address}/bookings`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const enriched = (data.data ?? []).map((b: any) => ({
        ...b,
        poster_color: '#E11D48',
      }));
      setBookings(enriched);
    } catch {
      setBookings(MOCK_BOOKINGS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [address, accessToken]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const handleSeatPress = (booking: Booking, seat: BookingItem) => {
    if (!seat.token_id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/qr/[tokenId]',
      params: {
        tokenId: String(seat.token_id),
        title: booking.title,
        venue: booking.venue,
        date: booking.display_time_text,
        seatCode: seat.seat_code,
        posterColor: booking.poster_color.replace('#', ''),
      },
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#E11D48" />
      </View>
    );
  }

  // TODO: 백엔드 연동 시 실명 API 응답으로 교체
  const displayName = '이재훈';

  return (
    <SafeAreaView style={styles.safe}>
      {/* 상단 바 */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topBarTitle}>내 티켓</Text>
          <Text style={styles.topBarAddress}>{displayName}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {/* 티켓 목록 */}
      <FlatList
        data={bookings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadBookings(); }}
            tintColor="#E11D48"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🎫</Text>
            <Text style={styles.emptyTitle}>예매한 티켓이 없어요</Text>
            <Text style={styles.emptySub}>
              웹사이트에서 티켓을 예매하면 여기에 표시됩니다
            </Text>
          </View>
        }
        renderItem={({ item: booking }) => (
          <View style={styles.card}>
            <View style={[styles.poster, { backgroundColor: booking.poster_color }]}>
              <Text style={styles.posterTitle} numberOfLines={2}>
                {booking.title}
              </Text>
              <View style={styles.posterMeta}>
                <Text style={styles.posterMetaText}>📍  {booking.venue}</Text>
                <Text style={styles.posterMetaText}>🕐  {booking.display_time_text}</Text>
              </View>
            </View>

            <View style={styles.seatSection}>
              <Text style={styles.seatSectionLabel}>좌석</Text>
              {booking.items.map((seat, idx) => (
                <TouchableOpacity
                  key={seat.booking_item_id}
                  style={[
                    styles.seatRow,
                    idx < booking.items.length - 1 && styles.seatRowDivider,
                    !seat.token_id && styles.seatRowDisabled,
                  ]}
                  onPress={() => handleSeatPress(booking, seat)}
                  disabled={!seat.token_id}
                  activeOpacity={0.7}
                >
                  <View style={styles.seatLeft}>
                    <Text style={styles.seatCode}>{seat.seat_code}</Text>
                    {!seat.token_id && (
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingText}>처리 중</Text>
                      </View>
                    )}
                  </View>
                  {seat.token_id ? (
                    <View style={styles.qrBadge}>
                      <Text style={styles.qrBadgeText}>QR 보기  →</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.bookingNo}>{booking.booking_no}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F0F1A' },
  loadingBox: {
    flex: 1, backgroundColor: '#0F0F1A',
    justifyContent: 'center', alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  topBarTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  topBarAddress: { fontSize: 12, color: '#8E8EA0', marginTop: 2 },
  logoutBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  logoutText: { color: '#8E8EA0', fontSize: 13, fontWeight: '500' },
  list: { padding: 16, gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  poster: { padding: 20, gap: 10 },
  posterTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', lineHeight: 24 },
  posterMeta: { gap: 4 },
  posterMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  seatSection: { padding: 16 },
  seatSectionLabel: {
    fontSize: 11, fontWeight: '600', color: '#8E8EA0',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  seatRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12,
  },
  seatRowDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  seatRowDisabled: { opacity: 0.4 },
  seatLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seatCode: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  pendingBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  pendingText: { fontSize: 11, color: '#8E8EA0' },
  qrBadge: {
    backgroundColor: 'rgba(225,29,72,0.12)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  qrBadgeText: { color: '#E11D48', fontSize: 13, fontWeight: '600' },
  bookingNo: {
    fontSize: 10, color: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16, paddingBottom: 12, fontFamily: 'monospace',
  },
  emptyBox: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  emptySub: {
    fontSize: 14, color: '#8E8EA0',
    textAlign: 'center', paddingHorizontal: 32, lineHeight: 20,
  },
});