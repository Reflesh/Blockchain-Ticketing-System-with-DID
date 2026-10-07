import { ethers } from 'ethers';

import { AUTH_API_URL } from '@/constants/api';
import { verifySessionAccount } from '@/lib/auth';
import {
  verifyAndStoreCredential,
  walletPublicJwk,
  type StoredCredential,
} from '@/lib/oid4vci';

export function extractMobilePairingToken(scannedValue: string): string {
  // React Native의 URL.hostname은 이 사용자 정의 URI를 처리하지 못할 수 있다.
  const matched = /^ticketprouserapp:\/\/mobile-pairing\/?\?([^#\s]*)(?:#[^\s]*)?$/i.exec(scannedValue.trim());
  if (!matched) {
    throw new Error('PC 웹 마이페이지에서 발급한 모바일 연결 URI를 입력해주세요.');
  }
  const tokens: string[] = [];
  try {
    for (const parameter of matched[1].split('&')) {
      const separator = parameter.indexOf('=');
      const key = separator < 0 ? parameter : parameter.slice(0, separator);
      if (decodeURIComponent(key.replace(/\+/g, ' ')) !== 'token') continue;
      tokens.push(decodeURIComponent((separator < 0 ? '' : parameter.slice(separator + 1)).replace(/\+/g, ' ')));
    }
  } catch {
    throw new Error('모바일 연결 URI의 인코딩이 올바르지 않습니다. URI 전체를 다시 복사해주세요.');
  }
  if (tokens.length !== 1 || !/^[A-Za-z0-9_-]{32,256}$/.test(tokens[0])) {
    throw new Error('모바일 연결 토큰이 없거나 올바르지 않습니다. URI 전체를 복사해주세요.');
  }
  return tokens[0];
}

export function getMobilePairingInputError(value: string): string | null {
  if (!value.trim()) return 'PC 웹 마이페이지의 모바일 연결 QR을 스캔하거나 URI를 입력해주세요.';
  try {
    extractMobilePairingToken(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '모바일 연결 URI를 확인해주세요.';
  }
}

export function canStartMobilePairing(value: string, busy: boolean): boolean {
  return !busy && getMobilePairingInputError(value) === null;
}

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
  await verifySessionAccount(completed.access_token, completed.account_wallet_address);
  return {
    accessToken: completed.access_token,
    accountWalletAddress: completed.account_wallet_address,
    credential,
  };
}
