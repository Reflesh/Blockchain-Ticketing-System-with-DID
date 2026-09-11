import { Ionicons } from '@expo/vector-icons';
import { useBookingDraft } from '@/context/BookingDraftContext';
import { getEventSessions, type EventSession } from '@/services/ticketApi';
import { router, useLocalSearchParams } from 'expo-router';
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

const STATUS_LABEL: Record<string, string> = {
  ready: '판매 준비',
  open: '예매 가능',
  sold_out: '매진',
  paused: '판매 중지',
  closed: '판매 종료',
};

function firstParam(value: string | string[] | undefined, fallback = '') {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function formatDate(value: string | null) {
  if (!value) return '일정 미정';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export default function SessionSelectionScreen() {
  const params = useLocalSearchParams<{
    eventId: string;
    title?: string;
    venue?: string;
    accentColor?: string;
  }>();
  const eventId = firstParam(params.eventId);
  const title = firstParam(params.title, '공연');
  const venue = firstParam(params.venue);
  const accent = firstParam(params.accentColor, '#E11D48');
  const { startDraft, selectSession } = useBookingDraft();
  const [sessions, setSessions] = useState<EventSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    startDraft({ id: eventId, title, venue, accentColor: accent });
  }, [accent, eventId, startDraft, title, venue]);

  const loadSessions = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    try {
      const data = await getEventSessions(eventId);
      setSessions(Array.isArray(data) ? data : []);
    } catch (error) {
      setSessions([]);
      setLoadError(error instanceof Error ? error.message : '공연 회차를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const handleSelect = (session: EventSession) => {
    if (session.sale_status !== 'open') return;
    selectSession(session);
    router.push({ pathname: '/seats/[sessionId]', params: { sessionId: String(session.id) } });
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.step}>STEP 1 · 회차 선택</Text>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={s.stateText}>공연 회차를 불러오는 중입니다.</Text>
        </View>
      ) : loadError ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={42} color="#4B5563" />
          <Text style={s.errorText}>{loadError}</Text>
          <TouchableOpacity style={[s.retryBtn, { borderColor: accent }]} onPress={() => void loadSessions()}>
            <Text style={[s.retryText, { color: accent }]}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={sessions.length === 0 ? s.emptyList : s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadSessions(true)} tintColor={accent} />}
          ListEmptyComponent={(
            <View style={s.center}>
              <Ionicons name="calendar-clear-outline" size={44} color="#2A2A3A" />
              <Text style={s.stateText}>등록된 공연 회차가 없습니다.</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const enabled = item.sale_status === 'open';
            return (
              <TouchableOpacity
                style={[s.sessionCard, enabled && { borderColor: accent + '66' }, !enabled && s.disabledCard]}
                onPress={() => handleSelect(item)}
                disabled={!enabled}
                activeOpacity={0.8}
              >
                <View style={s.sessionTop}>
                  <Text style={s.sessionName}>{item.session_name || `${item.id}회차`}</Text>
                  <View style={[s.statusBadge, enabled && { backgroundColor: accent + '22' }]}>
                    <Text style={[s.statusText, enabled && { color: accent }]}>
                      {STATUS_LABEL[item.sale_status] || item.sale_status}
                    </Text>
                  </View>
                </View>
                <View style={s.metaRow}>
                  <Ionicons name="time-outline" size={16} color="#9CA3AF" />
                  <Text style={s.metaText}>{formatDate(item.session_start_at)}</Text>
                </View>
                {enabled && <Ionicons name="chevron-forward" size={20} color={accent} style={s.chevron} />}
              </TouchableOpacity>
            );
          }}
        />
      )}
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
  list: { padding: 20, gap: 12 },
  emptyList: { flexGrow: 1 },
  center: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  stateText: { color: '#9CA3AF', fontSize: 14, textAlign: 'center' },
  errorText: { color: '#D1D5DB', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, marginTop: 4 },
  retryText: { fontSize: 14, fontWeight: '700' },
  sessionCard: { position: 'relative', backgroundColor: '#13131F', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 18, gap: 12 },
  disabledCard: { opacity: 0.48 },
  sessionTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 24 },
  sessionName: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  statusBadge: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { color: '#9CA3AF', fontSize: 11, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaText: { color: '#9CA3AF', fontSize: 13 },
  chevron: { position: 'absolute', right: 14, bottom: 16 },
});