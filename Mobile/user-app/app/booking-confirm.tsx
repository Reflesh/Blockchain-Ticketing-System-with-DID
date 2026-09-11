import { Ionicons } from '@expo/vector-icons';
import { useBookingDraft } from '@/context/BookingDraftContext';
import { useWallet } from '@/context/WalletContext';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function formatDate(value: string | null | undefined) {
  if (!value) return '일정 미정';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function formatPrice(amount: number) {
  const numericAmount = Math.max(0, Number(amount) || 0);
  return numericAmount === 0 ? '무료' : `${numericAmount.toLocaleString('ko-KR')}원`;
}

export default function BookingConfirmScreen() {
  const { address } = useWallet();
  const { event, session, seats, clearDraft } = useBookingDraft();
  const accent = event?.accentColor || '#E11D48';
  const totalAmount = seats.reduce((sum, seat) => sum + (Number(seat.price_amount) || 0), 0);

  const cancelDraft = () => {
    Alert.alert('예매 선택 취소', '선택한 회차와 좌석 정보를 삭제할까요?', [
      { text: '계속 선택', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => { clearDraft(); router.replace('/'); } },
    ]);
  };

  const continueAfterAuth = () => {
    if (!address) {
      router.push({ pathname: '/login', params: { returnTo: '/booking-confirm' } });
      return;
    }
    Alert.alert('예매 준비 완료', '결제 및 티켓 발급 기능은 로그인 연동 이후 연결됩니다.');
  };

  if (!event || !session || seats.length === 0) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={s.empty}>
          <Ionicons name="ticket-outline" size={48} color="#343445" />
          <Text style={s.emptyTitle}>선택한 예매 정보가 없습니다.</Text>
          <TouchableOpacity style={[s.homeBtn, { backgroundColor: accent }]} onPress={() => router.replace('/')}>
            <Text style={s.primaryText}>공연 둘러보기</Text>
          </TouchableOpacity>
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
          <Text style={s.step}>STEP 3 · 예매 내용 확인</Text>
          <Text style={s.title}>선택 정보를 확인해주세요</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.ticketCard, { borderTopColor: accent }]}>
          <View style={s.iconWrap}>
            <Ionicons name="ticket" size={22} color={accent} />
          </View>
          <Text style={s.eventTitle}>{event.title}</Text>
          <View style={s.divider} />
          <View style={s.infoRow}><Text style={s.infoKey}>공연장</Text><Text style={s.infoValue}>{event.venue || '-'}</Text></View>
          <View style={s.infoRow}><Text style={s.infoKey}>회차</Text><Text style={s.infoValue}>{session.session_name}</Text></View>
          <View style={s.infoRow}><Text style={s.infoKey}>일시</Text><Text style={s.infoValue}>{formatDate(session.session_start_at)}</Text></View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>선택 좌석</Text>
          {seats.map((seat) => (
            <View key={seat.id} style={s.seatRow}>
              <View style={[s.seatDot, { backgroundColor: accent }]} />
              <View style={s.seatInfo}>
                <Text style={s.seatCode}>{seat.seat_code}</Text>
                <Text style={s.seatMeta}>{seat.grade || seat.section_name || '일반석'}</Text>
              </View>
              <Text style={s.seatPrice}>{formatPrice(seat.price_amount)}</Text>
            </View>
          ))}
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>총 결제 예정 금액</Text>
            <Text style={[s.totalValue, { color: accent }]}>{formatPrice(totalAmount)}</Text>
          </View>
        </View>

        <View style={s.notice}>
          <Ionicons name="information-circle-outline" size={18} color="#9CA3AF" />
          <Text style={s.noticeText}>현재 단계에서는 좌석을 임시 선택한 것이며 실제 좌석 확보나 결제는 진행되지 않습니다.</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={s.footer}>
        <TouchableOpacity style={s.cancelBtn} onPress={cancelDraft}>
          <Text style={s.cancelText}>선택 취소</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.loginBtn, { backgroundColor: accent }]} onPress={continueAfterAuth}>
          <Ionicons name={address ? 'card-outline' : 'log-in-outline'} size={18} color="#FFFFFF" />
          <Text style={s.primaryText}>{address ? '결제 단계 확인' : '로그인 후 계속'}</Text>
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
  content: { padding: 20, gap: 14, paddingBottom: 110 },
  ticketCard: { backgroundColor: '#13131F', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderTopWidth: 3, padding: 20, gap: 12 },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  eventTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '800', lineHeight: 28 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 4 },
  infoRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  infoKey: { width: 48, color: '#6B7280', fontSize: 12, fontWeight: '600' },
  infoValue: { flex: 1, color: '#D1D5DB', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: '#13131F', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 18, gap: 12 },
  cardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginBottom: 2 },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seatDot: { width: 7, height: 7, borderRadius: 4 },
  seatInfo: { flex: 1 },
  seatCode: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  seatMeta: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  seatPrice: { color: '#D1D5DB', fontSize: 13, fontWeight: '600' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { color: '#D1D5DB', fontSize: 13, fontWeight: '600' },
  totalValue: { fontSize: 19, fontWeight: '800' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,255,255,0.035)', borderRadius: 14, padding: 14 },
  noticeText: { flex: 1, color: '#9CA3AF', fontSize: 12, lineHeight: 18 },
  footer: { flexDirection: 'row', gap: 10, backgroundColor: '#13131F', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 18, paddingTop: 12 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#9CA3AF', fontSize: 14, fontWeight: '700' },
  loginBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 15, borderRadius: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  emptyTitle: { color: '#D1D5DB', fontSize: 15, fontWeight: '600' },
  homeBtn: { borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13, marginTop: 4 },
});