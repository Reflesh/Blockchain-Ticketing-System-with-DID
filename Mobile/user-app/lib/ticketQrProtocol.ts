import { ethers } from 'ethers';

export const QR_FORMAT_VERSION = 1;
export const QR_DOMAIN = 'ticketpro';
export const QR_PURPOSE = 'ticket_entry';
export const QR_TTL_SECONDS = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_ID_PATTERN = /^[1-9][0-9]{0,77}$/;

export type TicketQrChallengeProtocol = {
  v: number;
  domain: string;
  purpose: string;
  challenge_id: string;
  token_id: string;
  nonce: string;
  issued_at: number;
  expires_at: number;
  account: string;
  signer: string;
  signing_message: string;
};

export function isValidTicketTokenId(tokenId: string): boolean {
  return TOKEN_ID_PATTERN.test(tokenId);
}

export function canonicalTicketQrSigningMessage(
  challenge: TicketQrChallengeProtocol,
): string {
  // Backend json.dumps(sort_keys=True, separators=(',', ':'))와 같은 key 순서입니다.
  return JSON.stringify({
    account: challenge.account,
    challenge_id: challenge.challenge_id,
    domain: challenge.domain,
    expires_at: challenge.expires_at,
    issued_at: challenge.issued_at,
    nonce: challenge.nonce,
    purpose: challenge.purpose,
    signer: challenge.signer,
    token_id: challenge.token_id,
    v: challenge.v,
  });
}

export function validateTicketQrChallenge(
  challenge: TicketQrChallengeProtocol,
  requestedTokenId: string,
  accountAddress: string,
  signerAddress: string,
): void {
  if (
    challenge.v !== QR_FORMAT_VERSION
    || challenge.domain !== QR_DOMAIN
    || challenge.purpose !== QR_PURPOSE
  ) {
    throw new Error('지원하지 않는 QR challenge 형식입니다.');
  }
  if (
    !UUID_PATTERN.test(challenge.challenge_id)
    || !TOKEN_ID_PATTERN.test(challenge.token_id)
    || challenge.token_id !== requestedTokenId
  ) {
    throw new Error('QR challenge의 티켓 식별값이 올바르지 않습니다.');
  }
  if (!BASE64URL_32_BYTE_PATTERN.test(challenge.nonce)) {
    throw new Error('QR challenge nonce 형식이 올바르지 않습니다.');
  }
  const normalizedNonce = challenge.nonce.replace(/-/g, '+').replace(/_/g, '/');
  const nonceBytes = ethers.decodeBase64(`${normalizedNonce}=`);
  if (nonceBytes.length !== 32) {
    throw new Error('QR challenge nonce 길이가 올바르지 않습니다.');
  }
  if (
    !Number.isSafeInteger(challenge.issued_at)
    || !Number.isSafeInteger(challenge.expires_at)
    || challenge.expires_at - challenge.issued_at !== QR_TTL_SECONDS
  ) {
    throw new Error('QR challenge 유효시간이 올바르지 않습니다.');
  }
  if (
    !ethers.isAddress(challenge.account)
    || !ethers.isAddress(challenge.signer)
    || challenge.account.toLowerCase() !== accountAddress.toLowerCase()
    || challenge.signer.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new Error('QR challenge의 Wallet 정보가 로그인 세션과 일치하지 않습니다.');
  }
  if (challenge.signing_message !== canonicalTicketQrSigningMessage(challenge)) {
    throw new Error('QR challenge 서명 메시지가 변경되었습니다.');
  }
}

export function verifyTicketQrSignature(
  signingMessage: string,
  signature: string,
  signerAddress: string,
): void {
  const recovered = ethers.verifyMessage(signingMessage, signature);
  if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error('모바일 Wallet QR 서명 확인에 실패했습니다.');
  }
}

export function serializeSignedTicketQr(
  challenge: TicketQrChallengeProtocol,
  signature: string,
): string {
  return JSON.stringify({
    v: challenge.v,
    domain: challenge.domain,
    purpose: challenge.purpose,
    challenge_id: challenge.challenge_id,
    token_id: challenge.token_id,
    nonce: challenge.nonce,
    issued_at: challenge.issued_at,
    expires_at: challenge.expires_at,
    account: challenge.account,
    signer: challenge.signer,
    signature,
  });
}
