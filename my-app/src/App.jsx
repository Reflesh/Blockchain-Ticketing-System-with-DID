import { useState } from 'react'
import axios from 'axios'
import './App.css'
import { ethers } from 'ethers'; 
import TicketABI from './contracts/TicketABI.json';

const RPC_URL = import.meta.env.VITE_RPC_URL;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const API_BASE_URL = 'http://localhost:8000/api';

import imgIu from './assets/아이유.png'; import imgLesMis from './assets/레미제라블.png';
import imgPsy from './assets/흠뻑쇼.png'; import imgAimer from './assets/Aimer.png';
import imgHearthstone from './assets/하스스톤.png'; import imgAws from './assets/AWS.png';
import imgOpera from './assets/오페라의 유령.png'; import imgLucia from './assets/루치아.png';
import imgJannabi from './assets/잔나비.png';

const mockTickets = [
  { id: 1, name: '아이유 콘서트 : The Golden Hour', time: '2026.09.15 19:00', location: '상암 월드컵 경기장', image: imgIu, period: '2026.09.15 - 2026.09.16', age: '전체관람가', price: '165,000' },
  { id: 2, name: '뮤지컬 <레미제라블>', time: '2026.10.10 14:00', location: '블루스퀘어 신한카드홀', image: imgLesMis, period: '2026.10.10 - 2027.01.31', age: '8세 이상 관람가', price: '170,000' },
  { id: 3, name: '흠뻑쇼 2026 REBOOT', time: '2026.08.01 18:00', location: '잠실 올림픽 주경기장', image: imgPsy, period: '2026.08.01 - 2026.08.03', age: '만 15세 이상', price: '143,000' },
  { id: 4, name: 'Aimer 라이브 투어 2026', time: '2026.11.20 19:00', location: 'KSPODOME', image: imgAimer, period: '2026.11.20 - 2026.11.21', age: '만 12세 이상', price: '132,000' },
  { id: 5, name: '하스스톤 전장 e스포츠 챔피언십', time: '2026.12.05 13:00', location: '벡스코 제1전시장', image: imgHearthstone, period: '2026.12.05 - 2026.12.06', age: '전체관람가', price: '50,000' },
  { id: 6, name: 'AWS Summit Busan 2026', time: '2026.07.12 10:00', location: '벡스코 오디토리움', image: imgAws, period: '2026.07.12 - 2026.07.13', age: '전체관람가', price: '무료' },
  { id: 7, name: '뮤지컬 <오페라의 유령>', time: '2026.12.24 19:30', location: '샤롯데씨어터', image: imgOpera, period: '2026.12.24 - 2027.03.01', age: '만 7세 이상', price: '190,000' },
  { id: 8, name: '태양의 서커스 <루치아>', time: '2026.09.30 20:00', location: '잠실 종합운동장 내 빅탑', image: imgLucia, period: '2026.09.30 - 2026.11.15', age: '전체관람가', price: '180,000' },
  { id: 9, name: '글로벌 블록체인 위크 2026', time: '2026.10.20 09:00', location: '코엑스 그랜드볼룸', image: 'https://images.unsplash.com/photo-1621504450181-5d356f61d307?q=80&w=600&h=800&auto=format&fit=crop', period: '2026.10.20 - 2026.10.22', age: '만 18세 이상', price: '120,000' },
  { id: 10, name: '잔나비 전국투어 콘서트', time: '2026.11.05 18:00', location: '수원 실내체육관', image: imgJannabi, period: '2026.11.05 - 2026.11.06', age: '만 12세 이상', price: '143,000' },
];

