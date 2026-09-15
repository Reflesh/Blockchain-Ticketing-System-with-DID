import { ethers } from 'ethers';

import { AUTH_API_URL } from '@/constants/api';

export type WalletSession = {
  accessToken: string;
  accountWalletAddress: string;
};

async function responseBody(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

function errorMessage(body: any, fallback: string): string {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.detail?.message === 'string') return body.detail.message;
  return fallback;
}

export async function authenticateWallet(wallet: ethers.Wallet): Promise<WalletSession> {
  const challengeResponse = await fetch(`${AUTH_API_URL}/login-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet_address: wallet.address }),
  });
  const challenge = await responseBody(challengeResponse);
  if (!challengeResponse.ok) {
    throw new Error(errorMessage(challenge, '로그인 요청에 실패했습니다.'));
  }
  if (typeof challenge.nonce !== 'string' || typeof challenge.message !== 'string') {
    throw new Error('로그인 서버 응답 형식이 올바르지 않습니다.');
  }

  const signature = await wallet.signMessage(challenge.message);
  const verifyResponse = await fetch(`${AUTH_API_URL}/login-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet_address: wallet.address,
      nonce: challenge.nonce,
      message: challenge.message,
      signature,
    }),
  });
  const verified = await responseBody(verifyResponse);
  if (!verifyResponse.ok) {
    throw new Error(errorMessage(verified, '로그인 검증에 실패했습니다.'));
  }
  if (typeof verified.access_token !== 'string' || !verified.access_token) {
    throw new Error('로그인 세션 토큰을 받지 못했습니다.');
  }
  const accountWalletAddress = typeof verified.account_wallet_address === 'string'
    ? verified.account_wallet_address
    : wallet.address;
  return { accessToken: verified.access_token, accountWalletAddress };
}
