import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, InteractionManager, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ActionButton from '../components/ui/ActionButton';
import VideoStickerImporter from '../components/VideoStickerImporter';
import { getPicker, getPickerError } from '../utils/multipleImagePickerProxy';
import { buildStickerFromPath, getFileExtension, normalizeFilePath } from '../utils/stickerUtils';
import { createStickerPreview } from '../utils/stickerPreview';
import { colors, radius, spacing } from '../styles/theme';

const MAX_STICKERS = 30;
const GRID_COLUMNS = 4;
const ACTIVE_ANIMATED_ROWS = 1;
const MAX_ACTIVE_ANIMATED_ITEMS = GRID_COLUMNS;
const ANIMATED_PLAY_SCALE = 0.76;

const getStaticPreviewSource = (sticker) => {
  if (!sticker) return null;
  if (sticker?.previewImageUri) return normalizeFilePath(sticker.previewImageUri);
  if (sticker?.animated) return null;
  const source = sticker?.uri || sticker?.originalUri || null;
  return source ? normalizeFilePath(source) : null;
};

const StickerPackEditorScreen = ({ pack, onBack, onNavigate, onUpdatePack, onPublish, publishing, importing, importProgress }) => {
  const [videoModalVisible, setVideoModalVisible] = useState(false);
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

  const stickers = useMemo(() => (Array.isArray(pack?.stickers) ? pack.stickers : []), [pack?.stickers]);
  const trayIconUri = pack?.trayIconUri;
  const packTitle = pack?.title || '';
  const isFull = stickers.length >= MAX_STICKERS;
  const rowGap = spacing(1.2);
  const totalRows = Math.max(1, Math.ceil(Math.max(stickers.length, 1) / GRID_COLUMNS));

  const size = useMemo(() => {
    const width = Dimensions.get('window').width;
    const padding = spacing(2);
    return (width - padding * 2 - rowGap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  }, [rowGap]);

  const applyActiveRowFromOffset = useCallback((offsetY) => {
    const maxRow = Math.max(0, totalRows - ACTIVE_ANIMATED_ROWS);
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
    if (trayIconUri || stickers.length === 0) return;
    const fallbackTray = stickers.map(getStaticPreviewSource).find(Boolean) || null;
    if (!fallbackTray) return;
    onUpdatePack?.({ trayIconUri: fallbackTray });
  }, [trayIconUri, stickers, onUpdatePack]);

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
    if (!Array.isArray(stickers) || stickers.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const sticker of stickers) {
        if (cancelled) return;
        if (!sticker?.animated) continue;
        const stickerId = sticker?.id;
        if (!stickerId) continue;
        if (sticker?.previewImageUri) continue;
        if (generatedPreviewUris[stickerId]) continue;
        if (failedPreviewIds.has(stickerId)) continue;
        const previewUri = await createStickerPreview(sticker?.uri || sticker?.originalUri, { width: 128, height: 128 });
        if (cancelled) return;
        if (previewUri) {
          setGeneratedPreviewUris(prev => (prev[stickerId] ? prev : { ...prev, [stickerId]: previewUri }));
          onUpdatePack?.(prev => {
            if (!prev || !Array.isArray(prev.stickers)) return prev;
            return {
              ...prev,
              stickers: prev.stickers.map(item => (
                item?.id === stickerId ? { ...item, previewImageUri: previewUri } : item
              )),
            };
          });
        } else {
          setFailedPreviewIds(prev => {
            if (prev.has(stickerId)) return prev;
            const next = new Set(prev);
            next.add(stickerId);
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
  }, [stickers, generatedPreviewUris, failedPreviewIds, onUpdatePack]);

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

  const mergeStickers = (incoming) => {
    const existingUris = new Set(
      stickers.map(sticker => normalizeFilePath(sticker.originalUri || sticker.uri)),
    );
    const unique = [];
    (Array.isArray(incoming) ? incoming : []).forEach(sticker => {
      const normalized = normalizeFilePath(sticker.originalUri || sticker.uri);
      if (!normalized || existingUris.has(normalized)) return;
      existingUris.add(normalized);
      unique.push(sticker);
    });

    if (unique.length === 0) {
      Alert.alert('Nothing new', 'These stickers are already in your pack.');
      return { added: [], next: stickers, dropped: 0 };
    }

    const remaining = Math.max(0, MAX_STICKERS - stickers.length);
    const added = unique.slice(0, remaining);
    const dropped = Math.max(0, unique.length - added.length);
    const next = [...stickers, ...added];

    const inferredTray = trayIconUri
      || next.map(getStaticPreviewSource).find(Boolean)
      || null;

    onUpdatePack?.({
      stickers: next,
      ...(trayIconUri ? {} : { trayIconUri: inferredTray ? normalizeFilePath(inferredTray) : null }),
    });

    if (dropped > 0) {
      Alert.alert('Pack limit reached', `Only ${MAX_STICKERS} stickers are allowed. ${dropped} were skipped.`);
    }

    return { added, next, dropped };
  };

  const handleAddImages = async () => {
    if (isFull) {
      Alert.alert('Pack full', 'You already have 30 stickers in this pack.');
      return;
    }
    const Picker = getPicker();
    if (!Picker) {
      const reason = getPickerError();
      Alert.alert('Gallery picker unavailable', reason?.message ?? 'Install react-native-image-picker or expo-image-picker and rebuild the app.');
      return;
    }

    try {
      const assets = await Picker.openPicker({
        mediaType: 'image',
        maxSelectedAssets: MAX_STICKERS - stickers.length,
      });
      if (!Array.isArray(assets) || assets.length === 0) return;

      const mapped = assets.map(asset => {
        const path = asset?.originalUri || asset?.uri || asset?.path || asset?.realPath || asset;
        const nameHint = asset?.name || asset?.fileName || asset?.filename;
        const mimeHint = asset?.mimeType || asset?.type;
        let extensionHint = getFileExtension(nameHint);
        if (!extensionHint && typeof mimeHint === 'string' && mimeHint.includes('/')) {
          extensionHint = mimeHint.split('/').pop();
        }
        return buildStickerFromPath(path, {
          source: 'gallery',
          name: nameHint,
          extension: extensionHint,
          mimeType: mimeHint,
        });
      }).filter(Boolean);

      const { added } = mergeStickers(mapped);
      if (added.length > 0) {
        onNavigate?.('StickerEdit', { stickerId: added[0].id });
      }
    } catch (error) {
      if (error?.code === 'E_PICKER_CANCELLED') return;
      Alert.alert('Image picker error', error?.message ?? 'Failed to pick images from gallery.');
    }
  };

  const handleAddStickerChoice = () => {
    if (isFull) {
      Alert.alert('Pack full', 'You already have 30 stickers in this pack.');
      return;
    }
    if (Platform.OS === 'web') {
      handleAddImages();
      return;
    }
    Alert.alert(
      'Add sticker',
      'Choose a source',
      [
        { text: 'Image', onPress: handleAddImages },
        { text: 'Video', onPress: () => setVideoModalVisible(true) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handlePickTrayIcon = async () => {
    const Picker = getPicker();
    if (!Picker) {
      const reason = getPickerError();
      Alert.alert('Gallery picker unavailable', reason?.message ?? 'Install react-native-image-picker or expo-image-picker and rebuild the app.');
      return;
    }

    try {
      const assets = await Picker.openPicker({
        mediaType: 'image',
        maxSelectedAssets: 1,
      });
      const asset = Array.isArray(assets) ? assets[0] : null;
      const path = asset?.originalUri || asset?.uri || asset?.path || asset?.realPath;
      if (!path) return;
      onUpdatePack?.({ trayIconUri: normalizeFilePath(path) });
    } catch (error) {
      if (error?.code === 'E_PICKER_CANCELLED') return;
      Alert.alert('Image picker error', error?.message ?? 'Failed to pick a tray icon.');
    }
  };

  const handleVideoImported = items => {
    const { added } = mergeStickers(items);
    setVideoModalVisible(false);
    if (added.length > 0) {
      onNavigate?.('StickerEdit', { stickerId: added[0].id });
    }
  };

  const canPublish = stickers.length > 0 && !publishing;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.navButton} />
        <Text style={styles.title}>{pack?.title || 'New Pack'}</Text>
        <Pressable
          style={[styles.publishButton, !canPublish && styles.publishDisabled]}
          onPress={canPublish ? onPublish : undefined}
        >
          <Text style={styles.publishText}>{publishing ? 'Publishing...' : 'Publish'}</Text>
        </Pressable>
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
        {importing && (
          <View style={styles.importBanner}>
            <ActivityIndicator size="small" color={colors.primaryAccent} />
            <Text style={styles.importBannerText}>
              Importing stickers… {importProgress?.loaded ?? 0}/{importProgress?.total ?? 0}
            </Text>
          </View>
        )}
        <View style={styles.traySection}>
          <Pressable style={styles.trayIcon} onPress={handlePickTrayIcon}>
            {trayIconUri ? (
              <Image
                source={{ uri: trayIconUri }}
                style={styles.trayImage}
                resizeMode="cover"
                resizeMethod="resize"
                fadeDuration={0}
              />
            ) : (
              <>
                <View style={styles.trayOverlay} />
                <Text style={styles.trayLabel}>PACK ICON</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.trayCaption}>Main Tray Icon (Required)</Text>
        </View>

        <View style={styles.nameCard}>
          <Text style={styles.nameLabel}>PACK NAME</Text>
          <TextInput
            style={styles.nameInput}
            value={packTitle}
            onChangeText={value => onUpdatePack?.({ title: value })}
            placeholder="Give your pack a name"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.collectionHeader}>
          <Text style={styles.sectionTitle}>STICKER COLLECTION</Text>
          <View style={styles.counter}>
            <Text style={styles.counterText}>{stickers.length}/{MAX_STICKERS}</Text>
          </View>
        </View>

        <View
          style={styles.grid}
          onLayout={event => {
            gridTopRef.current = event?.nativeEvent?.layout?.y ?? 0;
          }}
        >
          {Array.from({ length: MAX_STICKERS }).map((_, index) => {
            const sticker = stickers[index];
            const stickerId = sticker?.id || `slot-${index}`;
            const isAnimated = Boolean(sticker?.animated);
            const rowIndex = Math.floor(index / GRID_COLUMNS);
            const shouldPlayAnimated = rowIndex >= activeRowStart
              && rowIndex < activeRowStart + ACTIVE_ANIMATED_ROWS;
            const playIndexLimit = activeRowStart * GRID_COLUMNS + MAX_ACTIVE_ANIMATED_ITEMS;
            const shouldPlayThisSticker = shouldPlayAnimated
              && index < playIndexLimit
              && !failedAnimatedIds.has(stickerId);
            const animatedPlayUri = sticker?.uri || sticker?.originalUri;
            const generatedPreviewUri = stickerId ? generatedPreviewUris[stickerId] : null;
            const pausedCandidates = [sticker?.previewImageUri, generatedPreviewUri].filter(Boolean);
            const animatedPausedUri = pausedCandidates.find(uri => !failedPausedKeys.has(`${stickerId}|${uri}`)) || null;
            const fallbackUri = animatedPausedUri;
            return (
              <Pressable
                key={`slot-${index}`}
                style={[styles.slot, { width: size, height: size }]}
                onPress={() => {
                  if (sticker) {
                    onNavigate?.('StickerEdit', { stickerId: sticker.id });
                  } else {
                    handleAddStickerChoice();
                  }
                }}
              >
                {sticker ? (
                  isAnimated ? (
                    <View style={styles.animatedThumb}>
                      {fallbackUri ? (
                        <Image
                          source={{ uri: fallbackUri }}
                          style={styles.slotImage}
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
                          style={[styles.slotImage, styles.slotImageOverlay, styles.slotImagePlaying]}
                          resizeMode="contain"
                          fadeDuration={0}
                          onError={() => {
                            console.warn('[animated-grid] sticker preview failed', sticker?.id, animatedPlayUri);
                            markAnimatedFailed(stickerId);
                          }}
                        />
                      ) : null}
                    </View>
                  ) : (
                    <Image
                      source={{ uri: sticker.uri || sticker.originalUri }}
                      style={styles.slotImage}
                      resizeMode="cover"
                      resizeMethod="resize"
                      fadeDuration={0}
                    />
                  )
                ) : (
                  <Text style={styles.slotText}>+</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.infoBanner}>
          <View style={styles.infoDot} />
          <Text style={styles.infoText}>
            Add at least one sticker to publish your pack. We'll auto-fill to 3 if needed for WhatsApp.
          </Text>
        </View>

        <View style={styles.actions}>
          <ActionButton
            title="Add Image"
            onPress={handleAddImages}
            style={styles.actionPrimary}
            disabled={isFull}
          />
          <ActionButton
            title="Add Video"
            variant="secondary"
            onPress={() => setVideoModalVisible(true)}
            style={styles.actionSecondary}
            disabled={isFull}
          />
        </View>
      </ScrollView>

      <Modal
        visible={videoModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setVideoModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add video sticker</Text>
              <Pressable style={styles.modalClose} onPress={() => setVideoModalVisible(false)}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <VideoStickerImporter onImported={handleVideoImported} />
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  publishButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.6),
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  publishDisabled: {
    opacity: 0.6,
  },
  publishText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(3),
  },
  importBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing(1),
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(1.5),
  },
  importBannerText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginLeft: spacing(1),
  },
  traySection: {
    alignItems: 'center',
    marginBottom: spacing(2),
  },
  trayIcon: {
    width: 130,
    height: 130,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.primaryAccent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  trayImage: {
    width: '100%',
    height: '100%',
  },
  trayOverlay: {
    position: 'absolute',
    right: spacing(0.6),
    bottom: spacing(0.6),
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  trayLabel: {
    color: colors.primaryAccent,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.6,
  },
  trayCaption: {
    marginTop: spacing(1),
    color: colors.textMuted,
    fontSize: 12,
  },
  nameCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(2),
  },
  nameLabel: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.1,
    marginBottom: spacing(0.6),
  },
  nameInput: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.8),
    backgroundColor: colors.surfaceElevated,
  },
  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing(1.25),
  },
  sectionTitle: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  counter: {
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.4),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  counterText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  slot: {
    backgroundColor: '#f3f7fa',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(1.2),
    overflow: 'hidden',
  },
  slotText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '600',
  },
  slotImage: {
    width: '100%',
    height: '100%',
  },
  slotImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.95,
  },
  slotImagePlaying: {
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.divider,
    marginTop: spacing(1),
  },
  infoDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primaryAccent,
    marginRight: spacing(1),
    marginTop: spacing(0.3),
  },
  infoText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing(2),
  },
  actionPrimary: {
    flex: 1,
    marginRight: spacing(1),
  },
  actionSecondary: {
    flex: 1,
    marginLeft: spacing(1),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 25, 32, 0.85)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing(2),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  modalClose: {
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.4),
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
  },
  modalCloseText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  modalContent: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(2),
  },
});

export default StickerPackEditorScreen;
