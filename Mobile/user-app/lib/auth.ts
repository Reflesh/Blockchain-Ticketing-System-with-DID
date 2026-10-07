import { ethers } from 'ethers';

import { AUTH_API_URL, TICKET_API_URL } from '@/constants/api';

export type WalletSession = {
  accessToken: string;
  accountWalletAddress: string;
};

export type VerifiedAccountProfile = {
  walletAddress: string;
  displayName: string;
  verificationStatus: string;
};

async function responseBody(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

function errorMessage(body: any, fallback: string): string {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.detail?.message === 'string') return body.detail.message;
  return fallback;
}


export class WalletRequestError extends Error {
  constructor(
    public readonly reason: 'timeout' | 'cancelled' | 'network' | 'http',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WalletRequestError';
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ response: Response; body: any }> {
  if (signal?.aborted) {
    throw new WalletRequestError('cancelled', '로그인 요청이 취소되었습니다.');
  }
  const controller = new AbortController();
  let rejectInterrupted: (error: WalletRequestError) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  const cancel = () => {
    rejectInterrupted(new WalletRequestError('cancelled', '로그인 요청이 취소되었습니다.'));
    controller.abort();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    rejectInterrupted(new WalletRequestError('timeout', '서버 응답 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도해주세요.'));
    controller.abort();
  }, 15000);
  try {
    const request = async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      return { response, body: await responseBody(response) };
    };
    return await Promise.race([request(), interrupted]);
  } catch (error) {
    if (error instanceof WalletRequestError) throw error;
    throw new WalletRequestError('network', '서버에 연결하지 못했습니다. 네트워크 연결을 확인해주세요.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function verifySessionAccount(
  accessToken: string,
  accountWalletAddress: string,
  signal?: AbortSignal,
): Promise<VerifiedAccountProfile> {
  if (!ethers.isAddress(accountWalletAddress)) {
    throw new Error('로그인 계정 Wallet 주소가 올바르지 않습니다.');
  }
  const { response, body } = await requestJson(
    `${TICKET_API_URL}/users/${encodeURIComponent(accountWalletAddress)}/profile`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    signal,
  );
  if (!response.ok) {
    throw new WalletRequestError('http', errorMessage(body, '웹 계정과 모바일 Wallet 연결을 확인하지 못했습니다.'), response.status);
  }
  const profile = body?.data;
  if (
    typeof profile?.wallet_address !== 'string' ||
    profile.wallet_address.toLowerCase() !== accountWalletAddress.toLowerCase()
  ) {
    throw new Error('서버 프로필과 로그인 계정 Wallet 주소가 일치하지 않습니다.');
  }
  if (profile.verification_status !== 'verified') {
    throw new Error('학생 인증이 완료된 계정만 모바일 티켓 Wallet을 사용할 수 있습니다.');
  }
  return {
    walletAddress: profile.wallet_address,
    displayName: typeof profile.display_name === 'string' ? profile.display_name : 'TicketPro 회원',
    verificationStatus: profile.verification_status,
  };
}

export async function authenticateWallet(wallet: ethers.Wallet, signal?: AbortSignal): Promise<WalletSession> {
  const { response: challengeResponse, body: challenge } = await requestJson(`${AUTH_API_URL}/login-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet_address: wallet.address }),
  }, signal);
  if (!challengeResponse.ok) {
    throw new Error(errorMessage(challenge, '로그인 요청에 실패했습니다.'));
  }
  if (typeof challenge.nonce !== 'string' || typeof challenge.message !== 'string') {
    throw new Error('로그인 서버 응답 형식이 올바르지 않습니다.');
  }

  const signature = await wallet.signMessage(challenge.message);
  const { response: verifyResponse, body: verified } = await requestJson(`${AUTH_API_URL}/login-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet_address: wallet.address,
      nonce: challenge.nonce,
      message: challenge.message,
      signature,
    }),
  }, signal);
  if (!verifyResponse.ok) {
    throw new Error(errorMessage(verified, '로그인 검증에 실패했습니다.'));
  }
  if (typeof verified.access_token !== 'string' || !verified.access_token) {
    throw new Error('로그인 세션 토큰을 받지 못했습니다.');
  }
  const accountWalletAddress = typeof verified.account_wallet_address === 'string'
    ? verified.account_wallet_address
    : wallet.address;
  await verifySessionAccount(verified.access_token, accountWalletAddress, signal);
  if (signal?.aborted) throw new WalletRequestError('cancelled', '로그인 요청이 취소되었습니다.');
  return { accessToken: verified.access_token, accountWalletAddress };
}
