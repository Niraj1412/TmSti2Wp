import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import ImagePicker from '../components/ImagePicker';
import StickerList from '../components/StickerList';
import StickerConverter from '../components/StickerConverter';
import TelegramImporter from '../components/TelegramImporter';
import ActionButton from '../components/ui/ActionButton';
import { buildStickerFromPath, normalizeFilePath } from '../utils/stickerUtils';
import { createStickerPack, addPackToWhatsApp } from '../services/stickerService';
import { colors, radius, shadows, spacing, typography } from '../styles/theme';

const stepsOrder = ['import', 'convert', 'assign', 'done'];
const stepTitles = {
  import: 'Bring your Telegram stickers in',
  convert: 'Optimise for WhatsApp',
  assign: 'Tag emojis for quick access',
  done: 'Publish to WhatsApp',
};

const stepDescriptions = {
  import: 'Scan Telegram cache automatically or select saved stickers from your gallery.',
  convert: 'We resize and compress each static sticker to match WhatsApp limits.',
  assign: 'Allow friends to find stickers faster by associating relevant emojis.',
  done: 'Review the pack metadata and push it to WhatsApp or start over.',
};

const HomeScreen = () => {
  const [step, setStep] = useState('import');
  const [importedStickers, setImportedStickers] = useState([]);
  const [convertedStickers, setConvertedStickers] = useState([]);
  const [conversionSummary, setConversionSummary] = useState(null);
  const [stickerPack, setStickerPack] = useState(null);
  const [loading, setLoading] = useState(false);
  const isExpoGo = Constants?.appOwnership === 'expo';
  const isUnavailable = isExpoGo || Platform.OS === 'web';

  const hasImported = useMemo(() => importedStickers.length > 0, [importedStickers]);
  const hasConverted = useMemo(() => convertedStickers.length > 0, [convertedStickers]);

  const currentStepIndex = Math.max(stepsOrder.indexOf(step), 0);
  const progressPercent =
    stepsOrder.length > 1 ? ((currentStepIndex + 1) / stepsOrder.length) * 100 : 25;

  const handleTelegramImported = stickers => {
    setImportedStickers(Array.isArray(stickers) ? stickers : []);
    setConvertedStickers([]);
    setConversionSummary(null);
    setStickerPack(null);
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
    setStickerPack(null);
    setStep('convert');
  };

  const handleConversionResult = (results, summary) => {
    const successful = (Array.isArray(results) ? results : []).filter(
      sticker => sticker?.status?.level !== 'error',
    );

    if (successful.length === 0) {
      Alert.alert('Conversion failed', 'No stickers passed the conversion step.');
      return;
    }

    setConvertedStickers(successful);
    setConversionSummary(summary);
    setStickerPack(null);
    setStep('assign');
  };

  const handleSummaryChange = summary => {
    setConversionSummary(summary);
  };

  const handleEmojisAssigned = async stickersWithEmojis => {
    if (!Array.isArray(stickersWithEmojis) || stickersWithEmojis.length < 3) {
      Alert.alert('Need more stickers', 'WhatsApp packs require at least 3 stickers.');
      return;
    }

    setLoading(true);
    const trayPath = stickersWithEmojis[0]?.image_file;

    const { success, pack, error } = await createStickerPack(stickersWithEmojis, trayPath);
    setLoading(false);

    if (!success) {
      Alert.alert('Error', error || 'Failed to create sticker pack.');
      return;
    }

    setStickerPack(pack);
    setStep('done');
    Alert.alert('Success', `Pack created: ${pack.identifier}`);
  };

  const handleAddToWhatsApp = async () => {
    if (!stickerPack) return;

    setLoading(true);
    const { success, message } = await addPackToWhatsApp(stickerPack.identifier, stickerPack.name);
    setLoading(false);

    if (success) {
      Alert.alert('Added to WhatsApp!', 'Open WhatsApp to use stickers.');
    } else {
      Alert.alert('Error', message || 'WhatsApp integration failed.');
    }
  };

  const reset = () => {
    setStep('import');
    setImportedStickers([]);
    setConvertedStickers([]);
    setConversionSummary(null);
    setStickerPack(null);
    setLoading(false);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.backdrop}>
          <View style={[styles.blob, styles.blobPrimary]} />
          <View style={[styles.blob, styles.blobAccent]} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Sticker Studio</Text>
          </View>
          <Text style={styles.heroTitle}>Design WhatsApp-ready sticker packs in minutes</Text>
          <Text style={styles.heroSubtitle}>
            Follow the guided workflow below to import, refine, and publish a polished sticker pack.
          </Text>

          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressStep}>
                Step {currentStepIndex + 1} of {stepsOrder.length}
              </Text>
              <Text style={styles.progressLabel}>{stepTitles[step]}</Text>
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
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>
                {conversionSummary?.failed ? conversionSummary.failed : 0}
              </Text>
              <Text style={styles.metricLabel}>Needs Fix</Text>
            </View>
          </View>
        </View>

        <View style={styles.stepContainer}>
          <View style={[styles.stepCard, styles.activeCard]}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepBadge}>Step 1</Text>
              <Text style={styles.stepTitle}>{stepTitles.import}</Text>
            </View>
            <Text style={styles.stepDescription}>{stepDescriptions.import}</Text>
            <View style={styles.stepBody}>
              <TelegramImporter onImported={handleTelegramImported} />
              <ImagePicker onImagesPicked={handleImagesPicked} loading={loading} />
            </View>
            {hasImported && (
              <ActionButton
                title="Continue to conversion"
                onPress={() => setStep('convert')}
                style={styles.primaryAction}
              />
            )}
          </View>

          {step === 'convert' && (
            <View style={[styles.stepCard, styles.activeCard]}>
              <View style={styles.stepHeader}>
                <Text style={styles.stepBadge}>Step 2</Text>
                <Text style={styles.stepTitle}>{stepTitles.convert}</Text>
              </View>
              <Text style={styles.stepDescription}>{stepDescriptions.convert}</Text>
              <StickerConverter
                stickers={importedStickers}
                onConverted={handleConversionResult}
                onSummaryChange={handleSummaryChange}
              />
              <View style={styles.inlineActions}>
                <ActionButton
                  title="Assign emojis"
                  onPress={() => setStep('assign')}
                  disabled={!hasConverted}
                  style={styles.inlinePrimary}
                />
                <ActionButton
                  title="Back to import"
                  variant="secondary"
                  onPress={() => setStep('import')}
                  style={styles.inlineSecondary}
                />
              </View>
            </View>
          )}

          {step === 'assign' && (
            <View style={[styles.stepCard, styles.activeCard]}>
              <View style={styles.stepHeader}>
                <Text style={styles.stepBadge}>Step 3</Text>
                <Text style={styles.stepTitle}>{stepTitles.assign}</Text>
              </View>
              <Text style={styles.stepDescription}>{stepDescriptions.assign}</Text>
              <StickerList
                stickers={convertedStickers}
                onEmojisAssigned={handleEmojisAssigned}
                loading={loading}
              />
              <View style={styles.inlineActions}>
                <ActionButton
                  title="Back to convert"
                  variant="secondary"
                  onPress={() => setStep('convert')}
                  style={styles.inlineFull}
                />
              </View>
            </View>
          )}

          {step === 'done' && (
            <View style={[styles.stepCard, styles.activeCard]}>
              <View style={styles.stepHeader}>
                <Text style={styles.stepBadge}>Step 4</Text>
                <Text style={styles.stepTitle}>{stepTitles.done}</Text>
              </View>
              <Text style={styles.stepDescription}>{stepDescriptions.done}</Text>

              <View style={styles.packSummary}>
                <View style={styles.packRow}>
                  <Text style={styles.packLabel}>Pack ID</Text>
                  <Text style={styles.packValue}>{stickerPack?.identifier}</Text>
                </View>
                <View style={styles.packRow}>
                  <Text style={styles.packLabel}>Tray image</Text>
                  <Text style={styles.packValue}>
                    {normalizeFilePath(stickerPack?.trayImage || '')}
                  </Text>
                </View>
                <View style={styles.packRow}>
                  <Text style={styles.packLabel}>Stickers included</Text>
                  <Text style={styles.packValue}>{convertedStickers.length}</Text>
                </View>
              </View>

              <View style={styles.inlineActions}>
                <ActionButton
                  title="Add to WhatsApp"
                  onPress={handleAddToWhatsApp}
                  disabled={loading || isUnavailable}
                  loading={loading}
                  style={styles.inlinePrimary}
                />
                <ActionButton
                  title="Create another pack"
                  variant="secondary"
                  onPress={reset}
                  style={styles.inlineSecondary}
                />
              </View>
            </View>
          )}
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
  content: {
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(2),
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: radius.pill,
    opacity: 0.45,
    transform: [{ rotate: '25deg' }],
  },
  blobPrimary: {
    backgroundColor: colors.primarySoft,
    top: -120,
    right: -80,
  },
  blobAccent: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    bottom: -140,
    left: -100,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(2.5),
    marginBottom: spacing(2.5),
    ...shadows.floating,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.5),
    marginBottom: spacing(1.5),
  },
  heroBadgeText: {
    ...typography.caption,
    color: colors.primaryAccent,
    fontWeight: '600',
  },
  heroTitle: {
    ...typography.hero,
    marginBottom: spacing(1),
  },
  heroSubtitle: {
    ...typography.body,
    marginBottom: spacing(2),
  },
  progressContainer: {
    marginBottom: spacing(2.5),
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing(1),
  },
  progressStep: {
    ...typography.caption,
    color: colors.textMuted,
  },
  progressLabel: {
    ...typography.subheading,
    color: colors.textPrimary,
  },
  progressBar: {
    height: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primaryAccent,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing(1),
    marginHorizontal: -spacing(0.75),
  },
  metricCard: {
    flex: 1,
    marginHorizontal: spacing(0.75),
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  metricValue: {
    ...typography.subheading,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing(0.5),
  },
  metricLabel: {
    ...typography.caption,
  },
  stepContainer: {
    marginTop: spacing(1),
  },
  stepCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(2),
    ...shadows.card,
    marginBottom: spacing(2),
  },
  activeCard: {
    borderWidth: 1,
    borderColor: colors.surfaceSubtle,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing(1.5),
  },
  stepBadge: {
    backgroundColor: colors.primarySoft,
    color: colors.primaryAccent,
    fontWeight: '600',
    borderRadius: radius.pill,
    paddingVertical: spacing(0.5),
    paddingHorizontal: spacing(1),
    marginRight: spacing(1),
  },
  stepTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
  },
  stepDescription: {
    ...typography.body,
  },
  stepBody: {
    marginTop: spacing(2),
  },
  primaryAction: {
    marginTop: spacing(2),
  },
  inlineActions: {
    marginTop: spacing(2),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlinePrimary: {
    flex: 1,
    marginRight: spacing(1),
  },
  inlineSecondary: {
    flex: 1,
  },
  inlineFull: {
    flex: 1,
  },
  packSummary: {
    marginTop: spacing(2),
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  packRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing(0.5),
  },
  packLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  packValue: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing(1),
  },
});

export default HomeScreen;
