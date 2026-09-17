import AsyncStorage from '@react-native-async-storage/async-storage';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ethers } from 'ethers';

const STORAGE_KEY = 'ticketpro.oid4vci.credentials.v1';
const LOCAL_WALLET_KEY = 'ticketpro.oid4vci.encrypted-wallet.v1';

type JsonWebKeySet = {
  keys?: Array<{
    kty?: string;
    crv?: string;
    x?: string;
    y?: string;
    kid?: string;
    alg?: string;
  }>;
};


export type StoredCredential = {
  id: string;
  issuer: string;
  credentialConfigurationId: string;
  credential: string;
  subject: string;
  issuedAt: number;
  expiresAt: number;
  storedAt: string;
};

function isSameCredentialScope(left: StoredCredential, right: StoredCredential): boolean {
  return left.issuer === right.issuer
    && left.subject === right.subject
    && left.credentialConfigurationId === right.credentialConfigurationId;
}

function deduplicateCredentials(credentials: StoredCredential[]): StoredCredential[] {
  return credentials.filter((credential, index) => (
    credentials.findIndex((candidate) => isSameCredentialScope(candidate, credential)) === index
  ));
}

function base64url(bytes: Uint8Array): string {
  return ethers
    .encodeBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return ethers.decodeBase64(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
}

function decodeJwtPayload(jwt: string): Record<string, any> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('발급된 Credential JWT 형식이 올바르지 않습니다.');
  return JSON.parse(ethers.toUtf8String(decodeBase64url(parts[1])));
}

export function walletPublicJwk(wallet: ethers.Wallet) {
  const publicKey = ethers.getBytes(wallet.signingKey.publicKey);
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    throw new Error('Wallet 공개 키를 secp256k1 JWK로 변환할 수 없습니다.');
  }
  return {
    kty: 'EC',
    crv: 'secp256k1',
    x: base64url(publicKey.slice(1, 33)),
    y: base64url(publicKey.slice(33, 65)),
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body?.error_description ?? body?.detail ?? body?.error ?? `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return body as T;
}

async function verifyIssuedCredential(
  credential: string,
  issuer: string,
  wallet: ethers.Wallet,
  jwksUri: string,
): Promise<Record<string, any>> {
  const [encodedHeader, encodedPayload, encodedSignature] = credential.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('발급된 Credential JWT 형식이 올바르지 않습니다.');
  }

  const header = JSON.parse(ethers.toUtf8String(decodeBase64url(encodedHeader)));
  const payload = decodeJwtPayload(credential);
  if (header.alg !== 'ES256K' || header.typ !== 'JWT') {
    throw new Error('지원하지 않는 Credential JWT 서명 형식입니다.');
  }
  if (payload.iss !== issuer || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Credential 발급자 또는 만료 시간이 올바르지 않습니다.');
  }

  const holderJwk = walletPublicJwk(wallet);
  const credentialJwk = payload.cnf?.jwk;
  if (
    !credentialJwk ||
    credentialJwk.kty !== holderJwk.kty ||
    credentialJwk.crv !== holderJwk.crv ||
    credentialJwk.x !== holderJwk.x ||
    credentialJwk.y !== holderJwk.y
  ) {
    throw new Error('Credential이 현재 Wallet 키에 바인딩되지 않았습니다.');
  }

  if (!header.kid || typeof header.kid !== 'string') {
    throw new Error('Credential JWT에 발급자 key id가 없습니다.');
  }
  const jwks = await responseJson<JsonWebKeySet>(await fetch(jwksUri));
  const issuerJwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (
    !issuerJwk || issuerJwk.kty !== 'EC' || issuerJwk.crv !== 'secp256k1' ||
    issuerJwk.alg !== 'ES256K' || !issuerJwk.x || !issuerJwk.y
  ) {
    throw new Error('JWKS에서 Credential 발급자의 ES256K 공개키를 찾지 못했습니다.');
  }
  const publicKey = ethers.concat([
    new Uint8Array([4]),
    decodeBase64url(issuerJwk.x),
    decodeBase64url(issuerJwk.y),
  ]);
  const digest = ethers.getBytes(
    ethers.sha256(ethers.toUtf8Bytes(`${encodedHeader}.${encodedPayload}`)),
  );
  const valid = secp256k1.verify(
    decodeBase64url(encodedSignature),
    digest,
    ethers.getBytes(publicKey),
  );
  if (!valid) throw new Error('Credential Issuer 서명 검증에 실패했습니다.');
  return payload;
}

export async function verifyAndStoreCredential(
  credential: string,
  issuer: string,
  wallet: ethers.Wallet,
  jwksUri: string,
  credentialConfigurationId: string,
): Promise<StoredCredential> {
  const payload = await verifyIssuedCredential(credential, issuer, wallet, jwksUri);
  const stored: StoredCredential = {
    id: String(payload.jti),
    issuer,
    credentialConfigurationId,
    credential,
    subject: String(payload.sub),
    issuedAt: Number(payload.iat),
    expiresAt: Number(payload.exp),
    storedAt: new Date().toISOString(),
  };
  const existing = await loadCredentials();
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      stored,
      ...existing.filter((item) => (
        item.id !== stored.id && !isSameCredentialScope(item, stored)
      )),
    ]),
  );
  return stored;
}

export async function loadCredentials(): Promise<StoredCredential[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const deduplicated = deduplicateCredentials(parsed);
    if (deduplicated.length !== parsed.length) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(deduplicated));
    }
    return deduplicated;
  } catch {
    return [];
  }
}

export async function removeCredential(id: string): Promise<void> {
  const credentials = await loadCredentials();
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(credentials.filter((item) => item.id !== id)),
  );
}

export async function hasLocalEncryptedWallet(): Promise<boolean> {
  return (await AsyncStorage.getItem(LOCAL_WALLET_KEY)) !== null;
}

export async function createLocalEncryptedWallet(
  password: string,
  onProgress?: (progress: number) => void,
): Promise<ethers.Wallet> {
  if (password.length < 8) throw new Error('Wallet 비밀번호는 8자 이상이어야 합니다.');
  const wallet = new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32)));
  const encrypted = __DEV__
    ? await ethers.encryptKeystoreJson(
      { address: wallet.address, privateKey: wallet.privateKey },
      password,
      { progressCallback: onProgress, scrypt: { N: 1 << 14 } },
    )
    : await wallet.encrypt(password, onProgress);
  await AsyncStorage.setItem(LOCAL_WALLET_KEY, encrypted);
  return wallet;
}

export async function unlockLocalEncryptedWallet(
  password: string,
  onProgress?: (progress: number) => void,
): Promise<ethers.Wallet> {
  const encrypted = await AsyncStorage.getItem(LOCAL_WALLET_KEY);
  if (!encrypted) throw new Error('이 기기에 저장된 로컬 Wallet이 없습니다.');
  return ethers.Wallet.fromEncryptedJson(encrypted, password, onProgress) as Promise<ethers.Wallet>;
}

export async function resetLocalWallet(): Promise<void> {
  await AsyncStorage.multiRemove([LOCAL_WALLET_KEY, STORAGE_KEY]);
}
