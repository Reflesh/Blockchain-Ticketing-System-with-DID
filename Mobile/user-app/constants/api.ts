// 기본값은 현재 Main_Server 주소를 유지하고, 빌드 환경에서 덮어쓸 수 있다.
export const TICKET_API_URL =
  process.env.EXPO_PUBLIC_TICKET_API_URL || 'http://43.201.77.114:8000/api';

export const AUTH_API_URL =
  process.env.EXPO_PUBLIC_AUTH_API_URL || TICKET_API_URL;

export const WEB_BASE_URL =
  (process.env.EXPO_PUBLIC_WEB_BASE_URL || 'http://43.201.77.114:5173').replace(/\/$/, '');