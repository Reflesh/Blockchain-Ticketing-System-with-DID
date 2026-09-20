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

export async function verifySessionAccount(
  accessToken: string,
  accountWalletAddress: string,
): Promise<VerifiedAccountProfile> {
  if (!ethers.isAddress(accountWalletAddress)) {
    throw new Error('로그인 계정 Wallet 주소가 올바르지 않습니다.');
  }
  const response = await fetch(
    `${TICKET_API_URL}/users/${encodeURIComponent(accountWalletAddress)}/profile`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    throw new Error(errorMessage(body, '웹 계정과 모바일 Wallet 연결을 확인하지 못했습니다.'));
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
  await verifySessionAccount(verified.access_token, accountWalletAddress);
  return { accessToken: verified.access_token, accountWalletAddress };
}
