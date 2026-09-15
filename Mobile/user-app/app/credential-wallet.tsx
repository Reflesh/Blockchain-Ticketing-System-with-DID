import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useWallet } from '@/context/WalletContext';
import { authenticateWallet } from '@/lib/auth';
import { completeMobilePairing } from '@/lib/mobilePairing';
import {
  createLocalEncryptedWallet,
  hasLocalEncryptedWallet,
  loadCredentials,
  removeCredential,
  resetLocalWallet,
  type StoredCredential,
  unlockLocalEncryptedWallet,
} from '@/lib/oid4vci';

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('ko-KR');
}

export default function CredentialWalletScreen() {
  const { wallet, setSession } = useWallet();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [pairingValue, setPairingValue] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [hasSavedWallet, setHasSavedWallet] = useState(false);
  const [walletPassword, setWalletPassword] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletProgress, setWalletProgress] = useState<number | null>(null);

  const refreshCredentials = useCallback(() => {
    loadCredentials().then(setCredentials).catch(() => setCredentials([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCredentials();
      hasLocalEncryptedWallet().then(setHasSavedWallet).catch(() => setHasSavedWallet(false));
    }, [refreshCredentials]),
  );

  const handleLocalWallet = async () => {
    setWalletBusy(true);
    setWalletProgress(0);
    const operation = hasSavedWallet ? 'Wallet 잠금 해제' : 'Wallet 암호화';
    try {
      const onProgress = (progress: number) => {
        const percent = Math.round(progress * 100);
        setWalletProgress(percent);
        setStatus(`${operation} 중… ${percent}%`);
      };
      const unlocked = hasSavedWallet
        ? await unlockLocalEncryptedWallet(walletPassword, onProgress)
        : await createLocalEncryptedWallet(walletPassword, onProgress);
      setWalletPassword('');
      setHasSavedWallet(true);
      if (hasSavedWallet) {
        try {
          setStatus('Wallet 잠금을 해제했습니다. 서버 로그인을 진행하고 있습니다…');
          const session = await authenticateWallet(unlocked);
          setSession(unlocked, session.accessToken, session.accountWalletAddress);
          setStatus('Wallet 잠금 해제 및 서버 로그인을 완료했습니다.');
        } catch (loginError) {
          setSession(unlocked, null);
          const loginMessage = loginError instanceof Error
            ? loginError.message
            : '서버 로그인에 실패했습니다.';
          setStatus(`Wallet은 열었지만 서버 로그인에 실패했습니다: ${loginMessage}`);
        }
      } else {
        setSession(unlocked, null);
        setStatus('암호화된 로컬 Wallet을 생성했습니다. PC 웹 마이페이지의 QR로 연결해주세요.');
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : '';
      const message = /incorrect password/i.test(rawMessage)
        ? 'Wallet 비밀번호가 올바르지 않습니다.'
        : rawMessage || 'Wallet을 준비하지 못했습니다.';
      Alert.alert('Wallet 오류', message);
    } finally {
      setWalletBusy(false);
      setWalletProgress(null);
    }
  };

  const handleResetLocalWallet = () => {
    Alert.alert(
      'Wallet 초기화',
      '이 기기에 저장된 Wallet과 학생 인증서를 모두 삭제하고 새 Wallet을 만들까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '초기화',
          style: 'destructive',
          onPress: async () => {
            await resetLocalWallet();
            setSession(null, null);
            setHasSavedWallet(false);
            setCredentials([]);
            setWalletPassword('');
            setStatus('Wallet을 초기화했습니다. 새 비밀번호로 Wallet을 생성하세요.');
          },
        },
      ],
    );
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('카메라 권한 필요', 'PC 웹의 모바일 연결 QR을 스캔하려면 카메라 권한이 필요합니다.');
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  };

  const handleScan = ({ data }: { data: string }) => {
    if (scanLocked) return;
    setScanLocked(true);
    if (data.trim().startsWith('ticketprouserapp://mobile-pairing')) {
      setPairingValue(data);
      setStatus('PC 웹의 모바일 연결 QR을 읽었습니다. 연결 버튼을 눌러주세요.');
    } else {
      setStatus('TicketPro 모바일 연결 QR이 아닙니다.');
      Alert.alert('QR 확인', 'PC 웹 마이페이지에서 발급한 모바일 연결 QR을 스캔해주세요.');
    }
    setScannerOpen(false);
  };

  const handlePairing = async () => {
    if (!wallet) {
      Alert.alert('Wallet 준비 필요', '앱에서 Wallet을 생성하거나 저장된 Wallet의 잠금을 해제해주세요.');
      return;
    }
    if (!pairingValue.trim()) {
      Alert.alert('연결 QR 필요', 'PC 웹 마이페이지의 모바일 연결 QR을 스캔하거나 URI를 입력해주세요.');
      return;
    }
    setIssuing(true);
    setStatus('PC 웹 계정과 모바일 Wallet을 안전하게 연결하고 있습니다…');
    try {
      const result = await completeMobilePairing(pairingValue, wallet);
      setSession(wallet, result.accessToken, result.accountWalletAddress);
      setPairingValue('');
      await refreshCredentials();
      setStatus('모바일 VC 발급 및 서버 로그인을 완료했습니다.');
      Alert.alert(
        '모바일 연결 완료',
        `${formatDate(result.credential.expiresAt)}까지 이 Wallet으로 로그인할 수 있습니다.`,
        [{ text: '확인', onPress: () => router.replace('/') }],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '모바일 연결에 실패했습니다.';
      setStatus(`모바일 연결 실패: ${message}`);
      Alert.alert('모바일 연결 실패', message);
    } finally {
      setIssuing(false);
    }
  };

  const handleRemove = (credential: StoredCredential) => {
    Alert.alert('인증서 삭제', '이 기기에 저장된 학생 인증서를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await removeCredential(credential.id);
          refreshCredentials();
        },
      },
    ]);
  };

  if (scannerOpen) {
    return (
      <View style={s.cameraRoot}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
        />
        <SafeAreaView style={s.cameraOverlay}>
          <View style={s.cameraHeader}>
            <TouchableOpacity onPress={() => setScannerOpen(false)} style={s.iconButton}>
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={s.cameraTitle}>TicketPro QR 스캔</Text>
            <View style={s.iconButton} />
          </View>
          <View style={s.cameraCenter}>
            <View style={s.scanFrame} />
            <Text style={s.cameraGuide}>PC 마이페이지의 모바일 연결 QR을 프레임 안에 맞춰주세요.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.iconButton}>
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>학생 인증서 Wallet</Text>
          <View style={s.iconButton} />
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {!wallet && (
            <View style={s.warningCard}>
              <Ionicons name="warning-outline" size={20} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={s.warningTitle}>모바일 Wallet을 준비해주세요</Text>
                <Text style={s.warningText}>
                  앱에서 새 Wallet을 만들거나 이 기기에 저장된 Wallet의 잠금을 해제하세요.
                </Text>
                <TextInput
                  style={s.walletPasswordInput}
                  value={walletPassword}
                  onChangeText={setWalletPassword}
                  placeholder="Wallet 비밀번호 (8자 이상)"
                  placeholderTextColor="#6B7280"
                  secureTextEntry
                />
                <View style={s.walletActionRow}>
                  <TouchableOpacity style={s.secondaryButton} onPress={() => router.push('/login')}>
                    <Text style={s.secondaryButtonText}>기존 키스토어 사용</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.walletButton}
                    onPress={handleLocalWallet}
                    disabled={walletBusy}
                  >
                    {walletBusy ? (
                      <>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={s.walletButtonText}>{walletProgress ?? 0}%</Text>
                      </>
                    ) : (
                      <Text style={s.walletButtonText}>
                        {hasSavedWallet ? '잠금 해제' : '로컬 Wallet 생성'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                {hasSavedWallet && !walletBusy && (
                  <TouchableOpacity onPress={handleResetLocalWallet} style={s.resetWalletButton}>
                    <Text style={s.resetWalletText}>비밀번호를 잊었나요? Wallet 초기화</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <View style={[s.card, s.primaryCard]}>
            <View style={s.cardHeader}>
              <View style={s.stepBadge}>
                <Ionicons name="phone-portrait-outline" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>PC 웹 계정과 연결</Text>
                <Text style={s.cardSub}>마이페이지에서 발급한 1회용 QR을 스캔합니다.</Text>
              </View>
            </View>

            <TouchableOpacity style={s.scanButton} onPress={openScanner}>
              <Ionicons name="scan-outline" size={22} color="#FFFFFF" />
              <Text style={s.scanButtonText}>모바일 연결 QR 스캔</Text>
            </TouchableOpacity>

            <Text style={s.orText}>또는 Android 에뮬레이터에서 URI 직접 입력</Text>
            <TextInput
              style={s.offerInput}
              value={pairingValue}
              onChangeText={setPairingValue}
              placeholder="ticketprouserapp://mobile-pairing?token=…"
              placeholderTextColor="#4B5563"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[s.issueButton, (!wallet || issuing || !pairingValue.trim()) && s.disabled]}
              onPress={handlePairing}
              disabled={!wallet || issuing || !pairingValue.trim()}
            >
              {issuing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="link-outline" size={20} color="#FFFFFF" />
                  <Text style={s.issueButtonText}>모바일 VC 발급 및 로그인</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={s.securityNote}>
              기존 PC 키나 VC는 전송하지 않고, 이 기기에서 새로 만든 Wallet에 모바일용 VC를 발급합니다.
            </Text>
            {status && <Text style={s.status}>{status}</Text>}
          </View>

          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>저장된 인증서</Text>
            <Text style={s.count}>{credentials.length}</Text>
          </View>

          {credentials.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="id-card-outline" size={34} color="#374151" />
              <Text style={s.emptyTitle}>저장된 학생 인증서가 없습니다</Text>
            </View>
          ) : (
            credentials.map((credential) => (
              <View key={credential.id} style={s.credentialCard}>
                <View style={s.credentialTop}>
                  <View style={s.schoolIcon}>
                    <Ionicons name="school" size={22} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.credentialTitle}>
                      {credential.credentialConfigurationId === 'TicketProMobileCredential'
                        ? 'TicketPro 모바일 인증서'
                        : '부경대학교 학생 인증서'}
                    </Text>
                    <Text style={s.credentialState}>Issuer 서명 검증 완료</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleRemove(credential)}>
                    <Ionicons name="trash-outline" size={19} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                <View style={s.credentialDivider} />
                <Text style={s.metaLabel}>SUBJECT</Text>
                <Text style={s.metaValue} numberOfLines={1}>{credential.subject}</Text>
                <View style={s.dateRow}>
                  <View>
                    <Text style={s.metaLabel}>발급일</Text>
                    <Text style={s.dateValue}>{formatDate(credential.issuedAt)}</Text>
                  </View>
                  <View>
                    <Text style={s.metaLabel}>만료일</Text>
                    <Text style={s.dateValue}>{formatDate(credential.expiresAt)}</Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 60, gap: 16 },
  warningCard: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)', borderRadius: 14, padding: 14 },
  warningTitle: { color: '#F59E0B', fontSize: 13, fontWeight: '700' },
  warningText: { color: '#9CA3AF', fontSize: 11, marginTop: 3 },
  walletPasswordInput: { height: 42, marginTop: 12, borderRadius: 9, paddingHorizontal: 11, backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', fontSize: 12 },
  walletActionRow: { flexDirection: 'row', gap: 8, marginTop: 9 },
  secondaryButton: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  secondaryButtonText: { color: '#D1D5DB', fontSize: 11, fontWeight: '700' },
  walletButton: { flex: 1, height: 38, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F59E0B' },
  walletButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  resetWalletButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  resetWalletText: { color: '#F87171', fontSize: 10, textDecorationLine: 'underline' },
  card: { backgroundColor: '#13131F', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 16, gap: 13 },
  primaryCard: { borderColor: 'rgba(225,29,72,0.45)', backgroundColor: '#17131F' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E11D48', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  cardSub: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  scanButton: { height: 52, backgroundColor: '#E11D48', borderRadius: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  scanButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  orText: { color: '#4B5563', fontSize: 10, textAlign: 'center' },
  offerInput: { minHeight: 78, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0A0A14', color: '#D1D5DB', padding: 12, fontSize: 11, textAlignVertical: 'top' },
  issueButton: { height: 52, backgroundColor: '#10B981', borderRadius: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  issueButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  securityNote: { color: '#9CA3AF', fontSize: 10, lineHeight: 16, backgroundColor: 'rgba(16,185,129,0.08)', padding: 10, borderRadius: 9 },
  status: { color: '#9CA3AF', fontSize: 11, lineHeight: 17, textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 8 },
  sectionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  count: { color: '#E11D48', fontSize: 12, fontWeight: '800' },
  emptyCard: { alignItems: 'center', gap: 10, backgroundColor: '#10101A', borderRadius: 16, paddingVertical: 38, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  emptyTitle: { color: '#6B7280', fontSize: 12 },
  credentialCard: { backgroundColor: '#151525', borderRadius: 18, padding: 17, borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)' },
  credentialTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  schoolIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  credentialTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  credentialState: { color: '#10B981', fontSize: 10, marginTop: 3 },
  credentialDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 14 },
  metaLabel: { color: '#4B5563', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  metaValue: { color: '#9CA3AF', fontSize: 11, marginTop: 4, fontFamily: 'monospace' },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15, paddingRight: 35 },
  dateValue: { color: '#D1D5DB', fontSize: 12, fontWeight: '600', marginTop: 4 },
  cameraRoot: { flex: 1, backgroundColor: '#000000' },
  cameraOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  cameraHeader: { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  cameraTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  cameraCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  scanFrame: { width: 270, height: 270, borderWidth: 3, borderColor: '#10B981', borderRadius: 24 },
  cameraGuide: { color: '#FFFFFF', fontSize: 12, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
});
