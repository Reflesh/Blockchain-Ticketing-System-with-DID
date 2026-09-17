import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import { mapEventResponse, type Concert } from '@/constants/concerts';
import {
  getBookings,
  getUserProfile,
  getWishlist,
  removeWishlist,
  type Booking,
  type BookingItem,
  type UserProfile,
} from '@/services/ticketApi';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AUTH_API_URL } from '@/constants/api';

function shortAddr(addr: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}···${addr.slice(-4)}`;
}

function formatAmount(value: number) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ko-KR')}원`;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    minted: '발급 완료',
    mint_pending: '발급 중',
    confirmed: '확정',
    paid: '결제 완료',
    refunded: '환불 완료',
    transferred: '양도 완료',
    failed: '처리 실패',
  };
  return labels[value] ?? value;
}

function verificationLabel(value: string) {
  const labels: Record<string, string> = {
    verified: '인증 완료',
    pending: '인증 대기',
    failed: '인증 실패',
  };
  return labels[value] ?? value;
}

function TicketCard({
  booking,
  onSeatPress,
}: {
  booking: Booking;
  onSeatPress: (booking: Booking, seat: BookingItem) => void;
}) {
  const mintedCount = booking.items.filter((item) => item.token_id).length;
  return (
    <View style={tc.card}>
      <View style={[tc.header, { backgroundColor: booking.poster_color }]}>
        <View style={[tc.punch, tc.punchLeft]} />
        <View style={[tc.punch, tc.punchRight]} />
        <View style={tc.headerTop}>
          <View style={tc.categoryChip}><Text style={tc.categoryText}>{statusLabel(booking.booking_status)}</Text></View>
          <Text style={tc.seatCount}>{mintedCount}/{booking.items.length}석</Text>
        </View>
        <Text style={tc.eventTitle} numberOfLines={2}>{booking.title}</Text>
        <View style={tc.metaRow}>
          <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.65)" />
          <Text style={tc.metaText}>{booking.venue}</Text>
        </View>
        <View style={tc.metaRow}>
          <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.65)" />
          <Text style={tc.metaText}>{booking.session_name} · {booking.display_time_text}</Text>
        </View>
      </View>

      <View style={tc.separator}><View style={tc.sepLine} /></View>
      <View style={tc.statusRow}>
        <Text style={tc.statusText}>결제 {statusLabel(booking.payment_status)}</Text>
        <Text style={tc.statusText}>블록체인 {statusLabel(booking.blockchain_status)}</Text>
        <Text style={tc.amountText}>{formatAmount(booking.total_amount)}</Text>
      </View>

      <View style={tc.body}>
        {booking.items.map((seat, index) => (
          <TouchableOpacity
            key={seat.booking_item_id}
            style={[tc.seatRow, index < booking.items.length - 1 && tc.seatRowBorder, !seat.token_id && tc.seatRowDisabled]}
            onPress={() => onSeatPress(booking, seat)}
            disabled={!seat.token_id}
            activeOpacity={0.7}
          >
            <View style={tc.seatInfo}>
              <View style={[tc.statusDot, { backgroundColor: seat.token_id ? '#10B981' : '#F59E0B' }]} />
              <View>
                <Text style={tc.seatCode}>{seat.seat_code}</Text>
                <Text style={tc.seatMeta}>
                  {statusLabel(seat.ticket_status)} · {formatAmount(seat.unit_price)}
                  {seat.is_transferred ? ' · 양도됨' : ''}
                </Text>
              </View>
            </View>
            {seat.token_id
              ? <View style={tc.qrBtn}><Ionicons name="qr-code-outline" size={13} color="#E11D48" /><Text style={tc.qrBtnText}>QR 보기</Text></View>
              : <Ionicons name="ellipsis-horizontal" size={16} color="#2D2D40" />}
          </TouchableOpacity>
        ))}
      </View>
      {booking.txHash ? <Text style={tc.txHash} numberOfLines={1}>TX {booking.txHash}</Text> : null}
      <Text style={tc.bookingNo}>{booking.booking_no}</Text>
    </View>
  );
}

