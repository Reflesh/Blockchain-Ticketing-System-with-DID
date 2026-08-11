import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export default function SplashScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => router.replace('/login'), 2200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.logoWrap}>
          <Text style={styles.logoT}>T</Text>
        </View>
        <Text style={styles.brand}>TicketPro</Text>
        <Text style={styles.tagline}>블록체인 기반 티켓 입장 시스템</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { alignItems: 'center', gap: 12 },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: '#E11D48',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  logoT: { fontSize: 42, fontWeight: '800', color: '#FFFFFF' },
  brand: { fontSize: 30, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: '#8E8EA0', marginTop: 4 },
});