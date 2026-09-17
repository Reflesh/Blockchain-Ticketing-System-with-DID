import { ethers } from 'ethers';

import {
  issueTicketQrChallenge,
} from '@/services/ticketApi';
import {
  isValidTicketTokenId,
  serializeSignedTicketQr,
  validateTicketQrChallenge,
  verifyTicketQrSignature,
} from '@/lib/ticketQrProtocol';

export type SignedTicketQr = {
  qrValue: string;
  issuedAt: number;
  expiresAt: number;
  requestElapsedMs: number;
};

export async function createSignedTicketQr(
  tokenId: string,
  accessToken: string,
  wallet: ethers.Wallet,
  accountAddress: string,
  signal?: AbortSignal,
): Promise<SignedTicketQr> {
  if (!isValidTicketTokenId(tokenId)) {
    throw new Error('티켓 토큰 정보가 올바르지 않습니다.');
  }

  const requestStartedAt = Date.now();
  const challenge = await issueTicketQrChallenge(tokenId, accessToken, signal);
  if (signal?.aborted) throw new Error('QR challenge 요청이 취소되었습니다.');

  validateTicketQrChallenge(challenge, tokenId, accountAddress, wallet.address);
  const signature = await wallet.signMessage(challenge.signing_message);
  if (signal?.aborted) throw new Error('QR challenge 요청이 취소되었습니다.');

  verifyTicketQrSignature(challenge.signing_message, signature, wallet.address);
  return {
    qrValue: serializeSignedTicketQr(challenge, signature),
    issuedAt: challenge.issued_at,
    expiresAt: challenge.expires_at,
    requestElapsedMs: Date.now() - requestStartedAt,
  };
}