function WishlistCard({ item, onRemove }: { item: Concert; onRemove: (id: string) => void }) {
  return (
    <TouchableOpacity
      style={wc.card}
      activeOpacity={0.8}
      onPress={() => router.push({ pathname: '/concert/[concertId]', params: { concertId: item.id } })}
    >
      <View style={[wc.poster, { backgroundColor: item.posterColor }]}>
        <Text style={[wc.posterLetter, { color: item.accentColor }]}>{item.title[0]}</Text>
      </View>
      <View style={wc.info}>
        <Text style={wc.title} numberOfLines={2}>{item.title}</Text>
        <Text style={wc.meta} numberOfLines={1}>{item.displayTime}</Text>
        <Text style={wc.meta} numberOfLines={1}>{item.venue}</Text>
      </View>
      <TouchableOpacity
        style={wc.removeBtn}
        onPress={(event) => { event.stopPropagation(); onRemove(item.id); }}
        accessibilityLabel="찜 삭제"
      >
        <Ionicons name="heart" size={20} color="#E11D48" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function MyPageScreen() {
  const { address, accessToken, displayName: walletDisplayName, logout } = useWallet();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [wishlist, setWishlist] = useState<Concert[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'bookings' | 'wishlist'>('bookings');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadAccountData = useCallback(async () => {
    setLoadError('');
    if (!address || !accessToken) {
      setBookings([]);
      setWishlist([]);
      setProfile(null);
      setLoadError('로그인 정보가 없습니다. 다시 로그인해주세요.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [bookingData, wishlistData, profileData] = await Promise.all([
        getBookings(address, accessToken),
        getWishlist(address, accessToken),
        getUserProfile(address, accessToken).catch(() => null),
      ]);
      setBookings(bookingData);
      setWishlist(wishlistData.map(mapEventResponse));
      setProfile(profileData);
    } catch (error) {
      setBookings([]);
      setWishlist([]);
      setLoadError(error instanceof Error ? error.message : '사용자 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, address]);

  useFocusEffect(useCallback(() => {
    void loadAccountData();
  }, [loadAccountData]));

  const handleLogout = async () => {
    const token = accessToken;
    logout();
    router.replace('/login');
    if (!token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${AUTH_API_URL}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('세션 폐기 실패');
    } catch {
      Alert.alert('로그아웃 안내', '기기에서는 로그아웃되었습니다. 서버 연결 문제로 서버 세션 종료는 확인하지 못했습니다.');
    } finally {
      clearTimeout(timer);
    }
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

  const handleRemoveWishlist = async (eventId: string) => {
    if (!address || !accessToken) return;
    try {
      await removeWishlist(address, eventId, accessToken);
      await loadAccountData();
    } catch (error) {
      Alert.alert('찜 삭제 오류', error instanceof Error ? error.message : '찜 목록에서 삭제하지 못했습니다.');
    }
  };

  if (loading) return <View style={s.loadingBox}><ActivityIndicator size="large" color="#E11D48" /></View>;

  const displayName = profile?.display_name && profile.display_name !== 'TicketPro 회원'
    ? profile.display_name
    : walletDisplayName;
  const totalMinted = bookings.reduce((sum, booking) => sum + booking.items.filter((item) => item.token_id).length, 0);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.avatar}><Text style={s.avatarText}>{displayName.slice(0, 1)}</Text></View>
          <View>
            <Text style={s.displayName}>{displayName}</Text>
            <Text style={s.walletAddr}>{shortAddr(address)}</Text>
            {profile ? <Text style={s.verification}>{verificationLabel(profile.verification_status)}</Text> : null}
          </View>
        </View>
        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn} accessibilityLabel="로그아웃">
          <Ionicons name="log-out-outline" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <View style={s.statsBar}>
        <View style={s.statItem}><Text style={s.statValue}>{bookings.length}</Text><Text style={s.statLabel}>예매 건수</Text></View>
        <View style={s.statDivider} />
        <View style={s.statItem}><Text style={s.statValue}>{totalMinted}</Text><Text style={s.statLabel}>발급된 티켓</Text></View>
        <View style={s.statDivider} />
        <View style={s.statItem}><Text style={s.statValue}>{wishlist.length}</Text><Text style={s.statLabel}>찜한 공연</Text></View>
      </View>

      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, activeTab === 'bookings' && s.activeTab]} onPress={() => setActiveTab('bookings')}>
          <Text style={[s.tabText, activeTab === 'bookings' && s.activeTabText]}>예매내역</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, activeTab === 'wishlist' && s.activeTab]} onPress={() => setActiveTab('wishlist')}>
          <Text style={[s.tabText, activeTab === 'wishlist' && s.activeTabText]}>찜</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadAccountData(); }} tintColor="#E11D48" />}
      >
        {loadError ? (
          <View style={s.empty}>
            <Ionicons name="cloud-offline-outline" size={42} color="#2D2D40" />
            <Text style={s.emptyTitle}>사용자 정보를 불러오지 못했습니다</Text>
            <Text style={s.emptySub}>{loadError}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => void loadAccountData()}><Text style={s.retryBtnText}>다시 시도</Text></TouchableOpacity>
          </View>
        ) : activeTab === 'bookings' ? (
          bookings.length > 0
            ? bookings.map((booking) => <TicketCard key={booking.id} booking={booking} onSeatPress={handleSeatPress} />)
            : <View style={s.empty}><Ionicons name="ticket-outline" size={42} color="#2D2D40" /><Text style={s.emptyTitle}>예매한 티켓이 없어요</Text><Text style={s.emptySub}>웹에서 예매한 티켓도 이곳에 표시됩니다.</Text></View>
        ) : (
          wishlist.length > 0
            ? wishlist.map((item) => <WishlistCard key={item.id} item={item} onRemove={(id) => void handleRemoveWishlist(id)} />)
            : <View style={s.empty}><Ionicons name="heart-outline" size={42} color="#2D2D40" /><Text style={s.emptyTitle}>찜한 공연이 없어요</Text><Text style={s.emptySub}>공연 상세에서 관심 공연을 찜해보세요.</Text></View>
        )}
      </ScrollView>
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
  verification: { marginTop: 2, color: '#10B981', fontSize: 10, fontWeight: '700' },
  logoutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  statsBar: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 12, backgroundColor: '#13131F', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingVertical: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  statLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 4 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  tabs: { flexDirection: 'row', marginHorizontal: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#E11D48' },
  tabText: { color: '#6B7280', fontSize: 14, fontWeight: '700' },
  activeTabText: { color: '#FFFFFF' },
  list: { padding: 20, gap: 16, paddingBottom: 48 },
  empty: { alignItems: 'center', paddingVertical: 70, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  emptySub: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: '#E11D48' },
  retryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});