function App() {
  const [currentPage, setCurrentPage] = useState('main'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState(mockTickets);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [bookedTickets, setBookedTickets] = useState([]);
  const [wishTickets, setWishTickets] = useState([]);
  const [myPageTab, setMyPageTab] = useState('history');
  const [slideIndex, setSlideIndex] = useState(0);

  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null); 
  const [calYear, setCalYear] = useState(2026); 
  const [calMonth, setCalMonth] = useState(8);

  const [currentUser, setCurrentUser] = useState(null); 
  const [isLoading, setIsLoading] = useState(false);

  const [keystoreFile, setKeystoreFile] = useState(null);
  const [keystorePassword, setKeystorePassword] = useState('');
  const [loginTab, setLoginTab] = useState('did');
  
  // ✨ 드래그 앤 드롭 상태 추가
  const [isDragging, setIsDragging] = useState(false);

  const maxSlideIndex = mockTickets.length - 5; 
  const handleImageError = (e) => { e.target.src = "https://placehold.co/600x800/eeeeee/999999?text=No+Image"; };
  const handleNextSlide = () => { if (slideIndex < maxSlideIndex) setSlideIndex(slideIndex + 1); };
  const handlePrevSlide = () => { if (slideIndex > 0) setSlideIndex(slideIndex - 1); };

  const handleSearch = (e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { const results = mockTickets.filter(ticket => ticket.name.replace(/\s/g, "").includes(searchTerm.replace(/\s/g, ""))); setSearchResult(results); setCurrentPage('search'); } };
  const goToMain = () => { setCurrentPage('main'); setSearchTerm(''); setSelectedSeat(null); setSlideIndex(0); };
  const goToDetail = (ticket) => { setSelectedTicket(ticket); setCurrentPage('detail'); setSelectedDate(null); setSelectedSession(null); if (ticket && ticket.time) { const dateParts = ticket.time.split(' ')[0].split('.'); setCalYear(parseInt(dateParts[0], 10)); setCalMonth(parseInt(dateParts[1], 10)); } };
  const goToLogin = () => { setCurrentPage('login'); }; 
  const goToBooking = () => { if (!selectedSession) { alert("관람하실 회차(시간)를 선택해주세요!"); return; } setCurrentPage('booking'); setSelectedSeat(null); };
  const goToMyPage = () => { setCurrentPage('mypage'); setMyPageTab('history'); };
  const handleGoBack = () => { if (currentPage === 'detail' || currentPage === 'search' || currentPage === 'login' || currentPage === 'mypage') { setCurrentPage('main'); } else if (currentPage === 'booking') { setCurrentPage('detail'); } };

  // 🛡️ 드래그 앤 드롭 핸들러 함수들
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.json')) {
        setKeystoreFile(droppedFile);
      } else {
        alert("🚨 .json 형식의 키 파일만 업로드할 수 있습니다!");
      }
    }
  };

  const handleIdentityVerification = () => { const { IMP } = window; IMP.init("imp31832845"); IMP.certification({ merchant_uid: `mid_${new Date().getTime()}`, popup: false }, async (rsp) => { if (rsp.success) { try { setIsLoading(true); const verifyRes = await axios.post(`${API_BASE_URL}/verify-user`, { imp_uid: rsp.imp_uid }); const { name } = verifyRes.data.data; alert(`✅ ${name}님 인증 성공! 이제 안전한 DID 키 파일을 생성합니다.`); const password = prompt("키 파일을 암호화할 비밀번호를 설정하세요 (분실 시 복구 불가!)"); if (!password) { setIsLoading(false); return; } const wallet = ethers.Wallet.createRandom(); const encryptedJson = await wallet.encrypt(password); const blob = new Blob([encryptedJson], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `TicketPro_DID_${name}.json`; a.click(); alert("🔐 DID 키 파일이 다운로드되었습니다!\n이제 로그인 화면에서 이 파일을 업로드해 주세요."); setIsLoading(false); setLoginTab('did'); } catch (error) { alert("서버 통신 중 오류가 발생했습니다."); setIsLoading(false); } } else { alert(`인증 실패: ${rsp.error_msg}`); } }); };
  const handleKeystoreLogin = async () => { if (!keystoreFile || !keystorePassword) { alert("키 파일과 비밀번호를 모두 입력해주세요."); return; } try { setIsLoading(true); const reader = new FileReader(); reader.onload = async (e) => { try { const json = e.target.result; const wallet = await ethers.Wallet.fromEncryptedJson(json, keystorePassword); let extractedName = "DID 유저"; if (keystoreFile.name.includes('TicketPro_DID_')) { extractedName = keystoreFile.name.split('_')[2].replace('.json', ''); } alert(`🔓 로그인 성공! 지갑 주소: ${wallet.address}`); setCurrentUser({ username: extractedName, walletAddress: wallet.address, isDID: true }); setCurrentPage('main'); } catch (err) { alert("비밀번호가 틀렸거나 유효하지 않은 키 파일입니다."); } finally { setIsLoading(false); } }; reader.readAsText(keystoreFile); } catch (error) { alert("로그인 오류 발생."); setIsLoading(false); } };
  const connectMetaMask = async () => { if (typeof window.ethereum !== 'undefined') { try { const provider = new ethers.BrowserProvider(window.ethereum); const signer = await provider.getSigner(); const walletAddress = await signer.getAddress(); alert(`🦊 메타마스크 연결 성공!\n주소: ${walletAddress}`); setCurrentUser({ username: "MetaMask User", walletAddress: walletAddress, isMetaMask: true }); setCurrentPage('main'); } catch (error) { alert("지갑 연결 취소/에러"); } } else { alert("메타마스크를 설치해주세요! 🦊"); window.open('https://metamask.io/download/', '_blank'); } };
  const handleLogout = () => { setCurrentUser(null); setKeystoreFile(null); setKeystorePassword(''); setBookedTickets([]); alert("로그아웃 되었습니다."); setCurrentPage('main'); };
  const handlePayment = async () => { if (!selectedSeat) { alert('좌석을 먼저 선택해주세요!'); return; } if (!currentUser) { alert('로그인이 필요합니다.'); goToLogin(); return; } try { alert("⏳ 서버 지갑이 가스비를 대납하여 블록체인에 기록 중입니다..."); const response = await axios.post(`${API_BASE_URL}/buy-tickets`, { username: currentUser.walletAddress, companions: [] }); alert(`🎉 예매 성공! TX Hash: ${response.data.transaction_hash}`); setBookedTickets([...bookedTickets, { ...selectedTicket, seat: selectedSeat, bookingDate: new Date().toLocaleDateString(), txHash: response.data.transaction_hash }]); setCurrentPage('mypage'); setMyPageTab('history'); } catch (error) { alert("예매 오류 발생."); } };
  const handleWish = () => { const isAlreadyWished = wishTickets.find(ticket => ticket.id === selectedTicket.id); if (isAlreadyWished) { setWishTickets(wishTickets.filter(ticket => ticket.id !== selectedTicket.id)); alert('찜 삭제 🤍'); } else { setWishTickets([...wishTickets, selectedTicket]); alert('찜 추가 ❤️'); } };
  const handleRemoveWish = (e, ticketId) => { e.stopPropagation(); setWishTickets(wishTickets.filter(ticket => ticket.id !== ticketId)); alert('찜 삭제 💔'); };
  const handlePrevMonth = () => { if (calMonth === 1) { setCalMonth(12); setCalYear(calYear - 1); } else { setCalMonth(calMonth - 1); } };
  const handleNextMonth = () => { if (calMonth === 12) { setCalMonth(1); setCalYear(calYear + 1); } else { setCalMonth(calMonth + 1); } };

  const rows = ['A', 'B', 'C', 'D', 'E']; const cols = [1, 2, 3, 4, 5, 6, 7, 8];
  let daysInMonth = 31; let firstDayOfWeek = 0; let ticketYear = 0, ticketMonth = 0, ticketDay = 0;
  if (currentPage === 'detail' && selectedTicket) { daysInMonth = new Date(calYear, calMonth, 0).getDate(); firstDayOfWeek = new Date(calYear, calMonth - 1, 1).getDay(); const parts = selectedTicket.time.split(' ')[0].split('.'); ticketYear = parseInt(parts[0], 10); ticketMonth = parseInt(parts[1], 10); ticketDay = parseInt(parts[2], 10); }

  return (
    <div className="app-container">
      <nav className="navbar"><h1 className="logo" onClick={goToMain}>🎫 TicketPro</h1><div className="search-wrapper"><input type="text" placeholder="어떤 공연을 찾으시나요?" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={handleSearch}/></div><div className="nav-menus">{currentUser ? (<><span className="welcome-text" style={{marginRight: '15px', fontWeight: 'bold'}}>{currentUser.username}님</span><span onClick={goToMyPage}>마이페이지</span><span onClick={handleLogout}>로그아웃</span></>) : ( <span onClick={goToLogin}>로그인 / DID 발급</span> )}</div></nav>
      <div className="content-area">
        {currentPage === 'main' && (<div className="main-page-wrapper"><h2 className="section-title">🔥 공연 예정</h2><div className="carousel-container">{slideIndex > 0 && (<button className="carousel-arrow left" onClick={handlePrevSlide}>◀</button>)}<div className="carousel-track-wrapper"><div className="carousel-track" style={{ transform: `translateX(-${slideIndex * 20}%)` }}>{mockTickets.map((ticket) => (<div key={ticket.id} className="carousel-item"><div className="ticket-card" onClick={() => goToDetail(ticket)}><img src={ticket.image} alt={ticket.name} onError={handleImageError} /><div className="info"><h4>{ticket.name}</h4><p>{ticket.time}</p><p>{ticket.location}</p></div></div></div>))}</div></div>{slideIndex < maxSlideIndex && (<button className="carousel-arrow right" onClick={handleNextSlide}>▶</button>)}</div></div>)}
        {currentPage === 'search' && (<div className="search-page"><button className="icon-back-btn" onClick={handleGoBack}>⬅</button><h3>검색 결과 ({searchResult.length}건)</h3><div className="ticket-grid">{searchResult.map((ticket) => (<div key={ticket.id} className="ticket-card" onClick={() => goToDetail(ticket)}><img src={ticket.image} alt={ticket.name} onError={handleImageError} /><div className="info"><h4>{ticket.name}</h4><p>{ticket.time}</p><p>{ticket.location}</p></div></div>))}</div></div>)}
        
        {currentPage === 'login' && (
          <div className="login-page-wrapper">
            <button className="icon-back-btn" onClick={handleGoBack}>⬅</button>
            <div className="login-box">
              <h2 style={{ marginBottom: '20px' }}>스마트 로그인</h2>
              <div className="login-tabs"><button className={`login-tab-btn ${loginTab === 'did' ? 'active' : ''}`} onClick={() => setLoginTab('did')}>🔑 DID 키 파일</button><button className={`login-tab-btn ${loginTab === 'metamask' ? 'active' : ''}`} onClick={() => setLoginTab('metamask')}>🦊 메타마스크</button></div>
              
              {loginTab === 'did' && (
                <div className="tab-content">
                  <p style={{ color: '#666', fontSize: '13px', marginBottom: '15px' }}>발급받은 키 파일을 클릭하거나 드래그하여 업로드하세요.</p>
                  
                  {/* ✨ 드래그 이벤트 적용된 업로드 박스 */}
                  <div 
                    className={`file-upload-box ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <label htmlFor="keystore-upload" className="file-upload-label">
                      <span className="folder-icon">{isDragging ? '📥' : '📁'}</span>
                      {keystoreFile ? (
                        <span className="file-name">{keystoreFile.name} (선택됨)</span>
                      ) : (
                        <span className="file-placeholder">
                          {isDragging ? '파일을 여기에 놓아주세요!' : '여기를 클릭하거나 파일을 드래그하세요 (.json)'}
                        </span>
                      )}
                    </label>
                    <input id="keystore-upload" type="file" accept=".json" onChange={(e) => setKeystoreFile(e.target.files[0])} style={{ display: 'none' }} />
                  </div>

                  <input type="password" placeholder="파일 암호화 비밀번호" value={keystorePassword} onChange={(e) => setKeystorePassword(e.target.value)} className="password-input" />
                  <button onClick={handleKeystoreLogin} disabled={isLoading} className="submit-login-btn">{isLoading ? '복호화 중...' : '로그인'}</button>
                </div>
              )}

              {loginTab === 'metamask' && (<div className="tab-content metamask-content"><p style={{ color: '#666', fontSize: '13px', marginBottom: '20px', lineHeight: '1.6' }}>기존 Web3 유저를 위한 <strong>조회 전용</strong> 로그인입니다.<br/>(가스비 대납 미지원)</p><button onClick={connectMetaMask} className="metamask-btn"><img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" width="24" alt="fox"/> MetaMask 지갑 연결</button></div>)}
              <hr className="login-divider" />
              <div className="signup-prompt-box"><p>아직 안전한 DID가 없으신가요?</p><button onClick={handleIdentityVerification} disabled={isLoading} className="did-signup-btn">📱 본인인증 후 DID 발급받기</button></div>
            </div>
          </div>
        )}

        {currentPage === 'detail' && selectedTicket && (<div className="detail-page-wrapper"><button className="icon-back-btn" onClick={handleGoBack}>⬅</button><div className="detail-page"><div className="detail-left"><img src={selectedTicket.image} alt="포스터" onError={handleImageError} /><div className="detail-desc"><h2>{selectedTicket.name}</h2><ul><li><strong>장소:</strong> {selectedTicket.location}</li><li><strong>기간:</strong> {selectedTicket.period}</li><li><strong>시간:</strong> {selectedTicket.time}</li><li><strong>관람연령:</strong> {selectedTicket.age}</li><li><strong>가격:</strong> {selectedTicket.price}원</li></ul></div></div><div className="detail-right"><div className="real-calendar"><div className="cal-header"><button className="cal-arrow" onClick={handlePrevMonth}>◀</button><strong>{calYear}.{String(calMonth).padStart(2, '0')}</strong><button className="cal-arrow" onClick={handleNextMonth}>▶</button></div><div className="cal-week"><span className="sun">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span className="sat">토</span></div><div className="cal-days">{Array.from({ length: firstDayOfWeek }).map((_, i) => (<span key={`empty-${i}`} className="empty-day"></span>))}{Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => { const isSelected = selectedDate === day; const isPerformanceDay = (calYear === ticketYear && calMonth === ticketMonth && day === ticketDay); return (<button key={day} className={`day-btn ${isSelected ? 'selected' : ''} ${isPerformanceDay ? 'performance-day' : ''}`} onClick={() => setSelectedDate(day)}>{day}{isPerformanceDay && <span className="dot"></span>}</button>)})}</div></div><div className="session-select"><label><input type="radio" name="session" value="1회차 14:00" onChange={(e) => setSelectedSession(e.target.value)} /> 1회차 14:00</label><label><input type="radio" name="session" value="2회차 19:00" onChange={(e) => setSelectedSession(e.target.value)} /> 2회차 19:00</label></div><button className="book-btn" onClick={goToBooking}>예매하기</button><button className="wish-btn" onClick={handleWish}>{wishTickets.find(ticket => ticket.id === selectedTicket.id) ? '❤️' : '🤍'} 찜하기</button></div></div></div>)}
        {currentPage === 'booking' && selectedTicket && (<div className="booking-page-wrapper"><button className="icon-back-btn" onClick={handleGoBack}>⬅</button><div className="booking-container"><div className="seat-selection-area"><h3>좌석 선택</h3><div className="stage">STAGE</div><div className="seat-grid">{rows.map(row => cols.map(col => { const seatId = `${row}-${col}`; const isSelected = selectedSeat === seatId; return (<div key={seatId} className={`seat ${isSelected ? 'selected' : ''}`} onClick={() => setSelectedSeat(seatId)}>{seatId}</div>)}))}</div></div><div className="payment-summary-area"><h3>예매 정보</h3><div className="summary-box"><p className="summary-title">{selectedTicket.name}</p><p className="summary-info">장소: {selectedTicket.location}</p><p className="summary-info">일시: {selectedTicket.time}</p><hr className="divider" /><p className="summary-seat">선택 좌석: <strong>{selectedSeat || '좌석을 선택해주세요'}</strong></p><hr className="divider" /><div className="total-price-box"><span>총 결제 금액</span><span className="price">{selectedSeat ? `${selectedTicket.price}원` : '0원'}</span></div><button className={`pay-btn ${selectedSeat ? 'active' : ''}`} onClick={handlePayment}>결제하기</button></div></div></div></div>)}
        {currentPage === 'mypage' && (<div className="mypage-wrapper"><button className="icon-back-btn" onClick={handleGoBack}>⬅</button><div className="mypage-container"><h2 className="mypage-title">마이페이지 👤</h2><div className="mypage-tabs"><button className={`tab-btn ${myPageTab === 'history' ? 'active' : ''}`} onClick={() => setMyPageTab('history')}>예매 내역</button><button className={`tab-btn ${myPageTab === 'wish' ? 'active' : ''}`} onClick={() => setMyPageTab('wish')}>찜 목록</button></div>{myPageTab === 'history' && (bookedTickets.length === 0 ? (<div className="empty-content"><p>아직 예매한 티켓이 없어요.</p><button className="go-book-btn" onClick={() => setCurrentPage('main')}>공연 보러 가기</button></div>) : (<div className="history-list">{bookedTickets.map((ticket, index) => (<div key={index} className="history-card"><img src={ticket.image} alt={ticket.name} onError={handleImageError} /><div className="history-info"><h3>{ticket.name}</h3><p><strong>일시:</strong> {ticket.time}</p><p className="history-seat"><strong>좌석:</strong> {ticket.seat}</p><p className="history-price"><strong>결제금액:</strong> {ticket.price}원</p><p style={{fontSize: '11px', color: '#999', wordBreak: 'break-all'}}><strong>TX:</strong> {ticket.txHash}</p></div><div className="history-status">예매완료</div></div>))}</div>))}{myPageTab === 'wish' && (wishTickets.length === 0 ? (<div className="empty-content"><p>아직 찜한 공연이 없어요.</p><button className="go-book-btn" onClick={() => setCurrentPage('main')}>공연 찾아보기</button></div>) : (<div className="ticket-grid">{wishTickets.map((ticket) => (<div key={ticket.id} className="ticket-card" onClick={() => goToDetail(ticket)}><img src={ticket.image} alt={ticket.name} onError={handleImageError} /><button className="remove-wish-btn" onClick={(e) => handleRemoveWish(e, ticket.id)}>❌</button><div className="info"><h4>{ticket.name}</h4><p>{ticket.time}</p></div></div>))}</div>))}</div></div>)}
      </div>
    </div>
  )
}

export default App