import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { Video } from 'expo-av';
import * as ImageManipulator from 'expo-image-manipulator';
import ActionButton from '../components/ui/ActionButton';
import { colors, radius, spacing } from '../styles/theme';
import { getRNFS } from '../utils/fsProxy';
import { getFileExtension, normalizeFilePath } from '../utils/stickerUtils';
import { REMOVE_BG_API_ENDPOINT, REMOVE_BG_API_KEY } from '../config/editingConfig';
import { convertAnimatedWebpToMp4Preview, isFfmpegAvailable } from '../utils/videoStickerConverter';
import { cropStickerSquare, isNativeStickerPreviewAvailable, removeStickerBackgroundBasic } from '../utils/stickerPreview';

const getExpoFileSystem = () => {
  try {
    const legacy = require('expo-file-system/legacy');
    if (legacy) return legacy;
  } catch {
    /* ignore */
  }
  try {
    return require('expo-file-system');
  } catch {
    return null;
  }
};

const getImageDimensions = uri => new Promise(resolve => {
  Image.getSize(
    uri,
    (width, height) => resolve({ width, height }),
    () => resolve(null),
  );
});

const blobToBase64 = blob => new Promise((resolve, reject) => {
  try {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read response.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : '';
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  } catch (error) {
    reject(error);
  }
});

