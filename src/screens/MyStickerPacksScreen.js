import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Image, InteractionManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomTabBar from '../components/ui/BottomTabBar';
import { colors, radius, spacing } from '../styles/theme';
import { createStickerPreview } from '../utils/stickerPreview';

const ACTIVE_ROWS = 1;
const MAX_ACTIVE_ANIMATED_ITEMS = 2;
const ANIMATED_PLAY_SCALE = 0.76;

const MyStickerPacksScreen = ({
  packs,
  onNavigate,
  onOpenPack,
  onCreatePack,
  activeTab,
  onTabChange,
}) => {
  const [activeRowStart, setActiveRowStart] = useState(0);
  const [failedAnimatedIds, setFailedAnimatedIds] = useState(() => new Set());
  const [failedPausedKeys, setFailedPausedKeys] = useState(() => new Set());
  const [generatedPackPreviewUris, setGeneratedPackPreviewUris] = useState(() => ({}));
  const [failedPackPreviewIds, setFailedPackPreviewIds] = useState(() => new Set());
  const lastActiveRowRef = useRef(0);
  const scrollIdleTimerRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const maxScrollRef = useRef(1);
  const gridTopRef = useRef(0);
  const viewportHeightRef = useRef(1);
  const columns = 2;
  const totalRows = Math.ceil((Array.isArray(packs) ? packs.length : 0) / columns);

  const cardWidth = useMemo(() => {
    const width = Dimensions.get('window').width;
    const horizontalPadding = spacing(2);
    const gap = spacing(1.5);
    return (width - horizontalPadding * 2 - gap) / 2;
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
    setFailedAnimatedIds(new Set());
  }, [activeRowStart, packs?.length]);

  useEffect(() => {
    setFailedPausedKeys(new Set());
  }, [packs?.length]);

  useEffect(() => {
    setGeneratedPackPreviewUris({});
    setFailedPackPreviewIds(new Set());
  }, [packs?.length]);

  useEffect(() => {
    if (!Array.isArray(packs) || packs.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const pack of packs) {
        if (cancelled) return;
        const packId = pack?.id;
        if (!packId || !pack?.isAnimated) continue;
        if (pack?.previewImageUri) continue;
        if (generatedPackPreviewUris[packId]) continue;
        if (failedPackPreviewIds.has(packId)) continue;
        const source = pack?.animatedPreviewUri
          || pack?.stickers?.find(item => item?.animated)?.uri
          || pack?.stickers?.find(item => item?.animated)?.originalUri
          || null;
        if (!source) {
          setFailedPackPreviewIds(prev => {
            if (prev.has(packId)) return prev;
            const next = new Set(prev);
            next.add(packId);
            return next;
          });
          continue;
        }
        const previewUri = await createStickerPreview(source, { width: 128, height: 128 });
        if (cancelled) return;
        if (previewUri) {
          setGeneratedPackPreviewUris(prev => (prev[packId] ? prev : { ...prev, [packId]: previewUri }));
        } else {
          setFailedPackPreviewIds(prev => {
            if (prev.has(packId)) return prev;
            const next = new Set(prev);
            next.add(packId);
            return next;
          });
        }
        await new Promise(resolve => setTimeout(resolve, 12));
      }
    };
    const task = InteractionManager.runAfterInteractions(() => {
      run();
    });
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [packs, generatedPackPreviewUris, failedPackPreviewIds]);

  const markAnimatedFailed = useCallback((packId) => {
    if (!packId) return;
    setFailedAnimatedIds(prev => {
      if (prev.has(packId)) return prev;
      const next = new Set(prev);
      next.add(packId);
      return next;
    });
  }, []);

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

  const hasPacks = Array.isArray(packs) && packs.length > 0;

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
          <View style={styles.avatar} />
          <Text style={styles.title}>My Sticker Packs</Text>
          <View style={styles.iconButton} />
        </View>

        <View style={styles.searchBar}>
          <View style={styles.searchIcon} />
          <Text style={styles.searchText}>Search your packs...</Text>
        </View>

        {!hasPacks && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>No packs yet</Text>
            <Text style={styles.emptyText}>Create a new pack and add stickers to see them here.</Text>
            <Pressable style={styles.emptyButton} onPress={() => onCreatePack?.() || onNavigate?.('PackEditor')}>
              <Text style={styles.emptyButtonText}>Create your first pack</Text>
            </Pressable>
          </View>
        )}

        <View
          style={styles.grid}
          onLayout={event => {
            gridTopRef.current = event?.nativeEvent?.layout?.y ?? 0;
          }}
        >
          {(packs || []).map((pack, index) => {
            const rowIndex = Math.floor(index / columns);
            const packId = pack?.id || `pack-${index}`;
            const shouldPlayAnimated = rowIndex >= activeRowStart
              && rowIndex < activeRowStart + ACTIVE_ROWS;
            const playIndexLimit = activeRowStart * columns + MAX_ACTIVE_ANIMATED_ITEMS;
            const shouldPlayThisSticker = shouldPlayAnimated
              && index < playIndexLimit
              && !failedAnimatedIds.has(packId);
            const animatedPlayUri = pack?.animatedPreviewUri || null;
            const generatedPackPreviewUri = generatedPackPreviewUris[packId] || null;
            const pausedCandidates = [
              generatedPackPreviewUri,
              pack?.previewImageUri,
            ].filter(Boolean);
            const animatedPausedUri = pausedCandidates.find(uri => !failedPausedKeys.has(`${packId}|${uri}`)) || null;
            const showAnimatedPlaceholder = Boolean(pack?.isAnimated) && !shouldPlayThisSticker && !animatedPausedUri;
            const fallbackUri = animatedPausedUri || null;
            return (
              <Pressable
                key={packId}
                onPress={() => onOpenPack?.(pack) || onNavigate?.('PackDetails', { pack })}
                style={[styles.card, { width: cardWidth }]}
              >
                <View style={styles.cardPreview}>
                  {showAnimatedPlaceholder ? (
                    fallbackUri ? (
                      <Image
                        source={{ uri: fallbackUri }}
                        style={styles.cardImage}
                        resizeMode="cover"
                        resizeMethod="resize"
                        fadeDuration={0}
                        onError={() => markPausedFailed(packId, fallbackUri)}
                      />
                    ) : (
                      <View style={styles.animatedThumb}>
                        <View style={styles.fallbackTile}>
                          <View style={styles.fallbackDot} />
                        </View>
                      </View>
                    )
                  ) : pack?.isAnimated ? (
                    <View style={styles.animatedThumb}>
                      {fallbackUri ? (
                        <Image
                          source={{ uri: fallbackUri }}
                          style={styles.cardImage}
                          resizeMode="cover"
                          resizeMethod="resize"
                          fadeDuration={0}
                          onError={() => markPausedFailed(packId, fallbackUri)}
                        />
                      ) : (
                        <View style={styles.fallbackTile}>
                          <View style={styles.fallbackDot} />
                        </View>
                      )}
                      {shouldPlayThisSticker && animatedPlayUri ? (
                        <Image
                          source={{ uri: animatedPlayUri }}
                          style={[styles.cardImage, styles.cardImageOverlay, styles.cardImagePlaying]}
                          resizeMode="contain"
                          resizeMethod="auto"
                          fadeDuration={0}
                          onError={() => {
                            console.warn('[animated-grid] my packs preview failed', packId, animatedPlayUri);
                            markAnimatedFailed(packId);
                          }}
                        />
                      ) : null}
                    </View>
                  ) : pack.previewUri ? (
                    <Image
                      source={{ uri: pack.previewUri }}
                      style={styles.cardImage}
                      resizeMode="cover"
                      resizeMethod="resize"
                      fadeDuration={0}
                    />
                  ) : null}
                </View>
                {pack.isAnimated && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>VIDEO</Text>
                  </View>
                )}
                <Text style={styles.cardTitle} numberOfLines={1}>{pack.title}</Text>
                <Text style={styles.cardMeta}>
                  {pack.count} Stickers - {pack.isAnimated ? 'Animated' : 'Static'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => onCreatePack?.() || onNavigate?.('PackEditor')}>
        <Text style={styles.fabLabel}>+</Text>
        <Text style={styles.fabText}>Create New</Text>
      </Pressable>

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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.primaryAccent,
  },
  title: {
    flex: 1,
    marginLeft: spacing(1.25),
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(1),
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(2),
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
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    marginBottom: spacing(2),
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing(1),
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing(0.5),
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing(1.25),
  },
  emptyButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.8),
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  emptyButtonText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.25),
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(2),
  },
  cardPreview: {
    height: 120,
    borderRadius: radius.md,
    backgroundColor: '#f3f7fa',
    marginBottom: spacing(1),
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.95,
  },
  cardImagePlaying: {
    transform: [{ scale: ANIMATED_PLAY_SCALE }],
  },
  animatedThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  animatedLabel: {
    color: colors.primaryAccent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  fallbackTile: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dbe7ef',
  },
  fallbackDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#b8cbd8',
  },
  badge: {
    position: 'absolute',
    right: spacing(1.25),
    top: spacing(1.25),
    backgroundColor: colors.primaryAccent,
    paddingHorizontal: spacing(0.75),
    paddingVertical: spacing(0.35),
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 10,
    color: colors.textOnPrimary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing(0.25),
  },
  fab: {
    position: 'absolute',
    right: spacing(2),
    bottom: spacing(8),
    backgroundColor: colors.primaryAccent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabLabel: {
    fontSize: 18,
    color: colors.textOnPrimary,
    fontWeight: '700',
    marginRight: spacing(0.5),
  },
  fabText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.4,
  },
});

export default MyStickerPacksScreen;
