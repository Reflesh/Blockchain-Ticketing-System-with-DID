const DEFAULT_MAIN_API_URL = 'http://43.201.77.114:8000/api';

export const TICKET_API_URL =
  process.env.EXPO_PUBLIC_TICKET_API_URL || DEFAULT_MAIN_API_URL;

// Main 서버가 Auth API를 중계하므로 모바일이 Auth 인스턴스에 직접 접근하지 않는다.
export const AUTH_API_URL =
  process.env.EXPO_PUBLIC_AUTH_API_URL || DEFAULT_MAIN_API_URL;

export const WEB_BASE_URL =
  (process.env.EXPO_PUBLIC_WEB_BASE_URL || 'http://43.201.77.114:5173').replace(/\/$/, '');
