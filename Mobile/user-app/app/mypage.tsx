import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const TICKET_API_URL = 'http://13.124.21.176:8000/api';

type BookingItem = { booking_item_id: number; seat_code: string; token_id: number | null; ticket_status: string };
type Booking = { id: number; booking_no: string; title: string; venue: string; display_time_text: string; poster_color: string; items: BookingItem[] };

const MOCK_BOOKINGS: Booking[] = [
  {
    id: 1, booking_no: 'TP-2026-0001', title: '아이유 콘서트 : The Golden Hour',
    venue: '상암 월드컵 경기장', display_time_text: '2026.09.15 (화) 19:00', poster_color: '#C4192F',
    items: [{ booking_item_id: 1, seat_code: 'R구역 3열 12번', token_id: 42, ticket_status: 'minted' }],
  },
  {
    id: 2, booking_no: 'TP-2026-0002', title: '싸이 흠뻑쇼 SUMMER SWAG 2026',
    venue: '부경대학교 대운동장', display_time_text: '2026.08.20 (목) 18:00', poster_color: '#5B21B6',
    items: [
      { booking_item_id: 2, seat_code: 'A구역 1열 5번', token_id: 43, ticket_status: 'minted' },
      { booking_item_id: 3, seat_code: 'A구역 1열 6번', token_id: null, ticket_status: 'pending' },
    ],
  },
];

