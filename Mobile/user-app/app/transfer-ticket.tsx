import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWallet } from '@/context/WalletContext';
import { TICKET_API_URL } from '@/constants/api';
import { authenticatedFetch } from '@/lib/sessionTransport';
import { getBookings, type BookingItem } from '@/services/ticketApi';

type Intent = { request_id: string; seat_code: string; recipient_wallet: string; status: string };
export default function TransferTicketScreen() {
  const { bookingItemId } = useLocalSearchParams<{ bookingItemId: string }>();
  const { wallet, address, accessToken } = useWallet();
  const [item, setItem] = useState<BookingItem | null>(null);
  const [recipient, setRecipient] = useState('');
  const [requests, setRequests] = useState<Intent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const direct = !!wallet && wallet.address.toLowerCase() === address?.toLowerCase();
  const call = useCallback(async (path: string, body?: object) => {
    if (!accessToken) throw new Error('로그인이 필요합니다.');
    const response = await authenticatedFetch(`${TICKET_API_URL}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '양도 요청에 실패했습니다.');
    return data;
  }, [accessToken]);
  const load = useCallback(async () => {
    if (!address || !accessToken) return;
    try {
      const [bookings, intents] = await Promise.all([getBookings(address, accessToken), call('/mobile-transfers')]);
      setItem(bookings.flatMap(b => b.items).find(i => String(i.booking_item_id) === bookingItemId) ?? null);
      setRequests(intents.data ?? []); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '티켓을 불러오지 못했습니다.'); }
  }, [address, accessToken, bookingItemId, call]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function transfer() {
    if (inFlight.current || !wallet || !address || !item) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (item.is_transferred || item.ticket_status !== 'minted' || item.owner_wallet_address?.toLowerCase() !== address.toLowerCase()) throw new Error('본인 소유의 미사용·미양도 티켓만 양도할 수 있습니다.');
      if (!recipient.trim()) throw new Error('수령인의 닉네임·등록 이름·지갑 주소를 입력해주세요.');
      if (direct) {
        const payload = { wallet_address: address, booking_item_id: item.booking_item_id, companion_username: recipient.trim() };
        const { data: challenge } = await call('/transfer-ticket/challenge', payload);
        const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.message);
        const result = await call('/transfer-ticket', { ...payload, signature, nonce: Number(challenge.message.nonce), deadline: Number(challenge.message.deadline) });
        Alert.alert(result.status === 'pending' ? '양도 처리 중' : '양도 완료', result.message);
      } else {
        const result = await call('/mobile-transfers', { booking_item_id: item.booking_item_id, companion_username: recipient.trim() });
        Alert.alert('양도 요청 완료', result.message);
      }
      setRecipient(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '양도에 실패했습니다.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <TouchableOpacity onPress={() => router.back()}><Text style={s.note}>‹ 돌아가기</Text></TouchableOpacity>
    <Text style={s.title}>동반인 티켓 양도</Text>
    <View style={s.card}><Text style={s.heading}>{item ? `${item.seat_code} · 티켓 #${item.token_id}` : '티켓 확인 중'}</Text>
      <Text style={s.note}>{direct ? '양도는 1회만 가능하며 취소할 수 없습니다.' : '모바일 전용 키는 양도를 요청합니다. 10분 이내에 웹 마이페이지에서 NFT 소유 지갑으로 승인하면 양도가 실행됩니다.'}</Text>
      <TextInput style={s.input} value={recipient} onChangeText={setRecipient} autoCapitalize="none" placeholder="수령인 닉네임·이름·지갑 주소" placeholderTextColor="#73738C" editable={!busy}/>
      <TouchableOpacity disabled={busy || !item || item.is_transferred || item.ticket_status !== 'minted'} style={s.button} onPress={() => Alert.alert('티켓 양도', `${recipient.trim()} 님에게 ${direct ? '양도할까요? 양도 후에는 되돌릴 수 없습니다.' : '양도를 요청할까요?'}`, [{ text: '취소' }, { text: '확인', onPress: () => void transfer() }])}>{busy ? <ActivityIndicator color="#FFFFFF"/> : <Text style={s.buttonText}>{direct ? '서명하고 양도하기' : '웹 승인 요청하기'}</Text>}</TouchableOpacity>
    </View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <TouchableOpacity onPress={() => void load()}><Text style={s.note}>요청 상태 새로고침 ↻</Text></TouchableOpacity>
    {requests.map(r => <View key={r.request_id} style={s.card}><Text style={s.heading}>{r.seat_code}</Text><Text style={s.note}>{r.recipient_wallet}</Text><Text style={s.note}>{({ pending: '웹 승인 대기', processing: '처리 중', confirmed: '양도 완료', expired: '요청 만료', cancelled: '요청 취소', failed: '양도 실패' } as Record<string, string>)[r.status] ?? r.status}</Text>{r.status === 'pending' && <TouchableOpacity disabled={busy} onPress={() => void call(`/mobile-transfers/${r.request_id}/cancel`, {}).then(load).catch(e => setError(e.message))}><Text style={s.error}>요청 취소</Text></TouchableOpacity>}</View>)}
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#0A0A14' }, content: { padding: 24, gap: 20, paddingBottom: 60 }, title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' }, card: { padding: 20, borderRadius: 20, backgroundColor: '#13131F', gap: 14 }, heading: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' }, note: { color: '#9CA3AF', lineHeight: 22 }, input: { backgroundColor: '#242436', borderRadius: 12, padding: 14, color: '#FFFFFF' }, button: { backgroundColor: '#E11D48', padding: 15, borderRadius: 12, alignItems: 'center' }, buttonText: { color: '#FFFFFF', fontWeight: '600' }, error: { color: '#FB7185', lineHeight: 22 } });
