import React, { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { getRNFS } from '../utils/fsProxy';
import { buildStickerFromPath, createStatus, getFileExtension, normalizeFilePath } from '../utils/stickerUtils';
import { ensureLocalFileUri } from '../services/stickerConverter';
import { convertVideoToAnimatedWebp, isFfmpegAvailable } from '../utils/videoStickerConverter';
import ActionButton from './ui/ActionButton';
import { colors, radius, spacing, typography } from '../styles/theme';

const MAX_ANIM_DURATION_SECONDS = 3;
const MIN_ANIM_DURATION_SECONDS = 0.5;

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

const getVideoPicker = () => {
  try {
    const rnPicker = require('react-native-image-picker');
    if (rnPicker && typeof rnPicker.launchImageLibrary === 'function') {
      return { type: 'rn', api: rnPicker };
    }
  } catch {
    /* ignore */
  }
  try {
    const picker = require('expo-image-picker');
    if (picker && typeof picker.launchImageLibraryAsync === 'function') {
      return { type: 'expo', api: picker };
    }
  } catch {
    /* ignore */
  }
  return null;
};

  const ensureLocalVideoUri = async (uri, nameHint) => {
  const ext = getFileExtension(nameHint || uri) || 'mp4';
  return ensureLocalFileUri(uri, ext);
};

  const getDurationMs = duration => {
  if (!Number.isFinite(duration)) return null;
  if (duration > 10000) return Math.round(duration);
  return Math.round(duration * 1000);
};

const getAssetKind = asset => {
  if (!asset) return null;
  const ext = getFileExtension(asset?.fileName || asset?.filename || asset?.uri);
  const mime = asset?.mimeType || asset?.type;
  if (asset?.type === 'video') return 'video';
  if (ext === 'gif' || (typeof mime === 'string' && mime.includes('gif'))) return 'gif';
  if (typeof mime === 'string' && mime.startsWith('video/')) return 'video';
  if (['mp4', 'webm', 'mkv', 'mov'].includes(ext)) return 'video';
  return null;
};

const VideoStickerImporter = ({ onImported }) => {
  const [processing, setProcessing] = useState(false);
  const [videoAsset, setVideoAsset] = useState(null);
  const [trimStart, setTrimStart] = useState('0');
  const [trimDuration, setTrimDuration] = useState(String(MAX_ANIM_DURATION_SECONDS));
  const disabled = Platform.OS === 'web';
  const durationSeconds = useMemo(
    () => (videoAsset?.durationMs ? Math.max(1, Math.round(videoAsset.durationMs / 1000)) : null),
    [videoAsset],
  );

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const handlePickVideo = async () => {
    if (processing) return;
    const picker = getVideoPicker();
    if (!picker) {
      Alert.alert('Video picker unavailable', 'Install react-native-image-picker or expo-image-picker and rebuild the app.');
      return;
    }

    try {
      let asset = null;
      if (picker.type === 'rn') {
        const result = await picker.api.launchImageLibrary({
          mediaType: 'mixed',
          selectionLimit: 1,
        });
        if (result?.didCancel) return;
        if (result?.errorCode) {
          throw new Error(result?.errorMessage || 'Unable to open the picker.');
        }
        asset = Array.isArray(result?.assets) ? result.assets[0] : null;
      } else {
        const permission = await picker.api.requestMediaLibraryPermissionsAsync();
        if (!permission?.granted) {
          Alert.alert('Permission needed', 'Allow access to your media library to pick a video.');
          return;
        }
        const result = await picker.api.launchImageLibraryAsync({
          mediaTypes: picker.api.MediaType?.All ?? picker.api.MediaTypeOptions?.All ?? 'all',
          allowsMultipleSelection: false,
          quality: 1,
        });
        if (result?.canceled) return;
        asset = Array.isArray(result?.assets) ? result.assets[0] : null;
      }
      const videoUri = asset?.uri;
      if (!videoUri) {
        Alert.alert('No video selected', 'Pick a video to convert into an animated sticker.');
        return;
      }
      const assetKind = getAssetKind(asset);
      if (!assetKind) {
        Alert.alert('Unsupported file', 'Pick a video or GIF for animated stickers. Use the image importer for static stickers.');
        return;
      }

      setProcessing(true);
      const safeUri = await ensureLocalVideoUri(videoUri, asset?.fileName || asset?.filename);
      if (!safeUri || /^content:\/\//i.test(safeUri)) {
        Alert.alert('Video access blocked', 'Unable to read this video. Save it to Downloads and pick again.');
        return;
      }
      const durationMs = getDurationMs(asset?.duration);
      const maxDuration = durationMs
        ? Math.min(MAX_ANIM_DURATION_SECONDS, Math.max(1, Math.round(durationMs / 1000)))
        : MAX_ANIM_DURATION_SECONDS;
      setVideoAsset({
        uri: safeUri,
        name: asset?.fileName || asset?.filename || 'video',
        durationMs,
        kind: assetKind,
      });
      setTrimStart('0');
      setTrimDuration(String(maxDuration));
    } catch (error) {
      Alert.alert('Video import failed', error?.message ?? 'Unable to load this video.');
    } finally {
      setProcessing(false);
    }
  };

  const handleConvertVideo = async () => {
    if (!videoAsset?.uri) {
      Alert.alert('No video selected', 'Pick a video first.');
      return;
    }
    if (!isFfmpegAvailable()) {
      Alert.alert('Video conversion unavailable', 'Install ffmpeg-kit-react-native and rebuild the app.');
      return;
    }

    const totalSeconds = durationSeconds || MAX_ANIM_DURATION_SECONDS;
    const startValue = Number.parseFloat(trimStart);
    const durationValue = Number.parseFloat(trimDuration);
    const safeStart = Number.isFinite(startValue)
      ? clamp(startValue, 0, Math.max(0, totalSeconds - MIN_ANIM_DURATION_SECONDS))
      : 0;
    const maxDuration = Math.min(MAX_ANIM_DURATION_SECONDS, Math.max(MIN_ANIM_DURATION_SECONDS, totalSeconds - safeStart));
    const safeDuration = Number.isFinite(durationValue) ? clamp(durationValue, MIN_ANIM_DURATION_SECONDS, maxDuration) : maxDuration;

    setProcessing(true);
    try {
      const localUri = await ensureLocalVideoUri(videoAsset.uri, videoAsset.name);
      const result = await convertVideoToAnimatedWebp({
        uri: localUri,
        startSeconds: safeStart,
        durationSeconds: safeDuration,
      });
      const sticker = buildStickerFromPath(result.uri, {
        source: 'video',
        animated: true,
        status: createStatus('Animated sticker ready', 'success', { duration: safeDuration }),
      });
      onImported?.([sticker]);
      setVideoAsset(null);
    } catch (error) {
      Alert.alert('Video conversion failed', error?.message ?? 'Unable to create an animated sticker.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Convert video to animated sticker</Text>
        <Text style={styles.badge}>New</Text>
      </View>
      <Text style={styles.caption}>
        Pick a video, select the segment, and export a WhatsApp-ready animated WebP (max {MAX_ANIM_DURATION_SECONDS}s).
      </Text>
      <ActionButton
        title={processing ? 'Loading video...' : 'Choose Video'}
        onPress={handlePickVideo}
        disabled={processing || disabled}
        loading={processing}
        variant="outline"
      />
      {videoAsset && (
        <View style={styles.trimCard}>
          <Text style={styles.metaText}>
            Selected: {videoAsset.name}{durationSeconds ? ` - ${durationSeconds}s` : ''}
          </Text>
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Start (sec)</Text>
              <TextInput
                style={styles.fieldInput}
                value={trimStart}
                onChangeText={setTrimStart}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Length (sec)</Text>
              <TextInput
                style={styles.fieldInput}
                value={trimDuration}
                onChangeText={setTrimDuration}
                keyboardType="numeric"
                placeholder={`${MAX_ANIM_DURATION_SECONDS}`}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
          <Text style={styles.helperText}>
            WhatsApp animated stickers are limited to {MAX_ANIM_DURATION_SECONDS}s and 1MB.
          </Text>
          <ActionButton
            title={processing ? 'Creating sticker...' : 'Create animated sticker'}
            onPress={handleConvertVideo}
            disabled={processing || disabled}
            loading={processing}
          />
        </View>
      )}
      {disabled && (
        <Text style={[styles.caption, { marginTop: spacing(0.75) }]}>Video conversion is not available on web.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    paddingVertical: spacing(1.75),
    paddingHorizontal: spacing(2.25),
    marginTop: spacing(1.25),
    borderWidth: 1,
    borderColor: colors.divider,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(0.5) },
  title: { ...typography.subheading, color: colors.textPrimary, fontWeight: '700' },
  badge: { ...typography.caption, color: colors.primary, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing(1), paddingVertical: spacing(0.35), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider },
  caption: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing(1) },
  trimCard: { marginTop: spacing(1.25), padding: spacing(1.5), backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider },
  metaText: { ...typography.caption, color: colors.textMuted, marginBottom: spacing(1) },
  fieldRow: { flexDirection: 'row', marginHorizontal: -spacing(0.5) },
  field: { flex: 1, marginHorizontal: spacing(0.5) },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing(0.4) },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.6),
    color: colors.textPrimary,
    ...typography.body,
  },
  helperText: { ...typography.caption, color: colors.textMuted, marginTop: spacing(0.75), marginBottom: spacing(1) },
});

export default VideoStickerImporter;
