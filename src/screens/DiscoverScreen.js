import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomTabBar from '../components/ui/BottomTabBar';
import { colors, radius, spacing } from '../styles/theme';

const FILTERS = ['For You', 'Trending', 'Animated', 'Funny'];
const DISCOVER_COLUMNS = 2;
const ACTIVE_ROWS = 2;

const DiscoverScreen = ({
  packs,
  loading,
  loadingMore,
  hasMore,
  error,
  onLoadMore,
  onNavigate,
  activeTab,
  onTabChange,
}) => {
  const safePacks = Array.isArray(packs) ? packs : [];
  const trendingPack = safePacks[0] || null;
  const sidePack = safePacks[1] || null;
  const animatedPack = safePacks.find(pack => pack?.isAnimated) || null;
  const totalRows = Math.ceil(safePacks.length / DISCOVER_COLUMNS);
  const [activeRowStart, setActiveRowStart] = useState(0);
  const [failedPausedKeys, setFailedPausedKeys] = useState(() => new Set());
  const lastActiveRowRef = useRef(0);
  const scrollIdleTimerRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const maxScrollRef = useRef(1);
  const gridTopRef = useRef(0);
  const viewportHeightRef = useRef(1);

  const getPackStaticPreview = useCallback((pack) => {
    const candidate = pack?.previewImageUri || pack?.previewUri || null;
    const animatedUri = pack?.animatedPreviewUri || null;
    if (!candidate) return null;
    if (pack?.isAnimated && animatedUri && candidate === animatedUri) return null;
    return candidate;
  }, []);

  const applyActiveRowFromOffset = useCallback((offsetY) => {
    const maxRow = Math.max(0, totalRows - ACTIVE_ROWS);
    if (maxRow <= 0) {
      if (lastActiveRowRef.current !== 0) {
        lastActiveRowRef.current = 0;
        setActiveRowStart(0);
      }
      return;
    }

    const maxScroll = Math.max(1, maxScrollRef.current);
    const viewportHeight = Math.max(1, viewportHeightRef.current);
    const gridStart = Math.max(0, gridTopRef.current - (viewportHeight * 0.35));
    const gridOffset = Math.max(0, offsetY - gridStart);
    const maxGridScroll = Math.max(1, maxScroll - gridStart);
    const progress = Math.max(0, Math.min(1, gridOffset / maxGridScroll));

    let nextRow = Math.round(progress * maxRow);
    if (offsetY <= 2) nextRow = 0;
    if (offsetY >= maxScroll - 2) nextRow = maxRow;
    if (nextRow === lastActiveRowRef.current) return;

    lastActiveRowRef.current = nextRow;
    setActiveRowStart(nextRow);
  }, [totalRows]);

  const handleGridScroll = useCallback((event) => {
    const offsetY = event?.nativeEvent?.contentOffset?.y ?? 0;
    const contentHeight = event?.nativeEvent?.contentSize?.height ?? 0;
    const viewportHeight = event?.nativeEvent?.layoutMeasurement?.height ?? 0;
    maxScrollRef.current = Math.max(1, contentHeight - viewportHeight);
    viewportHeightRef.current = Math.max(1, viewportHeight);
    scrollOffsetRef.current = offsetY;
    applyActiveRowFromOffset(offsetY);
  }, [applyActiveRowFromOffset]);

  const markScrolling = useCallback(() => {
    if (scrollIdleTimerRef.current) {
      clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
    }
  }, []);

  const markScrollIdle = useCallback(() => {
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      applyActiveRowFromOffset(scrollOffsetRef.current);
      scrollIdleTimerRef.current = null;
    }, 120);
  }, [applyActiveRowFromOffset]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
  }, []);

  useEffect(() => {
    setFailedPausedKeys(new Set());
  }, [safePacks.length]);

  const markPausedFailed = useCallback((packId, uri) => {
    if (!packId || !uri) return;
    const key = `${packId}|${uri}`;
    setFailedPausedKeys(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        removeClippedSubviews
        onScroll={handleGridScroll}
        onScrollBeginDrag={markScrolling}
        onMomentumScrollBegin={markScrolling}
        onScrollEndDrag={markScrollIdle}
        onMomentumScrollEnd={markScrollIdle}
        scrollEventThrottle={32}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon} />
          <Text style={styles.title}>Discover Stickers</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <View style={styles.searchIcon} />
            <Text style={styles.searchText}>Search sticker packs...</Text>
          </View>
          <View style={styles.filterButton} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {FILTERS.map((filter, index) => (
            <View
              key={filter}
              style={[styles.filterChip, index === 0 && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, index === 0 && styles.filterTextActive]}>
                {filter}
              </Text>
            </View>
          ))}
        </ScrollView>

        {loading ? (
          <Text style={styles.statusText}>Loading discover packs...</Text>
        ) : null}

        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}

        {!loading && safePacks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No discover packs found</Text>
            <Text style={styles.emptyMeta}>Add rows in Supabase tables and reopen Discover.</Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Trending Now</Text>
          <Text style={styles.sectionAction}>See all</Text>
        </View>

        <View style={styles.trendingRow}>
          {trendingPack ? (
            <Pressable
              style={styles.trendingCard}
              onPress={() => onNavigate?.('PackDetails', { pack: trendingPack })}
            >
              <View style={styles.trendingGrid}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <View key={`trend-${trendingPack.id}-${index}`} style={styles.trendingSticker}>
                    {getPackStaticPreview(trendingPack) ? (
                      <Image
                        source={{ uri: getPackStaticPreview(trendingPack) }}
                        style={styles.trendingStickerImage}
                        resizeMode="cover"
                        fadeDuration={0}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
              <Text style={styles.trendingTitle}>{trendingPack.title}</Text>
              <Text style={styles.trendingMeta}>
                {trendingPack.count} Stickers
              </Text>
              <View style={styles.trendingFab}>
                <Text style={styles.trendingFabText}>+</Text>
              </View>
            </Pressable>
          ) : (
            <View style={styles.trendingCard} />
          )}

          <View style={styles.trendingSide}>
            {sidePack ? (
              <Pressable
                style={styles.trendingSideCard}
                onPress={() => onNavigate?.('PackDetails', { pack: sidePack })}
              >
                {getPackStaticPreview(sidePack) ? (
                  <Image
                    source={{ uri: getPackStaticPreview(sidePack) }}
                    style={styles.trendingSideImage}
                    resizeMode="cover"
                    fadeDuration={0}
                  />
                ) : null}
              </Pressable>
            ) : (
              <View style={styles.trendingSideCard} />
            )}
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Animated Packs</Text>
          <Text style={styles.sectionAction}>Explore</Text>
        </View>

        <View style={styles.animatedCard}>
          <View style={styles.animatedIcon}>
            {getPackStaticPreview(animatedPack) ? (
              <Image
                source={{ uri: getPackStaticPreview(animatedPack) }}
                style={styles.animatedIconImage}
                resizeMode="cover"
                fadeDuration={0}
              />
            ) : null}
          </View>
          <View style={styles.animatedInfo}>
            <Text style={styles.animatedTitle}>{animatedPack?.title || 'No animated pack yet'}</Text>
            <Text style={styles.animatedSub}>
              {animatedPack?.author ? `By ${animatedPack.author}` : 'Add animated rows in Supabase'}
            </Text>
            <Text style={styles.animatedLive}>{animatedPack ? 'Live Preview' : 'Waiting for data'}</Text>
          </View>
          <Pressable
            style={styles.animatedButton}
            onPress={() => {
              if (animatedPack) onNavigate?.('PackDetails', { pack: animatedPack });
            }}
          >
            <Text style={styles.animatedButtonText}>Get Pack</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>All Discover Packs</Text>
          <Text style={styles.sectionAction}>{safePacks.length} loaded</Text>
        </View>

        <View
          style={styles.funRow}
          onLayout={event => {
            gridTopRef.current = event?.nativeEvent?.layout?.y ?? 0;
          }}
        >
          {safePacks.map((pack, index) => (
            (() => {
              const packId = pack?.id || `discover-pack-${index}`;
              const rowIndex = Math.floor(index / DISCOVER_COLUMNS);
              const inRenderWindow = rowIndex >= Math.max(0, activeRowStart - 1)
                && rowIndex < activeRowStart + ACTIVE_ROWS + 1;
              const staticPreview = getPackStaticPreview(pack);
              const pausedUri = staticPreview && !failedPausedKeys.has(`${packId}|${staticPreview}`)
                ? staticPreview
                : null;

              return (
                <Pressable
                  key={packId}
                  style={[styles.funCard, index % 2 === 0 ? styles.funCardLeft : styles.funCardRight]}
                  onPress={() => onNavigate?.('PackDetails', { pack })}
                >
                  <View style={styles.funIcon}>
                    {!inRenderWindow ? (
                      <View style={styles.fallbackTile}>
                        <View style={styles.fallbackDot} />
                      </View>
                    ) : pausedUri ? (
                      <Image
                        source={{ uri: pausedUri }}
                        style={styles.funIconImage}
                        resizeMode="cover"
                        fadeDuration={0}
                        onError={() => markPausedFailed(packId, pausedUri)}
                      />
                    ) : (
                      <View style={styles.fallbackTile}>
                        <View style={styles.fallbackDot} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.funTitle}>{pack.title}</Text>
                  <Text style={styles.funMeta}>{pack.count} Stickers</Text>
                </Pressable>
              );
            })()
          ))}
        </View>

        {!loading && hasMore ? (
          <Pressable
            style={[styles.loadMoreButton, loadingMore && styles.loadMoreButtonDisabled]}
            onPress={onLoadMore}
            disabled={loadingMore}
          >
            <Text style={styles.loadMoreText}>
              {loadingMore ? 'Loading more packs...' : 'Load More Packs'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <BottomTabBar activeTab={activeTab} onTabChange={onTabChange} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(10),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2),
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  title: {
    flex: 1,
    marginLeft: spacing(1.25),
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing(2),
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(1),
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryAccent,
    marginRight: spacing(1),
  },
  searchText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  filterButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    marginLeft: spacing(1),
  },
  filterRow: {
    marginBottom: spacing(2.5),
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing(1),
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    marginBottom: spacing(1),
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing(1.25),
    marginBottom: spacing(2),
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: spacing(0.3),
  },
  emptyMeta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  filterChip: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.7),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: spacing(1),
  },
  filterChipActive: {
    backgroundColor: colors.primaryAccent,
    borderColor: colors.primaryAccent,
  },
  filterText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing(1.5),
  },
  sectionTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionAction: {
    color: colors.primaryAccent,
    fontSize: 12,
  },
  trendingRow: {
    flexDirection: 'row',
    marginBottom: spacing(2.5),
  },
  trendingCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.25),
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: spacing(1),
  },
  trendingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing(1),
  },
  trendingSticker: {
    width: '48%',
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing(0.8),
    overflow: 'hidden',
  },
  trendingStickerImage: {
    width: '100%',
    height: '100%',
  },
  trendingTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  trendingMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing(0.3),
  },
  trendingFab: {
    position: 'absolute',
    right: spacing(1),
    bottom: spacing(1),
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendingFabText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  trendingSide: {
    width: 130,
    marginLeft: spacing(0.5),
  },
  trendingSideCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  trendingSideImage: {
    width: '100%',
    height: '100%',
  },
  animatedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(2.5),
  },
  animatedIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing(1.5),
    overflow: 'hidden',
  },
  animatedIconImage: {
    width: '100%',
    height: '100%',
  },
  animatedInfo: {
    flex: 1,
  },
  animatedTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  animatedSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing(0.3),
  },
  animatedLive: {
    color: colors.primaryAccent,
    fontSize: 11,
    marginTop: spacing(0.3),
  },
  animatedButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.8),
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  animatedButtonText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  funRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  funCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(1.2),
  },
  funCardLeft: {
    marginRight: 0,
  },
  funCardRight: {
    marginRight: 0,
  },
  funIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing(1),
    overflow: 'hidden',
  },
  funIconImage: {
    width: '100%',
    height: '100%',
  },
  funTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  funMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing(0.3),
  },
  loadMoreButton: {
    marginTop: spacing(0.6),
    marginBottom: spacing(1.5),
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing(1),
  },
  loadMoreButtonDisabled: {
    opacity: 0.6,
  },
  loadMoreText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.2,
  },
});

export default DiscoverScreen;
