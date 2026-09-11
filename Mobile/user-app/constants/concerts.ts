import { WEB_BASE_URL } from '@/constants/api';

export type EventResponse = {
  id: number | string;
  name?: string | null;
  time?: string | null;
  location?: string | null;
  image?: string | null;
  period?: string | null;
  age?: string | null;
  price?: string | null;
  price_amount?: number | null;
  status?: string | null;
  category?: string | null;
};

export type Concert = {
  id: string;
  title: string;
  displayTime: string;
  genre: string;
  period: string;
  venue: string;
  image: string;
  posterColor: string;
  accentColor: string;
  description: string;
  ageRating: string;
  price: string;
  status: string;
};

const PALETTES = [
  { posterColor: '#0D1B4B', accentColor: '#5B8DEF' },
  { posterColor: '#1A0505', accentColor: '#C9A84C' },
  { posterColor: '#051A18', accentColor: '#00D4B4' },
  { posterColor: '#14050A', accentColor: '#E11D48' },
  { posterColor: '#1A0E00', accentColor: '#F59E0B' },
  { posterColor: '#051405', accentColor: '#22C55E' },
];

const CATEGORY_LABELS: Record<string, string> = {
  concert: '콘서트',
  musical: '뮤지컬',
  fanmeeting: '팬미팅',
  classical: '클래식',
  exhibition: '전시',
  theme: '테마',
  place: '장소',
};

function paletteIndex(id: string) {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTES.length;
}

function resolvePosterUrl(value: string | null | undefined) {
  const image = value?.trim() || '';
  if (!image) return '';
  if (/^(https?:|data:)/i.test(image)) return image;
  return `${WEB_BASE_URL}/${image.replace(/^\/+/, '')}`;
}

export function mapEventResponse(event: EventResponse): Concert {
  const id = String(event.id);
  const palette = PALETTES[paletteIndex(id)];
  const category = event.category?.trim() || '';

  return {
    id,
    title: event.name?.trim() || '공연명 없음',
    displayTime: event.time?.trim() || '',
    genre: CATEGORY_LABELS[category.toLowerCase()] || category || '공연',
    period: event.period?.trim() || event.time?.trim() || '',
    venue: event.location?.trim() || '',
    image: resolvePosterUrl(event.image),
    posterColor: palette.posterColor,
    accentColor: palette.accentColor,
    description: '',
    ageRating: event.age?.trim() || '',
    price: event.price?.trim() || '',
    status: event.status?.trim() || '',
  };
}

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