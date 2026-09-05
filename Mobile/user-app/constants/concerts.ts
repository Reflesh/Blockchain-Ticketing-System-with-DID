export type Concert = {
  id: string;
  title: string;
  artist: string;
  genre: string;
  period: string;
  venue: string;
  runtime: string;
  posterColor: string;
  accentColor: string;
  description: string;
  ageRating: string;
  price: string;
};

export const MOCK_CONCERTS: Concert[] = [
  {
    id: '1',
    title: 'BTS Permission to Dance',
    artist: 'BTS',
    genre: '콘서트',
    period: '2026.09.20 ~ 2026.09.22',
    venue: '잠실올림픽주경기장',
    runtime: '180분 (인터미션 없음)',
    posterColor: '#0D1B4B',
    accentColor: '#5B8DEF',
    ageRating: '전체 관람가',
    price: 'VIP 198,000원 / R석 154,000원 / S석 110,000원',
    description:
      '글로벌 아이콘 BTS의 전세계 투어가 서울에 상륙합니다. 화려한 무대 연출과 최신 히트곡들로 가득한 역대급 콘서트로 여러분을 초대합니다.',
  },
  {
    id: '2',
    title: '오페라의 유령',
    artist: '앤드류 로이드 웨버',
    genre: '뮤지컬',
    period: '2026.10.01 ~ 2027.01.31',
    venue: '블루스퀘어 신한카드홀',
    runtime: '165분 (인터미션 20분 포함)',
    posterColor: '#1A0505',
    accentColor: '#C9A84C',
    ageRating: '8세 이상',
    price: 'VIP 190,000원 / R석 160,000원 / S석 120,000원 / A석 80,000원',
    description:
      '세상에서 가장 사랑받는 뮤지컬. 화려한 샹들리에와 마스크 뒤에 숨겨진 비밀의 이야기가 펼쳐집니다.',
  },
  {
    id: '3',
    title: 'aespa MY WORLD TOUR',
    artist: 'aespa',
    genre: '콘서트',
    period: '2026.09.13 ~ 2026.09.14',
    venue: 'KSPO DOME',
    runtime: '150분 (인터미션 없음)',
    posterColor: '#051A18',
    accentColor: '#00D4B4',
    ageRating: '전체 관람가',
    price: 'VIP 165,000원 / R석 132,000원 / S석 99,000원',
    description:
      'aespa의 월드투어 서울 공연. SAVAGE부터 Supernova까지 모든 히트곡을 만나보세요.',
  },
  {
    id: '4',
    title: '레미제라블',
    artist: '클로드 미셸 쇤베르크',
    genre: '뮤지컬',
    period: '2026.11.01 ~ 2027.02.28',
    venue: '샤롯데씨어터',
    runtime: '190분 (인터미션 20분 포함)',
    posterColor: '#14050A',
    accentColor: '#E11D48',
    ageRating: '7세 이상',
    price: 'VIP 180,000원 / R석 150,000원 / S석 110,000원 / A석 70,000원',
    description:
      '빅토르 위고의 불멸의 원작. I Dreamed a Dream, One Day More 등 주옥같은 넘버들이 가득합니다.',
  },
  {
    id: '5',
    title: 'IU Concert: The Golden Hour',
    artist: 'IU (아이유)',
    genre: '콘서트',
    period: '2026.10.10 ~ 2026.10.12',
    venue: '고척스카이돔',
    runtime: '170분 (인터미션 없음)',
    posterColor: '#1A0E00',
    accentColor: '#F59E0B',
    ageRating: '전체 관람가',
    price: 'VIP 176,000원 / R석 143,000원 / S석 110,000원',
    description:
      '국민 가수 아이유의 골든아워 콘서트. 따뜻한 감성으로 여러분의 마음을 채워드립니다.',
  },
  {
    id: '6',
    title: '호두까기 인형',
    artist: '국립발레단',
    genre: '클래식',
    period: '2026.12.20 ~ 2026.12.28',
    venue: '예술의전당 오페라극장',
    runtime: '110분 (인터미션 20분 포함)',
    posterColor: '#051405',
    accentColor: '#22C55E',
    ageRating: '5세 이상',
    price: 'R석 110,000원 / S석 80,000원 / A석 50,000원 / B석 30,000원',
    description:
      '크리스마스 시즌의 가장 아름다운 선물. 차이코프스키의 음악과 국립발레단의 환상적인 무대.',
  },
];

export const CATEGORIES = [
  '전체',
  '콘서트',
  '뮤지컬',
  '팬미팅',
  '클래식',
  '전시',
  '테마',
  '장소',
];
