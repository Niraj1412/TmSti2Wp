import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { isImageResizerAvailable, getImageResizerError } from '../utils/imageResizerProxy';
import {
  isSupportedStaticSticker,
  isAnimatedSticker,
  isAnimatedWebpSticker,
  createStatus,
  getFileExtension,
} from '../utils/stickerUtils';
import {
  convertAnimatedSticker,
  convertStaticSticker,
  isTgsConverterAvailable,
  prepareAnimatedWebpSticker,
  tryUseOriginalSticker,
} from '../services/stickerConverter';
import { isFfmpegAvailable } from '../utils/videoStickerConverter';
import ActionButton from './ui/ActionButton';
import { colors, spacing, typography, radius, shadows } from '../styles/theme';

export default function StickerConverter({ stickers, onConverted, onSummaryChange, autoStart = false }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState(null);
  const autoStartedRef = useRef(false);

  const { staticCount, animatedCount } = useMemo(() => {
    const list = Array.isArray(stickers) ? stickers : [];
    return {
      staticCount: list.filter(isSupportedStaticSticker).length,
      animatedCount: list.filter(isAnimatedSticker).length,
    };
  }, [stickers]);

  const convertStickers = useCallback(async () => {
    const list = Array.isArray(stickers) ? stickers : [];
    const supportedStickers = list.filter(isSupportedStaticSticker);
    const animatedStickers = list.filter(isAnimatedSticker);
    const animatedWebpStickers = animatedStickers.filter(isAnimatedWebpSticker);
    const animatedNeedsConversion = animatedStickers.filter(sticker => !isAnimatedWebpSticker(sticker));

    console.log('[StickerConverter] Starting conversion', {
      total: list.length,
      staticCount: supportedStickers.length,
      animatedCount: animatedStickers.length,
    });

    if (supportedStickers.length > 0 && !isImageResizerAvailable()) {
      const reason = getImageResizerError();
      Alert.alert('Image resizer unavailable', reason?.message ?? 'Install expo-image-manipulator or rebuild with native resizer.');
      return;
    }

    const totalWork = supportedStickers.length + animatedNeedsConversion.length;
    if (totalWork === 0 && animatedWebpStickers.length === 0) {
      const nothingToDoSummary = {
        total: list.length,
        converted: 0,
        failed: 0,
        animatedSkipped: 0,
        message: 'Import static stickers (.png/.jpg/.webp) or an animated sticker to convert.',
      };
      setSummary(nothingToDoSummary);
      setProgress({ current: 0, total: 0 });
      onSummaryChange?.(nothingToDoSummary);
      onConverted?.([], nothingToDoSummary);
      return;
    }

    setLoading(true);
    setSummary(null);
    setProgress({ current: 0, total: totalWork });

    const converted = [];
    const failed = [];
    let preservedCount = 0;
    let animatedReady = 0;
    let progressCount = 0;
    const skipMessages = new Set();

    const preparedAnimated = await Promise.all(
      animatedWebpStickers.map(async sticker => {
        try {
          return await prepareAnimatedWebpSticker(sticker);
        } catch (error) {
          failed.push({ ...sticker, status: createStatus('Failed to prepare animated sticker', 'error', { detail: error.message }), error });
          return null;
        }
      }),
    );
    preparedAnimated.filter(Boolean).forEach(item => {
      animatedReady += 1;
      converted.push(item);
    });

    const canFfmpeg = isFfmpegAvailable();
    const canTgs = isTgsConverterAvailable();
    const animatedToConvert = animatedNeedsConversion.filter(sticker => {
      const ext = (sticker?.extension || getFileExtension(sticker?.name || sticker?.uri || '')).toLowerCase();
      if (ext === 'tgs' && !canTgs) {
        skipMessages.add('TGS conversion is not available in this build. Animated Telegram stickers were skipped.');
        failed.push({ ...sticker, status: createStatus('TGS conversion unavailable', 'error', { detail: 'Missing native TGS renderer.' }) });
        return false;
      }
      if (ext !== 'tgs' && !canFfmpeg) {
        skipMessages.add('FFmpeg is missing in this build. Video/GIF stickers were skipped.');
        failed.push({ ...sticker, status: createStatus('FFmpeg unavailable', 'error', { detail: 'FFmpeg is not available.' }) });
        return false;
      }
      return true;
    });

    for (const sticker of animatedToConvert) {
      try {
        const result = await convertAnimatedSticker(sticker, { maxDurationSeconds: 3, fps: 15 });
        converted.push(result);
        animatedReady += 1;
      } catch (error) {
        failed.push({ ...sticker, status: createStatus('Failed to convert animated sticker', 'error', { detail: error.message }), error });
      }
      progressCount += 1;
      setProgress({ current: progressCount, total: totalWork });
    }

    if (supportedStickers.length === 0) {
      setLoading(false);
      const messageParts = [];
      messageParts.push(animatedReady > 0 ? 'Animated stickers are ready for WhatsApp.' : 'Unable to prepare animated stickers.');
      skipMessages.forEach(message => messageParts.push(message));
      const conversionSummary = {
        total: list.length,
        converted: converted.length,
        failed: failed.length,
        animatedSkipped: failed.filter(item => item?.status?.label?.includes('unavailable')).length,
        animatedReady,
        message: messageParts.join(' '),
      };
      setSummary(conversionSummary);
      setProgress({ current: 0, total: 0 });
      onSummaryChange?.(conversionSummary);
      onConverted?.([...converted, ...failed], conversionSummary);
      return;
    }

    const preservedCandidates = await Promise.all(
      supportedStickers.map(sticker => tryUseOriginalSticker(sticker)),
    );
    const allPreserved = preservedCandidates.length > 0 && preservedCandidates.every(Boolean);
    if (allPreserved) {
      const preserved = preservedCandidates.filter(Boolean);
      preservedCount = preserved.length;
      converted.push(...preserved);
      progressCount += supportedStickers.length;
      setProgress({ current: progressCount, total: totalWork });
    } else {
      for (let index = 0; index < supportedStickers.length; index += 1) {
        const sticker = supportedStickers[index];
        try {
          const preserved = preservedCandidates[index];
          if (preserved) {
            preservedCount += 1;
            converted.push(preserved);
            progressCount += 1;
            setProgress({ current: progressCount, total: totalWork });
            continue;
          }
          const result = await convertStaticSticker(sticker);
          converted.push(result);
        } catch (error) {
          failed.push({ ...sticker, status: createStatus('Failed to convert', 'error', { detail: error.message }), error });
        }
        progressCount += 1;
        setProgress({ current: progressCount, total: totalWork });
      }
    }
    setLoading(false);

    const tooLargeCount = failed.filter(item => item?.status?.detail?.includes('100KB')).length;
    const tooLargeAnimatedCount = failed.filter(item => item?.status?.detail?.includes('1MB')).length;
    const otherFailedCount = failed.length - tooLargeCount - tooLargeAnimatedCount;
    const messageParts = [];
    if (failed.length === 0) {
      messageParts.push('All static stickers converted successfully.');
    } else {
      if (tooLargeCount > 0) {
        messageParts.push("Some stickers are still above WhatsApp's 100KB limit. Try simpler images or remove backgrounds.");
      }
      if (tooLargeAnimatedCount > 0) {
        messageParts.push("Some animated stickers are still above WhatsApp's 1MB limit. Shorten the clip or reduce motion.");
      }
      if (otherFailedCount > 0) {
        messageParts.push('Some stickers could not be processed. Try re-exporting them as .webp/.png or shorten animations.');
      }
    }
    if (animatedReady > 0) {
      messageParts.push(`${animatedReady} animated stickers are ready for WhatsApp.`);
    }
    if (preservedCount > 0) {
      messageParts.push(`${preservedCount} stickers were already WhatsApp-ready and kept without changes.`);
    }
    skipMessages.forEach(message => messageParts.push(message));

    const conversionSummary = {
      total: list.length,
      converted: converted.length,
      failed: failed.length,
      animatedSkipped: failed.filter(item => item?.status?.label?.includes('unavailable')).length,
      animatedReady,
      originalPreserved: preservedCount,
      message: messageParts.join(' '),
    };

    setSummary(conversionSummary);
    onSummaryChange?.(conversionSummary);
    onConverted?.([...converted, ...failed], conversionSummary);
    console.log('[StickerConverter] Conversion summary', conversionSummary);
  }, [stickers, onConverted, onSummaryChange]);

  useEffect(() => {
    if (!autoStart) {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current || loading) return;
    autoStartedRef.current = true;
    convertStickers();
  }, [autoStart, convertStickers, loading]);

  const progressRatio = progress.total > 0 ? Math.min(progress.current / progress.total, 1) : 0;
  const needsResizer = staticCount > 0;
  const isUnavailable = Platform.OS === 'web' || (needsResizer && !isImageResizerAvailable());

  const canConvert = staticCount > 0 || animatedCount > 0;

  return (
    <View style={styles.container}>
      <ActionButton title="Convert to WhatsApp Format" onPress={convertStickers} disabled={loading || !canConvert || isUnavailable} loading={loading} />
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
          {summary.animatedReady > 0 && (<Text style={styles.summaryWarning}>Animated ready: {summary.animatedReady}</Text>)}
          {summary.animatedSkipped > 0 && (<Text style={styles.summaryWarning}>Animated stickers skipped: {summary.animatedSkipped}</Text>)}
          {summary.failed > 0 && (<Text style={styles.summaryError}>Failed: {summary.failed}</Text>)}
          {!!summary.message && <Text style={styles.summaryMessage}>{summary.message}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing(1.5) },
  progressCard: { marginTop: spacing(1.5), borderRadius: radius.lg, backgroundColor: colors.surfaceElevated, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2), borderWidth: 1, borderColor: colors.divider },
  progressHeader: { flexDirection: 'row', alignItems: 'center' },
  progressText: { ...typography.body, marginLeft: spacing(1), color: colors.textPrimary },
  progressTrack: { marginTop: spacing(1.25), height: 8, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt, overflow: 'hidden', borderWidth: 1, borderColor: colors.divider },
  progressTrackFill: { height: '100%', backgroundColor: colors.primary },
  progressHint: { ...typography.caption, marginTop: spacing(1.25), color: colors.textMuted },
  summaryCard: { marginTop: spacing(1.75), borderRadius: radius.lg, backgroundColor: colors.surface, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2), borderWidth: 1, borderColor: colors.divider, ...shadows.card },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(1) },
  summaryBadge: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primaryAccent, marginRight: spacing(1) },
  summaryTitle: { ...typography.subheading, color: colors.textPrimary },
  summaryMetric: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  summaryWarning: { ...typography.caption, color: colors.warning },
  summaryError: { ...typography.caption, color: colors.error },
  summaryMessage: { ...typography.caption, marginTop: spacing(0.75), color: colors.textMuted },
});
