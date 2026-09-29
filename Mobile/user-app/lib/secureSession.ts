import * as SecureStore from 'expo-secure-store';
import { ethers } from 'ethers';

import { loadCredentials } from '@/lib/oid4vci';

const SECURE_SESSION_KEY = 'ticketpro.mobile.secure-session.v1';
const MOBILE_CREDENTIAL_CONFIGURATION_ID = 'TicketProMobileCredential';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type StoredSecureSession = {
  version: 1;
  privateKey: string;
  signerAddress: string;
  accountWalletAddress: string;
  accessToken: string;
};

export type RestoredSecureSession = {
  wallet: ethers.Wallet;
  accountWalletAddress: string;
  accessToken: string;
};

async function hasActiveMobileCredential(walletAddress: string): Promise<boolean> {
  const expectedSubject = `did:pknu:${walletAddress}`.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const credentials = await loadCredentials();
  return credentials.some((credential) => (
    credential.credentialConfigurationId === MOBILE_CREDENTIAL_CONFIGURATION_ID
    && credential.subject.toLowerCase() === expectedSubject
    && credential.expiresAt > now
  ));
}

export async function saveSecureSession(
  wallet: ethers.Wallet,
  accessToken: string,
  accountWalletAddress: string,
): Promise<boolean> {
  if (!await SecureStore.isAvailableAsync()) return false;
  if (!accessToken || !ethers.isAddress(accountWalletAddress)) return false;
  if (!await hasActiveMobileCredential(wallet.address)) return false;

  const session: StoredSecureSession = {
    version: 1,
    privateKey: wallet.privateKey,
    signerAddress: wallet.address,
    accountWalletAddress: ethers.getAddress(accountWalletAddress),
    accessToken,
  };
  await SecureStore.setItemAsync(
    SECURE_SESSION_KEY,
    JSON.stringify(session),
    SECURE_STORE_OPTIONS,
  );
  return true;
}

export async function loadSecureSession(): Promise<RestoredSecureSession | null> {
  if (!await SecureStore.isAvailableAsync()) return null;
  const raw = await SecureStore.getItemAsync(SECURE_SESSION_KEY, SECURE_STORE_OPTIONS);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSecureSession>;
    if (
      parsed.version !== 1
      || typeof parsed.privateKey !== 'string'
      || typeof parsed.signerAddress !== 'string'
      || typeof parsed.accountWalletAddress !== 'string'
      || typeof parsed.accessToken !== 'string'
      || !parsed.accessToken
      || !ethers.isAddress(parsed.signerAddress)
      || !ethers.isAddress(parsed.accountWalletAddress)
    ) {
      throw new Error('저장된 자동 로그인 정보 형식이 올바르지 않습니다.');
    }

    const wallet = new ethers.Wallet(parsed.privateKey);
    if (wallet.address.toLowerCase() !== parsed.signerAddress.toLowerCase()) {
      throw new Error('저장된 Wallet 키와 주소가 일치하지 않습니다.');
    }
    if (!await hasActiveMobileCredential(wallet.address)) {
      throw new Error('사용 가능한 모바일 학생 인증서가 없습니다.');
    }
    return {
      wallet,
      accountWalletAddress: ethers.getAddress(parsed.accountWalletAddress),
      accessToken: parsed.accessToken,
    };
  } catch {
    await clearSecureSession();
    return null;
  }
}

export async function clearSecureSession(): Promise<void> {
  if (!await SecureStore.isAvailableAsync()) return;
  await SecureStore.deleteItemAsync(SECURE_SESSION_KEY, SECURE_STORE_OPTIONS);
}
