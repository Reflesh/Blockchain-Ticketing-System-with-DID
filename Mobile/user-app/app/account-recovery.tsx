import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ethers } from 'ethers';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountRequest, withdrawAccount } from '@/lib/account';
import { completeMobilePairing } from '@/lib/mobilePairing';
import { resetLocalWallet, saveLocalWalletPassword, prepareReplacementWallet, finalizeReplacementWallet } from '@/lib/oid4vci';
import { useWallet } from '@/context/WalletContext';

type AccountSection = 'password' | 'recovery' | 'withdrawal';
const ACCOUNT_SECTIONS: { id: AccountSection; label: string }[] = [
  { id: 'password', label: '비밀번호 변경' },
  { id: 'recovery', label: '지갑 복구' },
  { id: 'withdrawal', label: '회원탈퇴' },
];

function isAccountSection(value: unknown): value is AccountSection {
  return ACCOUNT_SECTIONS.some(item => item.id === value);
}

export default function AccountRecoveryScreen() {
  const { wallet, accessToken, setSession, logout, storageError } = useWallet();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [activeSection, setActiveSection] = useState<AccountSection>(isAccountSection(section) ? section : wallet ? 'password' : 'recovery');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [recoveryUri, setRecoveryUri] = useState('');
  const [replacement, setReplacement] = useState<ethers.Wallet | null>(null);

  useEffect(() => {
    if (isAccountSection(section)) setActiveSection(section);
  }, [section]);

  function selectSection(next: AccountSection) {
    if (busy || next === activeSection) return;
    setPassword(''); setConfirmation(''); setMessage('');
    setActiveSection(next);
  }

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await operation(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '요청에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  function validatePassword() {
    if (password.length < 8) throw new Error('새 비밀번호를 8자 이상 입력해주세요.');
    if (password !== confirmation) throw new Error('새 비밀번호가 서로 일치하지 않습니다.');
  }
  async function sendCode() {
    if (Date.now() < cooldownUntil) throw new Error('인증번호는 60초 후 다시 요청해주세요.');
    const result = await accountRequest('/account/recovery/request', { email });
    setRequestId(result.request_id); setCode(''); setRecoveryUri(''); setReplacement(null);
    setCooldownUntil(Date.now() + 60000); setMessage('복구 가능한 계정이면 이메일로 인증번호가 발송됩니다. 3분 이내에 입력해주세요.');
  }
  async function recover() {
    validatePassword();
    if (!requestId) throw new Error('먼저 이메일 인증번호를 요청해주세요.');
    let uri = recoveryUri;
    if (!uri) {
      const result = await accountRequest('/account/recovery/verify', { request_id: requestId, code });
      uri = result.pairing_uri; setRecoveryUri(uri);
    }
    // Keep the old local wallet until a replacement has been verified successfully.
    const next = replacement ?? new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32)));
    setReplacement(next);
    await prepareReplacementWallet(next, password);
    const result = await completeMobilePairing(uri, next, '이메일 복구 모바일 Wallet');
    await finalizeReplacementWallet(next);
    const saved = await setSession(next, result.accessToken, result.accountWalletAddress);
    setPassword(''); setConfirmation(''); setRecoveryUri('');
    Alert.alert('복구 완료', saved ? '새 비밀번호로 모바일 지갑을 복구했습니다. 기존 티켓 소유권은 유지됩니다.' : '복구와 로그인은 완료했습니다. 자동 로그인 설정은 인증서 화면에서 확인해주세요.', [{ text: '확인', onPress: () => router.replace('/mypage') }]);
  }
  async function changePassword() {
    validatePassword();
    if (!wallet) throw new Error('먼저 지갑을 잠금 해제해주세요.');
    await saveLocalWalletPassword(wallet, password);
    setPassword(''); setConfirmation(''); setMessage('이 기기의 Wallet 비밀번호를 변경했습니다. 외부 키스토어 파일의 비밀번호는 변경되지 않습니다.');
  }
  function confirmWithdrawal() {
    if (!wallet || !accessToken) return;
    Alert.alert('회원탈퇴', '인증서와 모든 로그인 세션이 폐기됩니다. 미사용 티켓 또는 진행 중인 결제가 있으면 탈퇴할 수 없습니다. 예매·검표·블록체인 기록은 보존됩니다. 계속할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '탈퇴', style: 'destructive', onPress: () => void run(async () => {
        await withdrawAccount(wallet, accessToken);
        await logout(); await resetLocalWallet();
        Alert.alert('탈퇴 완료', '서비스 이용과 기기의 로그인 정보가 종료되었습니다.', [{ text: '확인', onPress: () => router.replace('/login') }]);
      }) },
    ]);
  }
  const passwordFields = (
    <>
      <View style={s.field}>
        <Text style={s.label}>새 비밀번호</Text>
        <TextInput style={s.input} placeholder="8자 이상 입력해주세요" placeholderTextColor="#73738C" secureTextEntry autoCapitalize="none" autoCorrect={false} accessibilityLabel="새 비밀번호" value={password} onChangeText={setPassword} editable={!busy}/>
      </View>
      <View style={s.field}>
        <Text style={s.label}>새 비밀번호 확인</Text>
        <TextInput style={s.input} placeholder="새 비밀번호를 한 번 더 입력해주세요" placeholderTextColor="#73738C" secureTextEntry autoCapitalize="none" autoCorrect={false} accessibilityLabel="새 비밀번호 확인" value={confirmation} onChangeText={setConfirmation} editable={!busy}/>
      </View>
    </>
  );

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity disabled={busy} onPress={() => router.back()} style={s.back} accessibilityLabel="이전 화면으로 돌아가기">
            <Ionicons name="chevron-back" size={23} color="#D1D5DB" />
          </TouchableOpacity>
          <Text style={s.title}>계정 및 보안</Text>
        </View>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.tabs} accessibilityRole="tablist">
            {ACCOUNT_SECTIONS.map(item => (
              <TouchableOpacity key={item.id} disabled={busy} accessibilityRole="tab" accessibilityState={{ selected: activeSection === item.id, disabled: busy }} onPress={() => selectSection(item.id)} style={[s.tab, activeSection === item.id && s.activeTab, busy && s.disabled]}>
                <Text style={[s.tabText, activeSection === item.id && s.activeTabText]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeSection === 'password' && (
            <View style={s.card}>
              <View style={s.sectionHeading}><Ionicons name="lock-closed-outline" size={21} color="#D1D5DB" /><Text style={s.heading}>비밀번호 변경</Text></View>
              <Text style={s.note}>이 기기의 Wallet 비밀번호를 변경합니다. 웹에서 내려받은 키 파일의 비밀번호는 바뀌지 않습니다.</Text>
              {wallet ? <>
                {passwordFields}
                <TouchableOpacity disabled={busy} style={[s.button, busy && s.disabled]} onPress={() => void run(changePassword)}>
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.buttonText}>비밀번호 변경하기</Text>}
                </TouchableOpacity>
              </> : <>
                <Text style={s.notice}>먼저 Wallet의 잠금을 해제한 뒤 변경할 수 있습니다.</Text>
                <TouchableOpacity style={s.secondary} onPress={() => router.push('/credential-wallet')}><Text style={s.buttonText}>Wallet 잠금 해제하기</Text></TouchableOpacity>
              </>}
            </View>
          )}

          {activeSection === 'recovery' && (
            <View style={s.card}>
              <View style={s.sectionHeading}><Ionicons name="refresh-outline" size={21} color="#D1D5DB" /><Text style={s.heading}>비밀번호 분실 · 지갑 복구</Text></View>
              <Text style={s.note}>비밀번호를 잊었다면 대학 이메일로 본인 인증 후 새 모바일 Wallet을 연결할 수 있습니다. 기존 티켓은 유지됩니다.</Text>
              <Text style={s.notice}>복구가 완료되면 기존 모바일 기기의 연결이 해제됩니다.</Text>
              <View style={s.field}>
                <Text style={s.label}>대학 이메일</Text>
                <TextInput style={s.input} placeholder="이메일 주소 (@pukyong.ac.kr)" placeholderTextColor="#73738C" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" accessibilityLabel="대학 이메일" value={email} onChangeText={setEmail} editable={!busy}/>
              </View>
              <TouchableOpacity disabled={busy} style={[s.secondary, busy && s.disabled]} onPress={() => void run(sendCode)}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.buttonText}>{requestId ? '인증번호 다시 받기' : '인증번호 받기'}</Text>}
              </TouchableOpacity>
              {!!requestId && <>
                <View style={s.field}>
                  <Text style={s.label}>인증번호</Text>
                  <TextInput style={s.input} placeholder="이메일로 받은 6자리 숫자" placeholderTextColor="#73738C" keyboardType="number-pad" maxLength={6} accessibilityLabel="복구 인증번호" value={code} onChangeText={setCode} editable={!busy}/>
                </View>
                {passwordFields}
                <TouchableOpacity disabled={busy} style={[s.button, busy && s.disabled]} onPress={() => Alert.alert('모바일 지갑 복구', '기존 모바일 기기의 연결이 해제됩니다. 새 지갑으로 복구할까요?', [{ text: '취소' }, { text: '복구', onPress: () => void run(recover) }])}>
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.buttonText}>새 비밀번호로 지갑 복구하기</Text>}
                </TouchableOpacity>
              </>}
            </View>
          )}

          {activeSection === 'withdrawal' && (
            <View style={[s.card, s.withdrawalCard]}>
              <View style={s.sectionHeading}><Ionicons name="person-remove-outline" size={21} color="#C58A95" /><Text style={s.heading}>회원탈퇴</Text></View>
              <Text style={s.note}>탈퇴 전에 아래 내용을 확인해주세요.</Text>
              <View style={s.withdrawalNotes}>
                <Text style={s.note}>• 미사용 티켓이나 진행 중인 결제가 있으면 탈퇴할 수 없습니다.</Text>
                <Text style={s.note}>• 인증서와 모든 로그인 세션이 폐기됩니다.</Text>
                <Text style={s.note}>• 예매·검표·블록체인 기록은 보존되며, 결제 환불은 진행되지 않습니다.</Text>
              </View>
              {wallet && accessToken ? (
                <TouchableOpacity disabled={busy} style={[s.withdrawalButton, busy && s.disabled]} onPress={confirmWithdrawal}>
                  {busy ? <ActivityIndicator color="#FB7185" /> : <Text style={s.danger}>회원탈퇴 진행하기</Text>}
                </TouchableOpacity>
              ) : <Text style={s.notice}>로그인하고 지갑 잠금을 해제한 뒤 이용할 수 있습니다.</Text>}
            </View>
          )}

          {!!message && <View style={s.messageBox}><Text accessibilityRole="alert" style={s.note}>{message}</Text></View>}
          {!!storageError && <Text style={s.note}>{storageError}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A14' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 20, paddingBottom: 60 },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: '#13131F', padding: 4, borderRadius: 12 },
  tab: { flex: 1, minHeight: 44, paddingHorizontal: 5, paddingVertical: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 9 },
  activeTab: { backgroundColor: 'rgba(225,29,72,0.13)' },
  tabText: { color: '#9CA3AF', fontSize: 12, lineHeight: 18, textAlign: 'center', fontWeight: '500' },
  activeTabText: { color: '#FB7185', fontWeight: '700' },
  card: { padding: 20, backgroundColor: '#13131F', borderRadius: 18, gap: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  heading: { flex: 1, color: '#FFFFFF', fontSize: 17, lineHeight: 25, fontWeight: '600' },
  note: { color: '#9CA3AF', lineHeight: 22, fontSize: 13 },
  notice: { color: '#C5AE83', fontSize: 12, lineHeight: 20, backgroundColor: 'rgba(197,174,131,0.07)', padding: 12, borderRadius: 10 },
  field: { gap: 8 },
  label: { color: '#D1D5DB', fontSize: 12, fontWeight: '500' },
  input: { color: '#FFFFFF', backgroundColor: '#1B1B2B', padding: 14, borderRadius: 11, fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  button: { minHeight: 48, padding: 14, borderRadius: 11, backgroundColor: '#E11D48', alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 48, padding: 14, borderRadius: 11, backgroundColor: '#242436', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  withdrawalCard: { borderColor: 'rgba(197,138,149,0.18)' },
  withdrawalNotes: { gap: 10, paddingVertical: 4 },
  withdrawalButton: { minHeight: 48, padding: 14, borderRadius: 11, backgroundColor: 'rgba(251,113,133,0.07)', borderWidth: 1, borderColor: 'rgba(251,113,133,0.22)', alignItems: 'center', justifyContent: 'center' },
  danger: { color: '#FB7185', fontSize: 13, fontWeight: '600' },
  messageBox: { padding: 14, backgroundColor: '#171724', borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
});
