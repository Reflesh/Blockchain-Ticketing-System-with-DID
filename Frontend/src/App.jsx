import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import './App.css'
import { ethers } from 'ethers'

const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api'
const TICKET_API_URL = import.meta.env.VITE_TICKET_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

function withPoster(ticket) {
  return {
    ...ticket,
    image: ticket.image || '',
  }
}

function toDateKey(value) {
  if (!value) return ''
  return value.slice(0, 10)
}

function formatSessionTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPrice(amount) {
  const numericAmount = Number(amount || 0)
  return numericAmount === 0 ? '무료' : `${numericAmount.toLocaleString()}원`
}

// 🎟️ 양도 가능 여부: 발행 완료 + 미양도 + 본인 소유인 티켓만 양도 가능
function isTransferable(item, currentUserWallet) {
  return (
    item?.ticket_status === 'minted' &&
    !item?.is_transferred &&
    (!currentUserWallet || (item?.owner_wallet_address || '').toLowerCase() === (currentUserWallet || '').toLowerCase()) &&
    item?.token_id !== null &&
    item?.token_id !== undefined
  )
}

// 지갑 주소 축약 표시 (0x1234...abcd)
function shortenAddress(addr) {
  if (!addr || addr.length < 12) return addr || ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function createEmptyAdminEvent() {
  return {
    name: '',
    location: '',
    price: '0',
    status: 'active',
    time: '2026.09.01 19:00',
    period: '2026.09.01 - 2026.09.01',
    start_at: '2026-09-01 19:00:00+09',
    end_at: '2026-09-01 22:00:00+09',
    age: '전체관람가',
    image: '',
    category: 'concert',
    session_name: '1회차',
    session_end_at: '2026-09-01 22:00:00+09',
    seat_count: 20,
  }
}

function createEmptyAdminSession() {
  return {
    session_name: '1회차',
    session_start_at: '2026-09-01 19:00:00+09',
    session_end_at: '2026-09-01 22:00:00+09',
    sale_status: 'open',
  }
}

function createEmptySeatBulk() {
  return {
    row_label: 'A',
    start_number: 1,
    seat_count: 20,
    section_name: 'STANDARD',
    grade: '일반석',
    price_amount: 0,
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState('main')
  const [searchTerm, setSearchTerm] = useState('')
  const [tickets, setTickets] = useState([])
  const [searchResult, setSearchResult] = useState([])
  const [eventLoadStatus, setEventLoadStatus] = useState('loading')
  const [eventLoadError, setEventLoadError] = useState('')
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [seats, setSeats] = useState([])
  const [selectedSeat, setSelectedSeat] = useState(null)
  const [selectedSeats, setSelectedSeats] = useState([])
  const MAX_SEATS_PER_BOOKING = 4
  const [bookedTickets, setBookedTickets] = useState([])
  const [wishTickets, setWishTickets] = useState([])
  const [myPageTab, setMyPageTab] = useState('history')
  const [slideIndex, setSlideIndex] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null)
  const [calYear, setCalYear] = useState(2026)
  const [calMonth, setCalMonth] = useState(8)
  const [currentUser, setCurrentUser] = useState(null)
  const [currentWallet, setCurrentWallet] = useState(null)
  const [userToken, setUserToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isEmailSending, setIsEmailSending] = useState(false)
  const [isCodeVerifying, setIsCodeVerifying] = useState(false)
  const [isWalletCreating, setIsWalletCreating] = useState(false)
  const [isKeystoreDecrypting, setIsKeystoreDecrypting] = useState(false)
  const [keystoreFile, setKeystoreFile] = useState(null)
  const [keystorePassword, setKeystorePassword] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [adminTab, setAdminTab] = useState('dashboard')
  const [adminEvents, setAdminEvents] = useState([])
  const [adminStats, setAdminStats] = useState(null)
  const [adminLoginId, setAdminLoginId] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('')
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedAdminEventId, setSelectedAdminEventId] = useState('')
  const [adminSessions, setAdminSessions] = useState([])
  const [editingSession, setEditingSession] = useState(null)
  const [selectedAdminSessionId, setSelectedAdminSessionId] = useState('')
  const [adminSeats, setAdminSeats] = useState([])
  const [seatBulkForm, setSeatBulkForm] = useState(createEmptySeatBulk())
  const [editingSeat, setEditingSeat] = useState(null)
  
  const [didStep, setDidStep] = useState(0)
  const [authEmail, setAuthEmail] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [walletPassword, setWalletPassword] = useState('')
  const [tempWallet, setTempWallet] = useState(null)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)

  // 🎟️ 티켓 양도 관련 상태 (닉네임 입력 추가)
  const [transferModalBooking, setTransferModalBooking] = useState(null)
  const [selectedTransferItem, setSelectedTransferItem] = useState(null)
  const [companionUsername, setCompanionUsername] = useState('')
  const [isTransferring, setIsTransferring] = useState(false)

  const maxSlideIndex = Math.max(tickets.length - 5, 0)
  const performanceDates = useMemo(() => new Set(sessions.map((session) => toDateKey(session.session_start_at))), [sessions])

  useEffect(() => {
    const loadEvents = async () => {
      try {
        setEventLoadStatus('loading')
        setEventLoadError('')
        const response = await axios.get(`${TICKET_API_URL}/events`)
        const eventData = response.data?.data
        if (!Array.isArray(eventData)) {
          throw new Error('공연 목록 응답 형식이 올바르지 않습니다.')
        }
        const dbTickets = eventData.map(withPoster)
        setTickets(dbTickets)
        setSearchResult(dbTickets)
        setAdminEvents(dbTickets)
        setEventLoadStatus('success')
      } catch (error) {
        console.error('공연 목록을 DB에서 불러오지 못했습니다.', error)
        setTickets([])
        setSearchResult([])
        setAdminEvents([])
        setEventLoadStatus('error')
        setEventLoadError(error.response?.data?.detail || error.message || '공연 목록을 불러오지 못했습니다.')
      }
    }
    loadEvents()
  }, [])

  useEffect(() => {
    if (!currentUser?.walletAddress) return
    loadUserData(currentUser.walletAddress)
  }, [currentUser])

  useEffect(() => {
    if (window.location.pathname === '/Roblocks_admin') {
      setCurrentPage('admin');
    }
  }, []);

  useEffect(() => {
    if (!selectedTicket || currentPage !== 'detail') return

    const loadSessions = async () => {
      try {
        const response = await axios.get(`${TICKET_API_URL}/events/${selectedTicket.id}/sessions`)
        setSessions(response.data.data)
      } catch (error) {
        console.error('공연 회차를 DB에서 불러오지 못했습니다.', error)
        setSessions([])
      }
    }
    loadSessions()
  }, [selectedTicket, currentPage])

  useEffect(() => {
    if (!selectedSession) {
      setSeats([])
      return
    }

    const loadSeats = async () => {
      try {
        const response = await axios.get(`${TICKET_API_URL}/sessions/${selectedSession.id}/seats`)
        setSeats(response.data.data)
      } catch (error) {
        console.error('좌석 정보를 DB에서 불러오지 못했습니다.', error)
        setSeats([])
      }
    }
    loadSeats()
  }, [selectedSession])

  useEffect(() => {
    if (isAdmin) loadAdminStats()
  }, [isAdmin])

  useEffect(() => {
    if (isAdmin && adminEvents.length > 0 && !selectedAdminEventId) {
      setSelectedAdminEventId(String(adminEvents[0].id))
    }
  }, [isAdmin, adminEvents, selectedAdminEventId])

  useEffect(() => {
    if (isAdmin && (adminTab === 'sessions' || adminTab === 'seats') && selectedAdminEventId) {
      loadAdminSessions(selectedAdminEventId)
    }
  }, [isAdmin, adminTab, selectedAdminEventId])

  useEffect(() => {
    if (isAdmin && adminTab === 'seats' && selectedAdminSessionId) {
      loadAdminSeats(selectedAdminSessionId)
    }
  }, [isAdmin, adminTab, selectedAdminSessionId])

  const loadUserData = async (walletAddress, token) => {
    try {
      const headers = getUserHeaders(token)
      const [bookingsRes, wishlistRes] = await Promise.all([
        axios.get(`${TICKET_API_URL}/users/${walletAddress}/bookings`, { headers }),
        axios.get(`${TICKET_API_URL}/users/${walletAddress}/wishlist`, { headers }),
      ])
      setBookedTickets(bookingsRes.data.data.map(withPoster))
      setWishTickets(wishlistRes.data.data.map(withPoster))
    } catch (error) {
      console.error('사용자 데이터를 DB에서 불러오지 못했습니다.', error)
      if (error.response?.status === 401) {
        alert(error.response?.data?.detail || 'DID 로그인 세션이 만료되었습니다. 다시 로그인해주세요.')
        handleLogout()
      }
    }
  }

  const loadAdminStats = async () => {
    try {
      const response = await axios.get(`${TICKET_API_URL}/admin/stats`, {
        headers: getAdminHeaders(),
      })
      setAdminStats(response.data.data)
    } catch (error) {
      console.error('관리자 통계를 DB에서 불러오지 못했습니다.', error)
      if (error.response?.status === 401) {
        setIsAdmin(false)
        setAdminToken('')
        alert(error.response?.data?.detail || '관리자 인증이 만료되었습니다.')
      }
    }
  }

  const getAdminHeaders = () => ({
    Authorization: `Bearer ${adminToken}`,
  })

  const getUserHeaders = (token) => ({
    Authorization: `Bearer ${token || userToken}`,
  })

  const loadAdminSessions = async (eventId) => {
    try {
      const response = await axios.get(`${TICKET_API_URL}/admin/events/${eventId}/sessions`, {
        headers: getAdminHeaders(),
      })
      const sessionData = response.data?.data || []
      setAdminSessions(sessionData)
      if (sessionData.length > 0 && !sessionData.some((session) => String(session.id) === String(selectedAdminSessionId))) {
        setSelectedAdminSessionId(String(sessionData[0].id))
      }
      if (sessionData.length === 0) {
        setSelectedAdminSessionId('')
        setAdminSeats([])
      }
    } catch (error) {
      console.error('관리자 회차 목록을 불러오지 못했습니다.', error)
      alert(error.response?.data?.detail || '회차 목록을 불러오지 못했습니다.')
    }
  }

  const loadAdminSeats = async (sessionId) => {
    try {
      const response = await axios.get(`${TICKET_API_URL}/admin/sessions/${sessionId}/seats`, {
        headers: getAdminHeaders(),
      })
      setAdminSeats(response.data?.data || [])
    } catch (error) {
      console.error('관리자 좌석 목록을 불러오지 못했습니다.', error)
      alert(error.response?.data?.detail || '좌석 목록을 불러오지 못했습니다.')
    }
  }

  const handleImageError = (e) => {
    e.target.src = 'https://placehold.co/600x800/eeeeee/999999?text=No+Image'
  }

  const handleNextSlide = () => {
    if (slideIndex < maxSlideIndex) setSlideIndex(slideIndex + 1)
  }

  const handlePrevSlide = () => {
    if (slideIndex > 0) setSlideIndex(slideIndex - 1)
  }

  const handleSearch = (e) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const results = tickets.filter((ticket) => ticket.name.replace(/\s/g, '').includes(searchTerm.replace(/\s/g, '')))
      setSearchResult(results)
      setCurrentPage('search')
    }
  }

  const goToMain = () => {
    setCurrentPage('main')
    setSearchTerm('')
    setSelectedSeat(null)
    setSelectedSeats([])
    setSlideIndex(0)
    setIsAdmin(false)
    setAdminToken('')
    window.history.pushState({}, '', '/')
  }

  const goToDetail = (ticket) => {
    setSelectedTicket(ticket)
    setCurrentPage('detail')
    setSelectedDate(null)
    setSelectedSession(null)
    setSelectedSeat(null)
    setSelectedSeats([])
    if (ticket?.time) {
      const dateParts = ticket.time.split(' ')[0].split('.')
      setCalYear(parseInt(dateParts[0], 10))
      setCalMonth(parseInt(dateParts[1], 10))
    }
  }

  const goToLogin = () => {
    setCurrentPage('login')
  }

  const goToBooking = () => {
    if (!selectedSession) {
      alert('관람하실 회차(시간)를 선택해주세요!')
      return
    }
    setCurrentPage('booking')
    setSelectedSeat(null)
    setSelectedSeats([])
  }

  const goToMyPage = () => {
    if (currentUser?.walletAddress) loadUserData(currentUser.walletAddress)
    setCurrentPage('mypage')
    setMyPageTab('history')
  }

  const goToAppGuide = () => {
    setCurrentPage('appguide')
  }

  const handleAdminLogin = async () => {
    try {
      const response = await axios.post(`${TICKET_API_URL}/admin/login`, {
        login_id: adminLoginId,
        password: adminPassword,
      })
      setAdminToken(response.data?.data?.token || '')
      setIsAdmin(true)
      setAdminTab('dashboard')
    } catch (error) {
      alert(error.response?.data?.detail || '관리자 인증에 실패했습니다.')
    }
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    
    try {
      if (editingEvent.id) {
        await axios.put(`${TICKET_API_URL}/admin/events/${editingEvent.id}`, editingEvent, {
          headers: getAdminHeaders(),
        })
        setAdminEvents(adminEvents.map((ev) => (ev.id === editingEvent.id ? editingEvent : ev)))
        setTickets(tickets.map((ev) => (ev.id === editingEvent.id ? editingEvent : ev)))
        setSearchResult(searchResult.map((ev) => (ev.id === editingEvent.id ? editingEvent : ev)))
        if (selectedTicket && selectedTicket.id === editingEvent.id) {
          setSelectedTicket(editingEvent)
        }
        alert('공연 정보가 데이터베이스에 성공적으로 수정되었습니다!')
      } else {
        const response = await axios.post(`${TICKET_API_URL}/admin/events`, editingEvent, {
          headers: getAdminHeaders(),
        })
        const createdEvent = withPoster(response.data.data)
        setAdminEvents([...adminEvents, createdEvent])
        setTickets([...tickets, createdEvent])
        setSearchResult([...searchResult, createdEvent])
        alert('새 공연이 데이터베이스에 성공적으로 등록되었습니다!')
      }
      setEditingEvent(null)
      
    } catch (error) {
      console.error('공연 정보 저장 실패:', error)
      alert(error.response?.data?.detail || '공연 정보 저장에 실패했습니다.')
    }
  }

  const handleDeleteEvent = async (event) => {
    if (!window.confirm(`정말 [${event.name}] 공연을 삭제하시겠습니까?`)) return
    try {
      await axios.delete(`${TICKET_API_URL}/admin/events/${event.id}`, {
        headers: getAdminHeaders(),
      })
      setAdminEvents(adminEvents.filter((ev) => ev.id !== event.id))
      setTickets(tickets.filter((ev) => ev.id !== event.id))
      setSearchResult(searchResult.filter((ev) => ev.id !== event.id))
      if (selectedTicket?.id === event.id) {
        setSelectedTicket(null)
      }
      alert('삭제 내용이 데이터베이스에 반영되었습니다.')
    } catch (error) {
      console.error('공연 삭제 실패:', error)
      alert(error.response?.data?.detail || '공연 삭제에 실패했습니다.')
    }
  }

  const handleSaveSession = async (e) => {
    e.preventDefault()
    if (!selectedAdminEventId) {
      alert('공연을 먼저 선택해주세요.')
      return
    }
    try {
      if (editingSession.id) {
        await axios.put(`${TICKET_API_URL}/admin/sessions/${editingSession.id}`, editingSession, {
          headers: getAdminHeaders(),
        })
        alert('회차 정보가 데이터베이스에 수정되었습니다.')
      } else {
        await axios.post(`${TICKET_API_URL}/admin/events/${selectedAdminEventId}/sessions`, editingSession, {
          headers: getAdminHeaders(),
        })
        alert('회차가 데이터베이스에 등록되었습니다.')
      }
      setEditingSession(null)
      await loadAdminSessions(selectedAdminEventId)
    } catch (error) {
      console.error('회차 저장 실패:', error)
      alert(error.response?.data?.detail || '회차 저장에 실패했습니다.')
    }
  }

  const handleDeleteSession = async (session) => {
    if (!window.confirm(`정말 [${session.session_name}] 회차를 삭제하시겠습니까?`)) return
    try {
      await axios.delete(`${TICKET_API_URL}/admin/sessions/${session.id}`, {
        headers: getAdminHeaders(),
      })
      alert('회차 변경 내용이 데이터베이스에 반영되었습니다.')
      await loadAdminSessions(selectedAdminEventId)
    } catch (error) {
      console.error('회차 삭제 실패:', error)
      alert(error.response?.data?.detail || '회차 삭제에 실패했습니다.')
    }
  }

  const handleCreateSeats = async (e) => {
    e.preventDefault()
    if (!selectedAdminSessionId) {
      alert('회차를 먼저 선택해주세요.')
      return
    }
    try {
      await axios.post(`${TICKET_API_URL}/admin/sessions/${selectedAdminSessionId}/seats/bulk`, seatBulkForm, {
        headers: getAdminHeaders(),
      })
      alert('좌석이 데이터베이스에 등록되었습니다.')
      await loadAdminSeats(selectedAdminSessionId)
    } catch (error) {
      console.error('좌석 생성 실패:', error)
      alert(error.response?.data?.detail || '좌석 생성에 실패했습니다.')
    }
  }

  const handleSaveSeat = async (e) => {
    e.preventDefault()
    try {
      await axios.put(`${TICKET_API_URL}/admin/seats/${editingSeat.id}`, editingSeat, {
        headers: getAdminHeaders(),
      })
      alert('좌석 정보가 데이터베이스에 수정되었습니다.')
      setEditingSeat(null)
      await loadAdminSeats(selectedAdminSessionId)
    } catch (error) {
      console.error('좌석 수정 실패:', error)
      alert(error.response?.data?.detail || '좌석 수정에 실패했습니다.')
    }
  }

  const handleDeleteSeat = async (seat) => {
    if (!window.confirm(`정말 [${seat.seat_code}] 좌석을 삭제하시겠습니까?`)) return
    try {
      await axios.delete(`${TICKET_API_URL}/admin/seats/${seat.id}`, {
        headers: getAdminHeaders(),
      })
      alert('좌석 변경 내용이 데이터베이스에 반영되었습니다.')
      await loadAdminSeats(selectedAdminSessionId)
    } catch (error) {
      console.error('좌석 삭제 실패:', error)
      alert(error.response?.data?.detail || '좌석 삭제에 실패했습니다.')
    }
  }

  const handleGoBack = () => {
    if (currentPage === 'detail' || currentPage === 'search' || currentPage === 'login' || currentPage === 'mypage' || currentPage === 'admin' || currentPage === 'appguide') {
      setCurrentPage('main')
      window.history.pushState({}, '', '/')
    } else if (currentPage === 'booking') {
      setCurrentPage('detail')
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files?.[0]) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.name.endsWith('.json')) {
        setKeystoreFile(droppedFile)
      } else {
        alert('.json 형식의 키 파일만 업로드할 수 있습니다!')
      }
    }
  }

  const handleRequestEmail = async () => {
    const cleanEmail = authEmail.trim().toLowerCase()
    if (!cleanEmail) {
      alert('이메일을 입력해 주세요.')
      return
    }
    if (!cleanEmail.endsWith('@pukyong.ac.kr')) {
      alert('부경대학교 이메일(@pukyong.ac.kr)만 인증이 가능합니다.')
      return
    }
    try {
      setIsEmailSending(true)
      await axios.post(`${AUTH_API_URL}/request-email-auth`, { 
        email: cleanEmail,
        is_recovery: isRecoveryMode
      })
      alert('인증번호가 발송되었습니다. 메일함을 확인하고 아래 인증번호를 입력하세요.')
      setDidStep(2)
    } catch (error) {
      alert('인증 오류: ' + (error.response?.data?.detail || error.message))
    } finally {
      setIsEmailSending(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!authCode) {
      alert('인증번호를 입력해 주세요.')
      return
    }
    try {
      setIsCodeVerifying(true)
      const wallet = ethers.Wallet.createRandom()
      const verifyRes = await axios.post(`${AUTH_API_URL}/verify-email-auth`, {
        email: authEmail.trim().toLowerCase(),
        code: authCode,
        wallet_address: wallet.address,
      })
      alert(verifyRes.data.message)
      setTempWallet(wallet)
      setDidStep(3)
    } catch (error) {
      alert('인증 오류: ' + (error.response?.data?.detail || error.message))
    } finally {
      setIsCodeVerifying(false)
    }
  }

  const handleCreateWallet = async () => {
    if (!walletPassword) {
      alert('비밀번호를 입력해 주세요.')
      return
    }
    try {
      setIsWalletCreating(true)
      const encryptedJson = await tempWallet.encrypt(walletPassword)
      const blob = new Blob([encryptedJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const studentId = authEmail.split('@')[0]
      a.download = `TicketPro_DID_${studentId}.json`
      a.click()
      URL.revokeObjectURL(url)

      alert('DID 키 파일이 안전하게 발급되었습니다.\n로그인 창에서 발급된 파일과 지정한 비밀번호로 로그인해 주세요.')
      setDidStep(0)
      setAuthEmail('')
      setAuthCode('')
      setWalletPassword('')
      setTempWallet(null)
      setIsRecoveryMode(false)
    } catch (error) {
      alert('키 파일 생성 실패: ' + error.message)
    } finally {
      setIsWalletCreating(false)
    }
  }

  const handleKeystoreLogin = async () => {
    if (!keystoreFile || !keystorePassword) {
      alert('키 파일과 비밀번호를 모두 입력해주세요.')
      return
    }
    try {
      setIsKeystoreDecrypting(true)
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const json = e.target.result
          const wallet = await ethers.Wallet.fromEncryptedJson(json, keystorePassword)
          const challengeRes = await axios.post(`${AUTH_API_URL}/login-challenge`, {
            wallet_address: wallet.address,
          })
          const { nonce, message } = challengeRes.data
          const signature = await wallet.signMessage(message)
          const loginRes = await axios.post(`${AUTH_API_URL}/login-verify`, {
            wallet_address: wallet.address,
            nonce,
            message,
            signature,
          })
          let extractedName = '부경대 학우'
          if (keystoreFile.name.includes('TicketPro_DID_')) {
            extractedName = keystoreFile.name.split('_')[2].replace('.json', '')
          }

          let accessToken = ''
          try {
            const challengeRes = await axios.post(`${AUTH_API_URL}/login-challenge`, {
              wallet_address: wallet.address,
            })
            const { message } = challengeRes.data
            const loginSignature = await wallet.signMessage(message)
            const verifyRes = await axios.post(`${AUTH_API_URL}/login-verify`, {
              wallet_address: wallet.address,
              nonce: challengeRes.data.nonce,
              message,
              signature: loginSignature,
            })
            accessToken = verifyRes.data.access_token
          } catch (authErr) {
            alert(
              'DID 로그인 세션 발급에 실패했습니다.\n' +
              (authErr.response?.data?.detail || authErr.message)
            )
            setIsLoading(false)
            return
          }

          if (!accessToken) {
            alert('로그인 세션 토큰을 받지 못했습니다. 다시 시도해주세요.')
            setIsLoading(false)
            return
          }

          alert(`로그인 성공! 지갑 주소: ${wallet.address}`)
          setUserToken(loginRes.data.access_token)
          setCurrentWallet(wallet)
          setUserToken(accessToken)
          setCurrentUser({ username: extractedName, walletAddress: wallet.address, isDID: true })
          await loadUserData(wallet.address, accessToken)
          setCurrentPage('main')
        } catch (err) {
          alert(err.response?.data?.detail || '비밀번호가 틀렸거나 유효하지 않은 키 파일입니다.')
        } finally {
          setIsKeystoreDecrypting(false)
        }
      }
      reader.readAsText(keystoreFile)
    } catch (error) {
      alert('로그인 오류 발생.')
      setIsKeystoreDecrypting(false)
    }
  }

  const handleLogout = async () => {
    if (userToken) {
      try {
        await axios.post(`${AUTH_API_URL}/logout`, { access_token: userToken })
      } catch (error) {
        console.error('서버 로그인 세션 폐기에 실패했습니다.', error)
      }
    }
    setCurrentUser(null)
    setCurrentWallet(null)
    setUserToken('')
    setKeystoreFile(null)
    setKeystorePassword('')
    setBookedTickets([])
    setWishTickets([])
    alert('로그아웃 되었습니다.')
    setCurrentPage('main')
  }

  const handleSeatClick = (seat) => {
    if (seat.status !== 'available') return
    setSelectedSeats((prev) => {
      const exists = prev.find((s) => s.id === seat.id)
      if (exists) {
        return prev.filter((s) => s.id !== seat.id)
      }
      if (prev.length >= MAX_SEATS_PER_BOOKING) {
        alert(`한 번에 최대 ${MAX_SEATS_PER_BOOKING}석까지만 선택할 수 있습니다.`)
        return prev
      }
      return [...prev, seat]
    })
  }

  // 🚀 예매(결제): 동반인 정보 없이 좌석만 담아서 넘기도록 수정
  const handlePayment = async () => {
    if (selectedSeats.length === 0) {
      alert('좌석을 먼저 선택해주세요!')
      return
    }
    if (!currentUser || !currentWallet) {
      alert('로그인이 필요한 기능입니다. 로그인 페이지로 이동합니다.')
      goToLogin()
      return
    }

    const orderedSeatIds = selectedSeats.map((s) => s.id)
    const totalAmount = selectedSeats.reduce((sum, s) => sum + Number(s.price_amount || 0), 0)

    setIsLoading(true)
    try {
      const paymentId = `ticket_${uuidv4_light()}`;
      const PORTONE_STORE_ID = import.meta.env.VITE_PORTONE_STORE_ID || 'store-xxxxxxxx';
      const PORTONE_CHANNEL_KEY = import.meta.env.VITE_PORTONE_CHANNEL_KEY || 'channel-key-d3965469-2d57-4114-9b5c-c7b5f45ff655';

      const orderName = selectedSeats.length > 1
        ? `${selectedTicket.name} 외 ${selectedSeats.length - 1}매`
        : selectedTicket.name

      const responsePay = await window.PortOne.requestPayment({
        storeId: PORTONE_STORE_ID,
        channelKey: PORTONE_CHANNEL_KEY,
        paymentId: paymentId,
        orderName: orderName,
        totalAmount: totalAmount,
        currency: 'KRW',
        payMethod: 'EASY_PAY',
        customer: {
          fullName: currentUser.username,
        },
      });

      if (responsePay.code) {
        alert(`결제가 취소되었거나 실패했습니다.\n사유: ${responsePay.message}`);
        return;
      }

      alert('💳 오프체인 원화 결제가 정상 완료되었습니다!\n이어서 티켓 위조 방지 블록체인 등록을 위한 암호학적 전자서명을 진행합니다.');

      // 서명 페이로드: companions 배열 삭제
      const signPayload = {
        wallet_address: currentUser.walletAddress,
        event_id: selectedTicket.id,
        event_session_id: selectedSession.id,
        seat_ids: orderedSeatIds,
        payment_id: responsePay.paymentId,
      };

      const signature = await currentWallet.signMessage(JSON.stringify(signPayload));

      alert('🔒 전자서명 생성이 완료되었습니다.\n서버 가스비 대납 민팅을 요청합니다. 잠시만 기다려 주세요...');

      const responseBack = await axios.post(`${TICKET_API_URL}/buy-tickets`, {
        username: currentUser.walletAddress,
        ...signPayload,
        signature,
      }, { headers: getUserHeaders() });

      alert(`🎉 예매 완료 및 스마트 위변조 방지 NFT 티켓이 지갑으로 안전하게 발급되었습니다!\n\n[Transaction Hash]\n${responseBack.data.transaction_hash}`);

      setSelectedSeats([]);
      setSelectedSeat(null);

      await loadUserData(currentUser.walletAddress);
      setCurrentPage('mypage');
      setMyPageTab('history');
    } catch (error) {
      console.error(error);
      alert('블록체인 민팅 및 영수증 처리 중 오류가 발생했습니다: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsLoading(false);
    }
  }

  // 🎟️ 티켓 양도 모달 열기 (본인 소유 티켓만 표시)
  const openTransferModal = (booking) => {
    const transferable = (booking.items || []).filter(item => isTransferable(item, currentUser.walletAddress))
    if (transferable.length === 0) {
      alert('이 예매 건에는 본인이 양도 가능한 티켓이 없습니다.')
      return
    }
    setTransferModalBooking(booking)
    setCompanionUsername('')
    setSelectedTransferItem(transferable.length === 1 ? transferable[0] : null)
  }

  const closeTransferModal = () => {
    setTransferModalBooking(null)
    setSelectedTransferItem(null)
    setCompanionUsername('')
    setIsTransferring(false)
  }

  // 🎟️ 양도 실행 (입력한 닉네임 기반)
  const handleTransferTicket = async () => {
    if (!selectedTransferItem) {
      alert('양도할 티켓을 선택해주세요.')
      return
    }
    if (!currentUser || !currentWallet) {
      alert('로그인이 필요한 기능입니다.')
      return
    }

    const targetNickname = companionUsername.trim()
    if (!targetNickname) {
      alert('티켓을 받을 동반인의 가입 닉네임을 정확히 입력해주세요.')
      return
    }

    const confirmMsg =
      `[${selectedTransferItem.seat_code}] 좌석 티켓을 '${targetNickname}' 님에게 양도합니다.\n\n` +
      `⚠️ 양도는 1회만 가능하며, 양도 후에는 되돌릴 수 없습니다.\n계속하시겠습니까?`
    if (!window.confirm(confirmMsg)) return

    setIsTransferring(true)
    try {
      const signPayload = {
        wallet_address: currentUser.walletAddress,
        booking_item_id: selectedTransferItem.booking_item_id,
        companion_username: targetNickname
      }
      const signature = await currentWallet.signMessage(JSON.stringify(signPayload))

      const response = await axios.post(`${TICKET_API_URL}/transfer-ticket`, {
        ...signPayload,
        signature,
      }, {
        headers: getUserHeaders(),
      })

      alert(
        `🎉 티켓이 ${targetNickname} 님에게 성공적으로 양도되었습니다!\n\n` +
        `[Transaction Hash]\n${response.data.transaction_hash}`
      )
      closeTransferModal()
      await loadUserData(currentUser.walletAddress)
    } catch (error) {
      console.error(error)
      alert('티켓 양도 중 오류가 발생했습니다: ' + (error.response?.data?.detail || error.message))
    } finally {
      setIsTransferring(false)
    }
  }

  function uuidv4_light() {
    return 'xxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    }).toUpperCase();
  }

  const handleWish = async () => {
    if (!currentUser) {
      alert('로그인이 필요한 기능입니다. 로그인 페이지로 이동합니다.')
      goToLogin()
      return
    }
    try {
      const isAlreadyWished = wishTickets.find((ticket) => ticket.id === selectedTicket.id)
      if (isAlreadyWished) {
        await axios.delete(`${TICKET_API_URL}/wishlist/${selectedTicket.id}`, {
          params: { wallet_address: currentUser.walletAddress },
          headers: getUserHeaders(),
        })
        alert('찜 목록에서 삭제되었습니다.')
      } else {
        await axios.post(`${TICKET_API_URL}/wishlist`, {
          wallet_address: currentUser.walletAddress,
          event_id: selectedTicket.id,
        }, { headers: getUserHeaders() })
        alert('찜 목록에 추가하였습니다.')
      }
      await loadUserData(currentUser.walletAddress)
    } catch (error) {
      alert(error.response?.data?.detail || '찜 목록 처리 중 오류가 발생했습니다.')
    }
  }

  const handleRemoveWish = async (e, ticketId) => {
    e.stopPropagation()
    if (!currentUser) return
    try {
      await axios.delete(`${TICKET_API_URL}/wishlist/${ticketId}`, {
        params: { wallet_address: currentUser.walletAddress },
        headers: getUserHeaders(),
      })
      await loadUserData(currentUser.walletAddress)
      alert('찜 목록에서 삭제되었습니다.')
    } catch (error) {
      alert('찜 목록에서 삭제하지 못했습니다.')
    }
  }

  const handlePrevMonth = () => {
    if (calMonth === 1) {
      setCalMonth(12)
      setCalYear(calYear - 1)
    } else {
      setCalMonth(calMonth - 1)
    }
  }

  const handleNextMonth = () => {
    if (calMonth === 12) {
      setCalMonth(1)
      setCalYear(calYear + 1)
    } else {
      setCalMonth(calMonth + 1)
    }
  }

  const daysInMonth = new Date(calYear, calMonth, 0).getDate()
  const firstDayOfWeek = new Date(calYear, calMonth - 1, 1).getDay()

  return (
    <div className="app-container">
      <nav className="navbar">
        <h1 className="logo" onClick={goToMain}>🎫 TicketPro</h1>
        <div className="search-wrapper">
          <input type="text" placeholder="어떤 공연을 찾으시나요?" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={handleSearch} />
        </div>
        <div className="nav-menus">
          <span onClick={goToAppGuide}>📱 앱 안내</span>
          {currentUser ? (
            <>
              <span className="welcome-text" style={{ marginRight: '15px', fontWeight: 'bold' }}>{currentUser.username}님</span>
              <span onClick={goToMyPage}>마이페이지</span>
              <span onClick={handleLogout}>로그아웃</span>
            </>
          ) : (
            <span onClick={goToLogin}>로그인 / DID 발급</span>
          )}
        </div>
      </nav>

      <div className="content-area">
        {currentPage === 'main' && (
          <div className="main-page-wrapper">
            <h2 className="section-title">🔥 공연 예정</h2>
            <div className="carousel-container">
              {slideIndex > 0 && <button className="carousel-arrow left" onClick={handlePrevSlide}>◀</button>}
              <div className="carousel-track-wrapper">
                <div className="carousel-track" style={{ transform: `translateX(-${slideIndex * 20}%)` }}>
                  {tickets.map((ticket) => (
                    <div key={ticket.id} className="carousel-item">
                      <div className="ticket-card" onClick={() => goToDetail(ticket)}>
                        <img src={ticket.image} alt={ticket.name} onError={handleImageError} />
                        <div className="info">
                          <h4>{ticket.name}</h4>
                          <p>{ticket.time}</p>
                          <p>{ticket.location}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {tickets.length === 0 && (
                  <div className="event-empty-state">
                    {eventLoadStatus === 'loading' ? (
                      <p>공연 목록을 불러오는 중입니다.</p>
                    ) : eventLoadStatus === 'error' ? (
                      <>
                        <p>공연 목록을 불러오지 못했습니다.</p>
                        <span>{eventLoadError}</span>
                      </>
                    ) : (
                      <p>등록된 공연이 없습니다.</p>
                    )}
                  </div>
                )}
              </div>
              {slideIndex < maxSlideIndex && <button className="carousel-arrow right" onClick={handleNextSlide}>▶</button>}
            </div>
          </div>
        )}

        {currentPage === 'search' && (
          <div className="search-page">
            <h3>검색 결과 ({searchResult.length}건)</h3>
            <div className="ticket-grid">
              {searchResult.map((ticket) => (
                <div key={ticket.id} className="ticket-card" onClick={() => goToDetail(ticket)}>
                  <img src={ticket.image} alt={ticket.name} onError={handleImageError} />
                  <div className="info">
                    <h4>{ticket.name}</h4>
                    <p>{ticket.time}</p>
                    <p>{ticket.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentPage === 'login' && (
          <div className="login-page-wrapper">
            <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
            <div className="login-box">
              <h2 style={{ marginBottom: '20px' }}>스마트 로그인</h2>
              <div className="tab-content">
                <p style={{ color: '#666', fontSize: '13px', marginBottom: '15px' }}>발급받은 키 파일을 클릭하거나 드래그하여 업로드하세요.</p>
                <div className={`file-upload-box ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                  <label htmlFor="keystore-upload" className="file-upload-label">
                    <span className="folder-icon">{isDragging ? '📥' : '📁'}</span>
                    {keystoreFile ? <span className="file-name">{keystoreFile.name} (선택됨)</span> : <span className="file-placeholder">{isDragging ? '파일을 여기에 놓아주세요!' : '여기를 클릭하거나 파일을 드래그하세요 (.json)'}</span>}
                  </label>
                  <input id="keystore-upload" type="file" accept=".json" onChange={(e) => setKeystoreFile(e.target.files[0])} style={{ display: 'none' }} />
                </div>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  handleKeystoreLogin();
                }}>
                  <input 
                    type="password" 
                    placeholder="파일 암호화 비밀번호" 
                    value={keystorePassword} 
                    onChange={(e) => setKeystorePassword(e.target.value)} 
                    className="password-input" 
                  />
                  <button 
                    type="submit" 
                    disabled={isKeystoreDecrypting} 
                    className="submit-login-btn"
                  >
                    {isKeystoreDecrypting ? '복호화 중...' : '로그인'}
                  </button>
                </form>
              </div>
              <hr className="login-divider" />
              <div className="signup-prompt-box">
                <p>아직 안전한 DID가 없으신가요?</p>
                {didStep === 0 && (
                  <button onClick={() => setDidStep(1)} className="did-signup-btn">
                    🎓 부경대 이메일 인증 후 DID 발급받기
                  </button>
                )}
                {didStep === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                    <input type="email" placeholder="부경대 이메일 (@pukyong.ac.kr)" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="password-input" />
                    <label style={{ fontSize: '13px', color: '#ff4d4f', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={isRecoveryMode} 
                        onChange={(e) => setIsRecoveryMode(e.target.checked)} 
                        style={{ cursor: 'pointer' }}
                      />
                      기존 키 파일을 분실하여 재발급(복구) 받습니다.
                    </label>
                    <button onClick={handleRequestEmail} disabled={isEmailSending} className="submit-login-btn">
                      {isEmailSending ? '인증 메일 발송 중...' : '인증번호 받기'}
                    </button>
                    <button onClick={() => {
                      setDidStep(0);
                      setIsRecoveryMode(false);
                    }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px' }}>취소</button>
                  </div>
                )}
                {didStep === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                    <p style={{ fontSize: '12px', color: '#ff4d4f', margin: 0 }}>학교 메일함으로 전송된 6자리 번호를 입력해 주세요.</p>
                    <input type="text" placeholder="6자리 인증번호 입력" value={authCode} onChange={(e) => setAuthCode(e.target.value)} className="password-input" />
                    <button onClick={handleVerifyCode} disabled={isCodeVerifying} className="submit-login-btn">
                      {isCodeVerifying ? '인증번호 검증 중...' : '인증번호 확인'}
                    </button>
                    <button onClick={() => setDidStep(0)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px' }}>처음으로</button>
                  </div>
                )}
                {didStep === 3 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                    <p style={{ fontSize: '12px', color: '#52c41a', margin: 0 }}>신원 인증 완료! 키 파일을 암호화할 비밀번호를 설정하세요.</p>
                    <input type="password" placeholder="키 파일 암호 설정 (분실 시 복구 불가)" value={walletPassword} onChange={(e) => setWalletPassword(e.target.value)} className="password-input" />
                    <button onClick={handleCreateWallet} disabled={isWalletCreating} className="submit-login-btn">
                      {isWalletCreating ? '암호화 및 블록체인 등록 중...' : 'DID 키 파일 생성 및 다운로드'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentPage === 'admin' && (
          <div className="admin-page-container">
            {!isAdmin ? (
              <div className="login-box admin-login">
                <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
                <h2>Admin Control Center</h2>
                <p style={{ color: '#666', marginBottom: '20px' }}>관리자 권한 인증이 필요합니다.</p>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  handleAdminLogin();
                }}>
                  <input 
                    className="password-input" 
                    type="text" 
                    placeholder="관리자 ID" 
                    value={adminLoginId} 
                    onChange={(e) => setAdminLoginId(e.target.value)} 
                  />
                  <input 
                    className="password-input" 
                    type="password" 
                    placeholder="관리자 비밀번호" 
                    value={adminPassword} 
                    onChange={(e) => setAdminPassword(e.target.value)} 
                  />
                  <button type="submit" className="submit-login-btn">
                    관리자 인증
                  </button>
                </form>
              </div>
            ) : (
              <div className="admin-dashboard-wrapper">
                <aside className="admin-sidebar">
                  <h3>관리자 메뉴</h3>
	                  <button className={adminTab === 'dashboard' ? 'active' : ''} onClick={() => setAdminTab('dashboard')}>📊 통계 대시보드</button>
	                  <button className={adminTab === 'events' ? 'active' : ''} onClick={() => setAdminTab('events')}>📅 공연 관리</button>
	                  <button className={adminTab === 'sessions' ? 'active' : ''} onClick={() => setAdminTab('sessions')}>🕒 회차 관리</button>
	                  <button className={adminTab === 'seats' ? 'active' : ''} onClick={() => setAdminTab('seats')}>💺 좌석 관리</button>
	                  <button onClick={goToMain}>🚪 나가기</button>
                </aside>
                <main className="admin-main-content">
                  {adminTab === 'dashboard' && (
                    <div className="admin-stats-view">
                      <h2>시스템 통계</h2>
                      <div className="stats-grid">
                        <div className="stat-card"><h4>총 예매 건수</h4><p>{adminStats?.total_bookings ?? 0}건</p></div>
                        <div className="stat-card"><h4>총 매출액</h4><p>{(adminStats?.total_sales ?? 0).toLocaleString()}원</p></div>
                        <div className="stat-card"><h4>활성 DID 유저</h4><p>{adminStats?.did_users ?? 0}명</p></div>
                        <div className="stat-card"><h4>Gas Balance</h4><p>{adminStats?.gas_balance ?? 0} MATIC</p></div>
                      </div>
                    </div>
                  )}
                  {adminTab === 'events' && (
                    <div className="admin-events-view">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h2>공연 리스트 관리</h2>
                        <button className="did-signup-btn" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => setEditingEvent(createEmptyAdminEvent())}>+ 새 공연 등록</button>
                      </div>
                      <table className="admin-table">
                        <thead>
                          <tr><th>ID</th><th>공연명</th><th>장소</th><th>가격</th><th>상태</th><th>액션</th></tr>
                        </thead>
                        <tbody>
                          {adminEvents.map((event) => (
                            <tr key={event.id}>
                              <td>{event.id}</td>
                              <td>{event.name}</td>
                              <td>{event.location}</td>
                              <td>{event.price}{event.price === '무료' ? '' : '원'}</td>
                              <td><span className="status-badge">{event.status === 'paused' ? '일시중지' : '판매중'}</span></td>
                              <td>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button 
                                    onClick={() => setEditingEvent(event)}
                                    style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                                  >
                                    수정
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteEvent(event)}
                                    style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#ff4d4f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {editingEvent && (
                        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                          <div className="modal-content" style={{ background: 'white', padding: '30px', borderRadius: '8px', width: '400px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>{editingEvent.id ? '공연 정보 수정' : '새 공연 등록'}</h3>
                            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                공연명
                                <input 
                                  type="text" 
                                  value={editingEvent.name} 
                                  onChange={(e) => setEditingEvent({...editingEvent, name: e.target.value})}
                                  style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                  required
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                장소
                                <input 
                                  type="text" 
                                  value={editingEvent.location} 
                                  onChange={(e) => setEditingEvent({...editingEvent, location: e.target.value})}
                                  style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                  required
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                가격 (숫자 또는 '무료')
                                <input 
                                  type="text" 
                                  value={editingEvent.price} 
                                  onChange={(e) => setEditingEvent({...editingEvent, price: e.target.value})}
                                  style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                  required
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                상태
                                <select 
                                  value={editingEvent.status} 
                                  onChange={(e) => setEditingEvent({...editingEvent, status: e.target.value})}
                                  style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                >
                                  <option value="active">판매중</option>
                                  <option value="paused">일시중지</option>
                                </select>
                              </label>
                              {!editingEvent.id && (
                                <>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    대표 일시 표시
                                    <input 
                                      type="text" 
                                      value={editingEvent.time} 
                                      onChange={(e) => setEditingEvent({...editingEvent, time: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                      required
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    기간 표시
                                    <input 
                                      type="text" 
                                      value={editingEvent.period} 
                                      onChange={(e) => setEditingEvent({...editingEvent, period: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                      required
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    시작 일시
                                    <input 
                                      type="text" 
                                      value={editingEvent.start_at} 
                                      onChange={(e) => setEditingEvent({...editingEvent, start_at: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                      required
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    종료 일시
                                    <input 
                                      type="text" 
                                      value={editingEvent.end_at} 
                                      onChange={(e) => setEditingEvent({...editingEvent, end_at: e.target.value, session_end_at: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    관람 등급
                                    <input 
                                      type="text" 
                                      value={editingEvent.age} 
                                      onChange={(e) => setEditingEvent({...editingEvent, age: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    포스터 URL
                                    <input 
                                      type="text" 
                                      value={editingEvent.image} 
                                      onChange={(e) => setEditingEvent({...editingEvent, image: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    회차명
                                    <input 
                                      type="text" 
                                      value={editingEvent.session_name} 
                                      onChange={(e) => setEditingEvent({...editingEvent, session_name: e.target.value})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
                                    좌석 수
                                    <input 
                                      type="number" 
                                      min="0"
                                      max="200"
                                      value={editingEvent.seat_count} 
                                      onChange={(e) => setEditingEvent({...editingEvent, seat_count: Number(e.target.value)})}
                                      style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '10px', minWidth: '100%', boxSizing: 'border-box' }}
                                    />
                                  </label>
                                </>
                              )}
                              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                                <button type="button" onClick={() => setEditingEvent(null)} style={{ padding: '8px 16px', background: '#ccc', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
                                <button type="submit" style={{ padding: '8px 16px', background: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>저장</button>
                              </div>
                            </form>
                          </div>
                        </div>
                      )}
	                    </div>
	                  )}
	                  {adminTab === 'sessions' && (
	                    <div className="admin-events-view">
	                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
	                        <h2>회차 관리</h2>
	                        <button className="did-signup-btn" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => setEditingSession(createEmptyAdminSession())}>+ 새 회차 등록</button>
	                      </div>
	                      <div style={{ marginBottom: '16px' }}>
	                        <select value={selectedAdminEventId} onChange={(e) => setSelectedAdminEventId(e.target.value)} style={{ padding: '8px', minWidth: '260px' }}>
	                          {adminEvents.map((event) => (
	                            <option key={event.id} value={event.id}>{event.name}</option>
	                          ))}
	                        </select>
	                      </div>
	                      <table className="admin-table">
	                        <thead>
	                          <tr><th>ID</th><th>회차명</th><th>시작</th><th>종료</th><th>상태</th><th>액션</th></tr>
	                        </thead>
	                        <tbody>
	                          {adminSessions.map((session) => (
	                            <tr key={session.id}>
	                              <td>{session.id}</td>
	                              <td>{session.session_name}</td>
	                              <td>{formatSessionTime(session.session_start_at)}</td>
	                              <td>{formatSessionTime(session.session_end_at)}</td>
	                              <td><span className="status-badge">{session.sale_status}</span></td>
	                              <td>
	                                <div style={{ display: 'flex', gap: '8px' }}>
	                                  <button onClick={() => setEditingSession(session)} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>수정</button>
	                                  <button onClick={() => handleDeleteSession(session)} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#ff4d4f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>삭제</button>
	                                </div>
	                              </td>
	                            </tr>
	                          ))}
	                        </tbody>
	                      </table>
	                      {editingSession && (
	                        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
	                          <div className="modal-content" style={{ background: 'white', padding: '30px', borderRadius: '8px', width: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
	                            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>{editingSession.id ? '회차 수정' : '새 회차 등록'}</h3>
	                            <form onSubmit={handleSaveSession} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>회차명<input type="text" value={editingSession.session_name} onChange={(e) => setEditingSession({...editingSession, session_name: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} required /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>시작 일시<input type="text" value={editingSession.session_start_at} onChange={(e) => setEditingSession({...editingSession, session_start_at: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} required /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>종료 일시<input type="text" value={editingSession.session_end_at || ''} onChange={(e) => setEditingSession({...editingSession, session_end_at: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>판매 상태<select value={editingSession.sale_status} onChange={(e) => setEditingSession({...editingSession, sale_status: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}><option value="ready">ready</option><option value="open">open</option><option value="sold_out">sold_out</option><option value="paused">paused</option><option value="closed">closed</option></select></label>
	                              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
	                                <button type="button" onClick={() => setEditingSession(null)} style={{ padding: '8px 16px', background: '#ccc', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
	                                <button type="submit" style={{ padding: '8px 16px', background: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>저장</button>
	                              </div>
	                            </form>
	                          </div>
	                        </div>
	                      )}
	                    </div>
	                  )}
	                  {adminTab === 'seats' && (
	                    <div className="admin-events-view">
	                      <h2>좌석 관리</h2>
	                      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
	                        <select value={selectedAdminEventId} onChange={(e) => setSelectedAdminEventId(e.target.value)} style={{ padding: '8px', minWidth: '220px' }}>
	                          {adminEvents.map((event) => (
	                            <option key={event.id} value={event.id}>{event.name}</option>
	                          ))}
	                        </select>
	                        <select value={selectedAdminSessionId} onChange={(e) => setSelectedAdminSessionId(e.target.value)} style={{ padding: '8px', minWidth: '220px' }}>
	                          {adminSessions.map((session) => (
	                            <option key={session.id} value={session.id}>{session.session_name} ({formatSessionTime(session.session_start_at)})</option>
	                          ))}
	                        </select>
	                      </div>
	                      <form onSubmit={handleCreateSeats} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(90px, 1fr)) auto', gap: '8px', alignItems: 'end', marginBottom: '18px' }}>
	                        <input placeholder="행" value={seatBulkForm.row_label} onChange={(e) => setSeatBulkForm({...seatBulkForm, row_label: e.target.value})} style={{ padding: '8px' }} />
	                        <input type="number" min="1" placeholder="시작번호" value={seatBulkForm.start_number} onChange={(e) => setSeatBulkForm({...seatBulkForm, start_number: Number(e.target.value)})} style={{ padding: '8px' }} />
	                        <input type="number" min="1" max="500" placeholder="좌석수" value={seatBulkForm.seat_count} onChange={(e) => setSeatBulkForm({...seatBulkForm, seat_count: Number(e.target.value)})} style={{ padding: '8px' }} />
	                        <input placeholder="구역" value={seatBulkForm.section_name} onChange={(e) => setSeatBulkForm({...seatBulkForm, section_name: e.target.value})} style={{ padding: '8px' }} />
	                        <input placeholder="등급" value={seatBulkForm.grade} onChange={(e) => setSeatBulkForm({...seatBulkForm, grade: e.target.value})} style={{ padding: '8px' }} />
	                        <input type="number" min="0" placeholder="가격" value={seatBulkForm.price_amount} onChange={(e) => setSeatBulkForm({...seatBulkForm, price_amount: Number(e.target.value)})} style={{ padding: '8px' }} />
	                        <button type="submit" className="did-signup-btn" style={{ width: 'auto', padding: '9px 14px' }}>좌석 생성</button>
	                      </form>
	                      <table className="admin-table">
	                        <thead>
	                          <tr><th>ID</th><th>좌석</th><th>구역</th><th>등급</th><th>가격</th><th>상태</th><th>액션</th></tr>
	                        </thead>
	                        <tbody>
	                          {adminSeats.map((seat) => (
	                            <tr key={seat.id}>
	                              <td>{seat.id}</td>
	                              <td>{seat.seat_code}</td>
	                              <td>{seat.section_name}</td>
	                              <td>{seat.grade}</td>
	                              <td>{Number(seat.price_amount || 0).toLocaleString()}원</td>
	                              <td><span className="status-badge">{seat.status}</span></td>
	                              <td>
	                                <div style={{ display: 'flex', gap: '8px' }}>
	                                  <button onClick={() => setEditingSeat(seat)} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>수정</button>
	                                  <button onClick={() => handleDeleteSeat(seat)} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#ff4d4f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>삭제</button>
	                                </div>
	                              </td>
	                            </tr>
	                          ))}
	                        </tbody>
	                      </table>
	                      {editingSeat && (
	                        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
	                          <div className="modal-content" style={{ background: 'white', padding: '30px', borderRadius: '8px', width: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
	                            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>좌석 수정</h3>
	                            <form onSubmit={handleSaveSeat} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>좌석 코드<input type="text" value={editingSeat.seat_code} onChange={(e) => setEditingSeat({...editingSeat, seat_code: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} required /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>구역<input type="text" value={editingSeat.section_name || ''} onChange={(e) => setEditingSeat({...editingSeat, section_name: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>등급<input type="text" value={editingSeat.grade || ''} onChange={(e) => setEditingSeat({...editingSeat, grade: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>가격<input type="number" min="0" value={editingSeat.price_amount} onChange={(e) => setEditingSeat({...editingSeat, price_amount: Number(e.target.value)})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} /></label>
	                              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>상태<select value={editingSeat.status} onChange={(e) => setEditingSeat({...editingSeat, status: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}><option value="available">available</option><option value="holding">holding</option><option value="booked">booked</option><option value="locked">locked</option><option value="invited">invited</option><option value="disabled">disabled</option></select></label>
	                              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
	                                <button type="button" onClick={() => setEditingSeat(null)} style={{ padding: '8px 16px', background: '#ccc', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
	                                <button type="submit" style={{ padding: '8px 16px', background: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>저장</button>
	                              </div>
	                            </form>
	                          </div>
	                        </div>
	                      )}
	                    </div>
	                  )}
	                </main>
              </div>
            )}
          </div>
        )}

        {currentPage === 'detail' && selectedTicket && (
          <div className="detail-page-wrapper">
            <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
            <div className="detail-page">
              <div className="detail-left">
                <img src={selectedTicket.image} alt="포스터" onError={handleImageError} />
                <div className="detail-desc">
                  <h2>{selectedTicket.name}</h2>
                  <ul>
                    <li><strong>장소:</strong> {selectedTicket.location}</li>
                    <li><strong>기간:</strong> {selectedTicket.period}</li>
                    <li><strong>시간:</strong> {selectedTicket.time}</li>
                    <li><strong>관람연령:</strong> {selectedTicket.age}</li>
                    <li><strong>가격:</strong> {selectedTicket.price}{selectedTicket.price === '무료' ? '' : '원'}</li>
                  </ul>
                </div>
              </div>
              <div className="detail-right">
                <div className="real-calendar">
                  <div className="cal-header">
                    <button className="cal-arrow" onClick={handlePrevMonth}>◀</button>
                    <strong>{calYear}.{String(calMonth).padStart(2, '0')}</strong>
                    <button className="cal-arrow" onClick={handleNextMonth}>▶</button>
                  </div>
                  <div className="cal-week"><span className="sun">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span className="sat">토</span></div>
                  <div className="cal-days">
                    {Array.from({ length: firstDayOfWeek }).map((_, i) => <span key={`empty-${i}`} className="empty-day"></span>)}
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const dateKey = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      const isSelected = selectedDate === dateKey
                      const isPerformanceDay = performanceDates.has(dateKey)
                      return (
                        <button key={day} className={`day-btn ${isSelected ? 'selected' : ''} ${isPerformanceDay ? 'performance-day' : ''}`} onClick={() => setSelectedDate(dateKey)}>
                          {day}{isPerformanceDay && <span className="dot"></span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="session-select">
                  {sessions.length === 0 ? (
                    <p className="session-empty">등록된 회차가 없습니다.</p>
                  ) : (
                    (() => {
                      const filteredSessions = sessions.filter((session) => !selectedDate || toDateKey(session.session_start_at) === selectedDate);
                      if (selectedDate && filteredSessions.length === 0) {
                        return (
                          <p className="session-empty" style={{ textAlign: 'center', padding: '10px 0', color: '#ff3b3b', fontWeight: 'bold' }}>
                            선택하신 날짜에는 공연이 없습니다.
                          </p>
                        );
                      }
                      return filteredSessions.map((session) => (
                        <label key={session.id} className={session.sale_status !== 'open' ? 'disabled-session' : ''}>
                          <input
                            type="radio"
                            name="session"
                            value={session.id}
                            disabled={session.sale_status !== 'open'}
                            checked={selectedSession?.id === session.id}
                            onChange={() => setSelectedSession(session)}
                          />
                          {session.session_name} ({formatSessionTime(session.session_start_at)})
                        </label>
                      ));
                    })()
                  )}
                </div>
                <button className="book-btn" disabled={!selectedSession} onClick={goToBooking}>예매하기</button>
                <button className="wish-btn" onClick={handleWish}>{wishTickets.find((ticket) => ticket.id === selectedTicket.id) ? '❤️' : '🤍'} 찜하기</button>
              </div>
            </div>
          </div>
        )}

        {currentPage === 'booking' && selectedTicket && (
          <div className="booking-page-wrapper">
            <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
            <div className="booking-container">
              <div className="seat-selection-area">
                <h3>좌석 선택</h3>
                <div className="stage">STAGE</div>
                <div className="seat-grid">
                  {seats.map((seat) => {
                    const selIndex = selectedSeats.findIndex((s) => s.id === seat.id)
                    const isSelected = selIndex !== -1
                    return (
                      <button
                        key={seat.id}
                        className={`seat ${isSelected ? 'selected' : ''} ${seat.status !== 'available' ? 'unavailable' : ''}`}
                        onClick={() => handleSeatClick(seat)}
                        disabled={seat.status !== 'available'}
                        title={`${seat.seat_code} / ${seat.status}`}
                      >
                        {isSelected && (
                          <span className="seat-order-badge">{selIndex + 1}</span>
                        )}
                        {seat.seat_code}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="payment-summary-area">
                <h3>예매 정보</h3>
                <div className="summary-box">
                  <p className="summary-title">{selectedTicket.name}</p>
                  <p className="summary-info">장소: {selectedTicket.location}</p>
                  <p className="summary-info">회차: {selectedSession?.session_name}</p>
                  <p className="summary-info">일시: {formatSessionTime(selectedSession?.session_start_at)}</p>
                  <hr className="divider" />
                  <p className="companion-guide">
                    최대 <strong>{MAX_SEATS_PER_BOOKING}석</strong>까지 한 번에 결제할 수 있으며, 발급된 티켓은 추후 마이페이지에서 동반인에게 안전하게 양도할 수 있습니다.
                  </p>
                  <div className="seat-summary-list">
                    {selectedSeats.length === 0 ? (
                      <p className="seat-summary-empty">좌석을 선택해주세요.</p>
                    ) : (
                      selectedSeats.map((seat, idx) => (
                        <div key={seat.id} className={`seat-summary-row ${idx === 0 ? 'mine' : ''}`}>
                          <div className="seat-summary-head">
                            <span className={`seat-role-badge ${idx === 0 ? 'mine' : ''}`}>좌석 {idx + 1}</span>
                            <strong className="seat-summary-code">{seat.seat_code}</strong>
                            <span className="seat-summary-price">{formatPrice(seat.price_amount)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <hr className="divider" />
                  <div className="total-price-box">
                    <span>총 결제 금액 ({selectedSeats.length}매)</span>
                    <span className="price">
                      {formatPrice(selectedSeats.reduce((sum, s) => sum + Number(s.price_amount || 0), 0))}
                    </span>
                  </div>
                  <button className={`pay-btn ${selectedSeats.length > 0 ? 'active' : ''}`} onClick={handlePayment} disabled={selectedSeats.length === 0 || isLoading}>
                    {isLoading ? '인증 및 처리 중...' : '결제 및 티켓 발행하기'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentPage === 'mypage' && (
          <div className="mypage-wrapper">
            <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
            <div className="mypage-container">
              <h2 className="mypage-title">마이페이지 👤</h2>
              <div className="mypage-tabs">
                <button className={`tab-btn ${myPageTab === 'history' ? 'active' : ''}`} onClick={() => setMyPageTab('history')}>예매 내역</button>
                <button className={`tab-btn ${myPageTab === 'wish' ? 'active' : ''}`} onClick={() => setMyPageTab('wish')}>찜 목록</button>
              </div>
              {myPageTab === 'history' && (
                bookedTickets.length === 0 ? (
                  <div className="empty-content">
                    <p>아직 예매한 티켓이 없어요.</p>
                    <button className="go-book-btn" onClick={() => setCurrentPage('main')}>공연 보러 가기</button>
                  </div>
                ) : (
                  <div className="history-list">
                    {bookedTickets.map((ticket) => {
                      const transferableItems = (ticket.items || []).filter(item => isTransferable(item, currentUser.walletAddress))
                      return (
                        <div key={ticket.id} className="history-card">
                          <img src={ticket.image} alt={ticket.name} onError={handleImageError} />
                          <div className="history-info">
                            <h3>{ticket.name}</h3>
                            <p><strong>회차:</strong> {ticket.session_name}</p>
                            <p><strong>일시:</strong> {formatSessionTime(ticket.session_start_at)}</p>
                            <div className="history-seat">
                              <strong>좌석:</strong>
                              <span className="seat-chip-group">
                                {ticket.items && ticket.items.length > 0 ? (
                                  ticket.items.map((item) => (
                                    <span
                                      key={item.booking_item_id || item.seat_code}
                                      className={
                                        'seat-chip' +
                                        (item.is_transferred ? ' transferred' : '') +
                                        (isTransferable(item, currentUser.walletAddress) ? ' transferable' : '')
                                      }
                                      title={
                                        item.is_transferred
                                          ? '동반인에게 양도 완료'
                                          : isTransferable(item, currentUser.walletAddress)
                                          ? `동반인 양도 가능`
                                          : undefined
                                      }
                                    >
                                      {item.seat_code}
                                      {item.is_transferred && ' ↗ (양도완료)'}
                                      {isTransferable(item, currentUser.walletAddress) && ' 🎁 (양도 가능)'}
                                    </span>
                                  ))
                                ) : (
                                  '좌석 정보 없음'
                                )}
                              </span>
                            </div>
                            <p className="history-price"><strong>결제금액:</strong> {formatPrice(ticket.total_amount)}</p>
                            <p style={{ fontSize: '11px', color: '#999', wordBreak: 'break-all' }}><strong>TX:</strong> {ticket.txHash}</p>
                            {transferableItems.length > 0 && (
                              <button className="transfer-btn" onClick={() => openTransferModal(ticket)}>
                                🎁 동반인에게 티켓 양도 ({transferableItems.length})
                              </button>
                            )}
                          </div>
                          <div className="history-status">예매완료</div>
                        </div>
                      )
                    })}
                  </div>
                )
              )}
              {myPageTab === 'wish' && (
                wishTickets.length === 0 ? (
                  <div className="empty-content">
                    <p>아직 찜한 공연이 없어요.</p>
                    <button className="go-book-btn" onClick={() => setCurrentPage('main')}>공연 찾아보기</button>
                  </div>
                ) : (
                  <div className="ticket-grid">
                    {wishTickets.map((ticket) => (
                      <div key={ticket.id} className="ticket-card" onClick={() => goToDetail(ticket)}>
                        <img src={ticket.image} alt={ticket.name} onError={handleImageError} />
                        <button className="remove-wish-btn" onClick={(e) => handleRemoveWish(e, ticket.id)}>❌</button>
                        <div className="info">
                          <h4>{ticket.name}</h4>
                          <p>{ticket.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {currentPage === 'appguide' && (
          <div className="appguide-wrapper">
            <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
            <div className="appguide-container">
              <h2 className="appguide-main-title">📱 TicketPro 모바일 앱 안내</h2>
              <p className="appguide-subtitle">블록체인 기반 NFT 티켓을 모바일에서도 편리하게 이용하세요.</p>

              {/* ── 앱 다운로드 ── */}
              <section className="appguide-section">
                <h3 className="appguide-section-title">앱 다운로드</h3>
                <div className="appguide-download-box">
                  <div className="appguide-qr-placeholder">
                    <span className="appguide-qr-icon">📷</span>
                    <p className="appguide-qr-text">앱 출시 후 업데이트 예정</p>
                    <p className="appguide-qr-sub">QR 코드를 스캔하여 앱을 설치하세요</p>
                  </div>
                  <div className="appguide-download-info">
                    <div className="appguide-store-badge">
                      <span>🤖</span>
                      <div>
                        <p className="appguide-store-label">Google Play</p>
                        <p className="appguide-store-name">Android 앱 다운로드</p>
                      </div>
                    </div>
                    <div className="appguide-store-badge">
                      <span>🍎</span>
                      <div>
                        <p className="appguide-store-label">App Store</p>
                        <p className="appguide-store-name">iOS 앱 다운로드</p>
                      </div>
                    </div>
                    <p className="appguide-coming-soon">※ 현재 앱 출시 준비 중입니다. 출시 시 업데이트될 예정입니다.</p>
                  </div>
                </div>
              </section>

              {/* ── 모바일 로그인 방법 ── */}
              <section className="appguide-section">
                <h3 className="appguide-section-title">모바일 앱 로그인 방법</h3>
                <p className="appguide-notice-text">
                  TicketPro는 개인 정보 보호를 위해 <strong>JSON 키 파일 기반 DID 로그인</strong>을 사용합니다.<br/>
                  모바일에서 로그인하려면 아래 절차를 따라주세요.
                </p>
                <div className="appguide-steps">
                  <div className="appguide-step">
                    <div className="appguide-step-num">1</div>
                    <div className="appguide-step-content">
                      <h4>PC에서 DID 키 파일 발급</h4>
                      <p>TicketPro 웹사이트에서 <strong>로그인 / DID 발급</strong>을 클릭 후, 부경대 이메일 인증을 통해 키 파일을 발급·다운로드하세요.</p>
                    </div>
                  </div>
                  <div className="appguide-step">
                    <div className="appguide-step-num">2</div>
                    <div className="appguide-step-content">
                      <h4>JSON 파일을 휴대폰으로 전송</h4>
                      <p>다운로드된 <code>TicketPro_DID_학번.json</code> 파일을 카카오톡, 이메일, USB 등을 통해 휴대폰으로 옮겨주세요.</p>
                    </div>
                  </div>
                  <div className="appguide-step">
                    <div className="appguide-step-num">3</div>
                    <div className="appguide-step-content">
                      <h4>TicketPro 앱 실행 후 파일 선택</h4>
                      <p>앱을 실행하고 로그인 화면에서 <strong>키 파일 불러오기</strong>를 탭하여 전송받은 JSON 파일을 선택하세요.</p>
                    </div>
                  </div>
                  <div className="appguide-step">
                    <div className="appguide-step-num">4</div>
                    <div className="appguide-step-content">
                      <h4>비밀번호 입력 후 로그인</h4>
                      <p>키 파일 생성 시 설정한 <strong>비밀번호</strong>를 입력하면 로그인이 완료됩니다. 비밀번호는 분실 시 복구가 불가하니 안전하게 보관하세요.</p>
                    </div>
                  </div>
                </div>
                <div className="appguide-tip">
                  💡 <strong>Tip:</strong> 키 파일은 절대 타인에게 공유하지 마세요. 키 파일과 비밀번호가 있으면 누구든 본인 계정으로 로그인이 가능합니다.
                </div>
              </section>

            </div>
          </div>
        )}

        {transferModalBooking && (
          <div className="transfer-modal-overlay" onClick={closeTransferModal}>
            <div className="transfer-modal" onClick={(e) => e.stopPropagation()}>
              <button className="transfer-modal-close" onClick={closeTransferModal} disabled={isTransferring}>×</button>
              <h3 className="transfer-modal-title">동반인 티켓 양도</h3>
              <p className="transfer-modal-sub">{transferModalBooking.name}</p>
              <p className="transfer-modal-desc">
                양도할 좌석과 티켓을 받을 동반인의 가입 닉네임을 입력해주세요.
              </p>
              <div className="transfer-item-list">
                {(transferModalBooking.items || [])
                  .filter(item => isTransferable(item, currentUser?.walletAddress))
                  .map((item) => (
                    <button
                      key={item.booking_item_id || item.seat_code}
                      type="button"
                      className={`transfer-item ${selectedTransferItem?.booking_item_id === item.booking_item_id ? 'selected' : ''}`}
                      onClick={() => setSelectedTransferItem(item)}
                      disabled={isTransferring}
                    >
                      <span className="transfer-item-seat">
                        <span className="transfer-item-label">좌석</span>
                        <strong>{item.seat_code}</strong>
                      </span>
                      <span className="transfer-item-recipient">
                        <span className="transfer-item-label">토큰 ID</span>
                        <code>{item.token_id ?? '발급 대기'}</code>
                      </span>
                      <span className="transfer-item-check">
                        {selectedTransferItem?.booking_item_id === item.booking_item_id ? '✓' : ''}
                      </span>
                    </button>
                  ))}
              </div>
              <input
                className="password-input"
                type="text"
                value={companionUsername}
                onChange={(e) => setCompanionUsername(e.target.value)}
                placeholder="동반인 가입 닉네임"
                disabled={isTransferring}
              />
              <div className="transfer-modal-actions">
                <button className="transfer-cancel-btn" onClick={closeTransferModal} disabled={isTransferring}>
                  취소
                </button>
                <button className="transfer-confirm-btn" onClick={handleTransferTicket} disabled={isTransferring}>
                  {isTransferring ? '양도 중...' : '양도하기'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

export default App