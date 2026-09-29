import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import 'react-native-get-random-values';
import 'react-native-reanimated';
import { useWallet, WalletProvider } from '@/context/WalletContext';

function AppNavigator() {
  const { isRestoring } = useWallet();

  if (isRestoring) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#E11D48" />
        <Text style={styles.loadingText}>안전한 로그인 정보를 확인하고 있습니다…</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="mypage" />
        <Stack.Screen name="credential-wallet" />
        <Stack.Screen name="qr/[tokenId]" />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <WalletProvider>
      <AppNavigator />
    </WalletProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 13,
  },
});
