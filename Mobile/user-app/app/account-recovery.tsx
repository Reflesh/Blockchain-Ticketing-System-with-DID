import { useState } from 'react';
import { ethers } from 'ethers';
import { router } from 'expo-router';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountRequest, withdrawAccount } from '@/lib/account';
import { completeMobilePairing } from '@/lib/mobilePairing';
import { resetLocalWallet, saveLocalWalletPassword, prepareReplacementWallet, finalizeReplacementWallet } from '@/lib/oid4vci';
import { useWallet } from '@/context/WalletContext';

export default function AccountRecoveryScreen() {
  const { wallet, accessToken, setSession, logout, storageError } = useWallet();
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
  return <SafeAreaView style={s.safe}><KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={s.header}><TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹ 돌아가기</Text></TouchableOpacity><Text style={s.title}>계정 및 보안</Text></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.card}><Text style={s.heading}>비밀번호 변경 · 분실 복구</Text><Text style={s.note}>로그인 상태에서는 현재 지갑의 비밀번호를 변경할 수 있습니다. 비밀번호를 잊었다면 대학 이메일로 재인증해 새 모바일 지갑을 연결합니다. NFT 소유 지갑과 티켓은 유지되며 기존 모바일 기기는 연결 해제됩니다.</Text>
        <TextInput style={s.input} placeholder="새 비밀번호 (8자 이상)" placeholderTextColor="#73738C" secureTextEntry value={password} onChangeText={setPassword} editable={!busy}/>
        <TextInput style={s.input} placeholder="새 비밀번호 확인" placeholderTextColor="#73738C" secureTextEntry value={confirmation} onChangeText={setConfirmation} editable={!busy}/>
        {wallet && <TouchableOpacity disabled={busy} style={s.button} onPress={() => void run(changePassword)}><Text style={s.buttonText}>현재 지갑 비밀번호 변경</Text></TouchableOpacity>}
        <TextInput style={s.input} placeholder="대학 이메일 (@pukyong.ac.kr)" placeholderTextColor="#73738C" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!busy}/>
        <TouchableOpacity disabled={busy} style={s.secondary} onPress={() => void run(sendCode)}><Text style={s.buttonText}>복구 인증번호 받기</Text></TouchableOpacity>
        {!!requestId && <><TextInput style={s.input} placeholder="6자리 인증번호" placeholderTextColor="#73738C" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} editable={!busy}/>
          <TouchableOpacity disabled={busy} style={s.button} onPress={() => Alert.alert('모바일 지갑 복구', '기존 모바일 기기의 연결이 해제됩니다. 새 지갑으로 복구할까요?', [{ text: '취소' }, { text: '복구', onPress: () => void run(recover) }])}><Text style={s.buttonText}>이메일 인증 후 비밀번호 재설정</Text></TouchableOpacity></>}
      </View>
      {busy && <ActivityIndicator color="#E11D48"/>}
      {!!message && <Text accessibilityRole="alert" style={s.note}>{message}</Text>}
      {!!storageError && <Text style={s.note}>{storageError}</Text>}
      {!!wallet && !!accessToken && <View style={s.card}><Text style={s.heading}>회원탈퇴</Text><Text style={s.note}>미사용 티켓은 먼저 사용하거나 양도해주세요. 탈퇴는 블록체인 NFT 소각이나 결제 환불을 수행하지 않습니다.</Text><TouchableOpacity disabled={busy} style={s.secondary} onPress={confirmWithdrawal}><Text style={s.danger}>회원탈퇴</Text></TouchableOpacity></View>}
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#0A0A14' }, header: { padding: 20, gap: 12 }, back: { color: '#9CA3AF' }, title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' }, content: { padding: 20, gap: 16, paddingBottom: 60 }, card: { padding: 20, backgroundColor: '#13131F', borderRadius: 20, gap: 14 }, heading: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' }, note: { color: '#9CA3AF', lineHeight: 22, fontSize: 13 }, input: { color: '#FFFFFF', backgroundColor: '#1B1B2B', padding: 14, borderRadius: 12 }, button: { padding: 15, borderRadius: 12, backgroundColor: '#E11D48', alignItems: 'center' }, secondary: { padding: 15, borderRadius: 12, backgroundColor: '#242436', alignItems: 'center' }, buttonText: { color: '#FFFFFF', fontWeight: '600' }, danger: { color: '#FB7185', fontWeight: '600' } });
