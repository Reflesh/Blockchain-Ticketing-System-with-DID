import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MOCK_CONCERTS } from '@/constants/concerts';

const TABS = ['상세정보', '기대평', 'Q&A', '공연장정보', '예매유의사항'];

// ─── 관계자(주최사/관리자) 지갑 주소 목록
const OFFICIAL_ADDRESSES = new Set([
  '0xAdminWallet0000000000000000000000000001',
  '0xAdminWallet0000000000000000000000000002',
]);

type Post = { id: number; author: string; content: string; createdAt: string };
type Reply = Post & { isOfficial: boolean };
type QnaPost = Post & { replies: Reply[] };

const SAMPLE_REVIEWS: Post[] = [
  { id: 1, author: '0xAbCd1234AbCd1234AbCd1234AbCd12341234AbCd', content: '기대돼요! 작년 공연도 너무 좋았는데 올해는 더 기대됩니다 🎶', createdAt: '2026.08.12' },
  { id: 2, author: '0x5E6F78905E6F78905E6F78905E6F78907890AbCd', content: '티켓팅 성공! 드디어 직관할 수 있다니 너무 설레요', createdAt: '2026.08.15' },
];

const SAMPLE_QNAS: QnaPost[] = [
  {
    id: 1,
    author: '0x1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD',
    content: '주차는 어떻게 되나요? 현장 주차 가능한가요?',
    createdAt: '2026.08.10',
    replies: [
      {
        id: 101,
        author: '0xAdminWallet0000000000000000000000000001',
        content: '현장 유료 주차가 가능하며, 공연 당일은 혼잡이 예상되어 대중교통 이용을 권장드립니다.',
        createdAt: '2026.08.11',
        isOfficial: true,
      },
    ],
  },
  {
    id: 2,
    author: '0xFEDC56780FEDC56780FEDC56780FEDC56780FEDC',
    content: '당일 취소 환불 규정이 어떻게 되나요?',
    createdAt: '2026.08.18',
    replies: [],
  },
];

