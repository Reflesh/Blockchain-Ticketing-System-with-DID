import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const TICKET_API_URL = 'http://13.124.21.176:8000/api';
const FRAME_SIZE = 260;
const CORNER = 28;
const CORNER_W = 3;
const CORNER_COLOR = '#22C55E';

// ⚠️ 개발용 — 입장 불가 사유 목록. 탭할 때마다 랜덤 출력. 배포 전 제거할 것
const FAIL_REASONS = [
  'QR이 만료되었습니다.',
  'QR 형식이 올바르지 않습니다.',
  '서명 검증에 실패했습니다. 위변조가 의심됩니다.',
  '이미 사용된 티켓입니다.',
  '환불 처리된 티켓입니다.',
  '양도 취소된 티켓입니다.',
  '다른 회차의 티켓입니다.',
  '다른 공연장의 티켓입니다.',
];

// ⚠️ 백엔드 검증 API가 없어서 넣은 임시 로직
// 나중에 실제 서버 엔드포인트 생기면 이 함수만 fetch 호출로 교체하면 됨
function mockVerifyCheckin(scannedData: string): {
  valid: boolean;
  reason: string;
  tokenId?: number;
} {
  try {
    const parsed = JSON.parse(scannedData);
    if (!parsed.payload || !parsed.signature) {
      return { valid: false, reason: 'QR 형식이 올바르지 않습니다.' };
    }
    const ageSeconds =
      Math.floor(Date.now() / 1000) -
      (parsed.payload.timestamp ?? Math.floor(Date.now() / 1000));
    if (!parsed.payload.mock && (ageSeconds > 60 || ageSeconds < -10)) {
      return { valid: false, reason: 'QR이 만료되었습니다.' };
    }
    return {
      valid: true,
      reason: '입장이 확인되었습니다.',
      tokenId: parsed.payload.token_id,
    };
  } catch {
    return { valid: false, reason: 'QR을 읽을 수 없습니다.' };
  }
}

type AdminInfo = { login_id: string; display_name: string; role: string };
type ScanResult = { valid: boolean; reason: string; tokenId?: number } | null;

// ─────────────────────────────────────────
// 루트
// ─────────────────────────────────────────
export default function App() {
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminInfo, setAdminInfo] = useState<AdminInfo | null>(null);

  if (!adminToken) {
    return (
      <LoginScreen
        onLoginSuccess={(token, info) => {
          setAdminToken(token);
          setAdminInfo(info);
        }}
      />
    );
  }
  return (
    <ScannerScreen
      adminInfo={adminInfo}
      onLogout={() => {
        setAdminToken(null);
        setAdminInfo(null);
      }}
    />
  );
}

