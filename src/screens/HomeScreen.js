import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const [convertedStickers, setConvertedStickers] = useState([]);
  const [conversionSummary, setConversionSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const hasImported = useMemo(() => importedStickers.length > 0, [importedStickers]);
  const hasConverted = useMemo(() => convertedStickers.length > 0, [convertedStickers]);

  const currentStepIndex = Math.max(stepsOrder.indexOf(step), 0);
  const progressPercent = stepsOrder.length > 1 ? ((currentStepIndex + 1) / stepsOrder.length) * 100 : 25;

  const handleTelegramImported = stickers => {
    setImportedStickers(Array.isArray(stickers) ? stickers : []);
    setConvertedStickers([]);
    setConversionSummary(null);
    setStep('convert');
  };

  const handleImagesPicked = paths => {
    const mapped = (Array.isArray(paths) ? paths : [])
      .map(path => buildStickerFromPath(path, { source: 'gallery' }))
      .filter(Boolean);

    if (mapped.length === 0) {
      Alert.alert('No images selected', 'Pick at least one Telegram sticker.');
      return;
    }

    setImportedStickers(mapped);
    setConvertedStickers([]);
    setConversionSummary(null);
    setStep('convert');
  };

  const handleConversionResult = (results, summary) => {
    const successful = (Array.isArray(results) ? results : []).filter(
      sticker => sticker?.status?.level !== 'error',
    );

    setConvertedStickers(successful);
    setConversionSummary(summary);
    setStep('done');
  };

  const reset = () => {
    setStep('import');
    setImportedStickers([]);
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
              <Text style={styles.metricValue}>{importedStickers.length}</Text>
              <Text style={styles.metricLabel}>Imported</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{convertedStickers.length}</Text>
              <Text style={styles.metricLabel}>Converted</Text>
            </View>
          </View>
        </View>

        <TelegramImporter onImported={handleTelegramImported} />
        <ImagePicker onImagesPicked={handleImagesPicked} loading={loading} />
        {hasImported && (
          <StickerList items={importedStickers} title="Selected stickers" />
        )}
        {hasImported && (
          <StickerConverter
            stickers={importedStickers}
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