const StickerEditScreen = ({ onBack, sticker, onRemove, onSetTrayIcon, onUpdateSticker }) => {
  const previewRef = useRef(null);
  const autoPlayRef = useRef({ id: null, attempted: false });
  const playSourceRef = useRef(null);
  const [overlayText, setOverlayText] = useState('');
  const [processing, setProcessing] = useState('');
  const [playAnimated, setPlayAnimated] = useState(false);
  const [previewVideoUri, setPreviewVideoUri] = useState(null);
  const [previewProcessing, setPreviewProcessing] = useState(false);

  const previewUri = sticker?.uri || sticker?.originalUri;
  const previewImageUri = sticker?.previewImageUri || null;
  const label = sticker?.displayName || sticker?.name || 'Sticker';
  const isAnimated = Boolean(sticker?.animated);
  const typeLabel = isAnimated ? 'Animated' : 'Static';
  const formatLabel = sticker?.format || (sticker?.extension ? sticker.extension.toUpperCase() : 'Unknown');
  const isBusy = Boolean(processing);
  const canEditImage = Boolean(previewUri);
  const previewReady = Boolean(previewVideoUri);

  const fileExists = useCallback(async uri => {
    if (!uri) return false;
    const FileSystem = getExpoFileSystem();
    if (FileSystem?.getInfoAsync) {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info?.exists) return true;
      } catch {
        /* ignore */
      }
    }
    const RNFS = getRNFS();
    if (RNFS?.exists) {
      try {
        return await RNFS.exists(String(uri).replace(/^file:\/\//i, ''));
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  const ensureLocalPreviewUri = useCallback(async (uri, extensionHint) => {
    if (!uri) return uri;
    const normalized = normalizeFilePath(uri);
    const FileSystem = getExpoFileSystem();
    const RNFS = getRNFS();
    const baseDir = FileSystem?.cacheDirectory
      || FileSystem?.documentDirectory
      || RNFS?.CachesDirectoryPath
      || RNFS?.DocumentDirectoryPath
      || RNFS?.TemporaryDirectoryPath;
    if (!baseDir) return normalized;
    const basePath = String(baseDir).replace(/^file:\/\//i, '');
    const normalizedPath = String(normalized).replace(/^file:\/\//i, '');
    if (normalizedPath.startsWith(basePath)) return normalized;

    const ext = extensionHint || getFileExtension(normalized) || 'webp';
    const dir = baseDir.endsWith('/') ? `${baseDir}preview` : `${baseDir}/preview`;
    const filename = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const target = dir.endsWith('/') ? `${dir}${filename}` : `${dir}/${filename}`;
    const targetUri = normalizeFilePath(target);

    try {
      if (FileSystem?.makeDirectoryAsync) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      } else if (RNFS?.mkdir) {
        await RNFS.mkdir(dir);
      }
    } catch {
      /* ignore */
    }

    try {
      if (FileSystem?.copyAsync) {
        await FileSystem.copyAsync({ from: normalized, to: targetUri });
        return targetUri;
      }
    } catch {
      /* ignore */
    }

    try {
      if (RNFS?.copyFile) {
        await RNFS.copyFile(normalizedPath, target);
        return normalizeFilePath(target);
      }
    } catch {
      /* ignore */
    }

    return normalized;
  }, []);

  const updateSticker = useCallback(patch => {
    if (!sticker?.id) return;
    onUpdateSticker?.({ ...patch, editedAt: Date.now() });
  }, [onUpdateSticker, sticker?.id]);

  useEffect(() => {
    playSourceRef.current = null;
    autoPlayRef.current = { id: sticker?.id ?? null, attempted: false };
    if (!isAnimated) {
      setPlayAnimated(false);
      setPreviewVideoUri(null);
      return;
    }
    setPlayAnimated(false);
    setPreviewVideoUri(null);
  }, [sticker?.id, isAnimated]);

  useEffect(() => {
    if (!isAnimated) return;
    if (sticker?.previewVideoUri) {
      setPreviewVideoUri(sticker.previewVideoUri);
    }
  }, [sticker?.previewVideoUri, isAnimated]);

  const startAnimatedPlayback = useCallback(async ({ allowFallback = false, showAlerts = true } = {}) => {
    if (!previewUri || previewProcessing) return;
    const uriExtension = String(getFileExtension(previewUri) || '').toLowerCase();
    const sourceExt = uriExtension || String(sticker?.extension || '').toLowerCase();
    const sourceFormat = String(sticker?.format || '').toLowerCase();
    const isLikelyAnimatedWebp = sourceExt === 'webp'
      || sourceFormat === 'webp'
      || /\.webp($|[?#])/i.test(String(previewUri || '').toLowerCase());
    if (previewVideoUri && await fileExists(previewVideoUri)) {
      playSourceRef.current = allowFallback ? 'manual' : 'auto';
      setPlayAnimated(true);
      return;
    }
    if (isLikelyAnimatedWebp) {
      // This build may not support animated WebP -> MP4 preview conversion.
      // Play the original asset directly and skip FFmpeg to avoid repeated hangs.
      playSourceRef.current = allowFallback ? 'manual' : 'auto';
      setPlayAnimated(true);
      return;
    }
    if (!isFfmpegAvailable()) {
      if (showAlerts) {
        Alert.alert(
          'Preview unavailable',
          'FFmpeg is not available to generate a smooth preview. Tap play to open the original animation (may be choppy).',
        );
      }
      if (allowFallback) {
        playSourceRef.current = 'manual';
        setPlayAnimated(true);
      }
      return;
    }
    setPreviewProcessing(true);
    try {
      const localSource = await ensureLocalPreviewUri(previewUri, sticker?.extension || 'webp');
      const result = await convertAnimatedWebpToMp4Preview({ uri: localSource });
      if (result?.uri) {
        setPreviewVideoUri(result.uri);
        updateSticker({ previewVideoUri: result.uri, previewGeneratedAt: Date.now() });
        playSourceRef.current = allowFallback ? 'manual' : 'auto';
        setPlayAnimated(true);
        return;
      }
      if (showAlerts) {
        Alert.alert('Preview unavailable', 'Unable to generate a smooth preview for this sticker.');
      }
    } catch (error) {
      if (showAlerts) {
        Alert.alert('Preview failed', error?.message ?? 'Unable to generate a smooth preview.');
      }
      if (allowFallback) {
        playSourceRef.current = 'manual';
        setPlayAnimated(true);
      }
    } finally {
      setPreviewProcessing(false);
    }
  }, [
    fileExists,
    previewProcessing,
    previewUri,
    previewVideoUri,
    ensureLocalPreviewUri,
    sticker?.extension,
    sticker?.format,
    updateSticker,
  ]);

  useEffect(() => {
    if (!isAnimated || !previewUri) return;
    if (autoPlayRef.current.attempted) return;
    autoPlayRef.current.attempted = true;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await startAnimatedPlayback({ allowFallback: false, showAlerts: false });
    };
    if (InteractionManager?.runAfterInteractions) {
      InteractionManager.runAfterInteractions(() => {
        run();
      });
    } else {
      run();
    }
    return () => {
      cancelled = true;
    };
  }, [isAnimated, previewUri, sticker?.id, startAnimatedPlayback]);

  const handleCropSquare = async () => {
    if (!previewUri) return;
    setProcessing('crop');
    try {
      if (isAnimated) setPlayAnimated(false);
      const sourceForEdit = normalizeFilePath(previewImageUri || previewUri);
      const normalized = await ensureLocalPreviewUri(sourceForEdit, 'png');
      const nativeCroppedUri = await cropStickerSquare(normalized);
      if (nativeCroppedUri) {
        updateSticker({
          uri: nativeCroppedUri,
          originalUri: nativeCroppedUri,
          extension: 'png',
          format: 'PNG',
          animated: false,
        });
        return;
      }

      const dimensions = await getImageDimensions(normalized);
      if (!dimensions) throw new Error('Unable to read image dimensions.');
      const size = Math.min(dimensions.width, dimensions.height);
      const originX = Math.floor((dimensions.width - size) / 2);
      const originY = Math.floor((dimensions.height - size) / 2);
      const result = await ImageManipulator.manipulateAsync(
        normalized,
        [{ crop: { originX, originY, width: size, height: size } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG },
      );
      if (!result?.uri) throw new Error('Crop failed to produce an image.');
      updateSticker({
        uri: result.uri,
        originalUri: result.uri,
        extension: 'png',
        format: 'PNG',
        width: result.width,
        height: result.height,
        animated: false,
      });
    } catch (error) {
      Alert.alert('Crop failed', error?.message ?? 'Unable to crop this sticker.');
    } finally {
      setProcessing('');
    }
  };

  const handleApplyText = async () => {
    if (!previewUri) return;
    if (!overlayText.trim()) {
      Alert.alert('Add text', 'Type a label before applying text.');
      return;
    }
    if (!previewRef.current) return;
    setProcessing('text');
    try {
      const uri = await captureRef(previewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      if (!uri) throw new Error('Unable to capture text overlay.');
      updateSticker({
        uri,
        originalUri: uri,
        extension: 'png',
        format: 'PNG',
        overlayText: overlayText.trim(),
        animated: false,
      });
      setOverlayText('');
    } catch (error) {
      Alert.alert('Text failed', error?.message ?? 'Unable to apply text overlay.');
    } finally {
      setProcessing('');
    }
  };

  const handleRemoveBackground = async () => {
    if (!previewUri) return;

    const FileSystem = getExpoFileSystem();
    const canUseRemoteApi = Boolean(REMOVE_BG_API_KEY && FileSystem?.writeAsStringAsync);
    const canUseNativeLocal = isNativeStickerPreviewAvailable();

    setProcessing('remove');
    try {
      if (isAnimated) setPlayAnimated(false);
      const sourceForEdit = normalizeFilePath(previewImageUri || previewUri);
      const normalized = await ensureLocalPreviewUri(sourceForEdit, 'png');
      if (canUseRemoteApi) {
        try {
          const form = new FormData();
          form.append('image_file', {
            uri: normalized,
            name: 'sticker.png',
            type: 'image/png',
          });
          form.append('size', 'auto');

          const response = await fetch(REMOVE_BG_API_ENDPOINT, {
            method: 'POST',
            headers: {
              'X-Api-Key': REMOVE_BG_API_KEY,
            },
            body: form,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Remove background failed.');
          }

          const blob = await response.blob();
          const base64 = await blobToBase64(blob);
          if (!base64) throw new Error('Failed to decode background-removed image.');

          const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
          if (!baseDir) throw new Error('Cache directory unavailable.');
          const target = baseDir.endsWith('/')
            ? `${baseDir}bg-removed-${Date.now()}.png`
            : `${baseDir}/bg-removed-${Date.now()}.png`;

          await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });

          updateSticker({
            uri: target,
            originalUri: target,
            extension: 'png',
            format: 'PNG',
            animated: false,
          });
          return;
        } catch {
          // Fall through to local remover if remote API fails.
        }
      }

      if (!canUseNativeLocal) {
        throw new Error('Local remover not available in current build. Rebuild app or set remove.bg API key in src/config/editingConfig.js.');
      }

      const localUri = await removeStickerBackgroundBasic(normalized, { tolerance: 44 });
      if (!localUri) {
        throw new Error('Background removal failed on device. Try different sticker background or add remove.bg API key in src/config/editingConfig.js.');
      }

      updateSticker({
        uri: localUri,
        originalUri: localUri,
        extension: 'png',
        format: 'PNG',
        animated: false,
      });
    } catch (error) {
      Alert.alert('Remove background failed', error?.message ?? 'Unable to remove background.');
    } finally {
      setProcessing('');
    }
  };

  const overlayPreviewText = useMemo(() => overlayText.trim(), [overlayText]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.navButton} />
        <Text style={styles.title}>Edit Sticker</Text>
        <Pressable onPress={onBack} style={styles.nextButton}>
          <Text style={styles.nextText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.previewCard} ref={previewRef} collapsable={false}>
          {previewUri ? (
            isAnimated && !playAnimated ? (
              <View style={styles.animatedPreview}>
                {previewImageUri ? (
                  <Image
                    source={{ uri: previewImageUri }}
                    style={styles.previewImage}
                    resizeMode="contain"
                    resizeMethod="resize"
                    fadeDuration={0}
                  />
                ) : (
                  <>
                    <Text style={styles.animatedTitle}>Animated sticker</Text>
                    <Text style={styles.animatedNote}>Preview paused to keep things smooth.</Text>
                  </>
                )}
                <View style={styles.previewOverlay}>
                  {previewProcessing ? (
                    <View style={styles.previewStatus}>
                      <ActivityIndicator size="small" color={colors.primaryAccent} />
                      <Text style={styles.previewStatusText}>Preparing preview...</Text>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.playButton}
                      onPress={() => startAnimatedPlayback({ allowFallback: true, showAlerts: true })}
                    >
                      <Text style={styles.playButtonText}>Play preview</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : isAnimated && playAnimated && previewReady ? (
              <Video
                source={{ uri: previewVideoUri }}
                style={styles.previewImage}
                resizeMode="contain"
                shouldPlay={playAnimated}
                isLooping
                useNativeControls={false}
                isMuted
                onError={() => {
                  setPlayAnimated(false);
                  const source = playSourceRef.current;
                  playSourceRef.current = null;
                  if (source === 'manual') {
                    Alert.alert('Playback error', 'Unable to play the preview on this device.');
                  }
                }}
              />
            ) : isAnimated && playAnimated ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.previewImage}
                resizeMode="contain"
                fadeDuration={0}
              />
            ) : (
              <Image
                source={{ uri: previewUri }}
                style={styles.previewImage}
                resizeMode="contain"
                resizeMethod="resize"
                fadeDuration={0}
              />
            )
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.previewPlaceholderText}>No sticker selected</Text>
            </View>
          )}
          {isAnimated && previewUri && playAnimated ? (
            <Pressable
              style={styles.previewToggle}
              onPress={() => {
                playSourceRef.current = null;
                setPlayAnimated(false);
              }}
            >
              <Text style={styles.previewToggleText}>Pause preview</Text>
            </Pressable>
          ) : null}
          {overlayPreviewText && !isAnimated ? (
            <View style={styles.overlayBadge}>
              <Text style={styles.overlayText}>{overlayPreviewText}</Text>
            </View>
          ) : null}
          {isBusy && processing !== 'text' && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="small" color={colors.primaryAccent} />
              <Text style={styles.processingText}>{processing}...</Text>
            </View>
          )}
        </View>

        <View style={styles.toolsCard}>
          <Text style={styles.toolsTitle}>Quick edits</Text>
          <View style={styles.toolRow}>
            <ActionButton
              title="Crop square"
              variant="secondary"
              onPress={handleCropSquare}
              disabled={!canEditImage || isBusy}
              style={[styles.toolButton, styles.toolButtonLeft]}
              loading={processing === 'crop'}
            />
            <ActionButton
              title="Remove BG"
              variant="secondary"
              onPress={handleRemoveBackground}
              disabled={!canEditImage || isBusy}
              style={[styles.toolButton, styles.toolButtonRight]}
              loading={processing === 'remove'}
            />
          </View>
          <Text style={styles.toolsLabel}>Text overlay</Text>
          <View style={styles.textRow}>
            <TextInput
              style={styles.textInput}
              value={overlayText}
              onChangeText={setOverlayText}
              placeholder="Add a short caption"
              placeholderTextColor={colors.textMuted}
              editable={canEditImage && !isBusy}
            />
            <ActionButton
              title="Apply"
              onPress={handleApplyText}
              disabled={!canEditImage || isBusy}
              style={styles.applyButton}
              loading={processing === 'text'}
            />
          </View>
        </View>

        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Name</Text>
          <Text style={styles.metaValue}>{label}</Text>
          <Text style={styles.metaLabel}>Type</Text>
          <Text style={styles.metaValue}>{typeLabel}</Text>
          <Text style={styles.metaLabel}>Format</Text>
          <Text style={styles.metaValue}>{formatLabel}</Text>
        </View>

        <View style={styles.actions}>
          <ActionButton
            title="Set as tray icon"
            variant="secondary"
            onPress={() => onSetTrayIcon?.()}
            disabled={!sticker || isBusy}
          />
          <ActionButton
            title="Remove from pack"
            variant="outline"
            onPress={() => onRemove?.()}
            disabled={!sticker || isBusy}
            style={styles.removeButton}
          />
        </View>
      </ScrollView>
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
  nextButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.6),
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  nextText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(3),
  },
  previewCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.divider,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: 320,
  },
  previewPlaceholder: {
    height: 320,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  animatedPreview: {
    height: 320,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(2),
    position: 'relative',
  },
  animatedTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing(0.5),
  },
  animatedNote: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing(1.25),
  },
  playButton: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.7),
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAccent,
  },
  playButtonText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  previewStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewStatusText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginLeft: spacing(0.75),
  },
  previewOverlay: {
    position: 'absolute',
    bottom: spacing(1.5),
    alignSelf: 'center',
    backgroundColor: 'rgba(7, 25, 32, 0.75)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.6),
    borderWidth: 1,
    borderColor: colors.divider,
  },
  previewToggle: {
    position: 'absolute',
    top: spacing(1),
    right: spacing(1),
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.4),
    borderRadius: radius.pill,
    backgroundColor: 'rgba(7, 25, 32, 0.7)',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  previewToggleText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  previewPlaceholderText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  overlayBadge: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: spacing(2),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.6),
    borderRadius: radius.pill,
    backgroundColor: 'rgba(7, 25, 32, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(42, 171, 238, 0.5)',
  },
  overlayText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  processingOverlay: {
    position: 'absolute',
    top: spacing(1),
    right: spacing(1),
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(7, 25, 32, 0.7)',
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.4),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  processingText: {
    color: colors.textSecondary,
    fontSize: 11,
    marginLeft: spacing(0.5),
  },
  toolsCard: {
    marginTop: spacing(1.5),
    padding: spacing(1.5),
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  toolsTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing(1),
  },
  toolRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  toolButton: {
    flex: 1,
  },
  toolButtonLeft: {
    marginRight: spacing(0.8),
  },
  toolButtonRight: {
    marginLeft: spacing(0.8),
  },
  toolsLabel: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1,
    marginTop: spacing(1.5),
    marginBottom: spacing(0.5),
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.7),
    color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing(1),
  },
  applyButton: {
    minWidth: 90,
  },
  metaCard: {
    marginTop: spacing(1.5),
    padding: spacing(1.5),
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  metaLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing(0.8),
    letterSpacing: 1,
  },
  metaValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing(0.4),
  },
  actions: {
    marginTop: spacing(2),
  },
  removeButton: {
    marginTop: spacing(1),
  },
});

export default StickerEditScreen;
