import { ethers } from 'ethers';

import { AUTH_API_URL } from '@/constants/api';
import {
  verifyAndStoreCredential,
  walletPublicJwk,
  type StoredCredential,
} from '@/lib/oid4vci';

type PairingResult = {
  accessToken: string;
  accountWalletAddress: string;
  credential: StoredCredential;
};

async function responseJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message ?? body?.error_description ?? body?.error ?? `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return body;
}

export function extractMobilePairingToken(scannedValue: string): string {
  let parsed: URL;
  try {
    parsed = new URL(scannedValue.trim());
  } catch {
    throw new Error('모바일 연결 QR 데이터가 URL 형식이 아닙니다.');
  }
  if (parsed.protocol !== 'ticketprouserapp:' || parsed.hostname !== 'mobile-pairing') {
    throw new Error('TicketPro 모바일 연결 QR이 아닙니다.');
  }
  const token = parsed.searchParams.get('token');
  if (!token || token.length < 32) {
    throw new Error('모바일 연결 토큰이 없습니다.');
  }
  return token;
}

export async function completeMobilePairing(
  scannedValue: string,
  wallet: ethers.Wallet,
  deviceName = 'Android Wallet',
): Promise<PairingResult> {
  const pairingToken = extractMobilePairingToken(scannedValue);
  const challenge = await responseJson(
    await fetch(`${AUTH_API_URL}/login-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: wallet.address }),
    }),
  );
  if (!challenge.nonce || !challenge.message) {
    throw new Error('서버가 모바일 Wallet Challenge를 제공하지 않았습니다.');
  }

  const signature = await wallet.signMessage(String(challenge.message));
  const completed = await responseJson(
    await fetch(`${AUTH_API_URL}/mobile-pairings/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_token: pairingToken,
        wallet_address: wallet.address,
        holder_jwk: walletPublicJwk(wallet),
        device_name: deviceName,
        nonce: challenge.nonce,
        message: challenge.message,
        signature,
      }),
    }),
  );
  if (
    typeof completed.access_token !== 'string' ||
    typeof completed.account_wallet_address !== 'string' ||
    typeof completed.credential !== 'string' ||
    typeof completed.issuer !== 'string' ||
    typeof completed.jwks_uri !== 'string'
  ) {
    throw new Error('모바일 연결 완료 응답 형식이 올바르지 않습니다.');
  }

  const credential = await verifyAndStoreCredential(
    completed.credential,
    completed.issuer,
    wallet,
    completed.jwks_uri,
    'TicketProMobileCredential',
  );
  return {
    accessToken: completed.access_token,
    accountWalletAddress: completed.account_wallet_address,
    credential,
  };
}
