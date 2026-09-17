function requirePublicUrl(name: string, value: string | undefined): string {
  const normalized = value?.trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  }
  return normalized;
}

export const TICKET_API_URL =
  requirePublicUrl('EXPO_PUBLIC_TICKET_API_URL', process.env.EXPO_PUBLIC_TICKET_API_URL);

// Main 서버가 Auth API를 중계하므로 모바일이 Auth 인스턴스에 직접 접근하지 않는다.
export const AUTH_API_URL =
  requirePublicUrl('EXPO_PUBLIC_AUTH_API_URL', process.env.EXPO_PUBLIC_AUTH_API_URL);

export const WEB_BASE_URL =
  requirePublicUrl('EXPO_PUBLIC_WEB_BASE_URL', process.env.EXPO_PUBLIC_WEB_BASE_URL);
