function requirePublicUrl(name: string, value: string | undefined): string {
  const normalized = value?.trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  }
  return normalized;
}

export const TICKET_API_URL = requirePublicUrl(
  'EXPO_PUBLIC_TICKET_API_URL',
  process.env.EXPO_PUBLIC_TICKET_API_URL,
);
