import { TICKET_API_URL } from '@/constants/api';
import type { EventResponse } from '@/constants/concerts';

export type EventSession = {
  id: number;
  event_id: number;
  session_name: string;
  session_start_at: string | null;
  session_end_at: string | null;
  sale_status: 'ready' | 'open' | 'sold_out' | 'paused' | 'closed' | string;
};

export type Seat = {
  id: number;
  event_session_id: number;
  seat_code: string;
  section_name: string | null;
  row_label: string | null;
  seat_number: string | number | null;
  grade: string | null;
  price_amount: number;
  status: 'available' | 'holding' | 'booked' | 'locked' | 'invited' | 'disabled' | string;
};

export type BookingItem = {
  booking_item_id: number;
  seat_code: string;
  owner_wallet_address: string | null;
  companion_wallet_address: string | null;
  token_id: number | string | null;
  is_transferred: boolean;
  ticket_status: string;
  unit_price: number;
};

export type Booking = {
  id: number;
  booking_no: string;
  title: string;
  venue: string;
  display_time_text: string;
  session_name: string;
  session_start_at: string | null;
  image: string;
  price: string;
  total_amount: number;
  booking_status: string;
  payment_status: string;
  blockchain_status: string;
  txHash: string | null;
  items: BookingItem[];
  created_at: string | null;
  poster_color: string;
};

export type UserProfile = {
  wallet_address: string;
  display_name: string;
  auth_provider: string;
  verification_status: string;
};

export type TicketQrChallenge = {
  v: number;
  domain: string;
  purpose: string;
  challenge_id: string;
  token_id: string;
  nonce: string;
  issued_at: number;
  expires_at: number;
  account: string;
  signer: string;
  signing_message: string;
};

type ApiErrorDetail = string | { message?: string };

export type ApiEnvelope<T> = {
  status?: string;
  data?: T;
  message?: string;
  detail?: ApiErrorDetail;
};

function errorMessage(body: ApiEnvelope<unknown> | null, fallback: string) {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.detail?.message === 'string') return body.detail.message;
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${TICKET_API_URL}${path}`, init);
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok) {
    throw new Error(errorMessage(body, '서버 요청을 처리하지 못했습니다.'));
  }
  return body ?? {};
}

async function requestData<T>(path: string, init: RequestInit = {}): Promise<T> {
  const body = await request<T>(path, init);
  if (body?.data === undefined) {
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
  }
  return body.data;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

function normalizeBooking(raw: any): Booking {
  return {
    ...raw,
    title: String(raw?.title ?? raw?.name ?? ''),
    venue: String(raw?.venue ?? raw?.location ?? ''),
    display_time_text: String(raw?.display_time_text ?? raw?.time ?? ''),
    session_name: String(raw?.session_name ?? ''),
    session_start_at: raw?.session_start_at ?? null,
    image: String(raw?.image ?? ''),
    price: String(raw?.price ?? ''),
    total_amount: Number(raw?.total_amount ?? 0),
    txHash: raw?.txHash ?? null,
    items: Array.isArray(raw?.items) ? raw.items : [],
    created_at: raw?.created_at ?? null,
    poster_color: String(raw?.poster_color ?? '#E11D48'),
  };
}

export function getEvents(signal?: AbortSignal) {
  return requestData<EventResponse[]>('/events', { signal });
}

export function getEvent(eventId: string, signal?: AbortSignal) {
  return requestData<EventResponse>(`/events/${encodeURIComponent(eventId)}`, { signal });
}

export function getEventSessions(eventId: string, signal?: AbortSignal) {
  return requestData<EventSession[]>(`/events/${encodeURIComponent(eventId)}/sessions`, { signal });
}

export function getSessionSeats(sessionId: string, signal?: AbortSignal) {
  return requestData<Seat[]>(`/sessions/${encodeURIComponent(sessionId)}/seats`, { signal });
}

export async function getBookings(walletAddress: string, accessToken: string, signal?: AbortSignal) {
  const bookings = await requestData<any[]>(
    `/users/${encodeURIComponent(walletAddress)}/bookings`,
    { headers: authHeaders(accessToken), signal },
  );
  return bookings.map(normalizeBooking);
}

export function issueTicketQrChallenge(tokenId: string, accessToken: string, signal?: AbortSignal) {
  return requestData<TicketQrChallenge>(
    `/tickets/${encodeURIComponent(tokenId)}/qr-challenge`,
    {
      method: 'POST',
      headers: authHeaders(accessToken),
      signal,
    },
  );
}

export function getWishlist(walletAddress: string, accessToken: string, signal?: AbortSignal) {
  return requestData<EventResponse[]>(
    `/users/${encodeURIComponent(walletAddress)}/wishlist`,
    { headers: authHeaders(accessToken), signal },
  );
}

export function getUserProfile(walletAddress: string, accessToken: string, signal?: AbortSignal) {
  return requestData<UserProfile>(
    `/users/${encodeURIComponent(walletAddress)}/profile`,
    { headers: authHeaders(accessToken), signal },
  );
}

export async function addWishlist(walletAddress: string, eventId: string, accessToken: string) {
  await request<never>('/wishlist', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ wallet_address: walletAddress, event_id: Number(eventId) }),
  });
}

export async function removeWishlist(walletAddress: string, eventId: string, accessToken: string) {
  const query = `wallet_address=${encodeURIComponent(walletAddress)}`;
  await request<never>(`/wishlist/${encodeURIComponent(eventId)}?${query}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
}
