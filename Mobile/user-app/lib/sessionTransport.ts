type SessionTransport = { token: () => string | null; epoch?: () => number; renew: () => Promise<string> };
let transport: SessionTransport | null = null;

export function installSessionTransport(value: SessionTransport) {
  transport = value;
  return () => { if (transport === value) transport = null; };
}

export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const active = transport;
  const headers = new Headers(init.headers);
  const supplied = headers.get('Authorization');
  const current = active?.token();
  const epoch = active?.epoch?.();
  const authenticated = supplied?.startsWith('Bearer ');
  if (authenticated && active && !current) throw new Error('다시 로그인해주세요.');
  if (supplied?.startsWith('Bearer ') && current) headers.set('Authorization', `Bearer ${current}`);
  const response = await fetch(url, { ...init, headers });
  if (authenticated && active && (transport !== active || !active.token() || active.epoch?.() !== epoch)) throw new Error('로그인 상태가 변경되었습니다.');
  if (response.status !== 401 || !active || !authenticated) return response;
  const token = await active.renew();
  if (transport !== active || active.token() !== token || active.epoch?.() !== epoch) throw new Error('로그인 상태가 변경되었습니다. 다시 시도해주세요.');
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
