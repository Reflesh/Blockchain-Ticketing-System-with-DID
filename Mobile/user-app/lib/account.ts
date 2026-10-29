import { ethers } from 'ethers';
import { AUTH_API_URL, TICKET_API_URL } from '@/constants/api';
import { authenticatedFetch } from '@/lib/sessionTransport';

export async function accountRequest(path: string, body: object, accessToken?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await (accessToken ? authenticatedFetch : fetch)(`${path === '/account/withdraw' ? TICKET_API_URL : AUTH_API_URL}${path}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '요청을 처리하지 못했습니다.');
    return data;
  } finally { clearTimeout(timer); }
}

export async function withdrawAccount(wallet: ethers.Wallet, accessToken: string) {
  const proof = await accountRequest('/account/withdraw/challenge', {}, accessToken);
  const signature = await wallet.signMessage(proof.message);
  return accountRequest('/account/withdraw', { ...proof, signature }, accessToken);
}
