import { ethers } from 'ethers';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { authenticateWallet, verifySessionAccount, WalletRequestError } from '@/lib/auth';
import { synchronizeCredential } from '@/lib/credentialSync';
import { installSessionTransport } from '@/lib/sessionTransport';
import {
  clearSecureSession,
  loadSecureSession,
  saveSecureSession,
} from '@/lib/secureSession';

type WalletContextType = {
  address: string | null;
  wallet: ethers.Wallet | null;
  accessToken: string | null;
  signerAddress: string | null;
  isLinkedAccount: boolean;
  isRestoring: boolean;
  storageError: string | null;
  setSession: (
    wallet: ethers.Wallet | null,
    accessToken: string | null,
    accountAddress?: string,
  ) => Promise<boolean>;
  logout: () => Promise<void>;
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWalletState] = useState<ethers.Wallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const sessionRef = useRef({ wallet, address, accessToken });
  sessionRef.current = { wallet, address, accessToken };
  const renewInFlight = useRef<Promise<string> | null>(null);
  const setSessionRef = useRef<WalletContextType['setSession'] | null>(null);
  const sessionGeneration = useRef(0);
  const logoutGeneration = useRef(0);
  const restoreController = useRef<AbortController | null>(null);
  const sessionStorageQueue = useRef<Promise<void>>(Promise.resolve());

  const updateSessionStorage = useCallback((operation: () => Promise<boolean>) => {
    const pending = sessionStorageQueue.current.then(operation);
    sessionStorageQueue.current = pending.then(() => {}, () => {});
    return pending;
  }, []);

  useEffect(() => {
    if (sessionGeneration.current !== 0) {
      setIsRestoring(false);
      return;
    }
    const controller = new AbortController();
    restoreController.current = controller;
    setIsRestoring(true);
    const generation = sessionGeneration.current;
    let active = true;
    const isCurrent = () => active && !controller.signal.aborted && generation === sessionGeneration.current;
    const timer = setTimeout(() => {
      controller.abort();
      if (active && generation === sessionGeneration.current) setIsRestoring(false);
    }, 15000);

    const restore = async () => {
      try {
        const saved = await loadSecureSession();
        if (!saved || !isCurrent()) return;

        let token = saved.accessToken;
        let accountWalletAddress = saved.accountWalletAddress;
        try {
          await verifySessionAccount(token, accountWalletAddress, controller.signal);
          await synchronizeCredential(saved.wallet, token, controller.signal);
        } catch (error) {
          if (!isCurrent()) return;
          if (!(error instanceof WalletRequestError) || error.reason !== 'http' || error.status !== 401) throw error;
          const refreshed = await authenticateWallet(saved.wallet, controller.signal);
          if (!isCurrent()) return;
          token = refreshed.accessToken;
          accountWalletAddress = refreshed.accountWalletAddress;
          await updateSessionStorage(async () => {
            if (!isCurrent()) return false;
            return saveSecureSession(saved.wallet, token, accountWalletAddress);
          });
        }

        if (!isCurrent()) return;
        setWalletState(saved.wallet);
        setAddress(accountWalletAddress);
        setAccessToken(token);
      } catch (error) {
        // 네트워크가 일시적으로 끊긴 경우에도 저장된 키를 지우지 않고 다음 실행에서 재시도한다.
        if (active && generation === sessionGeneration.current) {
          console.warn('자동 로그인 세션을 복구하지 못했습니다.', error);
        }
      } finally {
        clearTimeout(timer);
        if (restoreController.current === controller) restoreController.current = null;
        if (active && generation === sessionGeneration.current) setIsRestoring(false);
      }
    };

    void restore();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      if (restoreController.current === controller) restoreController.current = null;
    };
  }, [updateSessionStorage]);

  const setSession = async (
    newWallet: ethers.Wallet | null,
    newToken: string | null,
    accountAddress?: string,
  ): Promise<boolean> => {
    if (sessionRef.current.wallet?.address !== newWallet?.address || sessionRef.current.address !== (accountAddress ?? newWallet?.address ?? null)) logoutGeneration.current++;
    const generation = ++sessionGeneration.current;
    restoreController.current?.abort();
    restoreController.current = null;
    setIsRestoring(false);
    setStorageError(null);
    sessionRef.current = { wallet: newWallet, address: accountAddress ?? newWallet?.address ?? null, accessToken: newToken };
    setWalletState(newWallet);
    setAddress(accountAddress ?? newWallet?.address ?? null);
    setAccessToken(newToken);
    if (newWallet && newToken && accountAddress) {
      try {
        const saved = await updateSessionStorage(async () => {
          if (generation !== sessionGeneration.current) return false;
          return saveSecureSession(newWallet, newToken, accountAddress);
        });
        return generation === sessionGeneration.current && saved;
      } catch (error) {
        console.warn('자동 로그인 정보를 저장하지 못했습니다.', error);
        setStorageError(error instanceof Error ? error.message : '보안 저장소에 로그인 정보를 저장하지 못했습니다.');
      }
    }
    return false;
  };

  const logout = async () => {
    logoutGeneration.current++;
    const generation = ++sessionGeneration.current;
    restoreController.current?.abort();
    restoreController.current = null;
    setIsRestoring(false);
    sessionRef.current = { wallet: null, address: null, accessToken: null };
    renewInFlight.current = null;
    setWalletState(null);
    setAddress(null);
    setAccessToken(null);
    try {
      await updateSessionStorage(async () => {
        if (generation !== sessionGeneration.current) return false;
        await clearSecureSession();
        return true;
      });
    } catch (error) {
      console.warn('자동 로그인 정보를 삭제하지 못했습니다.', error);
    }
  };

  setSessionRef.current = setSession;
  useEffect(() => installSessionTransport({
    token: () => sessionRef.current.accessToken,
    epoch: () => logoutGeneration.current,
    renew: () => {
      if (renewInFlight.current) return renewInFlight.current;
      const before = sessionRef.current;
      const generation = sessionGeneration.current;
      if (!before.wallet || !before.address || !before.accessToken) return Promise.reject(new Error('다시 로그인해주세요.'));
      const signingWallet = before.wallet;
      const pending = (async () => {
        const refreshed = await authenticateWallet(signingWallet);
        if (generation !== sessionGeneration.current || refreshed.accountWalletAddress.toLowerCase() !== before.address!.toLowerCase()) {
          throw new Error('로그인 상태가 변경되었습니다. 다시 로그인해주세요.');
        }
        await setSessionRef.current!(signingWallet, refreshed.accessToken, refreshed.accountWalletAddress);
        if (sessionRef.current.accessToken !== refreshed.accessToken) throw new Error('로그인 상태가 변경되었습니다.');
        return refreshed.accessToken;
      })();
      renewInFlight.current = pending;
      void pending.finally(() => { if (renewInFlight.current === pending) renewInFlight.current = null; }).catch(() => {});
      return pending;
    },
  }), []);

  const signerAddress = wallet?.address ?? null;
  const isLinkedAccount = Boolean(wallet && address && accessToken);

  return (
    <WalletContext.Provider value={{
      address,
      wallet,
      accessToken,
      signerAddress,
      isLinkedAccount,
      isRestoring,
      storageError,
      setSession,
      logout,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet은 WalletProvider 안에서만 사용할 수 있어요');
  return context;
}
