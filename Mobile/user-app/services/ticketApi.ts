import { TICKET_API_URL } from '@/constants/api';

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

type ApiEnvelope<T> = {
  status?: string;
  data?: T;
  detail?: string;
};

async function getData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${TICKET_API_URL}${path}`, { signal });
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok) {
    throw new Error(body?.detail || '서버 요청을 처리하지 못했습니다.');
  }
  if (body?.data === undefined) {
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
  }
  return body.data;
}

export function getEventSessions(eventId: string, signal?: AbortSignal) {
  return getData<EventSession[]>(`/events/${encodeURIComponent(eventId)}/sessions`, signal);
}

export function getSessionSeats(sessionId: string, signal?: AbortSignal) {
  return getData<Seat[]>(`/sessions/${encodeURIComponent(sessionId)}/seats`, signal);
}
