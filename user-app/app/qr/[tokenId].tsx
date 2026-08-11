import { useWallet } from '@/context/WalletContext';
import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle } from 'react-native-svg';

const REFRESH_INTERVAL = 20;

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const size = 88;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - seconds / total);
  const isWarning = seconds <= 5;

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={cx} cy={cy} r={radius}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={3.5}
          fill="none"
        />
        <Circle
          cx={cx} cy={cy} r={radius}
          stroke={isWarning ? '#F59E0B' : '#E11D48'}
          strokeWidth={3.5}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${cx}, ${cy}`}
        />
      </Svg>
      <Text style={[styles.countdownNum, isWarning && styles.countdownWarn]}>
        {seconds}
      </Text>
    </View>
  );
}

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
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_INTERVAL);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // 화면 꺼짐 방지
  useKeepAwake();

  // 캡처 방지
  usePreventScreenCapture();

  // 밝기 최대 → 화면 떠날 때 복원
  // (mypage에서 이미 최대로 올렸으므로 유지만 함)
  useEffect(() => {
    let original: number | null = null;
    const initBrightness = async () => {
      try {
        original = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } catch {}
    };
    initBrightness();
    return () => {
      if (original !== null) {
        Brightness.setBrightnessAsync(original).catch(() => {});
      }
    };
  }, []);

  const accentColor = posterColor ? `#${posterColor}` : '#E11D48';

  const pulse = useCallback(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.spring(pulseAnim, { toValue: 1, tension: 80, friction: 6, useNativeDriver: true }),
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
    setSecondsLeft(REFRESH_INTERVAL);
    pulse();
  }, [wallet, address, tokenId, pulse]);

  useEffect(() => {
    generateQR();
    const interval = setInterval(generateQR, REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [generateQR]);

  useEffect(() => {
    const countdown = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(countdown);
  }, [qrValue]);

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>←  돌아가기</Text>
      </TouchableOpacity>

      <View style={[styles.banner, { borderColor: accentColor + '50' }]}>
        <View style={[styles.bannerAccent, { backgroundColor: accentColor }]} />
        <View style={styles.bannerInfo}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {title ?? '공연명'}
          </Text>
          <Text style={styles.bannerSub}>
            {venue ?? ''}  ·  {date ?? ''}
          </Text>
          <Text style={[styles.bannerSeat, { color: accentColor }]}>
            {seatCode ?? ''}
          </Text>
        </View>
      </View>

      <View style={styles.qrSection}>
        <Animated.View style={[styles.qrCard, { transform: [{ scale: pulseAnim }] }]}>
          {qrValue ? (
            <QRCode
              value={qrValue}
              size={220}
              color="#000000"
              backgroundColor="#FFFFFF"
            />
          ) : (
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrPlaceholderText}>생성 중...</Text>
            </View>
          )}
        </Animated.View>

        <View style={styles.countdownRow}>
          <CountdownRing seconds={secondsLeft} total={REFRESH_INTERVAL} />
          <Text style={styles.countdownLabel}>초 후 자동 갱신</Text>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          🔒  캡처·녹화 차단  ·  화면 꺼짐 방지  ·  밝기 최대
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F0F1A' },
  backBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  backText: { color: '#8E8EA0', fontSize: 14 },
  banner: {
    marginHorizontal: 20,
    backgroundColor: '#1A1A2E',
    borderRadius: 16, borderWidth: 1,
    flexDirection: 'row', overflow: 'hidden',
  },
  bannerAccent: { width: 4 },
  bannerInfo: { flex: 1, padding: 16, gap: 4 },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  bannerSub: { fontSize: 12, color: '#8E8EA0' },
  bannerSeat: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  qrSection: {
    flex: 1, alignItems: 'center',
    justifyContent: 'center', gap: 28,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24, padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  qrPlaceholder: {
    width: 220, height: 220,
    justifyContent: 'center', alignItems: 'center',
  },
  qrPlaceholderText: { color: '#9CA3AF', fontSize: 14 },
  countdownRow: { alignItems: 'center', gap: 6 },
  countdownNum: { fontSize: 26, fontWeight: '700', color: '#FFFFFF' },
  countdownWarn: { color: '#F59E0B' },
  countdownLabel: { fontSize: 12, color: '#8E8EA0' },
  infoBox: {
    marginHorizontal: 20, marginBottom: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  infoText: { fontSize: 12, color: '#8E8EA0', textAlign: 'center' },
});