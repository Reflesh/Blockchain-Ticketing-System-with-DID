import { ethers } from 'ethers';
import { AUTH_API_URL } from '@/constants/api';
import { verifyAndStoreCredential, walletPublicJwk } from '@/lib/oid4vci';
import { fetchWithTimeout } from '@/lib/requestTimeout';

export async function synchronizeCredential(wallet: ethers.Wallet, accessToken: string, signal?: AbortSignal, expectedAccount?: string) {
  const response = await fetchWithTimeout(`${AUTH_API_URL}/account/credential`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ holder_jwk: walletPublicJwk(wallet) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '학생 인증서를 복원하지 못했습니다.');
  if (typeof body.credential !== 'string' || typeof body.issuer !== 'string' || typeof body.jwks_uri !== 'string' || typeof body.credential_configuration_id !== 'string') {
    throw new Error('학생 인증서 복원 응답이 올바르지 않습니다.');
  }
  if (typeof body.account_wallet_address !== 'string') throw new Error('인증서의 원래 계정 정보가 없습니다.');
  if (expectedAccount && body.account_wallet_address.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error('로그인 계정과 인증서 계정이 일치하지 않습니다.');
  return verifyAndStoreCredential(body.credential, body.issuer, wallet, body.jwks_uri, body.credential_configuration_id, body.account_wallet_address);
}
