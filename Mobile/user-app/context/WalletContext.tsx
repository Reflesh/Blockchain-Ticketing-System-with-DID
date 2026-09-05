import { ethers } from 'ethers';
import { createContext, ReactNode, useContext, useState } from 'react';

type WalletContextType = {
  address: string | null;
  wallet: ethers.Wallet | null;
  accessToken: string | null;
  setSession: (wallet: ethers.Wallet | null, accessToken: string | null, mockAddress?: string) => void;
  logout: () => void;
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWalletState] = useState<ethers.Wallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const setSession = (newWallet: ethers.Wallet | null, newToken: string | null, mockAddress?: string) => {
    setWalletState(newWallet);
    setAddress(newWallet ? newWallet.address : mockAddress ?? null);
    setAccessToken(newToken);
  };

  const logout = () => {
    setWalletState(null);
    setAddress(null);
    setAccessToken(null);
  };

  return (
    <WalletContext.Provider value={{ address, wallet, accessToken, setSession, logout }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet은 WalletProvider 안에서만 사용할 수 있어요');
  return context;
}