import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MOCK_CONCERTS } from '@/constants/concerts';

const TABS = ['상세정보', '기대평', 'Q&A', '공연장정보', '예매유의사항'];

export default function ConcertDetailScreen() {
  const { concertId } = useLocalSearchParams<{ concertId: string }>();
  const concert = MOCK_CONCERTS.find((c) => c.id === concertId);
  const [activeTab, setActiveTab] = useState(0);

  if (!concert) {
    return (
      <SafeAreaView style={s.safe}>
        <TouchableOpacity style={s.errorBack} onPress={() => router.back()} accessibilityLabel="돌아가기">
          <Ionicons name="chevron-back" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 15 }}>돌아가기</Text>
        </TouchableOpacity>
        <Text style={{ color: '#9CA3AF', padding: 20 }}>
          공연 정보를 찾을 수 없습니다.
        </Text>
      </SafeAreaView>
    );
  }

  const accent = concert.accentColor;

  return (
    <View style={s.root}>
      {/* ── Poster header ── */}
      <View style={[s.posterArea, { backgroundColor: concert.posterColor }]}>
        <View style={[s.posterGlow, { backgroundColor: accent + '30' }]} />
        <Text style={[s.posterBgLetter, { color: accent + '16' }]}>
          {concert.title[0]}
        </Text>
        <SafeAreaView edges={['top']}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
            <View style={s.backPill}>
              <Ionicons name="chevron-back" size={16} color="#FFFFFF" />
              <Text style={s.backText}>돌아가기</Text>
            </View>
          </TouchableOpacity>
        </SafeAreaView>
        <View style={s.posterContent}>
          <View
            style={[
              s.genreBadge,
              {
                backgroundColor: accent + '28',
                borderColor: accent + '60',
              },
            ]}
          >
            <Text style={[s.genreBadgeText, { color: accent }]}>
              {concert.genre}
            </Text>
          </View>
          <Text style={s.posterTitle}>{concert.title}</Text>
          <Text style={s.posterArtist}>{concert.artist}</Text>
        </View>
      </View>

      {/* ── Info row ── */}
      <View style={s.infoRow}>
        <View style={s.infoCard}>
          <Ionicons name="calendar-outline" size={15} color={accent} />
          <Text style={s.infoLabel}>공연기간</Text>
          <Text style={s.infoValue} numberOfLines={2}>
            {concert.period}
          </Text>
        </View>
        <View style={s.infoSep} />
        <View style={s.infoCard}>
          <Ionicons name="location-outline" size={15} color={accent} />
          <Text style={s.infoLabel}>공연장</Text>
          <Text style={s.infoValue} numberOfLines={2}>
            {concert.venue}
          </Text>
        </View>
        <View style={s.infoSep} />
        <View style={s.infoCard}>
          <Ionicons name="time-outline" size={15} color={accent} />
          <Text style={s.infoLabel}>관람시간</Text>
          <Text style={s.infoValue} numberOfLines={2}>
            {concert.runtime}
          </Text>
        </View>
      </View>

      {/* ── Tab bar ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabBar}
        contentContainerStyle={s.tabBarContent}
      >
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab}
            style={s.tab}
            onPress={() => setActiveTab(i)}
          >
            <Text
              style={[s.tabText, i === activeTab && { color: '#FFFFFF' }]}
            >
              {tab}
            </Text>
            {i === activeTab && (
              <View style={[s.tabUnderline, { backgroundColor: accent }]} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Tab content ── */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* 상세정보 */}
        {activeTab === 0 && (
          <View style={s.tabContent}>
            <View style={s.card}>
              <Text style={s.cardTitle}>공연 소개</Text>
              <Text style={s.cardBody}>{concert.description}</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardTitle}>공연 정보</Text>
              <View style={s.row}>
                <Text style={s.rowKey}>관람연령</Text>
                <Text style={s.rowVal}>{concert.ageRating}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowKey}>공연시간</Text>
                <Text style={s.rowVal}>{concert.runtime}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowKey}>티켓가격</Text>
                <Text style={s.rowVal}>{concert.price}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 기대평 */}
        {activeTab === 1 && (
          <View style={s.tabContent}>
            <View style={s.emptyState}>
              <Ionicons name="chatbubble-outline" size={44} color="#1F1F30" />
              <Text style={s.emptyTitle}>아직 기대평이 없습니다</Text>
              <Text style={s.emptySub}>첫 번째 기대평을 남겨보세요!</Text>
            </View>
          </View>
        )}

        {/* Q&A */}
        {activeTab === 2 && (
          <View style={s.tabContent}>
            <View style={s.emptyState}>
              <Ionicons name="help-circle-outline" size={44} color="#1F1F30" />
              <Text style={s.emptyTitle}>등록된 Q&A가 없습니다</Text>
              <Text style={s.emptySub}>문의사항을 남겨주세요.</Text>
            </View>
          </View>
        )}

        {/* 공연장정보 */}
        {activeTab === 3 && (
          <View style={s.tabContent}>
            <View style={s.card}>
              <Text style={s.cardTitle}>공연장 안내</Text>
              <View style={s.row}>
                <Text style={s.rowKey}>공연장명</Text>
                <Text style={s.rowVal}>{concert.venue}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowKey}>주차</Text>
                <Text style={s.rowVal}>유료 주차 가능 (혼잡 예상)</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowKey}>대중교통</Text>
                <Text style={s.rowVal}>지하철 이용 권장</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowKey}>편의시설</Text>
                <Text style={s.rowVal}>매점, 물품 보관소 운영</Text>
              </View>
            </View>
          </View>
        )}

        {/* 예매유의사항 */}
        {activeTab === 4 && (
          <View style={s.tabContent}>
            <View style={s.card}>
              <Text style={s.cardTitle}>예매 유의사항</Text>
              {[
                '예매 완료 후 취소 시 수수료가 발생할 수 있습니다.',
                '공연 당일 취소는 불가합니다.',
                '본 티켓은 블록체인 기반 NFT 티켓으로 위변조가 불가합니다.',
                '입장 시 QR 코드를 제시해주세요.',
                '공연장 내 음식물 반입이 제한될 수 있습니다.',
                '미성년자는 보호자 동반 시 관람 가능합니다.',
              ].map((item, i) => (
                <View key={i} style={s.bulletRow}>
                  <Text style={[s.bulletDot, { color: accent }]}>•</Text>
                  <Text style={s.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── 예매하기 CTA ── */}
      <SafeAreaView
        edges={['bottom']}
        style={s.ctaWrap}
      >
        <TouchableOpacity
          style={[
            s.ctaBtn,
            { backgroundColor: accent, shadowColor: accent },
          ]}
          activeOpacity={0.85}
          onPress={() =>
            Alert.alert('예매하기', '현재 예매 기능은 준비 중입니다.')
          }
        >
          <Ionicons name="ticket-outline" size={18} color="#fff" />
          <Text style={s.ctaBtnText}>예매하기</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A14' },
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  errorBack: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 4,
  },
  /* Poster */
  posterArea: {
    height: 280,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  posterGlow: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  posterBgLetter: {
    position: 'absolute',
    bottom: -30,
    right: -8,
    fontSize: 250,
    fontWeight: '900',
    lineHeight: 270,
  },
  backBtn: { margin: 14 },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.38)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  backText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  posterContent: { padding: 20, gap: 6 },
  genreBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  genreBadgeText: { fontSize: 11, fontWeight: '700' },
  posterTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 32,
  },
  posterArtist: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  /* Info row */
  infoRow: {
    flexDirection: 'row',
    backgroundColor: '#13131F',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  infoCard: {
    flex: 1,
    alignItems: 'center',
    padding: 14,
    gap: 4,
  },
  infoSep: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: 12,
  },
  infoLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
    marginTop: 2,
  },
  infoValue: {
    fontSize: 11,
    color: '#D1D5DB',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 16,
  },
  /* Tab bar */
  tabBar: {
    backgroundColor: '#13131F',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    maxHeight: 46,
  },
  tabBarContent: { paddingHorizontal: 12 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
    position: 'relative',
  },
  tabText: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 8,
    right: 8,
    height: 2,
    borderRadius: 1,
  },
  /* Content */
  tabContent: { padding: 20, gap: 12 },
  card: {
    backgroundColor: '#13131F',
    borderRadius: 16,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  cardBody: { fontSize: 14, color: '#9CA3AF', lineHeight: 22 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowKey: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
    width: 60,
    paddingTop: 1,
  },
  rowVal: { flex: 1, fontSize: 13, color: '#D1D5DB', lineHeight: 20 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { fontSize: 14, lineHeight: 22, fontWeight: '700' },
  bulletText: { flex: 1, fontSize: 13, color: '#9CA3AF', lineHeight: 22 },
  /* Empty */
  emptyState: {
    alignItems: 'center',
    paddingVertical: 64,
    gap: 12,
  },
  emptyTitle: { fontSize: 15, color: '#9CA3AF', fontWeight: '600' },
  emptySub: { fontSize: 13, color: '#1F1F30' },
  /* CTA */
  ctaWrap: {
    backgroundColor: '#0A0A14',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 17,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
