import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'

import { TICKET_API_URL as API, AUTH_API_URL as AUTH } from './apiConfig'
const message = error => error.response?.data?.detail || error.message || '요청을 처리하지 못했습니다.'

export function AccountRecoveryForm() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [requestId, setRequestId] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  async function submit(event) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      if (!requestId) {
        if (Date.now() < cooldown) throw new Error('인증번호는 60초 후 다시 요청해주세요.')
        const response = await axios.post(`${AUTH}/account/recovery/request`, { email })
        setRequestId(response.data.request_id); setCooldown(Date.now() + 60000)
      } else {
        const response = await axios.post(`${AUTH}/account/recovery/verify`, { request_id: requestId, code })
        setResult(response.data)
      }
    } catch (error) { setError(String(message(error))) }
    finally { setBusy(false) }
  }
  return <section className="account-tools"><button type="button" className="account-link" onClick={() => setOpen(!open)}>비밀번호를 잊으셨나요? 모바일 지갑 복구</button>
    {open && <form onSubmit={submit}><p>대학 이메일로 재인증해 기존 계정에 새 모바일 Wallet을 연결합니다. 기존 키 파일 자체를 복호화하거나 NFT 소유 지갑을 바꾸지는 않습니다. 모바일 앱의 ‘비밀번호 분실 복구’에서 새 비밀번호를 설정할 수도 있습니다.</p>
      {!result ? <><input aria-label="복구 이메일" type="email" placeholder="대학 이메일 (@pukyong.ac.kr)" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy || !!requestId}/>
        {!!requestId && <><p>복구 가능한 계정이면 인증번호가 발송됩니다. 3분 이내에 입력해주세요.</p><input aria-label="복구 인증번호" placeholder="6자리 인증번호" value={code} onChange={e => setCode(e.target.value)} pattern="[0-9]{6}" maxLength={6} required/></>}
        <button disabled={busy}>{busy ? '확인 중…' : requestId ? '인증하고 모바일 연결 QR 받기' : '인증번호 받기'}</button>
        {!!requestId && <button type="button" disabled={busy} onClick={() => { setRequestId(''); setCode(''); setError(''); }}>이메일 수정 · 인증번호 다시 요청</button>}
      </> : <><p>3분 안에 모바일 앱의 인증서 Wallet에서 연결하세요. 비밀번호를 잊은 기기는 앱의 ‘이메일 복구’ 흐름을 이용해주세요.</p><img className="account-recovery-qr" alt="복구 모바일 연결 QR" src={`data:image/png;base64,${result.qr_png_base64}`}/><input aria-label="복구 연결 URI" value={result.pairing_uri} readOnly onFocus={e => e.target.select()}/></>}
      {!!error && <p role="alert" className="account-error">{error}</p>}
    </form>}
  </section>
}

