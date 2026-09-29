import { ethers } from 'ethers';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';

import { authenticateWallet, verifySessionAccount } from '@/lib/auth';
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
  const sessionGeneration = useRef(0);
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    const generation = sessionGeneration.current;
    let active = true;

    const restore = async () => {
      try {
        const saved = await loadSecureSession();
        if (!saved || !active || generation !== sessionGeneration.current) return;

        let token = saved.accessToken;
        let accountWalletAddress = saved.accountWalletAddress;
        try {
          await verifySessionAccount(token, accountWalletAddress);
        } catch {
          const refreshed = await authenticateWallet(saved.wallet);
          token = refreshed.accessToken;
          accountWalletAddress = refreshed.accountWalletAddress;
          await saveSecureSession(saved.wallet, token, accountWalletAddress);
        }

        if (!active || generation !== sessionGeneration.current) return;
        setWalletState(saved.wallet);
        setAddress(accountWalletAddress);
        setAccessToken(token);
      } catch (error) {
        // 네트워크가 일시적으로 끊긴 경우에도 저장된 키를 지우지 않고 다음 실행에서 재시도한다.
        console.warn('자동 로그인 세션을 복구하지 못했습니다.', error);
      } finally {
        if (active) setIsRestoring(false);
      }
    };

    void restore();
    return () => { active = false; };
  }, []);

  const setSession = async (
    newWallet: ethers.Wallet | null,
    newToken: string | null,
    accountAddress?: string,
  ): Promise<boolean> => {
    const generation = ++sessionGeneration.current;
    setWalletState(newWallet);
    setAddress(accountAddress ?? newWallet?.address ?? null);
    setAccessToken(newToken);
    if (newWallet && newToken && accountAddress) {
      try {
        const saved = await saveSecureSession(newWallet, newToken, accountAddress);
        if (generation !== sessionGeneration.current) {
          await clearSecureSession();
          return false;
        }
        return saved;
      } catch (error) {
        console.warn('자동 로그인 정보를 저장하지 못했습니다.', error);
      }
    }
    return false;
  };

  const logout = async () => {
    ++sessionGeneration.current;
    setWalletState(null);
    setAddress(null);
    setAccessToken(null);
    try {
      await clearSecureSession();
    } catch (error) {
      console.warn('자동 로그인 정보를 삭제하지 못했습니다.', error);
    }
  };

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
