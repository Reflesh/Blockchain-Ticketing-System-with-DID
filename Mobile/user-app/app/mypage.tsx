import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AUTH_API_URL } from '@/constants/api';
import { mapEventResponse, type Concert } from '@/constants/concerts';
import {
  getBookings,
  getUserProfile,
  getWishlist,
  type Booking,
  type BookingItem,
} from '@/services/ticketApi';

function shortAddr(addr: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}···${addr.slice(-4)}`;
}

function ownsTicket(item: BookingItem, accountAddress: string | null): boolean {
  return Boolean(accountAddress && item.owner_wallet_address &&
    item.owner_wallet_address.toLowerCase() === accountAddress.toLowerCase());
}

function getTransferLabel(item: BookingItem, accountAddress: string | null): string {
  if (item.is_transferred) return ownsTicket(item, accountAddress) ? '양도받은 티켓' : '양도 완료';
  return '';
}

type TicketState = 'pending' | 'minted' | 'used' | 'failed' | 'unavailable';

function getTicketState(booking: Booking, item: BookingItem): TicketState {
  if (item.ticket_status === 'used') return 'used';
  if (item.ticket_status === 'failed' || booking.booking_status === 'failed') return 'failed';
  if (
    item.ticket_status === 'minted' && item.token_id &&
    booking.booking_status === 'minted' &&
    booking.payment_status === 'paid' &&
    booking.blockchain_status === 'confirmed'
  ) return 'minted';
  if (item.ticket_status === 'mint_pending' || booking.booking_status === 'mint_pending') return 'pending';
  return 'unavailable';
}

const STATE_UI: Record<TicketState, { label: string; color: string }> = {
  pending: { label: '발급 중', color: '#F59E0B' },
  minted: { label: 'QR 보기', color: '#10B981' },
  used: { label: '입장 완료', color: '#6B7280' },
  failed: { label: '발급 실패', color: '#EF4444' },
  unavailable: { label: '사용 불가', color: '#6B7280' },
};

function TicketCard({ booking, accountAddress, onSeatPress }: { booking: Booking; accountAddress: string | null; onSeatPress: (b: Booking, s: BookingItem) => void }) {
  const issuedCount = booking.items.filter(item => ownsTicket(item, accountAddress) && ['minted', 'used'].includes(getTicketState(booking, item))).length;
  return (
    <View style={tc.card}>
      <View style={[tc.header, { backgroundColor: booking.poster_color }]}>
        <View style={[tc.punch, tc.punchLeft]} />
        <View style={[tc.punch, tc.punchRight]} />
        <View style={tc.headerTop}>
          <View style={tc.categoryChip}><Text style={tc.categoryText}>공연</Text></View>
          <Text style={tc.seatCount}>{issuedCount}/{booking.items.length}석</Text>
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
        {booking.items.map((seat, idx) => {
          const state = getTicketState(booking, seat);
          const stateUi = STATE_UI[state];
          const isOwner = ownsTicket(seat, accountAddress);
          const transferLabel = getTransferLabel(seat, accountAddress);
          return (
            <TouchableOpacity
              key={seat.booking_item_id}
              style={[tc.seatRow, idx < booking.items.length - 1 && tc.seatRowBorder, (!isOwner || state !== 'minted') && tc.seatRowDisabled]}
              disabled={!isOwner}
              onPress={() => onSeatPress(booking, seat)}
              activeOpacity={0.7}
            >
              <View style={tc.seatLeft}>
                <View style={[tc.statusDot, { backgroundColor: stateUi.color }]} />
                <View style={tc.seatInfo}>
                  <Text style={tc.seatCode}>{seat.seat_code}</Text>
                  {transferLabel !== '' && <Text style={tc.transferLabel}>{transferLabel}</Text>}
                </View>
              </View>
              {isOwner && state === 'minted' ? (
                <View style={tc.qrBtn}>
                  <Ionicons name="qr-code-outline" size={13} color="#E11D48" />
                  <Text style={tc.qrBtnText}>{stateUi.label}</Text>
                </View>
              ) : (
                <View style={[tc.stateBadge, { borderColor: stateUi.color + '55' }]}>
                  <Text style={[tc.stateText, { color: stateUi.color }]}>{isOwner ? stateUi.label : seat.is_transferred ? '양도 완료' : '사용 불가'}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={tc.bookingNo}>{booking.booking_no}</Text>
    </View>
  );
}

export default function MyPageScreen() {
  const { address, signerAddress, accessToken, isLinkedAccount, logout } = useWallet();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [displayName, setDisplayName] = useState('TicketPro 회원');
  const [activeTab, setActiveTab] = useState<'tickets' | 'wishlist'>('tickets');
  const [wishlist, setWishlist] = useState<Concert[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);
  const [wishlistRefreshing, setWishlistRefreshing] = useState(false);
  const [wishlistError, setWishlistError] = useState('');

  const loadBookings = useCallback(async (signal?: AbortSignal) => {
    setLoadError('');
    if (!address || !accessToken) {
      setBookings([]);
      setLoadError('로그인 정보가 없습니다. 다시 로그인해주세요.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [nextBookings, profile] = await Promise.all([
        getBookings(address, accessToken, signal),
        getUserProfile(address, accessToken, signal),
      ]);
      if (signal?.aborted) return;
      if (profile.wallet_address.toLowerCase() !== address.toLowerCase()) {
        throw new Error('로그인 계정과 서버 프로필이 일치하지 않습니다.');
      }
      setDisplayName(profile.display_name || 'TicketPro 회원');
      setBookings(nextBookings);
    } catch (error) {
      if (signal?.aborted) return;
      setBookings([]);
      setLoadError(error instanceof Error ? error.message : '예매 내역을 불러오지 못했습니다.');
    } finally {
      if (!signal?.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [address, accessToken]);

  const loadWishlist = useCallback(async (signal?: AbortSignal) => {
    setWishlistError('');
    if (!address || !accessToken) {
      setWishlist([]);
      setWishlistError('로그인 정보가 없습니다. 다시 로그인해주세요.');
      setWishlistLoading(false);
      setWishlistRefreshing(false);
      return;
    }
    try {
      const events = await getWishlist(address, accessToken, signal);
      if (!signal?.aborted) setWishlist(events.map(mapEventResponse));
    } catch (error) {
      if (signal?.aborted) return;
      setWishlist([]);
      setWishlistError(error instanceof Error ? error.message : '찜 목록을 불러오지 못했습니다.');
    } finally {
      if (!signal?.aborted) { setWishlistLoading(false); setWishlistRefreshing(false); }
    }
  }, [address, accessToken]);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setWishlistLoading(true);
    void loadBookings(controller.signal);
    void loadWishlist(controller.signal);
    return () => controller.abort();
  }, [loadBookings, loadWishlist]));

  const handleLogout = async () => {
    const token = accessToken;
    await logout();
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
    if (!ownsTicket(seat, address)) {
      Alert.alert(seat.is_transferred ? '양도 완료' : '사용 불가', '현재 본인이 소유한 티켓만 QR을 만들 수 있습니다.');
      return;
    }
    const state = getTicketState(booking, seat);
    if (state !== 'minted' || !seat.token_id) {
      const messages: Record<TicketState, string> = {
        pending: '블록체인 티켓을 발급하고 있습니다. 잠시 후 다시 확인해주세요.',
        minted: '',
        used: '이미 입장 처리된 티켓은 새 QR을 만들 수 없습니다.',
        failed: '티켓 발급에 실패했습니다. 웹 예매 내역에서 환불 상태를 확인해주세요.',
        unavailable: '현재 QR을 발급할 수 없는 티켓입니다.',
      };
      Alert.alert(STATE_UI[state].label, messages[state]);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: '/qr/[tokenId]', params: { tokenId: String(seat.token_id), title: booking.title, venue: booking.venue, date: booking.display_time_text, seatCode: seat.seat_code, posterColor: booking.poster_color.replace('#', '') } });
  };

  const totalMinted = bookings.reduce(
    (sum, booking) => sum + booking.items.filter(item => ownsTicket(item, address) && ['minted', 'used'].includes(getTicketState(booking, item))).length,
    0,
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.avatar}><Text style={s.avatarText}>{displayName.slice(0, 1)}</Text></View>
          <View>
            <Text style={s.displayName}>{displayName}</Text>
            <Text style={s.walletAddr}>{shortAddr(address)}</Text>
            <Text style={[s.linkState, !isLinkedAccount && s.linkStateError]}>
              {isLinkedAccount ? '웹 계정 연결 확인됨' : '계정 연결 필요'}
              {signerAddress && address && signerAddress.toLowerCase() !== address.toLowerCase() ? ' · 모바일 Wallet' : ''}
            </Text>
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

      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, activeTab === 'tickets' && s.activeTab]} onPress={() => setActiveTab('tickets')} accessibilityRole="tab" accessibilityState={{ selected: activeTab === 'tickets' }}>
          <Text style={[s.tabText, activeTab === 'tickets' && s.activeTabText]}>내 티켓</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, activeTab === 'wishlist' && s.activeTab]} onPress={() => setActiveTab('wishlist')} accessibilityRole="tab" accessibilityState={{ selected: activeTab === 'wishlist' }}>
          <Text style={[s.tabText, activeTab === 'wishlist' && s.activeTabText]}>찜 목록</Text>
        </TouchableOpacity>
      </View>

      {(activeTab === 'tickets' ? loading : wishlistLoading) ? (
        <View style={s.loadingBox}><ActivityIndicator size="large" color="#E11D48" /></View>
      ) : activeTab === 'tickets' ? (
      <FlatList
        key="tickets"
        data={bookings}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBookings(); }} tintColor="#E11D48" />}
        ListHeaderComponent={<Text style={s.sectionLabel}>내 티켓</Text>}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name={loadError ? 'cloud-offline-outline' : 'ticket-outline'} size={38} color="#2D2D40" />
            </View>
            <Text style={s.emptyTitle}>{loadError ? '예매 내역을 불러오지 못했습니다' : '예매한 티켓이 없어요'}</Text>
            <Text style={s.emptySub}>
              {loadError || <>웹사이트에서 티켓을 예매하면{'\n'}여기에 표시됩니다</>}
            </Text>
            {loadError !== '' && (
              <TouchableOpacity style={s.retryBtn} onPress={() => void loadBookings()}>
                <Text style={s.retryBtnText}>다시 시도</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => <TicketCard booking={item} accountAddress={address} onSeatPress={handleSeatPress} />}
      />
      ) : (
        <FlatList
          key="wishlist"
          data={wishlist}
          keyExtractor={item => item.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={wishlistRefreshing} onRefresh={() => { setWishlistRefreshing(true); void loadWishlist(); }} tintColor="#E11D48" />}
          ListHeaderComponent={<Text style={s.sectionLabel}>찜한 공연</Text>}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name={wishlistError ? 'cloud-offline-outline' : 'heart-outline'} size={38} color="#2D2D40" /></View>
              <Text style={s.emptyTitle}>{wishlistError ? '찜 목록을 불러오지 못했습니다' : '아직 찜한 공연이 없어요'}</Text>
              <Text style={s.emptySub}>{wishlistError || '공연 상세 화면에서 하트를 누르면 여기에 표시됩니다.'}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={() => wishlistError ? void loadWishlist() : router.push('/')}>
                <Text style={s.retryBtnText}>{wishlistError ? '다시 시도' : '공연 보러 가기'}</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={tc.card} onPress={() => router.push({ pathname: '/concert/[concertId]', params: { concertId: item.id } })} accessibilityLabel={`${item.title} 상세 보기`}>
              <View style={[tc.header, { backgroundColor: item.posterColor }]}>
                <View style={tc.headerTop}><Text style={tc.categoryText}>{item.genre}</Text><Ionicons name="heart" size={18} color="#E11D48" /></View>
                <Text style={tc.eventTitle}>{item.title}</Text>
                <Text style={tc.metaText}>{item.venue}</Text>
                <Text style={tc.metaText}>{item.displayTime}</Text>
              </View>
              <View style={s.wishlistFooter}><Text style={tc.seatCode}>{item.price}</Text><Text style={tc.qrBtnText}>상세 보기 ›</Text></View>
            </TouchableOpacity>
          )}
        />
      )}
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
  linkState: { fontSize: 10, color: '#10B981', marginTop: 3 },
  linkStateError: { color: '#EF4444' },
  logoutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  statsBar: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 6, backgroundColor: '#13131F', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingVertical: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  statLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 4, letterSpacing: 0.2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: 12, gap: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#13131F' },
  activeTab: { backgroundColor: 'rgba(225,29,72,0.15)' },
  tabText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  activeTabText: { color: '#E11D48' },
  wishlistFooter: { flexDirection: 'row', justifyContent: 'space-between', padding: 18 },
  list: { padding: 20, gap: 16, paddingBottom: 48 },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  empty: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  emptySub: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: '#E11D48' },
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
  seatInfo: { gap: 4 },
  transferLabel: { fontSize: 10, color: '#9CA3AF' },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  seatCode: { fontSize: 14, color: '#FFFFFF', fontWeight: '500' },
  stateBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.025)' },
  stateText: { fontSize: 10, fontWeight: '700' },
  qrBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(225,29,72,0.1)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(225,29,72,0.2)' },
  qrBtnText: { color: '#E11D48', fontSize: 12, fontWeight: '700' },
  bookingNo: { fontSize: 10, color: 'rgba(255,255,255,0.1)', paddingHorizontal: 18, paddingBottom: 12, fontFamily: 'monospace' },
});