function shortAddr(addr: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}···${addr.slice(-4)}`;
}

function TicketCard({ booking, onSeatPress }: { booking: Booking; onSeatPress: (b: Booking, s: BookingItem) => void }) {
  const mintedCount = booking.items.filter(i => i.token_id).length;
  return (
    <View style={tc.card}>
      <View style={[tc.header, { backgroundColor: booking.poster_color }]}>
        <View style={[tc.punch, tc.punchLeft]} />
        <View style={[tc.punch, tc.punchRight]} />
        <View style={tc.headerTop}>
          <View style={tc.categoryChip}><Text style={tc.categoryText}>공연</Text></View>
          <Text style={tc.seatCount}>{mintedCount}/{booking.items.length}석</Text>
        </View>
        <Text style={tc.eventTitle} numberOfLines={2}>{booking.title}</Text>
        <View style={tc.metaRow}>
          <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.65)" />
          <Text style={tc.metaText}>{booking.venue}</Text>
        </View>
        <View style={tc.metaRow}>
          <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.65)" />
          <Text style={tc.metaText}>{booking.display_time_text}</Text>
        </View>
      </View>

      <View style={tc.separator}><View style={tc.sepLine} /></View>

      <View style={tc.body}>
        {booking.items.map((seat, idx) => (
          <TouchableOpacity
            key={seat.booking_item_id}
            style={[tc.seatRow, idx < booking.items.length - 1 && tc.seatRowBorder, !seat.token_id && tc.seatRowDisabled]}
            onPress={() => onSeatPress(booking, seat)}
            disabled={!seat.token_id}
            activeOpacity={0.7}
          >
            <View style={tc.seatLeft}>
              <View style={[tc.statusDot, { backgroundColor: seat.token_id ? '#10B981' : '#F59E0B' }]} />
              <Text style={tc.seatCode}>{seat.seat_code}</Text>
              {!seat.token_id && (
                <View style={tc.pendingBadge}><Text style={tc.pendingText}>처리 중</Text></View>
              )}
            </View>
            {seat.token_id
              ? <View style={tc.qrBtn}><Ionicons name="qr-code-outline" size={13} color="#E11D48" /><Text style={tc.qrBtnText}>QR 보기</Text></View>
              : <Ionicons name="ellipsis-horizontal" size={16} color="#2D2D40" />}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={tc.bookingNo}>{booking.booking_no}</Text>
    </View>
  );
}

export default function MyPageScreen() {
  const { address, accessToken, logout } = useWallet();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBookings = useCallback(async () => {
    if (!address) return;
    if (!accessToken) { setBookings(MOCK_BOOKINGS); setLoading(false); setRefreshing(false); return; }
    try {
      const res = await fetch(`${TICKET_API_URL}/users/${address}/bookings`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBookings((data.data ?? []).map((b: any) => ({ ...b, poster_color: '#E11D48' })));
    } catch {
      setBookings(MOCK_BOOKINGS);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [address, accessToken]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  const handleLogout = () => { logout(); router.replace('/login'); };
  const handleSeatPress = (booking: Booking, seat: BookingItem) => {
    if (!seat.token_id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: '/qr/[tokenId]', params: { tokenId: String(seat.token_id), title: booking.title, venue: booking.venue, date: booking.display_time_text, seatCode: seat.seat_code, posterColor: booking.poster_color.replace('#', '') } });
  };

  if (loading) return <View style={s.loadingBox}><ActivityIndicator size="large" color="#E11D48" /></View>;

  // TODO: 백엔드 연동 시 실명 API 응답으로 교체
  const displayName = 'TicketPro 회원';
  const totalMinted = bookings.reduce((sum, b) => sum + b.items.filter(i => i.token_id).length, 0);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.avatar}><Text style={s.avatarText}>{displayName.slice(0, 1)}</Text></View>
          <View>
            <Text style={s.displayName}>{displayName}</Text>
            <Text style={s.walletAddr}>{shortAddr(address)}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn} accessibilityLabel="로그아웃" hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
          <Ionicons name="log-out-outline" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <View style={s.statsBar}>
        <View style={s.statItem}><Text style={s.statValue}>{bookings.length}</Text><Text style={s.statLabel}>예매 건수</Text></View>
        <View style={s.statDivider} />
        <View style={s.statItem}><Text style={s.statValue}>{totalMinted}</Text><Text style={s.statLabel}>발급된 티켓</Text></View>
        <View style={s.statDivider} />
        <View style={s.statItem}><Text style={[s.statValue, { color: '#10B981', fontSize: 13 }]}>On-chain</Text><Text style={s.statLabel}>저장 방식</Text></View>
      </View>

      <FlatList
        data={bookings}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBookings(); }} tintColor="#E11D48" />}
        ListHeaderComponent={<Text style={s.sectionLabel}>내 티켓</Text>}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}><Ionicons name="ticket-outline" size={38} color="#2D2D40" /></View>
            <Text style={s.emptyTitle}>예매한 티켓이 없어요</Text>
            <Text style={s.emptySub}>웹사이트에서 티켓을 예매하면{'\n'}여기에 표시됩니다</Text>
          </View>
        }
        renderItem={({ item }) => <TicketCard booking={item} onSeatPress={handleSeatPress} />}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  loadingBox: { flex: 1, backgroundColor: '#0A0A14', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E11D48', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  displayName: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  walletAddr: { fontSize: 11, color: '#9CA3AF', marginTop: 2, fontFamily: 'monospace' },
  logoutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  statsBar: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 6, backgroundColor: '#13131F', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingVertical: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  statLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 4, letterSpacing: 0.2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  list: { padding: 20, gap: 16, paddingBottom: 48 },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  empty: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  emptySub: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
});

const tc = StyleSheet.create({
  card: { backgroundColor: '#13131F', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, position: 'relative' },
  punch: { position: 'absolute', bottom: -13, width: 26, height: 26, borderRadius: 13, backgroundColor: '#0A0A14', zIndex: 2 },
  punchLeft: { left: -13 },
  punchRight: { right: -13 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  categoryChip: { backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  categoryText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5 },
  seatCount: { fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: '500' },
  eventTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 26, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  metaText: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  separator: { marginHorizontal: 12, paddingVertical: 1, zIndex: 1 },
  sepLine: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  body: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 6 },
  seatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
  seatRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  seatRowDisabled: { opacity: 0.45 },
  seatLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  seatCode: { fontSize: 14, color: '#FFFFFF', fontWeight: '500' },
  pendingBadge: { backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)' },
  pendingText: { fontSize: 10, color: '#F59E0B', fontWeight: '600' },
  qrBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(225,29,72,0.1)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(225,29,72,0.2)' },
  qrBtnText: { color: '#E11D48', fontSize: 12, fontWeight: '700' },
  bookingNo: { fontSize: 10, color: 'rgba(255,255,255,0.1)', paddingHorizontal: 18, paddingBottom: 12, fontFamily: 'monospace' },
});