import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-get-random-values';
import 'react-native-reanimated';
import { WalletProvider } from '@/context/WalletContext';
import { BookingDraftProvider } from '@/context/BookingDraftContext';

export default function RootLayout() {
  return (
    <WalletProvider>
      <BookingDraftProvider>
        <ThemeProvider value={DarkTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="mypage" />
            <Stack.Screen name="qr/[tokenId]" />
          </Stack>
          <StatusBar style="light" />
        </ThemeProvider>
      </BookingDraftProvider>
    </WalletProvider>
  );
}