function shortAddr(addr: string) {
  if (!addr || addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}···${addr.slice(-4)}`;
}

// ─── 기대평 포스트 카드
function PostCard({ post }: { post: Post }) {
  return (
    <View style={pc.card}>
      <View style={pc.topRow}>
        <Text style={pc.author}>{shortAddr(post.author)}</Text>
        <Text style={pc.date}>{post.createdAt}</Text>
      </View>
      <Text style={pc.content}>{post.content}</Text>
    </View>
  );
}

const pc = StyleSheet.create({
  card: {
    backgroundColor: '#13131F',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { fontSize: 12, color: '#9CA3AF', fontFamily: 'monospace' },
  date: { fontSize: 11, color: '#4B5563' },
  content: { fontSize: 14, color: '#D1D5DB', lineHeight: 21 },
});

// ─── Q&A 질문 카드 (답변 포함)
function QnaCard({
  qna,
  accent,
  onReply,
}: {
  qna: QnaPost;
  accent: string;
  onReply: (id: number) => void;
}) {
  return (
    <View style={qc.wrap}>
      {/* 질문 */}
      <View style={qc.qCard}>
        <View style={qc.topRow}>
          <View style={qc.qBadge}>
            <Text style={qc.qBadgeText}>Q</Text>
          </View>
          <Text style={qc.author}>{shortAddr(qna.author)}</Text>
          <Text style={qc.date}>{qna.createdAt}</Text>
        </View>
        <Text style={qc.content}>{qna.content}</Text>
        <TouchableOpacity
          style={[qc.replyBtn, { borderColor: accent + '44' }]}
          onPress={() => onReply(qna.id)}
          activeOpacity={0.7}
        >
          <Ionicons name="chatbubble-outline" size={12} color={accent} />
          <Text style={[qc.replyBtnText, { color: accent }]}>답변달기</Text>
        </TouchableOpacity>
      </View>

      {/* 답변 목록 */}
      {qna.replies.map((reply) => (
        <View key={reply.id} style={qc.replyIndent}>
          <View style={[qc.replyCard, reply.isOfficial ? qc.replyCardOfficial : qc.replyCardNormal]}>
            <View style={qc.topRow}>
              {reply.isOfficial ? (
                <View style={qc.officialBadge}>
                  <Ionicons name="shield-checkmark" size={11} color="#22C55E" />
                  <Text style={qc.officialBadgeText}>관계자</Text>
                </View>
              ) : (
                <View style={qc.aBadge}>
                  <Text style={qc.aBadgeText}>A</Text>
                </View>
              )}
              <Text style={[qc.author, reply.isOfficial && { color: '#22C55E' }]}>
                {shortAddr(reply.author)}
              </Text>
              <Text style={qc.date}>{reply.createdAt}</Text>
            </View>
            <Text style={qc.content}>{reply.content}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const qc = StyleSheet.create({
  wrap: { gap: 6 },
  qCard: {
    backgroundColor: '#13131F',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  qBadgeText: { fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  author: { fontSize: 12, color: '#9CA3AF', fontFamily: 'monospace', flex: 1 },
  date: { fontSize: 11, color: '#4B5563' },
  content: { fontSize: 14, color: '#D1D5DB', lineHeight: 21 },
  replyBtn: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  replyBtnText: { fontSize: 12, fontWeight: '600' },
  replyIndent: { paddingLeft: 18 },
  replyCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  replyCardOfficial: {
    backgroundColor: '#0A1A0F',
    borderColor: 'rgba(34,197,94,0.2)',
  },
  replyCardNormal: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  officialBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(34,197,94,0.12)',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
  },
  officialBadgeText: { fontSize: 11, fontWeight: '700', color: '#22C55E' },
  aBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },
  aBadgeText: { fontSize: 11, fontWeight: '700', color: '#6B7280' },
});

// ─── 글쓰기 모달
function WriteModal({
  visible,
  type,
  accent,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  type: 'review' | 'qna' | 'reply' | null;
  accent: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const titleMap = { review: '기대평 작성', qna: '질문 작성', reply: '답변 작성' };
  const placeholderMap = {
    review: '공연에 대한 기대평을 남겨보세요...',
    qna: '궁금한 점을 남겨주세요...',
    reply: '답변을 작성해주세요...',
  };

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText('');
  };

  const handleClose = () => {
    setText('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <TouchableOpacity style={wm.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={wm.sheet}>
          <View style={wm.handle} />
          <Text style={wm.title}>{type ? titleMap[type] : ''}</Text>
          <TextInput
            style={wm.input}
            multiline
            numberOfLines={5}
            placeholder={type ? placeholderMap[type] : ''}
            placeholderTextColor="#4B5563"
            value={text}
            onChangeText={setText}
            textAlignVertical="top"
            autoFocus
          />
          <View style={wm.btnRow}>
            <TouchableOpacity style={wm.cancelBtn} onPress={handleClose}>
              <Text style={wm.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[wm.submitBtn, { backgroundColor: accent }, !text.trim() && wm.submitDisabled]}
              onPress={handleSubmit}
              disabled={!text.trim()}
            >
              <Text style={wm.submitText}>등록</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const wm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#13131F',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', alignSelf: 'center', marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: '#FFFFFF',
    minHeight: 120,
    lineHeight: 21,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, padding: 15, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cancelText: { color: '#9CA3AF', fontSize: 15, fontWeight: '600' },
  submitBtn: { flex: 2, padding: 15, borderRadius: 14, alignItems: 'center' },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});

// ─── 메인 화면
export default function ConcertDetailScreen() {
  const { concertId } = useLocalSearchParams<{ concertId: string }>();
  const concert = MOCK_CONCERTS.find((c) => c.id === concertId);
  const { address } = useWallet();
  const [activeTab, setActiveTab] = useState(0);
  const [reviews, setReviews] = useState<Post[]>(SAMPLE_REVIEWS);
  const [qnas, setQnas] = useState<QnaPost[]>(SAMPLE_QNAS);
  const [modalType, setModalType] = useState<'review' | 'qna' | 'reply' | null>(null);
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);

  if (!concert) {
    return (
      <SafeAreaView style={s.safe}>
        <TouchableOpacity style={s.errorBack} onPress={() => router.back()} accessibilityLabel="돌아가기">
          <Ionicons name="chevron-back" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 15 }}>돌아가기</Text>
        </TouchableOpacity>
        <Text style={{ color: '#9CA3AF', padding: 20 }}>공연 정보를 찾을 수 없습니다.</Text>
      </SafeAreaView>
    );
  }

  const accent = concert.accentColor;

  const requireLogin = (cb: () => void) => {
    if (!address) {
      Alert.alert('로그인 필요', '로그인 후 이용해주세요.', [
        { text: '취소', style: 'cancel' },
        { text: '로그인', onPress: () => router.push('/login') },
      ]);
      return;
    }
    cb();
  };

  const handleWrite = (type: 'review' | 'qna') => {
    requireLogin(() => setModalType(type));
  };

  const handleReply = (qnaId: number) => {
    requireLogin(() => {
      setReplyTargetId(qnaId);
      setModalType('reply');
    });
  };

  const handleSubmit = (text: string) => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

    if (modalType === 'review') {
      const newPost: Post = { id: Date.now(), author: address ?? '', content: text, createdAt: dateStr };
      setReviews((prev) => [newPost, ...prev]);
    } else if (modalType === 'qna') {
      const newQna: QnaPost = { id: Date.now(), author: address ?? '', content: text, createdAt: dateStr, replies: [] };
      setQnas((prev) => [newQna, ...prev]);
    } else if (modalType === 'reply' && replyTargetId !== null) {
      const isOfficial = OFFICIAL_ADDRESSES.has(address ?? '');
      const newReply: Reply = { id: Date.now(), author: address ?? '', content: text, createdAt: dateStr, isOfficial };
      setQnas((prev) =>
        prev.map((q) =>
          q.id === replyTargetId ? { ...q, replies: [...q.replies, newReply] } : q
        )
      );
    }
    setModalType(null);
    setReplyTargetId(null);
  };

  return (
    <View style={s.root}>
      {/* ── Poster header ── */}
      <View style={[s.posterArea, { backgroundColor: concert.posterColor }]}>
        <View style={[s.posterGlow, { backgroundColor: accent + '30' }]} />
        <Text style={[s.posterBgLetter, { color: accent + '16' }]}>{concert.title[0]}</Text>
        <SafeAreaView edges={['top']}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
            <View style={s.backPill}>
              <Ionicons name="chevron-back" size={16} color="#FFFFFF" />
              <Text style={s.backText}>돌아가기</Text>
            </View>
          </TouchableOpacity>
        </SafeAreaView>
        <View style={s.posterContent}>
          <View style={[s.genreBadge, { backgroundColor: accent + '28', borderColor: accent + '60' }]}>
            <Text style={[s.genreBadgeText, { color: accent }]}>{concert.genre}</Text>
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
          <Text style={s.infoValue} numberOfLines={2}>{concert.period}</Text>
        </View>
        <View style={s.infoSep} />
        <View style={s.infoCard}>
          <Ionicons name="location-outline" size={15} color={accent} />
          <Text style={s.infoLabel}>공연장</Text>
          <Text style={s.infoValue} numberOfLines={2}>{concert.venue}</Text>
        </View>
        <View style={s.infoSep} />
        <View style={s.infoCard}>
          <Ionicons name="time-outline" size={15} color={accent} />
          <Text style={s.infoLabel}>관람시간</Text>
          <Text style={s.infoValue} numberOfLines={2}>{concert.runtime}</Text>
        </View>
      </View>

      {/* ── Tab bar ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={s.tabBarContent}>
        {TABS.map((tab, i) => (
          <TouchableOpacity key={tab} style={s.tab} onPress={() => setActiveTab(i)}>
            <Text style={[s.tabText, i === activeTab && { color: '#FFFFFF' }]}>{tab}</Text>
            {i === activeTab && <View style={[s.tabUnderline, { backgroundColor: accent }]} />}
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
              <View style={s.row}><Text style={s.rowKey}>관람연령</Text><Text style={s.rowVal}>{concert.ageRating}</Text></View>
              <View style={s.row}><Text style={s.rowKey}>공연시간</Text><Text style={s.rowVal}>{concert.runtime}</Text></View>
              <View style={s.row}><Text style={s.rowKey}>티켓가격</Text><Text style={s.rowVal}>{concert.price}</Text></View>
            </View>
          </View>
        )}

        {/* 기대평 */}
        {activeTab === 1 && (
          <View style={s.tabContent}>
            <TouchableOpacity
              style={[s.writeBtn, { borderColor: accent + '55', backgroundColor: accent + '0D' }]}
              onPress={() => handleWrite('review')}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil-outline" size={15} color={accent} />
              <Text style={[s.writeBtnText, { color: accent }]}>기대평 남기기</Text>
            </TouchableOpacity>
            {reviews.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="chatbubble-outline" size={44} color="#1F1F30" />
                <Text style={s.emptyTitle}>아직 기대평이 없습니다</Text>
                <Text style={s.emptySub}>첫 번째 기대평을 남겨보세요!</Text>
              </View>
            ) : (
              reviews.map((r) => <PostCard key={r.id} post={r} />)
            )}
          </View>
        )}

        {/* Q&A */}
        {activeTab === 2 && (
          <View style={s.tabContent}>
            <TouchableOpacity
              style={[s.writeBtn, { borderColor: accent + '55', backgroundColor: accent + '0D' }]}
              onPress={() => handleWrite('qna')}
              activeOpacity={0.8}
            >
              <Ionicons name="help-circle-outline" size={15} color={accent} />
              <Text style={[s.writeBtnText, { color: accent }]}>질문 남기기</Text>
            </TouchableOpacity>
            {qnas.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="help-circle-outline" size={44} color="#1F1F30" />
                <Text style={s.emptyTitle}>등록된 Q&A가 없습니다</Text>
                <Text style={s.emptySub}>문의사항을 남겨주세요.</Text>
              </View>
            ) : (
              qnas.map((q) => <QnaCard key={q.id} qna={q} accent={accent} onReply={handleReply} />)
            )}
          </View>
        )}

        {/* 공연장정보 */}
        {activeTab === 3 && (
          <View style={s.tabContent}>
            <View style={s.card}>
              <Text style={s.cardTitle}>공연장 안내</Text>
              <View style={s.row}><Text style={s.rowKey}>공연장명</Text><Text style={s.rowVal}>{concert.venue}</Text></View>
              <View style={s.row}><Text style={s.rowKey}>주차</Text><Text style={s.rowVal}>유료 주차 가능 (혼잡 예상)</Text></View>
              <View style={s.row}><Text style={s.rowKey}>대중교통</Text><Text style={s.rowVal}>지하철 이용 권장</Text></View>
              <View style={s.row}><Text style={s.rowKey}>편의시설</Text><Text style={s.rowVal}>매점, 물품 보관소 운영</Text></View>
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
      <SafeAreaView edges={['bottom']} style={s.ctaWrap}>
        <TouchableOpacity
          style={[s.ctaBtn, { backgroundColor: accent, shadowColor: accent }]}
          activeOpacity={0.85}
          onPress={() => Alert.alert('예매하기', '현재 예매 기능은 준비 중입니다.')}
        >
          <Ionicons name="ticket-outline" size={18} color="#fff" />
          <Text style={s.ctaBtnText}>예매하기</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* ── 글쓰기 모달 ── */}
      <WriteModal
        visible={modalType !== null}
        type={modalType}
        accent={accent}
        onClose={() => { setModalType(null); setReplyTargetId(null); }}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A14' },
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  errorBack: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 4 },
  /* Poster */
  posterArea: { height: 280, justifyContent: 'flex-end', overflow: 'hidden' },
  posterGlow: { position: 'absolute', top: -80, right: -80, width: 280, height: 280, borderRadius: 140 },
  posterBgLetter: { position: 'absolute', bottom: -30, right: -8, fontSize: 250, fontWeight: '900', lineHeight: 270 },
  backBtn: { margin: 14 },
  backPill: {
    flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.38)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
  },
  backText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  posterContent: { padding: 20, gap: 6 },
  genreBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  genreBadgeText: { fontSize: 11, fontWeight: '700' },
  posterTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', lineHeight: 32 },
  posterArtist: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  /* Info row */
  infoRow: { flexDirection: 'row', backgroundColor: '#13131F', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  infoCard: { flex: 1, alignItems: 'center', padding: 14, gap: 4 },
  infoSep: { width: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 12 },
  infoLabel: { fontSize: 10, color: '#9CA3AF', fontWeight: '600', marginTop: 2 },
  infoValue: { fontSize: 11, color: '#D1D5DB', fontWeight: '500', textAlign: 'center', lineHeight: 16 },
  /* Tab bar */
  tabBar: { backgroundColor: '#13131F', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', maxHeight: 46 },
  tabBarContent: { paddingHorizontal: 12 },
  tab: { paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center', position: 'relative' },
  tabText: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },
  tabUnderline: { position: 'absolute', bottom: 0, left: 8, right: 8, height: 2, borderRadius: 1 },
  /* Content */
  tabContent: { padding: 20, gap: 12 },
  card: { backgroundColor: '#13131F', borderRadius: 16, padding: 18, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  cardBody: { fontSize: 14, color: '#9CA3AF', lineHeight: 22 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowKey: { fontSize: 12, color: '#9CA3AF', fontWeight: '600', width: 60, paddingTop: 1 },
  rowVal: { flex: 1, fontSize: 13, color: '#D1D5DB', lineHeight: 20 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { fontSize: 14, lineHeight: 22, fontWeight: '700' },
  bulletText: { flex: 1, fontSize: 13, color: '#9CA3AF', lineHeight: 22 },
  /* Write button */
  writeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 14, borderWidth: 1,
  },
  writeBtnText: { fontSize: 14, fontWeight: '600' },
  /* Empty */
  emptyState: { alignItems: 'center', paddingVertical: 64, gap: 12 },
  emptyTitle: { fontSize: 15, color: '#9CA3AF', fontWeight: '600' },
  emptySub: { fontSize: 13, color: '#1F1F30' },
  /* CTA */
  ctaWrap: { backgroundColor: '#0A0A14', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 20, paddingTop: 12 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 17, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
