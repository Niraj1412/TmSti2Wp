import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import ImagePicker from '../components/ImagePicker';
import StickerConverter from '../components/StickerConverter';
import StickerList from '../components/StickerList';
import VideoStickerImporter from '../components/VideoStickerImporter';
import { buildStickerFromPath, decodeBase64ToBytes, getFileExtension, isAnimatedWebpHeader, isSupportedStaticSticker, normalizeFilePath } from '../utils/stickerUtils';
import { extractStickerFilesFromZip, isTgsLikeUri, isZipLikeUri } from '../utils/packImporter';
import { getImageResizer, getImageResizerError, isImageResizerAvailable } from '../utils/imageResizerProxy';
import ActionButton from '../components/ui/ActionButton';
import { colors, spacing, typography, radius, shadows } from '../styles/theme';
import { addPackToWhatsApp, createWhatsAppPack, isPackAddedToWhatsApp } from '../services/whatsappService';
import { getRNFS } from '../utils/fsProxy';

const stepsOrder = ['import', 'convert', 'add', 'done'];
const TRAY_ICON_SIZE = 96;

const HomeScreen = () => {
  const [step, setStep] = useState('import');
  const [importedStickers, setImportedStickers] = useState([]);
  const [selectedStickerIds, setSelectedStickerIds] = useState(new Set());
  const [convertedStickers, setConvertedStickers] = useState([]);
  const [addingToWhatsApp, setAddingToWhatsApp] = useState(false);
  const [autoConvert, setAutoConvert] = useState(false);
  const [addSectionOffset, setAddSectionOffset] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const scrollRef = useRef(null);

  const selectedStickers = useMemo(
    () => importedStickers.filter(item => selectedStickerIds.has(item.id)),
    [importedStickers, selectedStickerIds],
  );

  const hasImported = useMemo(() => importedStickers.length > 0, [importedStickers]);
  const hasConverted = useMemo(() => convertedStickers.length > 0, [convertedStickers]);

  const currentStepIndex = Math.max(stepsOrder.indexOf(step), 0);
  const progressPercent = stepsOrder.length > 1 ? ((currentStepIndex + 1) / stepsOrder.length) * 100 : 25;

  const mergeAndSelectStickers = useCallback((items, source) => {
    const mapped = (Array.isArray(items) ? items : [])
      .map(item => {
        if (item?.id && item?.uri) return { ...item, source: item?.source ?? source };
        const path = item?.originalUri || item?.uri || item?.path || item;
        const nameHint = item?.name || item?.fileName || item?.filename;
        const mimeHint = item?.mimeType || item?.type;
        let extensionHint = getFileExtension(nameHint);
        if (!extensionHint && typeof mimeHint === 'string' && mimeHint.includes('/')) {
          extensionHint = mimeHint.split('/').pop();
        }
        const animatedHint = typeof item?.animated === 'boolean' ? item.animated : undefined;
        return buildStickerFromPath(path, {
          source,
          name: nameHint,
          extension: extensionHint,
          mimeType: mimeHint,
          animated: animatedHint,
        });
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
    setStep('convert');
  }, [importedStickers]);

  const handleVideoImported = useCallback(
    items => mergeAndSelectStickers(items, 'video'),
    [mergeAndSelectStickers],
  );

  const handleImagesPicked = useCallback(
    items => {
      mergeAndSelectStickers(items, 'gallery');
    },
    [mergeAndSelectStickers],
  );

  const handleConversionResult = (results) => {
    const successful = (Array.isArray(results) ? results : []).filter(
      sticker => sticker?.status?.level !== 'error',
    );

    setConvertedStickers(successful);
    setStep('add');
    setAutoConvert(false);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(addSectionOffset - spacing(2), 0), animated: true });
    }, 150);
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
    setStep('convert');
  };

  const reset = () => {
    setStep('import');
    setImportedStickers([]);
    setSelectedStickerIds(new Set());
    setConvertedStickers([]);
    setAutoConvert(false);
  };

  const parseIncomingLink = raw => {
    if (!raw || typeof raw !== 'string') return { uri: null, mime: null };
    if (!raw.startsWith('stickerconverter://open')) return { uri: raw, mime: null };
    const query = raw.split('?')[1] || '';
    const params = {};
    query.split('&').forEach(part => {
      if (!part) return;
      const [key, value] = part.split('=');
      if (key) params[key] = value ?? '';
    });
    const decodeValue = value => {
      try {
        return decodeURIComponent(value || '');
      } catch {
        return value || '';
      }
    };
    return {
      uri: decodeValue(params.uri),
      mime: decodeValue(params.mime),
    };
  };

  const getExpoFileSystem = useCallback(() => {
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
  }, []);

  const getFileSize = useCallback(async (uri) => {
    if (!uri) return null;
    const normalized = normalizeFilePath(uri);
    const FileSystem = getExpoFileSystem();
    try {
      if (FileSystem?.getInfoAsync) {
        const info = await FileSystem.getInfoAsync(normalized);
        if (typeof info?.size === 'number') return info.size;
      }
    } catch {
      /* ignore */
    }
    try {
      const RNFS = getRNFS();
      if (!RNFS?.stat) return null;
      const path = String(normalized).replace(/^file:\/\//i, '');
      const stat = await RNFS.stat(path);
      if (typeof stat?.size === 'number') return stat.size;
    } catch {
      /* ignore */
    }
    return null;
  }, [getExpoFileSystem]);

  const detectAnimatedWebp = useCallback(async (uri, { fast = false } = {}) => {
    if (!uri) return false;
    const normalized = normalizeFilePath(uri);
    void fast;

    const FileSystem = getExpoFileSystem();
    let base64 = null;
    try {
      if (FileSystem?.readAsStringAsync) {
        base64 = await FileSystem.readAsStringAsync(normalized, { encoding: FileSystem.EncodingType.Base64 });
      }
    } catch {
      /* ignore */
    }
    if (!base64) {
      try {
        const RNFS = getRNFS();
        if (RNFS?.readFile) {
          base64 = await RNFS.readFile(String(normalized).replace(/^file:\/\//i, ''), 'base64');
        }
      } catch {
        /* ignore */
      }
    }

    const bytes = decodeBase64ToBytes(base64);
    if (!bytes) return false;
    return isAnimatedWebpHeader(bytes);
  }, [getFileSize]);

  const buildIncomingSticker = useCallback(async (uri, overrides = {}, options = {}) => {
    const candidate = buildStickerFromPath(uri, overrides);
    if (!candidate) return null;
    if (candidate.extension === 'webp' && !candidate.animated) {
      const animated = await detectAnimatedWebp(candidate.uri || candidate.originalUri, { fast: Boolean(options.fastAnimatedCheck) });
      if (animated) candidate.animated = true;
    }
    const size = await getFileSize(candidate.uri || candidate.originalUri);
    if (typeof size === 'number') candidate.size = size;
    return candidate;
  }, [detectAnimatedWebp, getFileSize]);

  const handleIncomingUri = useCallback(async (uri) => {
    if (!uri) return;
    const parsed = parseIncomingLink(uri);
    if (!parsed.uri) return;
    const raw = parsed.uri.trim();
    const normalized = normalizeFilePath(raw);
    const mime = parsed?.mime || null;

    if (isZipLikeUri(normalized, mime)) {
      setIsImporting(true);
      try {
        const extracted = await extractStickerFilesFromZip(normalized);
        if (!extracted || extracted.length === 0) {
          Alert.alert('No stickers found', 'This .wastickers pack does not contain supported files.');
          return;
        }
        const items = (await Promise.all(
          extracted.map(path => buildIncomingSticker(path, { source: 'file-intent' }, { fastAnimatedCheck: true })),
        )).filter(Boolean);
        if (items.length === 0) {
          Alert.alert('No stickers found', 'Unable to read sticker files in this pack.');
          return;
        }
        mergeAndSelectStickers(items, 'file-intent');
      } catch (error) {
        Alert.alert('Import failed', error?.message ?? 'Unable to read this sticker pack.');
      } finally {
        setIsImporting(false);
      }
      return;
    }

    if (isTgsLikeUri(normalized, mime)) {
      const candidate = await buildIncomingSticker(normalized, { source: 'file-intent', animated: true });
      if (!candidate) return;
      mergeAndSelectStickers([candidate], 'file-intent');
      return;
    }

    const candidate = await buildIncomingSticker(normalized, { source: 'file-intent' });
    if (!candidate) return;
    if (!isSupportedStaticSticker(candidate) && !candidate.animated) {
      Alert.alert('Unsupported file', 'Open a .wastickers/.zip pack or a .webp/.png/.jpg/.tgs/.gif/.mp4 sticker.');
      return;
    }
    mergeAndSelectStickers([candidate], 'file-intent');
  }, [buildIncomingSticker, mergeAndSelectStickers]);

  useEffect(() => {
    const checkInitialIntent = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) handleIncomingUri(initialUrl);
      } catch {
        /* ignore */
      }
    };
    checkInitialIntent();
    const subscription = Linking.addEventListener('url', event => handleIncomingUri(event?.url));
    return () => subscription?.remove?.();
  }, [handleIncomingUri]);

  const stripFileScheme = value => {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/^file:\/\//i, '');
  };

  const buildPackName = (isAnimated = false) => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return isAnimated ? `Animated Pack ${stamp}` : `Sticker Pack ${stamp}`;
  };

  const ensureMinStickerFiles = async (stickers, minCount) => {
    const source = Array.isArray(stickers) ? stickers.filter(item => item?.uri || item?.originalUri) : [];
    if (source.length >= minCount) return source;
    if (source.length === 0) return source;

    const FileSystem = getExpoFileSystem();
    const RNFS = getRNFS();
    const baseDir = FileSystem?.cacheDirectory
      || FileSystem?.documentDirectory
      || RNFS?.CachesDirectoryPath
      || RNFS?.DocumentDirectoryPath
      || RNFS?.TemporaryDirectoryPath;
    if (!baseDir) return source;
    const dir = baseDir.endsWith('/') ? `${baseDir}wa-dupes` : `${baseDir}/wa-dupes`;

    if (FileSystem?.makeDirectoryAsync) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    } else if (RNFS?.mkdir) {
      await RNFS.mkdir(dir);
    }

    const output = [...source];
    const baseSticker = source[0];
    const baseUri = baseSticker?.uri || baseSticker?.originalUri;
    if (!baseUri) return output;
    const ext = getFileExtension(baseUri) || 'webp';
    const normalizedBase = normalizeFilePath(baseUri);

    for (let i = output.length; i < minCount; i += 1) {
      const target = `${dir}/dup-${Date.now()}-${i}.${ext}`;
      if (FileSystem?.copyAsync) {
        await FileSystem.copyAsync({ from: normalizedBase, to: normalizeFilePath(target) });
      } else if (RNFS?.copyFile) {
        await RNFS.copyFile(normalizedBase.replace(/^file:\/\//i, ''), target);
      } else {
        break;
      }
      output.push({
        ...baseSticker,
        id: `${baseSticker.id}-dup-${i}-${Date.now()}`,
        uri: normalizeFilePath(target),
        originalUri: normalizeFilePath(target),
      });
    }

    return output;
  };

  const createTrayIcon = async sourceUri => {
    const resizer = getImageResizer();
    if (!resizer) {
      const reason = getImageResizerError();
      throw new Error(reason?.message ?? 'Image resizer unavailable.');
    }
    const normalized = normalizeFilePath(sourceUri);
    const resized = await resizer.createResizedImage(
      normalized,
      TRAY_ICON_SIZE,
      TRAY_ICON_SIZE,
      'PNG',
      100,
      0,
      undefined,
      false,
      { mode: 'contain' },
    );
    return resized?.uri || normalized;
  };

  const handleAddToWhatsApp = useCallback(async (stickersOverride, options = {}) => {
    const { suggestConversion = false } = options;
    if (Platform.OS !== 'android') {
      Alert.alert('Unsupported', 'Adding to WhatsApp is only available on Android.');
      return;
    }
    if (!isImageResizerAvailable()) {
      const reason = getImageResizerError();
      Alert.alert('Image tools unavailable', reason?.message ?? 'Image tools are missing from this build.');
      return;
    }

    const available = (Array.isArray(stickersOverride) ? stickersOverride : convertedStickers)
      .filter(sticker => sticker?.status?.level !== 'error');
    const hasAnimated = available.some(sticker => sticker?.animated);
    const hasStatic = available.some(sticker => !sticker?.animated);
    if (hasAnimated && hasStatic) {
      Alert.alert('Mixed pack not supported', 'WhatsApp requires sticker packs to be either all static or all animated.');
      return;
    }
    const normalizedStickers = await ensureMinStickerFiles(available, 3);
    if (normalizedStickers.length < 1) {
      Alert.alert('Need at least 1 sticker', 'Select at least one sticker to create a pack.');
      return;
    }

    const packStickers = normalizedStickers.slice(0, 30);
    const firstUri = packStickers[0]?.uri || packStickers[0]?.originalUri;
    if (!firstUri) {
      Alert.alert('Missing files', 'Sticker files are missing. Please convert again.');
      return;
    }

    setAddingToWhatsApp(true);
    try {
      const trayUri = await createTrayIcon(firstUri);
      const packName = buildPackName(hasAnimated);
      const stickerItems = packStickers
        .map(item => ({
          path: stripFileScheme(item.uri || item.originalUri),
          emojis: Array.isArray(item.emojis) ? item.emojis : [],
        }))
        .filter(item => Boolean(item.path));

      if (stickerItems.length < 1) {
        Alert.alert('Missing files', 'Some sticker files are missing. Please convert again.');
        return;
      }

      const created = await createWhatsAppPack({
        name: packName,
        publisher: 'StickerConverter',
        trayImage: trayUri,
        stickers: stickerItems,
        animated: hasAnimated,
      });
      const identifier = created?.identifier;
      if (typeof identifier !== 'number') {
        throw new Error('Failed to create sticker pack.');
      }

      const existingStatus = await isPackAddedToWhatsApp({ identifier, includeExtraPackages: [] }).catch(() => null);
      const availability = existingStatus?.package_availability || {};
      if (availability.consumer === false && availability.smb === false) {
        Alert.alert('WhatsApp not installed', 'Install WhatsApp to add sticker packs.');
        return;
      }
      const whitelist = existingStatus?.whitelist_status || {};
      if (whitelist.consumer || whitelist.smb) {
        Alert.alert('Already added', 'This sticker pack is already in WhatsApp.');
        setStep('done');
        return;
      }

      const status = await addPackToWhatsApp({ identifier, name: packName });
      if (status?.type === 'already_added') {
        Alert.alert('Already added', 'This sticker pack is already in WhatsApp.');
        setStep('done');
        return;
      }
      if (status?.type === 'validation_error' && status?.message) {
        Alert.alert('WhatsApp rejected the pack', status.message);
        return;
      }
      if (status?.isPackValid === false && status?.message) {
        Alert.alert('WhatsApp rejected the pack', status.message);
        return;
      }
      setStep('done');
    } catch (error) {
      const isMissing = error?.code === 'E_ACTIVITY_NOT_FOUND';
      if (suggestConversion) {
        Alert.alert(
          'Conversion suggested',
          'WhatsApp rejected this pack. Convert the files to WhatsApp sticker format and try again.',
          [
            { text: 'Convert', onPress: () => setStep('convert') },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }
      Alert.alert(
        isMissing ? 'WhatsApp not installed' : 'WhatsApp export failed',
        isMissing ? 'Install WhatsApp to add sticker packs.' : (error?.message ?? 'Unable to add pack to WhatsApp.'),
      );
    } finally {
      setAddingToWhatsApp(false);
    }
  }, [convertedStickers]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} ref={scrollRef}>
        <View style={styles.backdrop}>
          <View style={[styles.blob, styles.blobPrimary]} />
          <View style={[styles.blob, styles.blobAccent]} />
          <View style={[styles.blob, styles.blobSecondary]} />
        </View>

        <View style={styles.heroCard}>
          {isImporting && (
            <View style={styles.importBanner}>
              <ActivityIndicator size="small" color={colors.primaryAccent} />
              <Text style={styles.importBannerText}>Importing sticker pack…</Text>
            </View>
          )}
          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Stickers -> WhatsApp</Text>
            </View>
            <View style={[styles.heroBadge, styles.heroBadgeAlt]}>
              <Text style={[styles.heroBadgeText, styles.heroBadgeAltText]}>1-30 ready</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>Bridge your sticker worlds</Text>
          <Text style={styles.heroSubtitle}>
            Convert images or videos into WhatsApp stickers and add them instantly.
          </Text>

          <View style={styles.stepPills}>
            {stepsOrder.map((item, index) => {
              const active = index <= currentStepIndex;
              return (
                <View key={item} style={[styles.stepPill, active && styles.stepPillActive]}>
                  <Text style={[styles.stepPillLabel, active && styles.stepPillLabelActive]}>
                    {index + 1}. {item}
                  </Text>
                </View>
              );
            })}
          </View>

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
            <View style={[styles.metricCard, styles.metricCardAccent]}>
              <Text style={styles.metricValue}>1-30</Text>
              <Text style={styles.metricLabel}>Pack Range</Text>
            </View>
          </View>
        </View>

        <VideoStickerImporter onImported={handleVideoImported} />
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
          <View style={styles.addPackCard}>
            <Text style={styles.addPackTitle}>Try add without conversion</Text>
            <Text style={styles.addPackCopy}>
              If WhatsApp rejects the pack, we will suggest conversion.
            </Text>
            <ActionButton
              title={addingToWhatsApp ? 'Adding to WhatsApp...' : 'Add to WhatsApp'}
              onPress={() => handleAddToWhatsApp(selectedStickers, { suggestConversion: true })}
              loading={addingToWhatsApp}
              disabled={addingToWhatsApp || selectedStickers.length < 1}
            />
          </View>
        )}
        {hasImported && (
          <StickerConverter
            stickers={selectedStickers}
            onConverted={handleConversionResult}
            autoStart={autoConvert}
          />
        )}

        {hasConverted && (
          <View
            style={styles.addPackCard}
            onLayout={event => setAddSectionOffset(event.nativeEvent.layout.y)}
          >
            <Text style={styles.addPackTitle}>Add to WhatsApp</Text>
            <Text style={styles.addPackCopy}>
              Ready to publish {Math.min(convertedStickers.length, 30)} stickers. We can auto-fill up to 3 if needed.
            </Text>
            <ActionButton
              title={addingToWhatsApp ? 'Adding to WhatsApp...' : 'Add to WhatsApp'}
              onPress={() => handleAddToWhatsApp()}
              loading={addingToWhatsApp}
              disabled={addingToWhatsApp || convertedStickers.length < 1}
            />
          </View>
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
  content: { paddingVertical: spacing(3.5), paddingHorizontal: spacing(2), paddingBottom: spacing(5) },
  backdrop: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  blob: { position: 'absolute', width: 320, height: 320, borderRadius: radius.pill, opacity: 0.5, transform: [{ rotate: '18deg' }] },
  blobPrimary: { backgroundColor: colors.primarySoft, top: -150, right: -110 },
  blobAccent: { backgroundColor: 'rgba(42, 171, 238, 0.12)', bottom: -170, left: -90 },
  blobSecondary: { backgroundColor: 'rgba(12, 37, 51, 0.6)', top: 140, left: 40, opacity: 0.25 },
  heroCard: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing(3), paddingHorizontal: spacing(2.5), marginBottom: spacing(2.5), borderWidth: 1, borderColor: colors.divider, ...shadows.floating },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: spacing(1.25), marginHorizontal: -spacing(0.25) },
  heroBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing(1.25), paddingVertical: spacing(0.5), marginHorizontal: spacing(0.25), marginBottom: spacing(0.5), borderWidth: 1, borderColor: 'rgba(42, 171, 238, 0.35)' },
  heroBadgeAlt: { backgroundColor: 'rgba(42, 171, 238, 0.12)', borderColor: 'rgba(30, 190, 107, 0.6)' },
  heroBadgeText: { ...typography.caption, color: colors.primaryAccent, fontWeight: '700', letterSpacing: 0.2 },
  heroBadgeAltText: { color: colors.primary },
  heroTitle: { ...typography.hero, color: colors.textPrimary, marginBottom: spacing(1), letterSpacing: -0.2 },
  heroSubtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing(2) },
  stepPills: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing(0.5), marginBottom: spacing(2) },
  stepPill: { paddingVertical: spacing(0.75), paddingHorizontal: spacing(1.25), backgroundColor: colors.surfaceElevated, borderRadius: radius.pill, marginHorizontal: spacing(0.5), marginBottom: spacing(0.75), borderWidth: 1, borderColor: colors.divider },
  stepPillActive: { backgroundColor: 'rgba(30, 190, 107, 0.16)', borderColor: 'rgba(30, 190, 107, 0.7)' },
  stepPillLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  stepPillLabelActive: { color: colors.textPrimary },
  progressContainer: { marginBottom: spacing(2.25), padding: spacing(1.5), backgroundColor: colors.surfaceElevated, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing(1) },
  progressStep: { ...typography.caption, color: colors.textMuted },
  progressLabel: { ...typography.subheading, color: colors.textPrimary },
  progressBar: { height: 10, borderRadius: radius.md, backgroundColor: colors.backgroundAlt, overflow: 'hidden', borderWidth: 1, borderColor: colors.divider },
  progressFill: { height: '100%', backgroundColor: colors.primaryAccent },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing(0.75), marginHorizontal: -spacing(0.75) },
  importBanner: { flexDirection: 'row', alignItems: 'center', padding: spacing(1), borderRadius: radius.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.divider, marginBottom: spacing(1.5) },
  importBannerText: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing(1) },
  metricCard: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing(1.35), marginHorizontal: spacing(0.75), borderWidth: 1, borderColor: colors.divider },
  metricCardAccent: { backgroundColor: 'rgba(42, 171, 238, 0.12)', borderColor: 'rgba(42, 171, 238, 0.4)' },
  metricValue: { ...typography.heading, textAlign: 'center', color: colors.textPrimary },
  metricLabel: { ...typography.caption, textAlign: 'center', color: colors.textSecondary },
  addPackCard: { marginTop: spacing(2), borderRadius: radius.lg, backgroundColor: colors.surface, paddingVertical: spacing(1.75), paddingHorizontal: spacing(2), borderWidth: 1, borderColor: colors.divider, ...shadows.card },
  addPackTitle: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing(0.75) },
  addPackCopy: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing(1.25) },
  inlineActions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: spacing(2.5) },
  inlineSecondary: { marginLeft: spacing(1) },
});

export default HomeScreen;
