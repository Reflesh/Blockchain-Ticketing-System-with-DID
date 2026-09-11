import { Ionicons } from '@expo/vector-icons';
import { useBookingDraft } from '@/context/BookingDraftContext';
import { getSessionSeats, type Seat } from '@/services/ticketApi';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const MAX_SEATS_PER_BOOKING = 4;

const STATUS_LABEL: Record<string, string> = {
  available: '선택 가능',
  holding: '선택 중',
  booked: '예매 완료',
  locked: '판매 잠금',
  invited: '초대석',
  disabled: '사용 불가',
};

function formatPrice(amount: number) {
  const numericAmount = Math.max(0, Number(amount) || 0);
  return numericAmount === 0 ? '무료' : `${numericAmount.toLocaleString('ko-KR')}원`;
}

export default function SeatSelectionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { event, session, seats: draftSeats, setSelectedSeats } = useBookingDraft();
  const accent = event?.accentColor || '#E11D48';
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>(
    session?.id === Number(sessionId) ? draftSeats.map((seat) => seat.id) : [],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadSeats = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    try {
      const data = await getSessionSeats(sessionId);
      const nextSeats = Array.isArray(data) ? data : [];
      setSeats(nextSeats);
      setSelectedIds((current) => current.filter((id) => nextSeats.some((seat) => seat.id === id && seat.status === 'available')));
    } catch (error) {
      setSeats([]);
      setLoadError(error instanceof Error ? error.message : '좌석 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => { void loadSeats(); }, [loadSeats]);

  const selectedSeats = useMemo(
    () => selectedIds
      .map((id) => seats.find((seat) => seat.id === id))
      .filter((seat): seat is Seat => seat !== undefined),
    [seats, selectedIds],
  );
  const totalAmount = selectedSeats.reduce((sum, seat) => sum + (Number(seat.price_amount) || 0), 0);

  const toggleSeat = (seat: Seat) => {
    if (seat.status !== 'available') return;
    setSelectedIds((current) => {
      if (current.includes(seat.id)) return current.filter((id) => id !== seat.id);
      if (current.length >= MAX_SEATS_PER_BOOKING) {
        Alert.alert('좌석 선택 제한', `한 번에 최대 ${MAX_SEATS_PER_BOOKING}석까지만 선택할 수 있습니다.`);
        return current;
      }
      return [...current, seat.id];
    });
  };

  const continueBooking = () => {
    if (selectedSeats.length === 0) return;
    setSelectedSeats(selectedSeats);
    router.push('/booking-confirm');
  };

  if (!event || !session || session.id !== Number(sessionId)) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#4B5563" />
          <Text style={s.stateText}>회차 선택 정보가 없습니다.{`\n`}공연 상세에서 다시 선택해주세요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.step}>STEP 2 · 좌석 선택</Text>
          <Text style={s.title} numberOfLines={1}>{session.session_name}</Text>
        </View>
      </View>

      <View style={s.stageWrap}>
        <View style={[s.stage, { borderTopColor: accent }]} />
        <Text style={s.stageText}>STAGE</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={s.stateText}>좌석 정보를 불러오는 중입니다.</Text>
        </View>
      ) : loadError ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={42} color="#4B5563" />
          <Text style={s.errorText}>{loadError}</Text>
          <TouchableOpacity style={[s.retryBtn, { borderColor: accent }]} onPress={() => void loadSeats()}>
            <Text style={[s.retryText, { color: accent }]}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={seats}
          numColumns={3}
          keyExtractor={(item) => String(item.id)}
          columnWrapperStyle={s.seatRow}
          contentContainerStyle={seats.length === 0 ? s.emptyList : s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadSeats(true)} tintColor={accent} />}
          ListEmptyComponent={(
            <View style={s.center}>
              <Ionicons name="grid-outline" size={44} color="#2A2A3A" />
              <Text style={s.stateText}>등록된 좌석이 없습니다.</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const available = item.status === 'available';
            const selected = selectedIds.includes(item.id);
            return (
              <TouchableOpacity
                style={[
                  s.seatCard,
                  !available && s.unavailableSeat,
                  selected && { borderColor: accent, backgroundColor: accent + '22' },
                ]}
                disabled={!available}
                onPress={() => toggleSeat(item)}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={selected ? 'checkmark-circle' : available ? 'radio-button-off' : 'close-circle-outline'}
                  size={18}
                  color={selected ? accent : available ? '#9CA3AF' : '#4B5563'}
                />
                {selected && (
                  <View style={[s.selectionOrder, { backgroundColor: accent }]}>
                    <Text style={s.selectionOrderText}>{selectedIds.indexOf(item.id) + 1}</Text>
                  </View>
                )}
                <Text style={[s.seatCode, selected && { color: accent }]} numberOfLines={1}>{item.seat_code}</Text>
                <Text style={s.seatGrade}>{item.grade || item.section_name || '일반석'}</Text>
                <Text style={s.seatPrice}>{formatPrice(item.price_amount)}</Text>
                {!available && <Text style={s.seatStatus}>{STATUS_LABEL[item.status] || item.status}</Text>}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <SafeAreaView edges={['bottom']} style={s.footer}>
        <View>
          <Text style={s.selectionText}>{selectedSeats.length}/{MAX_SEATS_PER_BOOKING}석 선택</Text>
          <Text style={s.totalText}>{formatPrice(totalAmount)}</Text>
        </View>
        <TouchableOpacity
          style={[s.continueBtn, { backgroundColor: accent }, selectedSeats.length === 0 && s.continueDisabled]}
          disabled={selectedSeats.length === 0}
          onPress={continueBooking}
        >
          <Text style={s.continueText}>예매 내용 확인</Text>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  headerText: { flex: 1, marginLeft: 12 },
  step: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginTop: 3 },
  stageWrap: { alignItems: 'center', paddingTop: 22, paddingBottom: 8 },
  stage: { width: '72%', borderTopWidth: 4, borderRadius: 100, opacity: 0.7 },
  stageText: { marginTop: 7, color: '#4B5563', fontSize: 10, fontWeight: '700', letterSpacing: 3 },
  list: { padding: 16, paddingBottom: 120 },
  emptyList: { flexGrow: 1 },
  seatRow: { gap: 10, marginBottom: 10 },
  seatCard: { position: 'relative', flex: 1, minWidth: 0, minHeight: 126, backgroundColor: '#13131F', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 12, gap: 5 },
  unavailableSeat: { opacity: 0.4, backgroundColor: '#101019' },
  selectionOrder: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  selectionOrderText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  seatCode: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  seatGrade: { color: '#9CA3AF', fontSize: 11 },
  seatPrice: { color: '#D1D5DB', fontSize: 11, fontWeight: '600' },
  seatStatus: { color: '#6B7280', fontSize: 10, marginTop: 'auto' },
  center: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  stateText: { color: '#9CA3AF', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  errorText: { color: '#D1D5DB', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, marginTop: 4 },
  retryText: { fontSize: 14, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, backgroundColor: '#13131F', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 18, paddingTop: 12 },
  selectionText: { color: '#9CA3AF', fontSize: 11 },
  totalText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 2 },
  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15 },
  continueDisabled: { opacity: 0.35 },
  continueText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});