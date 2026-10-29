import { useEffect, useState } from 'react'
import axios from 'axios'
import { TICKET_API_URL } from './apiConfig'

const STATUSES = {
  active: { label: '유효', note: '모바일 인증서도 원본 인증서의 만료일까지만 유효합니다.' },
  expired: { label: '만료됨', note: '학생 인증서의 유효기간이 끝났습니다. 학생 인증을 다시 확인해주세요.' },
  revoked: { label: '폐기됨', note: '폐기된 인증서입니다. 현재 인증 상태를 확인해주세요.' },
  not_issued: { label: '발급 정보 없음', note: '이 웹 계정에 연결된 원본 학생 인증서를 찾지 못했습니다.' },
  unknown: { label: '확인 필요', note: '인증서의 유효기간 정보를 확인해주세요.' },
}

function credentialDate(value) {
  if (!value) return { date: '—', time: '' }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return { date: '확인 필요', time: '' }
  return {
    date: date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
  }
}

export default function CredentialSummary({ token, account }) {
  const [credential, setCredential] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCredential(null); setError(''); setLoading(true)
    if (!token || !account) {
      setLoading(false); setError('로그인 후 인증서 정보를 확인할 수 있습니다.')
      return () => controller.abort()
    }
    axios.get(`${TICKET_API_URL}/account/credential`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(({ data }) => {
      if (controller.signal.aborted) return
      if (data.data?.wallet_address?.toLowerCase() !== account.toLowerCase()) throw new Error('인증서 계정 정보가 일치하지 않습니다.')
      setCredential(data.data)
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.response?.status === 401 ? '로그인 상태를 다시 확인해주세요.' : '인증서 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, account, refresh])

  const status = STATUSES[credential?.status] || STATUSES.unknown
  const issued = credentialDate(credential?.issued_at)
  const expires = credentialDate(credential?.expires_at)

  return <section className="credential-summary" aria-labelledby="credential-summary-title" aria-busy={loading}>
    <div className="credential-summary-heading">
      <div className="credential-summary-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.3 3.1 7.6 7.5 9.5 4.4-1.9 7.5-5.2 7.5-9.5V6L12 3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/></svg>
        <div><h3 id="credential-summary-title">학생 인증서</h3><p>웹 계정에 연결된 원본 VC</p></div>
      </div>
      {credential && !loading && <span className={`credential-status ${credential.status === 'active' ? 'active' : 'inactive'}`}>{status.label}</span>}
    </div>
    {loading ? <p className="credential-summary-loading" role="status">인증서 정보를 확인하고 있습니다…</p> : error ? <div className="credential-summary-error"><p role="alert">{error}</p><button type="button" onClick={() => setRefresh(value => value+1)}>다시 확인</button></div> : <>
      <dl className="credential-summary-dates">
        <div><dt>발급일</dt><dd>{issued.date}{issued.time && <span>{issued.time}</span>}</dd></div>
        <div><dt>만료일</dt><dd>{expires.date}{expires.time && <span>{expires.time}</span>}</dd></div>
      </dl>
      <div className="credential-summary-footer"><p>{status.note}<span>날짜와 시간은 현재 기기의 시간대 기준입니다.</span></p><button type="button" onClick={() => setRefresh(value => value+1)}>새로고침</button></div>
    </>}
  </section>
}
