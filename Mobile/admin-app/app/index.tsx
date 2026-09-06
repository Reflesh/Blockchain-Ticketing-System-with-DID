import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';

export default function SplashScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => router.replace('/main'), 2200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <TouchableWithoutFeedback
      accessibilityLabel="눌러서 건너뛰기"
      onPress={() => router.replace('/main')}
    >
      <View style={styles.container}>
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.logoWrap}>
            <Text style={styles.logoT}>T</Text>
          </View>
          <Text style={styles.brand}>TicketPro</Text>
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>관리자 전용</Text>
          </View>
          <Text style={styles.tagline}>블록체인 기반 티켓 입장 시스템</Text>
          <Text style={styles.skipHint}>화면을 누르면 바로 이동해요</Text>
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { alignItems: 'center', gap: 12 },
  logoWrap: {
    width: 88, height: 88, borderRadius: 22,
    backgroundColor: '#E11D48',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
  },
  logoT: { fontSize: 42, fontWeight: '800', color: '#FFFFFF' },
  brand: { fontSize: 30, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  adminBadge: {
    backgroundColor: 'rgba(225,29,72,0.15)',
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(225,29,72,0.3)',
  },
  adminBadgeText: { color: '#E11D48', fontSize: 12, fontWeight: '600' },
  tagline: { fontSize: 13, color: '#8E8EA0', marginTop: 4 },
  skipHint: { fontSize: 11, color: '#8E8EA0', marginTop: 18 },
});