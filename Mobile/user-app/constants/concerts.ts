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
      '글로벌 아이콘 BTS의 전세계 투어가 서울에 상륙합니다. 화려한 무대 연출과 최신 히트곡들로 가득한 역대급 콘서트.',
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
      '세상에서 가장 사랑받는 뮤지컬. 화려한 샹들리에와 마스크 뒤에 숨겨진 비밀의 이야기.',
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
  {
    id: '7',
    title: '세븐틴 팬미팅 SVT LEADERS',
    artist: '세븐틴',
    genre: '팬미팅',
    period: '2026.10.25 ~ 2026.10.26',
    venue: '올림픽 체조경기장',
    runtime: '120분',
    posterColor: '#0A1628',
    accentColor: '#3B82F6',
    ageRating: '전체 관람가',
    price: 'VIP 132,000원 / R석 110,000원 / S석 88,000원',
    description:
      '13명이 함께 만드는 특별한 팬미팅. 팬들과의 소통으로 가득한 특별한 시간.',
  },
  {
    id: '8',
    title: '반 고흐: 별이 빛나는 밤',
    artist: '반 고흐 미디어 아트팀',
    genre: '전시',
    period: '2026.09.01 ~ 2026.12.31',
    venue: 'DDP 동대문디자인플라자',
    runtime: '자유관람 (평균 60~90분)',
    posterColor: '#0A0A1E',
    accentColor: '#F59E0B',
    ageRating: '전체 관람가',
    price: '성인 18,000원 / 청소년 14,000원 / 어린이 10,000원',
    description:
      '빈센트 반 고흐의 명작을 몰입형 미디어 아트로 재해석. 별이 빛나는 밤 속으로 들어가세요.',
  },
  {
    id: '9',
    title: '해리포터 마법세계 체험전',
    artist: 'Warner Bros.',
    genre: '테마',
    period: '2026.09.10 ~ 2027.03.31',
    venue: 'COEX 전시홀',
    runtime: '자유관람 (평균 120분)',
    posterColor: '#0D0820',
    accentColor: '#8B5CF6',
    ageRating: '전체 관람가',
    price: '성인 25,000원 / 어린이 18,000원',
    description:
      '호그와트의 마법 세계가 서울에! 마법 지팡이를 들고 직접 마법을 체험하세요.',
  },
  {
    id: '10',
    title: '남이섬 가을 단풍 페스티벌',
    artist: '남이섬 아트팀',
    genre: '장소',
    period: '2026.10.15 ~ 2026.11.20',
    venue: '남이섬 (강원도 춘천)',
    runtime: '자유관람',
    posterColor: '#1A0A00',
    accentColor: '#F97316',
    ageRating: '전체 관람가',
    price: '성인 16,000원 / 청소년 13,000원 / 어린이 10,000원',
    description:
      '붉게 물든 단풍과 함께하는 남이섬 가을 페스티벌. 다양한 공연과 체험 프로그램.',
  },
  {
    id: '11',
    title: '뉴진스 팬미팅 Bunnies Camp',
    artist: '뉴진스',
    genre: '팬미팅',
    period: '2026.11.08 ~ 2026.11.09',
    venue: '인스파이어 아레나',
    runtime: '130분',
    posterColor: '#001428',
    accentColor: '#06B6D4',
    ageRating: '전체 관람가',
    price: 'VIP 143,000원 / R석 121,000원 / S석 99,000원',
    description:
      '뉴진스와 함께하는 특별한 하루. Bunnies들을 위한 특별 무대와 깜짝 이벤트.',
  },
  {
    id: '12',
    title: '모네: 빛의 정원',
    artist: '인상주의 미디어팀',
    genre: '전시',
    period: '2026.10.01 ~ 2027.01.15',
    venue: '예술의전당 한가람미술관',
    runtime: '자유관람 (평균 90분)',
    posterColor: '#051A14',
    accentColor: '#10B981',
    ageRating: '전체 관람가',
    price: '성인 20,000원 / 청소년 16,000원 / 어린이 12,000원',
    description:
      '클로드 모네의 수련 연작을 중심으로 펼쳐지는 몰입형 전시. 빛과 색채의 향연.',
  },
  {
    id: '13',
    title: '전주 한옥마을 야간 문화축제',
    artist: '전주시 문화재단',
    genre: '장소',
    period: '2026.10.01 ~ 2026.10.31',
    venue: '전주 한옥마을',
    runtime: '자유관람',
    posterColor: '#1A0F00',
    accentColor: '#DC8A35',
    ageRating: '전체 관람가',
    price: '무료',
    description:
      '한옥마을을 배경으로 펼쳐지는 전통 공연과 야간 조명 축제. 한국의 미를 느껴보세요.',
  },
  {
    id: '14',
    title: '공연예술박람회 PAMS',
    artist: '한국공연예술센터',
    genre: '테마',
    period: '2026.11.15 ~ 2026.11.20',
    venue: '아르코예술극장',
    runtime: '자유관람',
    posterColor: '#14001A',
    accentColor: '#D946EF',
    ageRating: '전체 관람가',
    price: '무료 (사전등록 필요)',
    description:
      '국내외 공연 예술 단체들이 한자리에. 다채로운 쇼케이스와 네트워킹 프로그램.',
  },
  {
    id: '15',
    title: '베토벤 교향곡 전집',
    artist: '서울시향',
    genre: '클래식',
    period: '2026.10.05 ~ 2026.10.08',
    venue: '롯데콘서트홀',
    runtime: '120분 (인터미션 20분 포함)',
    posterColor: '#0A0A0A',
    accentColor: '#A78BFA',
    ageRating: '8세 이상',
    price: 'R석 90,000원 / S석 65,000원 / A석 45,000원',
    description:
      '서울시향과 함께하는 베토벤 교향곡 연주회. 운명, 전원, 합창까지 한자리에.',
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