export default function AccountTools({ token, wallet, account, onWithdraw }) {
  const [intents, setIntents] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const headers = { Authorization: `Bearer ${token}` }
  const load = useCallback(async () => {
    if (!token) return
    try {
      const response = await axios.get(`${API}/mobile-transfers`, { headers: { Authorization: `Bearer ${token}` } })
      setIntents(response.data.data || [])
    } catch (error) { setError(String(message(error))) }
  }, [token])
  useEffect(() => { void load(); const id = setInterval(load, 30000); return () => clearInterval(id) }, [load])
  async function run(operation) {
    if (busy) return
    setBusy(true); setError('')
    try { await operation() } catch (error) { setError(String(message(error))) } finally { setBusy(false) }
  }
  function requireOwnerWallet() {
    if (!wallet || wallet.address.toLowerCase() !== account?.toLowerCase()) throw new Error('소유 지갑의 키스토어 파일로 다시 로그인한 뒤 진행해주세요.')
  }
  async function approve(intent) {
    requireOwnerWallet()
    if (!window.confirm(`${intent.seat_code} 티켓을 ${intent.recipient_wallet}에게 양도할까요? 양도는 1회이며 되돌릴 수 없습니다.`)) return
    const payload = { wallet_address: account, booking_item_id: intent.booking_item_id, companion_username: intent.recipient_wallet }
    const { data: { data: challenge } } = await axios.post(`${API}/transfer-ticket/challenge`, payload, { headers })
    const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.message)
    const response = await axios.post(`${API}/mobile-transfers/${intent.request_id}/approve`, { signature, nonce: Number(challenge.message.nonce), deadline: Number(challenge.message.deadline) }, { headers })
    window.alert(response.data.message || '양도 요청을 처리했습니다.'); await load()
  }
  async function changePassword(event) {
    event.preventDefault()
    await run(async () => {
      requireOwnerWallet()
      if (newPassword.length < 8 || newPassword !== passwordAgain) throw new Error('새 비밀번호를 8자 이상, 두 칸에 동일하게 입력해주세요.')
      const encrypted = await wallet.encrypt(newPassword)
      const url = URL.createObjectURL(new Blob([encrypted], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `TicketPro_Wallet_${wallet.address}.json`; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNewPassword(''); setPasswordAgain(''); window.alert('새 비밀번호의 키 파일을 다운로드했습니다. 다음 로그인부터 새 파일을 사용하세요. 이전 파일의 암호는 바뀌지 않습니다.')
    })
  }
  async function withdraw() {
    requireOwnerWallet()
    if (window.prompt('회원탈퇴를 진행하려면 회원탈퇴를 입력해주세요. 미사용 티켓·진행 중인 결제가 있으면 탈퇴할 수 없습니다. 기록은 보존됩니다.') !== '회원탈퇴') return
    const { data: challenge } = await axios.post(`${AUTH}/account/withdraw/challenge`, {}, { headers })
    const signature = await wallet.signMessage(challenge.message)
    await axios.post(`${API}/account/withdraw`, { ...challenge, signature }, { headers })
    onWithdraw(); window.alert('회원탈퇴가 완료되었습니다.')
  }
  return <section className="account-tools">
    <h3>모바일 양도 요청</h3><p>모바일 전용 지갑에서 요청한 양도는 여기서 소유 지갑으로 승인합니다.</p>
    <button type="button" onClick={load} disabled={busy}>요청 새로고침</button>
    {intents.filter(i => ['pending', 'processing'].includes(i.status)).length === 0 && <p>승인 대기 중인 요청이 없습니다.</p>}
    {intents.filter(i => ['pending', 'processing'].includes(i.status)).map(i => <div className="account-intent" key={i.request_id}><strong>{i.seat_code}</strong><code>{i.recipient_wallet}</code><span>{i.status === 'pending' ? '승인 대기 · 10분 후 만료' : '블록체인 처리 확인 중'}</span>{i.status === 'pending' && <><button disabled={busy} onClick={() => void run(() => approve(i))}>서명하고 승인</button><button disabled={busy} onClick={() => void run(async () => { await axios.post(`${API}/mobile-transfers/${i.request_id}/cancel`, {}, { headers }); await load() })}>거절</button></>}</div>)}
    <details><summary>계정 및 보안</summary><form onSubmit={changePassword}><h4>키 파일 비밀번호 변경</h4><p>로그인한 소유 지갑을 새 비밀번호로 암호화해 다운로드합니다.</p><input aria-label="새 키 파일 비밀번호" type="password" minLength={8} placeholder="새 비밀번호 (8자 이상)" value={newPassword} onChange={e => setNewPassword(e.target.value)} required autoComplete="new-password"/><input aria-label="새 키 파일 비밀번호 확인" type="password" placeholder="새 비밀번호 확인" value={passwordAgain} onChange={e => setPasswordAgain(e.target.value)} required autoComplete="new-password"/><button disabled={busy}>{busy ? '처리 중…' : '새 키 파일 다운로드'}</button></form><h4>회원탈퇴</h4><p>학생 인증서·모바일 연결·세션을 폐기합니다. 예매·검표·블록체인 기록은 보존됩니다.</p><button type="button" disabled={busy} className="account-danger" onClick={() => void run(withdraw)}>회원탈퇴</button></details>
    {!!error && <p role="alert" className="account-error">{error}</p>}
  </section>
}