const tc = StyleSheet.create({
  card: { backgroundColor: '#13131F', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, position: 'relative' },
  punch: { position: 'absolute', bottom: -13, width: 26, height: 26, borderRadius: 13, backgroundColor: '#0A0A14', zIndex: 2 },
  punchLeft: { left: -13 },
  punchRight: { right: -13 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  categoryChip: { backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  categoryText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  seatCount: { fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: '500' },
  eventTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 26, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  metaText: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  separator: { marginHorizontal: 12, paddingVertical: 1 },
  sepLine: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  statusRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 18, paddingTop: 12 },
  statusText: { color: '#9CA3AF', fontSize: 10 },
  amountText: { marginLeft: 'auto', color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  body: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 6 },
  seatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
  seatRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  seatRowDisabled: { opacity: 0.45 },
  seatInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  seatCode: { fontSize: 14, color: '#FFFFFF', fontWeight: '500' },
  seatMeta: { color: '#6B7280', fontSize: 10, marginTop: 2 },
  qrBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(225,29,72,0.1)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(225,29,72,0.2)' },
  qrBtnText: { color: '#E11D48', fontSize: 12, fontWeight: '700' },
  txHash: { color: '#4B5563', fontSize: 9, paddingHorizontal: 18, paddingTop: 4, fontFamily: 'monospace' },
  bookingNo: { fontSize: 10, color: 'rgba(255,255,255,0.2)', paddingHorizontal: 18, paddingVertical: 12, fontFamily: 'monospace' },
});

const wc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', minHeight: 104, padding: 12, borderRadius: 16, backgroundColor: '#13131F', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  poster: { width: 62, height: 80, borderRadius: 10, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  posterLetter: { fontSize: 48, fontWeight: '900', opacity: 0.28 },
  info: { flex: 1, paddingHorizontal: 12, gap: 4 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  meta: { color: '#9CA3AF', fontSize: 11 },
  removeBtn: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(225,29,72,0.1)' },
});
