import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import ImagePicker from '../components/ImagePicker';
import StickerConverter from '../components/StickerConverter';
import StickerList from '../components/StickerList';
import TelegramImporter from '../components/TelegramImporter';
import { buildStickerFromPath, normalizeFilePath } from '../utils/stickerUtils';
import ActionButton from '../components/ui/ActionButton';
import { colors, spacing, typography, radius, shadows } from '../styles/theme';

const stepsOrder = ['import', 'convert', 'assign', 'done'];

const HomeScreen = () => {
  const [step, setStep] = useState('import');
  const [importedStickers, setImportedStickers] = useState([]);
  const [selectedStickerIds, setSelectedStickerIds] = useState(new Set());
  const [convertedStickers, setConvertedStickers] = useState([]);
  const [conversionSummary, setConversionSummary] = useState(null);

  const selectedStickers = useMemo(
    () => importedStickers.filter(item => selectedStickerIds.has(item.id)),
    [importedStickers, selectedStickerIds],
  );

  const hasImported = useMemo(() => importedStickers.length > 0, [importedStickers]);
  const hasConverted = useMemo(() => convertedStickers.length > 0, [convertedStickers]);

  const currentStepIndex = Math.max(stepsOrder.indexOf(step), 0);
  const progressPercent = stepsOrder.length > 1 ? ((currentStepIndex + 1) / stepsOrder.length) * 100 : 25;

  const mergeAndSelectStickers = (items, source) => {
    const mapped = (Array.isArray(items) ? items : [])
      .map(item => {
        if (item?.id && item?.uri) return { ...item, source: item?.source ?? source };
        const path = item?.originalUri || item?.uri || item?.path || item;
        return buildStickerFromPath(path, { source });
      })
      .filter(Boolean);

    if (mapped.length === 0) {
      Alert.alert('No stickers found', 'We could not read any sticker files to import.');
      return;
    }

    const existingUris = new Set(importedStickers.map(sticker => normalizeFilePath(sticker.originalUri || sticker.uri)));
    const unique = [];

    mapped.forEach(sticker => {
      const normalized = normalizeFilePath(sticker.originalUri || sticker.uri);
      if (!normalized || existingUris.has(normalized)) return;
      existingUris.add(normalized);
      unique.push(sticker);
    });

    if (unique.length === 0) {
      Alert.alert('Nothing new', 'These stickers are already in your selection.');
      return;
    }

    setImportedStickers(prev => [...prev, ...unique]);
    setSelectedStickerIds(prev => new Set([...prev, ...unique.map(sticker => sticker.id)]));
    setConvertedStickers([]);
    setConversionSummary(null);
    setStep('convert');
  };

  const handleTelegramImported = stickers => mergeAndSelectStickers(stickers, 'telegram');

  const handleImagesPicked = paths => {
    const mapped = (Array.isArray(paths) ? paths : [])
      .map(path => buildStickerFromPath(path, { source: 'gallery' }))
      .filter(Boolean);
    mergeAndSelectStickers(mapped, 'gallery');
  };

  const handleConversionResult = (results, summary) => {
    const successful = (Array.isArray(results) ? results : []).filter(
      sticker => sticker?.status?.level !== 'error',
    );

    setConvertedStickers(successful);
    setConversionSummary(summary);
    setStep('done');
  };

  const toggleStickerSelection = sticker => {
    if (!sticker?.id) return;
    setSelectedStickerIds(prev => {
      const next = new Set(prev);
      if (next.has(sticker.id)) next.delete(sticker.id);
      else next.add(sticker.id);
      return next;
    });
    setConvertedStickers([]);
    setConversionSummary(null);
    setStep('convert');
  };

  const reset = () => {
    setStep('import');
    setImportedStickers([]);
    setSelectedStickerIds(new Set());
    setConvertedStickers([]);
    setConversionSummary(null);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.backdrop}>
          <View style={[styles.blob, styles.blobPrimary]} />
          <View style={[styles.blob, styles.blobAccent]} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Telegram → WhatsApp</Text>
          </View>
          <Text style={styles.heroTitle}>Convert Telegram stickers to WhatsApp</Text>
          <Text style={styles.heroSubtitle}>
            Import your Telegram stickers, convert to 512×512 WEBP under 100KB, then add to WhatsApp.
          </Text>

          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressStep}>Step {currentStepIndex + 1} / {stepsOrder.length}</Text>
              <Text style={styles.progressLabel}>{step.toUpperCase()}</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{selectedStickers.length}</Text>
              <Text style={styles.metricLabel}>Selected</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{convertedStickers.length}</Text>
              <Text style={styles.metricLabel}>Converted</Text>
            </View>
          </View>
        </View>

        <TelegramImporter onImported={handleTelegramImported} existingStickers={importedStickers} />
        <ImagePicker onImagesPicked={handleImagesPicked} />
        {hasImported && (
          <StickerList
            items={importedStickers}
            title="Choose stickers to convert"
            selectable
            selectedIds={selectedStickerIds}
            onToggleSelect={toggleStickerSelection}
          />
        )}
        {hasImported && (
          <StickerConverter
            stickers={selectedStickers}
            onConverted={handleConversionResult}
            onSummaryChange={setConversionSummary}
          />
        )}

        {hasConverted && (
          <View style={styles.inlineActions}>
            <ActionButton title="Create another pack" variant="secondary" onPress={reset} style={styles.inlineSecondary} />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing(3), paddingHorizontal: spacing(2) },
  backdrop: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  blob: { position: 'absolute', width: 280, height: 280, borderRadius: radius.pill, opacity: 0.45, transform: [{ rotate: '25deg' }] },
  blobPrimary: { backgroundColor: colors.primarySoft, top: -120, right: -80 },
  blobAccent: { backgroundColor: 'rgba(245, 158, 11, 0.12)', bottom: -140, left: -100 },
  heroCard: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing(3), paddingHorizontal: spacing(2.5), marginBottom: spacing(2.5), ...shadows.floating },
  heroBadge: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing(1.25), paddingVertical: spacing(0.5), marginBottom: spacing(1.5) },
  heroBadgeText: { ...typography.caption, color: colors.primaryAccent, fontWeight: '600' },
  heroTitle: { ...typography.hero, marginBottom: spacing(1) },
  heroSubtitle: { ...typography.body, marginBottom: spacing(2) },
  progressContainer: { marginBottom: spacing(2.5) },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing(1) },
  progressStep: { ...typography.caption, color: colors.textMuted },
  progressLabel: { ...typography.subheading, color: colors.textPrimary },
  progressBar: { height: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primaryAccent },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing(1), marginHorizontal: -spacing(0.75) },
  metricCard: { flex: 1, backgroundColor: colors.surfaceSubtle, borderRadius: radius.md, padding: spacing(1.25), marginHorizontal: spacing(0.75) },
  metricValue: { ...typography.heading, textAlign: 'center' },
  metricLabel: { ...typography.caption, textAlign: 'center' },
  inlineActions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: spacing(2) },
  inlineSecondary: { marginLeft: spacing(1) },
});

export default HomeScreen;
