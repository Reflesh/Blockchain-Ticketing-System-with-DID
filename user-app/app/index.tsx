import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '@/context/WalletContext';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORIES, MOCK_CONCERTS, type Concert } from '@/constants/concerts';

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_WIDTH = SCREEN_W * 0.76;
const CARD_W = SCREEN_W - 48;
const CARD_GAP = 12;

// ─── Small card (section list) ───────────────────────────
function SmallCard({ item }: { item: Concert }) {
  return (
    <TouchableOpacity
      style={s.smallCard}
      activeOpacity={0.85}
      onPress={() =>
        router.push({
          pathname: '/concert/[concertId]',
          params: { concertId: item.id },
        })
      }
    >
      <View style={[s.smallPoster, { backgroundColor: item.posterColor }]}>
        <Text style={[s.smallBgLetter, { color: item.accentColor }]}>
          {item.title[0]}
        </Text>
        <View
          style={[
            s.smallGenreBadge,
            { backgroundColor: item.accentColor + '28' },
          ]}
        >
          <Text style={[s.smallGenreText, { color: item.accentColor }]}>
            {item.genre}
          </Text>
        </View>
      </View>
      <Text style={s.smallTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={s.smallArtist} numberOfLines={1}>
        {item.artist}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Home screen ─────────────────────────────────────────
export default function HomeScreen() {
  const { address, logout } = useWallet();
  const shortAddr = address
    ? `${address.slice(0, 6)}···${address.slice(-4)}`
    : null;

  const drawerX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('전체');
  const [carouselIndex, setCarouselIndex] = useState(0);
  const carouselRef = useRef<FlatList>(null);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.spring(drawerX, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [drawerX, backdropOpacity]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.spring(drawerX, {
        toValue: -DRAWER_WIDTH,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setDrawerOpen(false));
  }, [drawerX, backdropOpacity]);

  // Swipe-from-left-edge gesture
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy, moveX }) =>
        moveX < 36 && dx > 10 && Math.abs(dx) > Math.abs(dy),
      onPanResponderGrant: () => setDrawerOpen(true),
      onPanResponderMove: (_, { dx }) => {
        const x = Math.min(0, Math.max(-DRAWER_WIDTH, -DRAWER_WIDTH + dx));
        drawerX.setValue(x);
        backdropOpacity.setValue(1 + x / DRAWER_WIDTH);
      },
      onPanResponderRelease: (_, { dx, vx }) => {
        if (dx > DRAWER_WIDTH / 3 || vx > 0.5) openDrawer();
        else closeDrawer();
      },
    })
  ).current;

  // Auto-scroll carousel every 3.5 s
  useEffect(() => {
    const iv = setInterval(() => {
      setCarouselIndex((prev) => {
        const next = (prev + 1) % MOCK_CONCERTS.length;
        try {
          carouselRef.current?.scrollToIndex({ index: next, animated: true });
        } catch {}
        return next;
      });
    }, 3500);
    return () => clearInterval(iv);
  }, []);

  const filtered =
    activeCategory === '전체'
      ? MOCK_CONCERTS
      : MOCK_CONCERTS.filter((c) => c.genre === activeCategory);

  return (
    <View style={s.root} {...panResponder.panHandlers}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={openDrawer} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="menu" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.brand}>TicketPro</Text>
          <TouchableOpacity style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="search-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* ── Carousel ── */}
          <View style={{ marginTop: 14 }}>
            <FlatList
              ref={carouselRef}
              data={MOCK_CONCERTS}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={CARD_W + CARD_GAP}
              decelerationRate="fast"
              contentContainerStyle={{ paddingHorizontal: 24 }}
              ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
              keyExtractor={(item) => item.id}
              getItemLayout={(_, i) => ({
                length: CARD_W + CARD_GAP,
                offset: (CARD_W + CARD_GAP) * i,
                index: i,
              })}
              onMomentumScrollEnd={(e) => {
                const i = Math.round(
                  e.nativeEvent.contentOffset.x / (CARD_W + CARD_GAP)
                );
                setCarouselIndex(
                  Math.max(0, Math.min(i, MOCK_CONCERTS.length - 1))
                );
              }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.carouselCard, { width: CARD_W }]}
                  activeOpacity={0.92}
                  onPress={() =>
                    router.push({
                      pathname: '/concert/[concertId]',
                      params: { concertId: item.id },
                    })
                  }
                >
                  {/* Poster */}
                  <View
                    style={[
                      s.carouselPoster,
                      { backgroundColor: item.posterColor },
                    ]}
                  >
                    <View
                      style={[
                        s.carouselGlow,
                        { backgroundColor: item.accentColor + '22' },
                      ]}
                    />
                    <Text
                      style={[
                        s.carouselBgLetter,
                        { color: item.accentColor + '18' },
                      ]}
                    >
                      {item.title[0]}
                    </Text>
                    <View style={s.carouselOverlay}>
                      <View
                        style={[
                          s.genreBadge,
                          {
                            backgroundColor: item.accentColor + '28',
                            borderColor: item.accentColor + '55',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            s.genreBadgeText,
                            { color: item.accentColor },
                          ]}
                        >
                          {item.genre}
                        </Text>
                      </View>
                      <Text style={s.carouselTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={s.carouselArtist}>{item.artist}</Text>
                    </View>
                  </View>
                  {/* Bottom info */}
                  <View style={s.carouselBottom}>
                    <View style={s.carouselInfoRow}>
                      <Ionicons
                        name="location-outline"
                        size={11}
                        color="#6B7280"
                      />
                      <Text style={s.carouselInfoText}>{item.venue}</Text>
                    </View>
                    <View style={s.carouselInfoRow}>
                      <Ionicons
                        name="calendar-outline"
                        size={11}
                        color="#6B7280"
                      />
                      <Text style={s.carouselInfoText}>{item.period}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            />
            {/* Indicator dots */}
            <View style={s.dots}>
              {MOCK_CONCERTS.map((_, i) => (
                <View
                  key={i}
                  style={[s.dot, i === carouselIndex && s.dotActive]}
                />
              ))}
            </View>
          </View>

          {/* ── Category chips ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.catRow}
          >
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  s.catChip,
                  activeCategory === cat && s.catChipActive,
                ]}
                onPress={() => setActiveCategory(cat)}
              >
                <Text
                  style={[
                    s.catChipText,
                    activeCategory === cat && s.catChipTextActive,
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── 지금 주목받는 공연 ── */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>지금 주목받는 공연</Text>
              <TouchableOpacity>
                <Text style={s.sectionMore}>전체보기</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.smallRow}
            >
              {filtered.map((item) => (
                <SmallCard key={item.id} item={item} />
              ))}
            </ScrollView>
          </View>

          {/* ── 이번 주 인기 ── */}
          <View style={[s.section, { marginBottom: 48 }]}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>이번 주 인기</Text>
              <TouchableOpacity>
                <Text style={s.sectionMore}>전체보기</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.smallRow}
            >
              {[...MOCK_CONCERTS]
                .reverse()
                .slice(0, 5)
                .map((item) => (
                  <SmallCard key={item.id + '_r'} item={item} />
                ))}
            </ScrollView>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* ── Backdrop ── */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'rgba(0,0,0,0.55)', opacity: backdropOpacity },
        ]}
        pointerEvents={drawerOpen ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={closeDrawer}
        />
      </Animated.View>

      {/* ── Drawer panel ── */}
      <Animated.View
        style={[s.drawer, { transform: [{ translateX: drawerX }] }]}
        pointerEvents={drawerOpen ? 'auto' : 'none'}
      >
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left']}>
          {/* Login / Profile section */}
          {address ? (
            <View style={s.drawerLogin}>
              <View style={[s.drawerAvatar, { backgroundColor: 'rgba(225,29,72,0.15)', borderColor: 'rgba(225,29,72,0.3)' }]}>
                <Ionicons name="wallet-outline" size={20} color="#E11D48" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.drawerLoginTitle}>이재훈</Text>{/* TODO: API에서 이름 받아오기 */}
                <Text style={[s.drawerLoginSub, { color: '#6B7280' }]}>{shortAddr}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  logout();
                  closeDrawer();
                  Alert.alert('로그아웃', '로그아웃되었습니다.');
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="log-out-outline" size={20} color="#374151" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={s.drawerLogin}
              activeOpacity={0.8}
              onPress={() => {
                closeDrawer();
                setTimeout(() => router.push('/login'), 280);
              }}
            >
              <View style={s.drawerAvatar}>
                <Ionicons name="person-outline" size={22} color="#6B7280" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.drawerLoginTitle}>로그인 해주세요</Text>
                <Text style={s.drawerLoginSub}>지갑으로 로그인 →</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#374151" />
            </TouchableOpacity>
          )}

          <View style={s.drawerSep} />

          {/* 마이페이지 */}
          <TouchableOpacity
            style={s.drawerMenuItem}
            onPress={() => {
              closeDrawer();
              setTimeout(() => {
                if (address) router.push('/mypage');
                else router.push('/login');
              }, 280);
            }}
          >
            <Ionicons name="ticket-outline" size={18} color="#6B7280" />
            <Text style={s.drawerMenuText}>마이페이지</Text>
          </TouchableOpacity>

          <View style={s.drawerSep} />

          {/* Categories */}
          <Text style={s.drawerCatLabel}>카테고리</Text>
          {CATEGORIES.filter((c) => c !== '전체').map((cat) => (
            <TouchableOpacity
              key={cat}
              style={s.drawerCatItem}
              onPress={() => {
                setActiveCategory(cat);
                closeDrawer();
              }}
            >
              <Text style={s.drawerCatText}>{cat}</Text>
              <Ionicons name="chevron-forward" size={13} color="#374151" />
            </TouchableOpacity>
          ))}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A14' },
  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  iconBtn: { padding: 4 },
  brand: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  /* Carousel card */
  carouselCard: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#13131F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  carouselPoster: {
    height: 210,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  carouselGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  carouselBgLetter: {
    position: 'absolute',
    top: -24,
    right: -8,
    fontSize: 190,
    fontWeight: '900',
    lineHeight: 210,
  },
  carouselOverlay: { padding: 18, gap: 5 },
  genreBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 2,
  },
  genreBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  carouselTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 28,
  },
  carouselArtist: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  carouselBottom: { backgroundColor: '#13131F', padding: 14, gap: 6 },
  carouselInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  carouselInfoText: { fontSize: 12, color: '#6B7280' },
  /* Dots */
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 12,
    marginBottom: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dotActive: { width: 18, backgroundColor: '#E11D48', borderRadius: 2.5 },
  /* Categories */
  catRow: { paddingHorizontal: 20, paddingVertical: 16, gap: 8 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  catChipActive: { backgroundColor: '#E11D48', borderColor: '#E11D48' },
  catChipText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  catChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  /* Sections */
  section: { marginTop: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  sectionMore: { fontSize: 12, color: '#374151' },
  smallRow: { paddingHorizontal: 20, gap: 12 },
  /* Small cards */
  smallCard: { width: 130 },
  smallPoster: {
    width: 130,
    height: 168,
    borderRadius: 14,
    justifyContent: 'space-between',
    padding: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  smallBgLetter: {
    position: 'absolute',
    bottom: -10,
    right: 2,
    fontSize: 80,
    fontWeight: '900',
    opacity: 0.2,
    lineHeight: 90,
  },
  smallGenreBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  smallGenreText: { fontSize: 10, fontWeight: '700' },
  smallTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 18,
  },
  smallArtist: { fontSize: 11, color: '#4B5563', marginTop: 2 },
  /* Drawer */
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#0F0F1E',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 24,
  },
  drawerLogin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    paddingVertical: 22,
  },
  drawerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  drawerLoginTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  drawerLoginSub: { fontSize: 12, color: '#E11D48', marginTop: 3 },
  drawerSep: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 16,
  },
  drawerMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  drawerMenuText: { fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  drawerCatLabel: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  drawerCatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  drawerCatText: { fontSize: 14, color: '#D1D5DB', fontWeight: '500' },
});
