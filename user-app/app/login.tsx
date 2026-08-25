import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import { ethers } from 'ethers';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert, Animated, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const AUTH_API_URL = 'http://13.125.221.211:8001/api';

export default function LoginScreen() {
  const { setSession } = useWallet();
  const [keystoreJson, setKeystoreJson] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const shake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const pickKeystoreFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    const content = await FileSystem.readAsStringAsync(asset.uri);
    setKeystoreJson(content);
    setFileName(asset.name);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const unlockAndLogin = async () => {
    if (!keystoreJson || !password) {
      shake();
      Alert.alert('입력 필요', '키스토어 파일과 비밀번호를 모두 입력해주세요.');
      return;
    }
    setIsUnlocking(true);
    try {
      const wallet = (await ethers.Wallet.fromEncryptedJson(keystoreJson, password)) as ethers.Wallet;
      const challengeRes = await fetch(`${AUTH_API_URL}/login-challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet.address }),
      });
      if (!challengeRes.ok) throw new Error('로그인 요청에 실패했습니다.');
      const { nonce, message } = await challengeRes.json();
      const signature = await wallet.signMessage(message);
      const verifyRes = await fetch(`${AUTH_API_URL}/login-verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet.address, nonce, message, signature }),
      });
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => null);
        throw new Error(err?.detail ?? '로그인 검증에 실패했습니다.');
      }
      const { access_token } = await verifyRes.json();
      setSession(wallet, access_token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('로그인 성공', '로그인되었습니다.', [
        { text: '확인', onPress: () => router.replace('/') },
      ]);
    } catch (e: any) {
      shake();
      Alert.alert('로그인 오류', e?.message ?? '지갑을 열 수 없습니다.');
    } finally {
      setIsUnlocking(false);
    }
  };

  // ⚠️ 개발용 — 배포 전 제거할 것
  const devLogin = () => {
    setSession(null, null, '0x1234567890123456789012345678901234567890');
    Alert.alert('로그인 성공', '로그인되었습니다.', [
      { text: '확인', onPress: () => router.replace('/') },
    ]);
  };

  const step1Done = !!keystoreJson;
  const step2Done = !!keystoreJson && password.length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.header}>
            <View style={s.logoWrap}><Text style={s.logoT}>T</Text></View>
            <Text style={s.brand}>TicketPro</Text>
            <Text style={s.headerSub}>DID 지갑으로 로그인</Text>
          </View>

          <Animated.View style={[s.card, { transform: [{ translateX: shakeAnim }] }]}>
            {/* Step 1 */}
            <View style={s.stepHeader}>
              <View style={[s.stepBadge, step1Done && s.stepBadgeDone]}>
                {step1Done
                  ? <Ionicons name="checkmark" size={11} color="#fff" />
                  : <Text style={s.stepBadgeText}>1</Text>}
              </View>
              <Text style={[s.stepLabel, step1Done && s.stepLabelDone]}>키스토어 파일 선택</Text>
            </View>

            <TouchableOpacity style={[s.fileBtn, keystoreJson && s.fileBtnDone]} onPress={pickKeystoreFile} activeOpacity={0.7}>
              <View style={[s.fileIconBox, keystoreJson && s.fileIconBoxDone]}>
                <Ionicons name={keystoreJson ? 'document-text' : 'folder-open-outline'} size={22} color={keystoreJson ? '#E11D48' : '#4B5563'} />
              </View>
              <View style={s.fileTextBox}>
                <Text style={[s.filePrimary, keystoreJson && s.filePrimaryDone]} numberOfLines={1}>
                  {fileName ?? '파일을 선택하세요'}
                </Text>
                <Text style={s.fileSecondary}>{keystoreJson ? '탭하여 변경' : 'Ethereum 키스토어 (.json)'}</Text>
              </View>
              {keystoreJson && <Ionicons name="checkmark-circle" size={20} color="#E11D48" />}
            </TouchableOpacity>

            {/* Step 2 */}
            <View style={[s.stepHeader, { marginTop: 24 }]}>
              <View style={[s.stepBadge, step2Done && s.stepBadgeDone]}>
                {step2Done
                  ? <Ionicons name="checkmark" size={11} color="#fff" />
                  : <Text style={s.stepBadgeText}>2</Text>}
              </View>
              <Text style={[s.stepLabel, step2Done && s.stepLabelDone]}>비밀번호 입력</Text>
            </View>

            <View style={s.inputRow}>
              <Ionicons name="lock-closed-outline" size={17} color="#4B5563" style={{ marginRight: 10 }} />
              <TextInput
                style={s.input}
                placeholder="키스토어 비밀번호"
                placeholderTextColor="#374151"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={unlockAndLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[s.loginBtn, isUnlocking && s.loginBtnDisabled]} onPress={unlockAndLogin} disabled={isUnlocking} activeOpacity={0.85}>
              {isUnlocking
                ? <Text style={s.loginBtnText}>지갑 복호화 중...</Text>
                : <View style={s.loginBtnRow}>
                    <Ionicons name="wallet-outline" size={18} color="#fff" />
                    <Text style={s.loginBtnText}>지갑으로 로그인</Text>
                  </View>}
            </TouchableOpacity>
          </Animated.View>

          <View style={s.secRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#2D2D40" />
            <Text style={s.secText}>개인키는 기기 밖으로 전송되지 않습니다</Text>
          </View>

          {/* ⚠️ 개발용 — 배포 전 제거할 것 */}
          <TouchableOpacity onPress={devLogin} style={s.devBtn}>
            <Text style={s.devText}>개발용 빠른 입장</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', paddingVertical: 48 },
  header: { alignItems: 'center', marginBottom: 40, gap: 8 },
  logoWrap: {
    width: 80, height: 80, borderRadius: 22, backgroundColor: '#E11D48',
    justifyContent: 'center', alignItems: 'center', marginBottom: 4,
    shadowColor: '#E11D48', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 18, elevation: 14,
  },
  logoT: { fontSize: 38, fontWeight: '800', color: '#FFFFFF' },
  brand: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.8 },
  headerSub: { fontSize: 14, color: '#4B5563' },
  card: { backgroundColor: '#13131F', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  stepBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepBadgeDone: { backgroundColor: '#E11D48', borderColor: '#E11D48' },
  stepBadgeText: { fontSize: 11, fontWeight: '700', color: '#4B5563' },
  stepLabel: { fontSize: 12, fontWeight: '600', color: '#4B5563', letterSpacing: 0.3 },
  stepLabelDone: { color: '#FFFFFF' },
  fileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', borderStyle: 'dashed',
    borderRadius: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  fileBtnDone: { borderStyle: 'solid', borderColor: 'rgba(225,29,72,0.35)', backgroundColor: 'rgba(225,29,72,0.05)' },
  fileIconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  fileIconBoxDone: { backgroundColor: 'rgba(225,29,72,0.1)' },
  fileTextBox: { flex: 1 },
  filePrimary: { fontSize: 14, color: '#4B5563', fontWeight: '500' },
  filePrimaryDone: { color: '#FFFFFF' },
  fileSecondary: { fontSize: 11, color: '#2D2D40', marginTop: 2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14, paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 15, fontSize: 15, color: '#FFFFFF' },
  loginBtn: {
    marginTop: 24, backgroundColor: '#E11D48', borderRadius: 16, padding: 17, alignItems: 'center',
    shadowColor: '#E11D48', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 10,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  secText: { fontSize: 12, color: '#2D2D40' },
  devBtn: { marginTop: 18, alignItems: 'center' },
  devText: { color: '#1A1A2A', fontSize: 13 },
});