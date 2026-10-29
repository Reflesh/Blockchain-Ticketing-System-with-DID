import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { TICKET_API_URL } from './apiConfig'

const LABELS = { review: '기대평', qna: 'Q&A' }
const authorLabel = author => `${author.slice(0, 6)}···${author.slice(-4)}`
const errorMessage = error => typeof error.response?.data?.detail === 'string' ? error.response.data.detail : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'
const uniqueReplies = rows => [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.id - b.id)

export default function EventCommunity({ eventId, tab, onTabChange, token, onLogin }) {
  const [posts, setPosts] = useState([])
  const [counts, setCounts] = useState(null)
  const [nextOffset, setNextOffset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [replyLoading, setReplyLoading] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState({})
  const [replyTarget, setReplyTarget] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const requestEpoch = useRef(0)
  const endpoint = `${TICKET_API_URL}/events/${eventId}/community`

  useEffect(() => {
    const controller = new AbortController()
    requestEpoch.current += 1
    setLoading(true); setError(''); setNotice(''); setPosts([]); setNextOffset(null); setReplyTarget(null)
    setMoreLoading(false); setReplyLoading(null)
    axios.get(endpoint, { params: { kind: tab }, signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return
      setPosts(data.data.map(post => ({ ...post, replyOffset: post.replies?.length || 0 })))
      setCounts(data.counts); setNextOffset(data.next_offset)
    }).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); requestEpoch.current += 1 }
  }, [endpoint, tab, refresh])

  function selectTab(next) {
    if (posting || moreLoading || replyLoading !== null) return
    onTabChange(next)
  }
  async function loadMore() {
    if (nextOffset === null || moreLoading) return
    const epoch = requestEpoch.current
    setMoreLoading(true); setError('')
    try {
      const { data } = await axios.get(endpoint, { params: { kind: tab, offset: nextOffset } })
      if (epoch !== requestEpoch.current) return
      setPosts(previous => [...new Map([...previous, ...data.data.map(post => ({ ...post, replyOffset: post.replies?.length || 0 }))].map(post => [post.id, post])).values()])
      setCounts(data.counts); setNextOffset(data.next_offset)
    } catch (error) { if (epoch === requestEpoch.current) setError(errorMessage(error)) }
    finally { if (epoch === requestEpoch.current) setMoreLoading(false) }
  }
  async function loadReplies(post) {
    if (replyLoading !== null) return
    const epoch = requestEpoch.current
    setReplyLoading(post.id); setError('')
    try {
      const { data } = await axios.get(`${endpoint}/${post.id}/replies`, { params: { offset: post.replyOffset } })
      if (epoch !== requestEpoch.current) return
      setPosts(previous => previous.map(item => item.id === post.id ? { ...item, replies: uniqueReplies([...item.replies, ...data.data]), replyOffset: item.replyOffset+data.data.length } : item))
    } catch (error) { if (epoch === requestEpoch.current) setError(errorMessage(error)) }
    finally { if (epoch === requestEpoch.current) setReplyLoading(null) }
  }
  async function submit(event, post = null) {
    event.preventDefault()
    if (!token) { onLogin(); return }
    const key = post ? `reply-${post.id}` : tab
    const content = (drafts[key] || '').trim()
    if (!content || posting) return
    const epoch = requestEpoch.current
    setPosting(true); setError(''); setNotice('')
    try {
      const { data } = await axios.post(post ? `${endpoint}/${post.id}/replies` : endpoint, post ? { content } : { content, kind: tab }, { headers: { Authorization: `Bearer ${token}` } })
      setDrafts(previous => ({ ...previous, [key]: '' }))
      if (epoch !== requestEpoch.current) return
      if (post) {
        setPosts(previous => previous.map(item => item.id === post.id ? {
          ...item, replies: uniqueReplies([...item.replies, data.data]), reply_count: item.reply_count+1,
          replyOffset: item.replyOffset === item.reply_count ? item.replyOffset+1 : item.replyOffset,
        } : item))
        setReplyTarget(null); setNotice('답변을 등록했습니다.')
      } else {
        setRefresh(value => value+1)
      }
    } catch (error) { setError(errorMessage(error)) }
    finally { setPosting(false) }
  }
  function composer(post = null) {
    const key = post ? `reply-${post.id}` : tab
    const label = post ? '답변' : LABELS[tab]
    return <form className="community-composer" onSubmit={event => void submit(event, post)}>
      <label htmlFor={`community-input-${key}`}>{post ? '질문에 답변 남기기' : tab === 'review' ? '이 공연, 어떤 점이 기대되나요?' : '공연에 대해 궁금한 점을 남겨주세요'}</label>
      <textarea id={`community-input-${key}`} rows={post ? 3 : 4} maxLength={2000} disabled={posting} value={drafts[key] || ''} onChange={event => setDrafts(previous => ({ ...previous, [key]: event.target.value }))} placeholder={post ? '다른 관객에게 도움이 되는 답변을 남겨주세요.' : tab === 'review' ? '기다리는 무대나 함께 보고 싶은 이유를 자유롭게 적어주세요.' : '관람이나 예매에 대해 궁금한 점을 적어주세요.'} />
      <div className="community-composer-footer"><span>{(drafts[key] || '').length.toLocaleString()} / 2,000</span><button type="submit" disabled={posting || !(drafts[key] || '').trim()}>{posting ? '등록 중…' : `${label} 등록`}</button></div>
    </form>
  }

  return <section id="event-community" className="event-community" aria-labelledby="event-community-title">
    <div className="community-heading"><div><h2 id="event-community-title">공연 이야기</h2><p>기대되는 순간과 궁금한 점을 함께 나눠보세요.</p></div></div>
    <div className="community-tabs" aria-label="공연 이야기 메뉴">
      {Object.entries(LABELS).map(([kind, label]) => <button key={kind} type="button" aria-pressed={tab === kind} disabled={posting || moreLoading || replyLoading !== null} className={tab === kind ? 'active' : ''} onClick={() => selectTab(kind)}>{label}<span>{counts ? counts[kind] : '—'}</span></button>)}
    </div>
    {token ? composer() : <div className="community-login"><p>글을 남기려면 로그인해주세요. 작성된 글은 로그인 없이 볼 수 있습니다.</p><button type="button" onClick={onLogin}>로그인하고 글 남기기</button></div>}
    {!!error && <div className="community-error" role="alert">{error}<button type="button" onClick={() => setRefresh(value => value+1)}>다시 불러오기</button></div>}
    {!!notice && <p className="community-notice" role="status">{notice}</p>}
    {loading ? <p className="community-empty" role="status">{LABELS[tab]}을 불러오고 있습니다.</p> : !error && posts.length === 0 ? <div className="community-empty"><strong>{tab === 'review' ? '아직 기대평이 없습니다' : '아직 등록된 질문이 없습니다'}</strong><p>{tab === 'review' ? '첫 번째 기대평을 남겨보세요.' : '궁금했던 점을 먼저 물어보세요.'}</p></div> : null}
    <div className="community-posts">{posts.map(post => <article className="community-post" key={post.id}>
      <div className="community-post-meta"><strong>{authorLabel(post.author)}</strong><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleDateString('ko-KR')}</time></div>
      <p className="community-post-content">{post.content}</p>
      {tab === 'qna' && <>
        <div className="community-reply-actions"><span>답변 {post.reply_count}개</span><button type="button" disabled={posting} onClick={() => token ? setReplyTarget(replyTarget === post.id ? null : post.id) : onLogin()}>{replyTarget === post.id ? '답변 접기' : '답변 남기기'}</button></div>
        {post.replies.map(reply => <div className="community-reply" key={reply.id}><div className="community-post-meta"><strong>이용자 답변 · {authorLabel(reply.author)}</strong><time dateTime={reply.created_at}>{new Date(reply.created_at).toLocaleDateString('ko-KR')}</time></div><p className="community-post-content">{reply.content}</p></div>)}
        {post.replyOffset < post.reply_count && <button className="community-more-replies" type="button" disabled={replyLoading !== null} onClick={() => void loadReplies(post)}>{replyLoading === post.id ? '불러오는 중…' : '답변 더 보기'}</button>}
        {replyTarget === post.id && composer(post)}
      </>}
    </article>)}</div>
    {nextOffset !== null && <button type="button" className="community-load-more" disabled={moreLoading || posting} onClick={() => void loadMore()}>{moreLoading ? '불러오는 중…' : `${LABELS[tab]} 더 보기`}</button>}
  </section>
}
