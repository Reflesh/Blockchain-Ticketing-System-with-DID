import { useWallet } from '@/context/WalletContext';
import { ethers } from 'ethers';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Animated,
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

const AUTH_API_URL = 'http://13.125.221.211:8001/api';

export default function LoginScreen() {
  const { setSession } = useWallet();
  const [keystoreJson, setKeystoreJson] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
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
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet.address }),
      });
      if (!challengeRes.ok) throw new Error('로그인 요청에 실패했습니다.');
      const { nonce, message } = await challengeRes.json();
      const signature = await wallet.signMessage(message);
      const verifyRes = await fetch(`${AUTH_API_URL}/login-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet.address, nonce, message, signature }),
      });
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => null);
        throw new Error(err?.detail ?? '로그인 검증에 실패했습니다.');
      }
      const { access_token } = await verifyRes.json();
      setSession(wallet, access_token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/mypage');
    } catch (e: any) {
      shake();
      Alert.alert('로그인 실패', e?.message ?? '지갑을 열 수 없습니다.');
    } finally {
      setIsUnlocking(false);
    }
  };

  const devLogin = () => {
    setSession(null, null, '0x1234567890123456789012345678901234567890');
    router.replace('/mypage');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>T</Text>
            </View>
            <Text style={styles.brand}>TicketPro</Text>
            <Text style={styles.headerSub}>DID 지갑으로 로그인하세요</Text>
          </View>

          <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
            <Text style={styles.cardLabel}>키스토어 파일</Text>
            <TouchableOpacity
              style={[styles.fileBtn, keystoreJson && styles.fileBtnActive]}
              onPress={pickKeystoreFile}
              activeOpacity={0.7}
            >
              <Text style={[styles.fileBtnIcon, keystoreJson && styles.fileBtnIconActive]}>
                {keystoreJson ? '✓' : '+'}
              </Text>
              <Text
                style={[styles.fileBtnText, keystoreJson && styles.fileBtnTextActive]}
                numberOfLines={1}
              >
                {fileName ?? '파일 선택 (.json)'}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.cardLabel, { marginTop: 20 }]}>비밀번호</Text>
            <TextInput
              style={styles.input}
              placeholder="비밀번호 입력"
              placeholderTextColor="#4A4A6A"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={unlockAndLogin}
            />

            <TouchableOpacity
              style={[styles.loginBtn, isUnlocking && styles.loginBtnDisabled]}
              onPress={unlockAndLogin}
              disabled={isUnlocking}
              activeOpacity={0.85}
            >
              <Text style={styles.loginBtnText}>
                {isUnlocking ? '로그인 중...' : '지갑으로 로그인'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity onPress={devLogin} style={styles.devBtn}>
            <Text style={styles.devText}>개발용 빠른 입장</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F0F1A' },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingVertical: 48,
  },
  header: { alignItems: 'center', marginBottom: 36, gap: 8 },
  logo: {
    width: 72, height: 72, borderRadius: 18,
    backgroundColor: '#E11D48',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  logoText: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  brand: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSub: { fontSize: 14, color: '#8E8EA0' },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardLabel: {
    fontSize: 11, fontWeight: '600', color: '#8E8EA0',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8,
  },
  fileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    borderStyle: 'dashed', borderRadius: 12,
    padding: 14, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  fileBtnActive: {
    borderColor: '#E11D48', borderStyle: 'solid',
    backgroundColor: 'rgba(225,29,72,0.08)',
  },
  fileBtnIcon: { fontSize: 18, color: '#4A4A6A', width: 20, textAlign: 'center' },
  fileBtnIconActive: { color: '#E11D48' },
  fileBtnText: { flex: 1, fontSize: 14, color: '#4A4A6A' },
  fileBtnTextActive: { color: '#FFFFFF' },
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
});