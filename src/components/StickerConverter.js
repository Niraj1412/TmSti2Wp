import React, { useMemo, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Alert, Platform } from 'react-native';
import { getImageResizer, isImageResizerAvailable, getImageResizerError } from '../utils/imageResizerProxy';
import {
  STICKER_DIMENSION,
  STICKER_SIZE_LIMIT_BYTES,
  isSupportedStaticSticker,
  isAnimatedSticker,
  createStatus,
  normalizeFilePath,
} from '../utils/stickerUtils';
import ActionButton from './ui/ActionButton';
import { colors, spacing, typography, radius, shadows } from '../styles/theme';

const QUALITY_STEPS = [90, 80, 70, 60, 50];

export default function StickerConverter({ stickers, onConverted, onSummaryChange }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState(null);

  const { staticCount, animatedCount, totalCount } = useMemo(() => {
    const list = Array.isArray(stickers) ? stickers : [];
    return {
      staticCount: list.filter(isSupportedStaticSticker).length,
      animatedCount: list.filter(isAnimatedSticker).length,
      totalCount: list.length,
    };
  }, [stickers]);

  const convertStickers = async () => {
    if (!isImageResizerAvailable()) {
      const reason = getImageResizerError();
      Alert.alert('Image resizer unavailable', reason?.message ?? 'Install expo-image-manipulator or rebuild with native resizer.');
      return;
    }

    const list = Array.isArray(stickers) ? stickers : [];
    const supportedStickers = list.filter(isSupportedStaticSticker);
    const animatedStickers = list.filter(isAnimatedSticker);

    if (supportedStickers.length === 0) {
      const nothingToDoSummary = {
        total: list.length,
        converted: 0,
        failed: 0,
        animatedSkipped: animatedStickers.length,
        message: animatedStickers.length > 0
          ? 'Animated Telegram stickers (.tgs) are not supported yet.'
          : 'Import static stickers (.png/.jpg/.webp) to convert.',
      };
      setSummary(nothingToDoSummary);
      setProgress({ current: 0, total: 0 });
      onSummaryChange?.(nothingToDoSummary);
      onConverted?.([], nothingToDoSummary);
      return;
    }

    setLoading(true);
    setSummary(null);
    setProgress({ current: 0, total: supportedStickers.length });

    const converted = [];
    const failed = [];

    for (let index = 0; index < supportedStickers.length; index += 1) {
      const sticker = supportedStickers[index];
      try {
        const result = await convertSingleSticker(sticker);
        converted.push(result);
      } catch (error) {
        failed.push({ ...sticker, status: createStatus('Failed to convert', 'error', { detail: error.message }), error });
      }
      setProgress({ current: index + 1, total: supportedStickers.length });
    }
    setLoading(false);

    const conversionSummary = {
      total: list.length,
      converted: converted.length,
      failed: failed.length,
      animatedSkipped: animatedStickers.length,
      message: failed.length === 0 ? 'All static stickers converted successfully.' : 'Some stickers require manual attention.',
    };

    setSummary(conversionSummary);
    onSummaryChange?.(conversionSummary);
    onConverted?.([...converted, ...failed], conversionSummary);
  };

  const progressRatio = progress.total > 0 ? Math.min(progress.current / progress.total, 1) : 0;
  const isUnavailable = Platform.OS === 'web' || !isImageResizerAvailable();

  return (
    <View style={styles.container}>
      <ActionButton title="Convert to WhatsApp Format" onPress={convertStickers} disabled={loading || staticCount === 0 || isUnavailable} loading={loading} />
      {loading && (
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <ActivityIndicator size="small" color={colors.primaryAccent} />
            <Text style={styles.progressText}>Processing {progress.current}/{progress.total}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressTrackFill, { width: `${progressRatio * 100}%` }]} />
          </View>
          <Text style={styles.progressHint}>This may take a moment while we optimise sticker sizes for WhatsApp.</Text>
        </View>
      )}
      {!loading && summary && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryBadge} />
            <Text style={styles.summaryTitle}>Conversion summary</Text>
          </View>
          <Text style={styles.summaryMetric}>Converted: {summary.converted} / {summary.total}</Text>
          {summary.animatedSkipped > 0 && (<Text style={styles.summaryWarning}>Animated stickers skipped: {summary.animatedSkipped}</Text>)}
          {summary.failed > 0 && (<Text style={styles.summaryError}>Failed: {summary.failed}</Text>)}
          {!!summary.message && <Text style={styles.summaryMessage}>{summary.message}</Text>}
        </View>
      )}
    </View>
  );
}

const convertSingleSticker = async sticker => {
  const ImageResizer = getImageResizer();
  const format = 'WEBP';
  let lastError;
  const sourceUri = sticker?.uri || sticker?.originalUri;
  const normalizedSource = normalizeFilePath(sourceUri);
  if (!normalizedSource) throw new Error('Sticker path missing.');

  for (const quality of QUALITY_STEPS) {
    try {
      const resized = await ImageResizer.createResizedImage(
        normalizedSource,
        STICKER_DIMENSION,
        STICKER_DIMENSION,
        format,
        quality,
        0,
        undefined,
        false,
        { mode: 'contain' },
      );
      const finalUri = resized.uri;
      const normalizedFinal = normalizeFilePath(finalUri);
      const fileStat = await safeStat(normalizedFinal);
      if (fileStat && fileStat.size <= STICKER_SIZE_LIMIT_BYTES) {
        return { ...sticker, uri: normalizedFinal, width: resized.width ?? STICKER_DIMENSION, height: resized.height ?? STICKER_DIMENSION, size: fileStat?.size ?? null, qualityUsed: quality, status: createStatus('Ready for WhatsApp', 'success', { quality }), format };
      }
      lastError = new Error('File exceeds 100KB after resizing.');
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error('Unable to convert sticker.');
};

const safeStat = async uri => {
  try {
    const FileSystem = require('expo-file-system');
    const normalized = /^(file|content):\/\//.test(uri || '') ? uri : `file://${uri}`;
    const info = await FileSystem.getInfoAsync(normalized);
    return { size: info?.size ?? null };
  } catch { return null; }
};

const styles = StyleSheet.create({
  container: { marginTop: spacing(1.5) },
  progressCard: { marginTop: spacing(1.5), borderRadius: radius.lg, backgroundColor: colors.surfaceSubtle, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2) },
  progressHeader: { flexDirection: 'row', alignItems: 'center' },
  progressText: { ...typography.body, marginLeft: spacing(1), color: colors.textPrimary },
  progressTrack: { marginTop: spacing(1.25), height: 6, borderRadius: radius.sm, backgroundColor: colors.divider, overflow: 'hidden' },
  progressTrackFill: { height: '100%', backgroundColor: colors.primaryAccent },
  progressHint: { ...typography.caption, marginTop: spacing(1.25) },
  summaryCard: { marginTop: spacing(1.75), borderRadius: radius.lg, backgroundColor: colors.surfaceSubtle, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2), ...shadows.card },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(1) },
  summaryBadge: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primaryAccent, marginRight: spacing(1) },
  summaryTitle: { ...typography.subheading, color: colors.textPrimary },
  summaryMetric: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  summaryWarning: { ...typography.caption, color: colors.warning },
  summaryError: { ...typography.caption, color: colors.error },
  summaryMessage: { ...typography.caption, marginTop: spacing(0.75) },
});