// ─────────────────────────────────────────
// 로그인 화면
// ─────────────────────────────────────────
function LoginScreen({
  onLoginSuccess,
}: {
  onLoginSuccess: (token: string, info: AdminInfo) => void;
}) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!loginId || !password) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('입력 필요', '아이디와 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${TICKET_API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: loginId, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail ?? '로그인에 실패했습니다.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLoginSuccess(json.data.token, json.data);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('로그인 실패', e?.message ?? '로그인할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ⚠️ 개발용 — 백엔드 없이 스캐너 화면 바로 진입. 배포 전 제거할 것
  const devLogin = () => {
    onLoginSuccess('dev-token', {
      login_id: 'admin',
      display_name: '관리자',
      role: 'admin',
    });
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.loginScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.header}>
            <View style={s.logo}>
              <Text style={s.logoText}>T</Text>
            </View>
            <Text style={s.brand}>TicketPro</Text>
            <View style={s.adminBadge}>
              <Text style={s.adminBadgeText}>관리자 전용</Text>
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.cardLabel}>아이디</Text>
            <TextInput
              style={s.input}
              placeholder="관리자 아이디"
              placeholderTextColor="#8E8EA0"
              autoCapitalize="none"
              value={loginId}
              onChangeText={setLoginId}
            />
            <Text style={[s.cardLabel, { marginTop: 16 }]}>비밀번호</Text>
            <TextInput
              style={s.input}
              placeholder="비밀번호"
              placeholderTextColor="#8E8EA0"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={[s.loginBtn, loading && s.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={s.loginBtnText}>
                {loading ? '로그인 중...' : '로그인'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={devLogin} style={s.devBtn}>
            <Text style={s.devText}>개발용 빠른 입장</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────
// 스캐너 화면
// ─────────────────────────────────────────
function ScannerScreen({
  adminInfo,
  onLogout,
}: {
  adminInfo: AdminInfo | null;
  onLogout: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<ScanResult>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scanLock = useRef(false); // 중복 스캔 방지

  const frameLeft = (width - FRAME_SIZE) / 2;
  const frameTop = (height - FRAME_SIZE) / 2;

  const handleScan = ({ data }: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    const verified = mockVerifyCheckin(data);
    Haptics.notificationAsync(
      verified.valid
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error
    );
    setResult(verified);
  };

  const handleRescan = () => {
    setResult(null);
    scanLock.current = false; // 재스캔 시 잠금 해제
  };

  const handleManualVerify = () => {
    const code = manualCode.replace(/\s/g, '');
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('입력 오류', '6자리 숫자를 입력해주세요.');
      return;
    }
    // ⚠️ 개발용 — 실제 배포 시 서버에서 코드 검증 필요
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setResult({ valid: true, reason: '코드 수동 인증 완료', tokenId: undefined });
    setManualCode('');
    setManualMode(false);
  };

  if (!permission) {
    return (
      <View style={[s.safe, s.center]}>
        <Text style={s.permText}>카메라 권한 확인 중...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[s.safe, s.center]}>
        <Text style={s.permText}>QR 스캔을 위해{'\n'}카메라 권한이 필요해요</Text>
        <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
          <Text style={s.permBtnText}>카메라 권한 허용</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (result) {
    return (
      <ResultScreen
        result={result}
        adminInfo={adminInfo}
        onRescan={handleRescan}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleScan}
      />

      {/* 어두운 오버레이 — 4분할로 스캔 영역만 뚫기 */}
      <View style={[s.overlay, { top: 0, left: 0, right: 0, height: frameTop }]} />
      <View style={[s.overlay, { top: frameTop, left: 0, width: frameLeft, height: FRAME_SIZE }]} />
      <View style={[s.overlay, { top: frameTop, right: 0, width: frameLeft, height: FRAME_SIZE }]} />
      <View style={[s.overlay, { top: frameTop + FRAME_SIZE, left: 0, right: 0, bottom: 0 }]} />

      {/* 코너 브라켓 — 좌상 */}
      <View style={[s.ch, { top: frameTop, left: frameLeft }]} />
      <View style={[s.cv, { top: frameTop, left: frameLeft }]} />
      {/* 코너 브라켓 — 우상 */}
      <View style={[s.ch, { top: frameTop, left: frameLeft + FRAME_SIZE - CORNER }]} />
      <View style={[s.cv, { top: frameTop, left: frameLeft + FRAME_SIZE - CORNER_W }]} />
      {/* 코너 브라켓 — 좌하 */}
      <View style={[s.ch, { top: frameTop + FRAME_SIZE - CORNER_W, left: frameLeft }]} />
      <View style={[s.cv, { top: frameTop + FRAME_SIZE - CORNER, left: frameLeft }]} />
      {/* 코너 브라켓 — 우하 */}
      <View style={[s.ch, { top: frameTop + FRAME_SIZE - CORNER_W, left: frameLeft + FRAME_SIZE - CORNER }]} />
      <View style={[s.cv, { top: frameTop + FRAME_SIZE - CORNER, left: frameLeft + FRAME_SIZE - CORNER_W }]} />

      {/* 힌트 */}
      <View style={[s.hintBox, { top: frameTop + FRAME_SIZE + 24 }]}>
        <Text style={s.hintText}>QR 코드를 사각형 안에 맞춰주세요</Text>
      </View>

      {/* 상단 바 */}
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={s.topBarBadge}>
          <Text style={s.topBarBadgeText}>
            {adminInfo?.display_name ?? adminInfo?.login_id ?? '관리자'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[s.topBarBadge, manualMode && s.topBarBadgeActive]}
            onPress={() => { setManualMode(v => !v); setManualCode(''); }}
            accessibilityLabel="코드 입력 모드"
          >
            <Text style={s.topBarBadgeText}>코드 입력</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.topBarBadge} onPress={onLogout} accessibilityLabel="로그아웃">
            <Text style={s.topBarBadgeText}>로그아웃</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 수동 코드 입력 패널 */}
      {manualMode && (
        <View style={[s.manualPanel, { top: insets.top + 56 }]}>
          <Text style={s.manualTitle}>수동 코드 인증</Text>
          <Text style={s.manualSub}>QR 화면에 표시된 6자리 숫자를 입력하세요</Text>
          <View style={s.manualInputRow}>
            <TextInput
              style={s.manualInput}
              placeholder="000 000"
              placeholderTextColor="#4B5563"
              keyboardType="number-pad"
              maxLength={7}
              value={manualCode}
              onChangeText={(t) => {
                const digits = t.replace(/\D/g, '').slice(0, 6);
                setManualCode(digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits);
              }}
              autoFocus
            />
            <TouchableOpacity
              style={[s.manualConfirmBtn, manualCode.replace(/\s/g,'').length !== 6 && { opacity: 0.4 }]}
              onPress={handleManualVerify}
              disabled={manualCode.replace(/\s/g,'').length !== 6}
            >
              <Text style={s.manualConfirmText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ⚠️ 개발용 — 실제 QR 스캔 없이 결과 화면 확인용. 배포 전 제거할 것 */}
      <View style={[s.testBtnWrap, { bottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={s.testBtnPass}
          onPress={() =>
            setResult({
              valid: true,
              reason: '입장이 확인되었습니다. (테스트)',
              tokenId: 42,
            })
          }
        >
          <Text style={s.testBtnText}>테스트: 입장 가능 →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.testBtnFail}
          onPress={() =>
            setResult({
              valid: false,
              reason:
                FAIL_REASONS[Math.floor(Math.random() * FAIL_REASONS.length)] +
                ' (테스트)',
            })
          }
        >
          <Text style={s.testBtnText}>테스트: 입장 불가 →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────
// 결과 화면
// ─────────────────────────────────────────
function ResultScreen({
  result,
  adminInfo,
  onRescan,
}: {
  result: { valid: boolean; reason: string; tokenId?: number };
  adminInfo: AdminInfo | null;
  onRescan: () => void;
}) {
  const isPass = result.valid;
  const accentColor = isPass ? '#22C55E' : '#EF4444';
  const bgColor = isPass ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: '#0A0A14' }]}>
      <View style={[s.resultContainer, { backgroundColor: bgColor }]}>
        <View style={[s.resultIconBox, { borderColor: accentColor }]}>
          <Text style={[s.resultIconText, { color: accentColor }]}>
            {isPass ? '✓' : '✕'}
          </Text>
        </View>
        <Text style={[s.resultTitle, { color: accentColor }]}>
          {isPass ? '입장 가능' : '입장 불가'}
        </Text>
        <Text style={s.resultReason}>{result.reason}</Text>
        {result.tokenId !== undefined && (
          <View style={s.tokenBox}>
            <Text style={s.tokenLabel}>티켓 토큰</Text>
            <Text style={[s.tokenValue, { color: accentColor }]}>
              #{result.tokenId}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[s.rescanBtn, { backgroundColor: accentColor }]}
          onPress={onRescan}
          activeOpacity={0.85}
        >
          <Text style={s.rescanText}>다시 스캔</Text>
        </TouchableOpacity>
      </View>
      <View style={s.resultFooter}>
        <Text style={s.resultFooterText}>
          {adminInfo?.display_name ?? adminInfo?.login_id ?? '관리자'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  loginScroll: {
    flexGrow: 1, paddingHorizontal: 24,
    justifyContent: 'center', paddingVertical: 48,
  },
  header: { alignItems: 'center', marginBottom: 36, gap: 10 },
  logo: {
    width: 72, height: 72, borderRadius: 18,
    backgroundColor: '#E11D48',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  logoText: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  brand: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  adminBadge: {
    backgroundColor: 'rgba(225,29,72,0.12)',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(225,29,72,0.3)',
  },
  adminBadgeText: { color: '#E11D48', fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: '#1A1A2E', borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  cardLabel: {
    fontSize: 11, fontWeight: '600', color: '#8E8EA0',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, padding: 14,
    fontSize: 15, color: '#FFFFFF',
  },
  loginBtn: {
    marginTop: 24, backgroundColor: '#E11D48',
    borderRadius: 14, padding: 16, alignItems: 'center',
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  devBtn: { marginTop: 28, alignItems: 'center' },
  devText: { color: '#3A3A5A', fontSize: 13 },
  overlay: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.65)' },
  ch: { position: 'absolute', width: CORNER, height: CORNER_W, backgroundColor: CORNER_COLOR },
  cv: { position: 'absolute', width: CORNER_W, height: CORNER, backgroundColor: CORNER_COLOR },
  hintBox: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: {
    color: 'rgba(255,255,255,0.8)', fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, overflow: 'hidden',
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBarBadge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
  },
  topBarBadgeActive: {
    backgroundColor: 'rgba(34,197,94,0.7)',
  },
  topBarBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  manualPanel: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: '#0F0F1E',
    borderRadius: 20, padding: 20, gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  manualTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  manualSub: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  manualInputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  manualInput: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 24, fontWeight: '700', color: '#FFFFFF',
    fontFamily: 'monospace', letterSpacing: 6, textAlign: 'center',
  },
  manualConfirmBtn: {
    backgroundColor: '#22C55E', borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  manualConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  permText: { fontSize: 16, color: '#FFFFFF', textAlign: 'center', lineHeight: 24 },
  permBtn: { backgroundColor: '#E11D48', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  permBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  // ⚠️ 개발용 스타일 — 배포 전 제거할 것
  testBtnWrap: { position: 'absolute', left: 20, right: 20, gap: 8 },
  testBtnPass: {
    backgroundColor: 'rgba(34,197,94,0.85)',
    padding: 14, borderRadius: 12, alignItems: 'center',
  },
  testBtnFail: {
    backgroundColor: 'rgba(239,68,68,0.85)',
    padding: 14, borderRadius: 12, alignItems: 'center',
  },
  testBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  resultContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: 16, marginHorizontal: 24, marginVertical: 32, borderRadius: 28,
  },
  resultIconBox: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 3, justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
  },
  resultIconText: { fontSize: 48, fontWeight: '700' },
  resultTitle: { fontSize: 32, fontWeight: '800' },
  resultReason: { fontSize: 15, color: '#8E8EA0', textAlign: 'center', paddingHorizontal: 32 },
  tokenBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, padding: 16, alignItems: 'center', gap: 4, marginTop: 8,
  },
  tokenLabel: { fontSize: 11, color: '#8E8EA0', fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  tokenValue: { fontSize: 22, fontWeight: '700' },
  rescanBtn: { marginTop: 8, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 48 },
  rescanText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  resultFooter: { alignItems: 'center', paddingBottom: 24 },
  resultFooterText: { color: '#3A3A5A', fontSize: 13 },
});