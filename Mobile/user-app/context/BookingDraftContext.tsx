import type { EventSession, Seat } from '@/services/ticketApi';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type BookingEvent = {
  id: string;
  title: string;
  venue: string;
  accentColor: string;
};

type BookingDraft = {
  event: BookingEvent | null;
  session: EventSession | null;
  seats: Seat[];
};

type BookingDraftContextType = BookingDraft & {
  startDraft: (event: BookingEvent) => void;
  selectSession: (session: EventSession) => void;
  setSelectedSeats: (seats: Seat[]) => void;
  clearDraft: () => void;
};

const EMPTY_DRAFT: BookingDraft = { event: null, session: null, seats: [] };
const BookingDraftContext = createContext<BookingDraftContextType | undefined>(undefined);

export function BookingDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);

  const startDraft = useCallback((event: BookingEvent) => {
    setDraft((current) => current.event?.id === event.id
      ? { ...current, event }
      : { event, session: null, seats: [] });
  }, []);

  const selectSession = useCallback((session: EventSession) => {
    setDraft((current) => current.session?.id === session.id
      ? current
      : { ...current, session, seats: [] });
  }, []);

  const setSelectedSeats = useCallback((seats: Seat[]) => {
    setDraft((current) => ({ ...current, seats }));
  }, []);

  const clearDraft = useCallback(() => setDraft(EMPTY_DRAFT), []);

  const value = useMemo<BookingDraftContextType>(() => ({
    ...draft,
    startDraft,
    selectSession,
    setSelectedSeats,
    clearDraft,
  }), [clearDraft, draft, selectSession, setSelectedSeats, startDraft]);

  return <BookingDraftContext.Provider value={value}>{children}</BookingDraftContext.Provider>;
}

export function useBookingDraft() {
  const context = useContext(BookingDraftContext);
  if (!context) throw new Error('useBookingDraft는 BookingDraftProvider 안에서만 사용할 수 있어요');
  return context;
}