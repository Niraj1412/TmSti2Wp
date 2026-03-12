import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ActionButton from '../components/ui/ActionButton';
import { colors, radius, spacing } from '../styles/theme';
import { getFileExtension } from '../utils/stickerUtils';
import { createStickerPreview } from '../utils/stickerPreview';
import { fetchDiscoverPackStickers } from '../services/discoverService';

const ACTIVE_ROWS = 3;
const ANIMATED_PLAY_SCALE = 0.76;

const PackDetailsScreen = ({ pack, onBack, onAddToWhatsApp, onEditPack, publishing }) => {
  const [remoteStickers, setRemoteStickers] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [activeRowStart, setActiveRowStart] = useState(0);
  const [failedAnimatedIds, setFailedAnimatedIds] = useState(() => new Set());
  const [failedPausedKeys, setFailedPausedKeys] = useState(() => new Set());
  const [generatedPreviewUris, setGeneratedPreviewUris] = useState(() => ({}));
  const [failedPreviewIds, setFailedPreviewIds] = useState(() => new Set());
  const lastActiveRowRef = useRef(0);
  const scrollIdleTimerRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const maxScrollRef = useRef(1);
  const gridTopRef = useRef(0);
  const viewportHeightRef = useRef(1);
  const baseItems = Array.isArray(pack?.stickers) ? pack.stickers : [];
  const items = (remoteStickers.length > 0 ? remoteStickers : baseItems).length > 0
    ? (remoteStickers.length > 0 ? remoteStickers : baseItems)
    : Array.from({ length: 12 }).map((_, index) => ({
      id: `sticker-${index}`,
      animated: index % 4 === 0,
    }));
  const rowGap = spacing(1.2);
  const columns = 3;
  const totalRows = Math.ceil(items.length / columns);

  const previewSticker = remoteStickers[0] || pack?.stickers?.[0];
  const displayCount = (typeof pack?.count === 'number' && pack.count > 0) ? pack.count : items.length;
  const isAnimatedPack = Boolean(pack?.isAnimated || pack?.stickers?.some(item => item?.animated));
  const hasPackStaticPreview = Boolean(pack?.previewImageUri || pack?.stickers?.some(item => item?.previewImageUri));
  const trayExt = String(getFileExtension(pack?.trayIconUri || '')).toLowerCase();
  const safeTrayIconUri = isAnimatedPack && trayExt === 'webp' && hasPackStaticPreview ? null : pack?.trayIconUri;
  const previewAnimated = Boolean(previewSticker?.animated || isAnimatedPack);
  const previewImageUri = safeTrayIconUri || pack?.previewImageUri || previewSticker?.previewImageUri || null;
  const previewUri = previewAnimated
    ? previewImageUri
    : (safeTrayIconUri || previewSticker?.uri || previewSticker?.originalUri || null);

  const itemSize = useMemo(() => {
    const width = Dimensions.get('window').width;
    const padding = spacing(2);
    return (width - padding * 2 - rowGap * (columns - 1)) / columns;
  }, [columns, rowGap]);

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
    setRemoteStickers([]);
    setRemoteLoading(false);
    setRemoteError('');
  }, [pack?.id]);

  useEffect(() => {
    const packId = String(pack?.id || '').trim();
    if (!packId) return;
    if (pack?.source !== 'discover') return;
    if (Array.isArray(pack?.stickers) && pack.stickers.length > 0) return;

    let cancelled = false;
    const load = async () => {
      setRemoteLoading(true);
      const { stickers, error } = await fetchDiscoverPackStickers({ packId, limit: 120 });
      if (cancelled) return;
      setRemoteStickers(Array.isArray(stickers) ? stickers : []);
      setRemoteError(error || '');
      setRemoteLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [pack?.id, pack?.source, pack?.stickers]);

  useEffect(() => {
    setFailedAnimatedIds(new Set());
  }, [pack?.id, activeRowStart]);

  useEffect(() => {
    setFailedPausedKeys(new Set());
  }, [pack?.id]);

  useEffect(() => {
    setGeneratedPreviewUris({});
    setFailedPreviewIds(new Set());
  }, [pack?.id]);

  useEffect(() => {
    if (!Array.isArray(items) || items.length === 0) return;
    const startRow = Math.max(0, activeRowStart - 2);
    const endRow = activeRowStart + ACTIVE_ROWS + 2;
    const targets = items.filter((item, index) => {
      const rowIndex = Math.floor(index / columns);
      return rowIndex >= startRow && rowIndex < endRow;
    });
    if (targets.length === 0) return;

    let cancelled = false;
    const run = async () => {
      let processed = 0;
      for (const item of targets) {
        if (cancelled) return;
        if (processed >= 12) break;
        const stickerId = item?.id;
        if (!stickerId || !item?.animated) continue;
        if (item?.previewImageUri) continue;
        if (generatedPreviewUris[stickerId]) continue;
        if (failedPreviewIds.has(stickerId)) continue;
        const generatedUri = await createStickerPreview(item?.uri || item?.originalUri, { width: 128, height: 128 });
        if (cancelled) return;
        if (generatedUri) {
          setGeneratedPreviewUris(prev => (prev[stickerId] ? prev : { ...prev, [stickerId]: generatedUri }));
        } else {
          setFailedPreviewIds(prev => {
            if (prev.has(stickerId)) return prev;
            const next = new Set(prev);
            next.add(stickerId);
            return next;
          });
        }
        processed += 1;
        await new Promise(resolve => setTimeout(resolve, 8));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [items, activeRowStart, columns, generatedPreviewUris, failedPreviewIds]);

  const markAnimatedFailed = useCallback((stickerId) => {
    if (!stickerId) return;
    setFailedAnimatedIds(prev => {
      if (prev.has(stickerId)) return prev;
      const next = new Set(prev);
      next.add(stickerId);
      return next;
    });
  }, []);

  const markPausedFailed = useCallback((stickerId, uri) => {
    if (!stickerId || !uri) return;
    const key = `${stickerId}|${uri}`;
    setFailedPausedKeys(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.navButton} />
        <Text style={styles.title}>Pack Details</Text>
        <Pressable style={styles.navButton} />
      </View>

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
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            {previewUri ? (
              !previewAnimated ? (
                <Image
                  source={{ uri: previewUri }}
                  style={styles.heroImage}
                  resizeMode="cover"
                  resizeMethod="resize"
                  fadeDuration={0}
                />
              ) : (
                <Image
                  source={{ uri: previewUri }}
                  style={styles.heroImage}
                  resizeMode="cover"
                  resizeMethod="resize"
                  fadeDuration={0}
                />
              )
            ) : previewAnimated ? (
              <View style={styles.animatedThumb}>
                <Text style={styles.animatedLabel}> </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.packTitle}>{pack?.title || 'Sticker Pack'}</Text>
          <Text style={styles.packSubtitle}>by @StickerCreator</Text>
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statText}>{displayCount} Stickers</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statText}>{pack?.isAnimated ? 'Animated' : 'Static'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.actionsRow}>
          {['Share Pack', 'Copy Link'].map(label => (
            <Pressable key={label} style={styles.actionCard}>
              <View style={styles.actionIcon} />
              <Text style={styles.actionLabel}>{label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.actionCard} onPress={() => onEditPack?.()}>
            <View style={styles.actionIcon} />
            <Text style={styles.actionLabel}>Edit Pack</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Stickers</Text>
          <Text style={styles.sectionAction}>Grid View</Text>
        </View>

        {remoteLoading ? (
          <Text style={styles.statusText}>Loading stickers...</Text>
        ) : null}

        {remoteError ? (
          <Text style={styles.errorText}>{remoteError}</Text>
        ) : null}

        <View
          style={styles.grid}
          onLayout={event => {
            gridTopRef.current = event?.nativeEvent?.layout?.y ?? 0;
          }}
        >
          {items.map((item, index) => {
            const isAnimated = Boolean(item?.animated);
            const rowIndex = Math.floor(index / columns);
            const stickerId = item?.id || `sticker-${index}`;
            const inRenderWindow = rowIndex >= Math.max(0, activeRowStart - 1)
              && rowIndex < activeRowStart + ACTIVE_ROWS + 1;
            const shouldPlayThisSticker = !remoteLoading
              && inRenderWindow
              && !failedAnimatedIds.has(stickerId);
            const animatedPlayUri = item?.uri || item?.originalUri;
            const generatedPreviewUri = stickerId ? generatedPreviewUris[stickerId] : null;
            const pausedCandidates = [generatedPreviewUri, item?.previewImageUri]
              .filter(uri => Boolean(uri) && uri !== animatedPlayUri);
            const animatedPausedUri = pausedCandidates.find(uri => !failedPausedKeys.has(`${stickerId}|${uri}`)) || null;
            const fallbackUri = animatedPausedUri;
            return (
            <View key={stickerId} style={[styles.sticker, { width: itemSize, height: itemSize }]}>
              {isAnimated ? (
                <View style={styles.animatedThumb}>
                  {fallbackUri ? (
                    <Image
                      source={{ uri: fallbackUri }}
                      style={styles.stickerImage}
                      resizeMode="cover"
                      resizeMethod="resize"
                      fadeDuration={0}
                      onError={() => markPausedFailed(stickerId, fallbackUri)}
                    />
                  ) : (
                    <View style={styles.fallbackTile}>
                      <View style={styles.fallbackDot} />
                    </View>
                  )}
                  {shouldPlayThisSticker && animatedPlayUri ? (
                    <Image
                      source={{ uri: animatedPlayUri }}
                      style={[styles.stickerImage, styles.stickerImageOverlay, styles.stickerImagePlaying]}
                      resizeMode="contain"
                      fadeDuration={0}
                      onError={() => {
                        console.warn('[animated-grid] pack details preview failed', stickerId, animatedPlayUri);
                        markAnimatedFailed(stickerId);
                      }}
                    />
                  ) : null}
                </View>
              ) : item?.uri || item?.originalUri ? (
                <Image
                  source={{ uri: item.uri || item.originalUri }}
                  style={styles.stickerImage}
                  resizeMode="cover"
                  resizeMethod="resize"
                  fadeDuration={0}
                />
              ) : null}
            </View>
          );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <ActionButton
          title={publishing ? 'Adding to WhatsApp...' : 'Add to WhatsApp'}
          onPress={onAddToWhatsApp}
          loading={publishing}
          disabled={publishing}
          style={styles.footerButton}
        />
        <Text style={styles.footerNote}>OFFICIALLY COMPATIBLE WITH WHATSAPP</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1.5),
    paddingBottom: spacing(1),
  },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(10),
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing(2.5),
  },
  heroIcon: {
    width: 120,
    height: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.primaryAccent,
    marginBottom: spacing(1.5),
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
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
  packTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  packSubtitle: {
    color: colors.primaryAccent,
    marginTop: spacing(0.5),
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing(1.5),
  },
  statPill: {
    paddingHorizontal: spacing(1.2),
    paddingVertical: spacing(0.5),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginHorizontal: spacing(0.5),
  },
  statText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing(2.5),
  },
  actionCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing(1.2),
    marginHorizontal: spacing(0.5),
    borderWidth: 1,
    borderColor: colors.divider,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing(0.75),
  },
  actionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
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
    color: colors.textMuted,
    fontSize: 12,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  sticker: {
    backgroundColor: '#f3f7fa',
    borderRadius: radius.lg,
    marginBottom: spacing(1.2),
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  stickerImage: {
    width: '100%',
    height: '100%',
  },
  stickerImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.95,
  },
  stickerImagePlaying: {
    transform: [{ scale: ANIMATED_PLAY_SCALE }],
  },
  footer: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.backgroundAlt,
  },
  footerButton: {
    marginBottom: spacing(0.8),
  },
  footerNote: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    letterSpacing: 0.6,
  },
});

export default PackDetailsScreen;
