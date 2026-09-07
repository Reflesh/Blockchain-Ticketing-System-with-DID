import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle } from 'react-native-svg';

const REFRESH_INTERVAL = 20;

// ─── 카운트다운 링 ────────────────────────────────────
function CountdownRing({
  seconds,
  total,
}: {
  seconds: number;
  total: number;
}) {
  const SIZE = 68;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const RADIUS = 26;
  const CIRC = 2 * Math.PI * RADIUS;
  const offset = CIRC * (1 - seconds / total);
  const warn = seconds <= 5;

  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Circle
          cx={CX}
          cy={CY}
          r={RADIUS}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={3}
          fill="none"
        />
        <Circle
          cx={CX}
          cy={CY}
          r={RADIUS}
          stroke={warn ? '#F59E0B' : '#E11D48'}
          strokeWidth={3}
          fill="none"
          strokeDasharray={`${CIRC} ${CIRC}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${CX}, ${CY}`}
        />
      </Svg>
      <Text style={[s.ringNum, warn && s.ringNumWarn]}>{seconds}</Text>
    </View>
  );
}

// ─── QR 화면 ─────────────────────────────────────────
export default function QRScreen() {
  const { tokenId, title, venue, date, seatCode, posterColor } =
    useLocalSearchParams<{
      tokenId: string;
      title?: string;
      venue?: string;
      date?: string;
      seatCode?: string;
      posterColor?: string;
    }>();

  const { wallet, address } = useWallet();
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [entryCode, setEntryCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_INTERVAL);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useKeepAwake();
  usePreventScreenCapture();

  // 밝기 최대로 올리고 화면 떠날 때 복원
  useEffect(() => {
    const originalPromise = Brightness.getBrightnessAsync();
    Brightness.setBrightnessAsync(1).catch(() => {});
    return () => {
      if (Platform.OS === 'android') {
        // Android: 시스템 자동밝기 제어권 반환
        Brightness.useSystemBrightnessAsync().catch(() => {});
      } else {
        // iOS: 저장해둔 원래 밝기로 복원
        originalPromise
          .then((original) => Brightness.setBrightnessAsync(original))
          .catch(() => {});
      }
    };
  }, []);

  const accentColor = posterColor ? `#${posterColor}` : '#E11D48';

  const pulse = useCallback(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 0.97,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(pulseAnim, {
        toValue: 1,
        tension: 80,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pulseAnim]);

  const generateQR = useCallback(async () => {
    const payload = {
      action: 'ticket_checkin',
      token_id: Number(tokenId),
      wallet_address: address,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const message = JSON.stringify(payload);
    const signature = wallet
      ? await wallet.signMessage(message)
      : 'mock-dev-signature';

    setQrValue(JSON.stringify({ payload, signature }));
    setEntryCode(String(Math.floor(Math.random() * 1000000)).padStart(6, '0'));
    setSecondsLeft(REFRESH_INTERVAL);
    pulse();
  }, [wallet, address, tokenId, pulse]);

  useEffect(() => {
    generateQR();
    const iv = setInterval(generateQR, REFRESH_INTERVAL * 1000);
    return () => clearInterval(iv);
  }, [generateQR]);

  useEffect(() => {
    const iv = setInterval(() => {
      setSecondsLeft((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, [qrValue]);

  return (
    <SafeAreaView style={s.safe}>
      {/* 상단 컬러 스트립 */}
      <View style={[s.topGlow, { backgroundColor: accentColor + '15' }]} />

      {/* 뒤로가기 */}
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} accessibilityLabel="돌아가기">
        <View style={s.backPill}>
          <Ionicons name="chevron-back" size={16} color="#FFFFFF" />
          <Text style={s.backText}>돌아가기</Text>
        </View>
      </TouchableOpacity>

      {/* 이벤트 정보 카드 */}
      <View style={[s.eventCard, { borderLeftColor: accentColor }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.eventTitle} numberOfLines={1}>
            {title ?? '공연명'}
          </Text>
          <Text style={s.eventMeta} numberOfLines={1}>
            {venue ?? ''}
          </Text>
          <Text style={s.eventMeta}>{date ?? ''}</Text>
        </View>
        <View style={[s.seatBadge, { borderColor: accentColor + '55' }]}>
          <Text style={[s.seatBadgeText, { color: accentColor }]}>
            {seatCode ?? '좌석'}
          </Text>
        </View>
      </View>

      {/* QR 영역 */}
      <View style={s.qrArea}>
        <Animated.View
          style={[s.qrCard, { transform: [{ scale: pulseAnim }] }]}
        >
          {qrValue ? (
            <QRCode
              value={qrValue}
              size={216}
              color="#0A0A14"
              backgroundColor="#FFFFFF"
            />
          ) : (
            <View style={s.qrPlaceholder}>
              <Text style={s.qrPlaceholderText}>QR 생성 중...</Text>
            </View>
          )}
          {entryCode && (
            <>
              <View style={s.codeDivider} />
              <View style={s.codeBox}>
                <Text style={s.codeLabel}>수동 입력 코드</Text>
                <Text style={s.codeValue}>
                  {entryCode.slice(0, 3)} {entryCode.slice(3)}
                </Text>
              </View>
            </>
          )}
        </Animated.View>

        {/* 카운트다운 */}
        <View style={s.countdown}>
          <CountdownRing seconds={secondsLeft} total={REFRESH_INTERVAL} />
          <Text style={s.countdownLabel}>초 후 자동 갱신</Text>
        </View>
      </View>

      {/* 보안 배지 */}
      <View style={s.secRow}>
        <View style={s.secBadge}>
          <Ionicons name="eye-off-outline" size={12} color="#9CA3AF" />
          <Text style={s.secText}>캡처 차단</Text>
        </View>
        <View style={s.secDot} />
        <View style={s.secBadge}>
          <Ionicons name="sunny-outline" size={12} color="#9CA3AF" />
          <Text style={s.secText}>밝기 최대</Text>
        </View>
        <View style={s.secDot} />
        <View style={s.secBadge}>
          <Ionicons name="shield-checkmark-outline" size={12} color="#9CA3AF" />
          <Text style={s.secText}>서명 검증</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  backBtn: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  backText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  /* 이벤트 카드 */
  eventCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: '#13131F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderLeftWidth: 3,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  eventTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 3 },
  eventMeta: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  seatBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  seatBadgeText: { fontSize: 12, fontWeight: '700' },
  /* QR 영역 */
  qrArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 20,
  },
  qrPlaceholder: {
    width: 216,
    height: 216,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrPlaceholderText: { color: '#9CA3AF', fontSize: 14 },
  /* 카운트다운 */
  countdown: { alignItems: 'center', gap: 6 },
  ringNum: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  ringNumWarn: { color: '#F59E0B' },
  countdownLabel: { fontSize: 11, color: '#9CA3AF' },
  /* 보안 배지 */
  secRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 28,
    gap: 10,
  },
  secBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  secText: { fontSize: 11, color: '#9CA3AF' },
  secDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#1F1F30' },
  /* 수동 입력 코드 */
  codeDivider: { height: 1, backgroundColor: '#E5E7EB', marginTop: 16, marginHorizontal: -20 },
  codeBox: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
    gap: 4,
  },
  codeLabel: { fontSize: 10, color: '#6B7280', fontWeight: '600', letterSpacing: 0.6 },
  codeValue: { fontSize: 26, fontWeight: '700', color: '#0A0A14', fontFamily: 'monospace', letterSpacing: 6 },
});
