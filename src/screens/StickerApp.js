import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, InteractionManager, Linking, NativeModules, Platform, View } from 'react-native';
import DiscoverScreen from './DiscoverScreen';
import MyStickerPacksScreen from './MyStickerPacksScreen';
import PackDetailsScreen from './PackDetailsScreen';
import ProfileScreen from './ProfileScreen';
import StickerEditScreen from './StickerEditScreen';
import StickerPackEditorScreen from './StickerPackEditorScreen';
import { addPackToWhatsApp, createWhatsAppPack, isPackAddedToWhatsApp } from '../services/whatsappService';
import {
  convertAnimatedSticker,
  convertStaticSticker,
  isTgsConverterAvailable,
  prepareAnimatedWebpSticker,
  tryUseOriginalSticker,
} from '../services/stickerConverter';
import { isImageResizerAvailable, getImageResizer, getImageResizerError } from '../utils/imageResizerProxy';
import { getRNFS } from '../utils/fsProxy';
import {
  buildStickerFromPath,
  createStatus,
  decodeBase64ToBytes,
  getFileExtension,
  isAnimatedSticker,
  isAnimatedWebpSticker,
  isAnimatedWebpHeader,
  isSupportedStaticSticker,
  normalizeFilePath,
} from '../utils/stickerUtils';
import { isFfmpegAvailable } from '../utils/videoStickerConverter';
import { readPersistedState, writePersistedState } from '../utils/persistence';
import { extractStickerFilesFromZip, isTgsLikeUri, isZipLikeUri } from '../utils/packImporter';
import { fetchDiscoverPacks } from '../services/discoverService';

const TAB_ROOT = {
  myPacks: 'MyPacks',
  discover: 'Discover',
  profile: 'Profile',
};
const ROOT_SCREENS = new Set(Object.values(TAB_ROOT));

const MAX_STICKERS = 30;
const TRAY_ICON_SIZE = 96;
const DISCOVER_BATCH_SIZE = 4;

const buildPackTitle = () => {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `Sticker Pack ${stamp}`;
};

const createPackDraft = (overrides = {}) => ({
  id: `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: buildPackTitle(),
  stickers: [],
  trayIconUri: null,
  createdAt: Date.now(),
  ...overrides,
});

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

const getStickerPreviewModule = () => {
  const module = NativeModules?.StickerPreview;
  if (!module || typeof module.createPreview !== 'function') return null;
  return module;
};

const stripFileScheme = value => {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/^file:\/\//i, '');
};

const getFileSize = async (uri) => {
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
};

const fileExists = async uri => {
  if (!uri) return false;
  const normalized = normalizeFilePath(uri);
  const FileSystem = getExpoFileSystem();
  if (FileSystem?.getInfoAsync) {
    try {
      const info = await FileSystem.getInfoAsync(normalized);
      if (info?.exists) return true;
    } catch {
      /* ignore */
    }
  }
  const RNFS = getRNFS();
  if (RNFS?.exists) {
    try {
      return await RNFS.exists(String(normalized).replace(/^file:\/\//i, ''));
    } catch {
      return false;
    }
  }
  return false;
};

const detectAnimatedWebp = async (uri, { fast = false } = {}) => {
  if (!uri) return false;
  const normalized = normalizeFilePath(uri);
  void fast;
  if (fast) return false;

  const FileSystem = getExpoFileSystem();
  let base64 = null;
  const normalizedPath = String(normalized).replace(/^file:\/\//i, '');
  const RNFS = getRNFS();

  // Read only a small header chunk first to avoid blocking JS on large files.
  if (RNFS?.read) {
    try {
      base64 = await RNFS.read(normalizedPath, 128, 0, 'base64');
    } catch {
      /* ignore */
    }
  }
  if (!base64 && FileSystem?.readAsStringAsync) {
    try {
      base64 = await FileSystem.readAsStringAsync(normalized, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: 128,
      });
    } catch {
      /* ignore */
    }
  }
  if (!base64 && RNFS?.readFile) {
    try {
      base64 = await RNFS.readFile(normalizedPath, 'base64');
    } catch {
      /* ignore */
    }
  }
  if (!base64 && FileSystem?.readAsStringAsync) {
    try {
      base64 = await FileSystem.readAsStringAsync(normalized, { encoding: FileSystem.EncodingType.Base64 });
    } catch {
      /* ignore */
    }
  }

  const bytes = decodeBase64ToBytes(base64);
  if (!bytes) return false;
  return isAnimatedWebpHeader(bytes);
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

const createAnimatedPreviewImage = async (sticker) => {
  const source = normalizeFilePath(sticker?.uri || sticker?.originalUri);
  if (!source) return null;

  const stickerPreview = getStickerPreviewModule();
  if (stickerPreview?.createPreview) {
    try {
      const result = await stickerPreview.createPreview(source, 128, 128);
      const nativeUri = result?.uri || result?.path;
      if (nativeUri) return normalizeFilePath(nativeUri);
    } catch {
      /* ignore */
    }
  }

  try {
    const ImageManipulator = require('expo-image-manipulator');
    if (ImageManipulator?.manipulateAsync) {
      const result = await ImageManipulator.manipulateAsync(
        source,
        [{ resize: { width: 128, height: 128 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.PNG },
      );
      if (result?.uri) return result.uri;
    }
  } catch {
    /* ignore */
  }

  if (!isImageResizerAvailable()) return null;

  try {
    const resizer = getImageResizer();
    const resized = await resizer.createResizedImage(
      source,
      128,
      128,
      'PNG',
      70,
      0,
      undefined,
      false,
      { mode: 'cover' },
    );
    return resized?.uri || null;
  } catch {
    /* ignore */
  }

  return null;
};

const convertStickersForWhatsApp = async stickers => {
  const list = Array.isArray(stickers) ? stickers : [];
  const supportedStickers = list.filter(isSupportedStaticSticker);
  const animatedStickers = list.filter(isAnimatedSticker);
  const animatedWebpStickers = animatedStickers.filter(isAnimatedWebpSticker);
  const animatedNeedsConversion = animatedStickers.filter(sticker => !isAnimatedWebpSticker(sticker));
  const converted = [];
  const failed = [];

  const preparedAnimated = await Promise.all(
    animatedWebpStickers.map(async sticker => {
      try {
        return await prepareAnimatedWebpSticker(sticker);
      } catch (error) {
        failed.push({
          ...sticker,
          status: createStatus('Failed to prepare animated sticker', 'error', { detail: error.message }),
          error,
        });
        return null;
      }
    }),
  );
  preparedAnimated.filter(Boolean).forEach(item => converted.push(item));

  const canFfmpeg = isFfmpegAvailable();
  const canTgs = isTgsConverterAvailable();

  for (const sticker of animatedNeedsConversion) {
    const ext = (sticker?.extension || getFileExtension(sticker?.name || sticker?.uri || '')).toLowerCase();
    if (ext === 'tgs' && !canTgs) {
      failed.push({
        ...sticker,
        status: createStatus('TGS conversion unavailable', 'error', { detail: 'Missing native TGS renderer.' }),
      });
      continue;
    }
    if (ext !== 'tgs' && !canFfmpeg) {
      failed.push({
        ...sticker,
        status: createStatus('FFmpeg unavailable', 'error', { detail: 'FFmpeg is not available.' }),
      });
      continue;
    }
    try {
      const result = await convertAnimatedSticker(sticker, { maxDurationSeconds: 3, fps: 15 });
      converted.push(result);
    } catch (error) {
      failed.push({
        ...sticker,
        status: createStatus('Failed to convert animated sticker', 'error', { detail: error.message }),
        error,
      });
    }
  }

  const preservedCandidates = await Promise.all(
    supportedStickers.map(sticker => tryUseOriginalSticker(sticker)),
  );

  for (let index = 0; index < supportedStickers.length; index += 1) {
    const sticker = supportedStickers[index];
    try {
      const preserved = preservedCandidates[index];
      if (preserved) {
        converted.push(preserved);
        continue;
      }
      const result = await convertStaticSticker(sticker);
      converted.push(result);
    } catch (error) {
      failed.push({
        ...sticker,
        status: createStatus('Failed to convert', 'error', { detail: error.message }),
        error,
      });
    }
  }

  const unsupported = list.filter(item => !isSupportedStaticSticker(item) && !isAnimatedSticker(item));
  unsupported.forEach(sticker => {
    failed.push({
      ...sticker,
      status: createStatus('Unsupported sticker type', 'error'),
    });
  });

  return { converted, failed };
};

const StickerApp = () => {
  const [activeTab, setActiveTab] = useState('myPacks');
  const [stack, setStack] = useState([{ name: TAB_ROOT.myPacks }]);
  const [packs, setPacks] = useState([]);
  const [discoverPacks, setDiscoverPacks] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverLoadingMore, setDiscoverLoadingMore] = useState(false);
  const [discoverHasMore, setDiscoverHasMore] = useState(true);
  const [discoverOffset, setDiscoverOffset] = useState(0);
  const [discoverError, setDiscoverError] = useState('');
  const [draftPack, setDraftPack] = useState(null);
  const [publishingId, setPublishingId] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [importState, setImportState] = useState({ active: false, total: 0, loaded: 0 });
  const persistTimer = useRef(null);
  const importQueueRef = useRef(0);
  const previewQueueRef = useRef({ running: false, processed: new Set() });
  const animatedCheckRef = useRef({ packId: null, checked: new Set() });
  const discoverRequestRef = useRef(0);

  const appendStickersToDraft = useCallback((incoming, source = 'file-intent', packOverrides = null) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return { added: 0, packId: null };
    let createdPackId = null;
    setDraftPack(prev => {
      const base = prev || createPackDraft(packOverrides || undefined);
      if (!prev) createdPackId = base.id;
      const nextBase = prev ? base : { ...base, ...(packOverrides || {}) };
      const existingUris = new Set(
        (nextBase.stickers || []).map(sticker => normalizeFilePath(sticker.originalUri || sticker.uri)),
      );
      const unique = [];
      incoming.forEach(sticker => {
        if (!sticker) return;
        const normalized = normalizeFilePath(sticker.originalUri || sticker.uri);
        if (!normalized || existingUris.has(normalized)) return;
        existingUris.add(normalized);
        unique.push({ ...sticker, source: sticker.source || source });
      });
      if (unique.length === 0) return base;
      const nextStickers = [...(nextBase.stickers || []), ...unique].slice(0, MAX_STICKERS);
      return { ...nextBase, stickers: nextStickers, updatedAt: Date.now() };
    });
    return { added: incoming.length, packId: createdPackId };
  }, []);

  const buildIncomingSticker = useCallback(async (path, overrides = {}, options = {}) => {
    const candidate = buildStickerFromPath(path, overrides);
    if (!candidate) return null;
    if (candidate.extension === 'webp' && !candidate.animated) {
      const animated = await detectAnimatedWebp(candidate.uri || candidate.originalUri, { fast: Boolean(options.fastAnimatedCheck) });
      if (animated) candidate.animated = true;
    }
    const size = await getFileSize(candidate.uri || candidate.originalUri);
    if (typeof size === 'number') candidate.size = size;
    return candidate;
  }, []);

  const importStickerPathsInBatches = useCallback((paths, options = {}) => {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const batchSize = options.batchSize ?? 3;
    const delayMs = options.delayMs ?? 80;
    const source = options.source ?? 'file-intent';
    const packOverrides = options.packOverrides ?? null;
    const assumeReady = Boolean(options.assumeReady);
    const fastAnimatedCheck = options.fastAnimatedCheck ?? true;

    const total = paths.length;
    const queueId = importQueueRef.current + 1;
    importQueueRef.current = queueId;
    setImportState({ active: true, total, loaded: 0 });

    let index = 0;
    const processBatch = async () => {
      if (queueId !== importQueueRef.current) return;
      const slice = paths.slice(index, index + batchSize);
      if (slice.length === 0) {
        setImportState({ active: false, total, loaded: total });
        return;
      }
      const items = (await Promise.all(
        slice.map(path => buildIncomingSticker(path, { source, assumeReady }, { fastAnimatedCheck })),
      )).filter(Boolean);
      appendStickersToDraft(items, source, index === 0 ? packOverrides : null);
      index += slice.length;
      setImportState(prev => ({ ...prev, loaded: Math.min(total, index) }));
      if (index < total) {
        setTimeout(processBatch, delayMs);
      } else {
        setImportState({ active: false, total, loaded: total });
      }
    };

    processBatch();
  }, [appendStickersToDraft, buildIncomingSticker]);

  const handleIncomingUri = useCallback(async (uri) => {
    if (!uri) return;
    const parsed = parseIncomingLink(uri);
    if (!parsed.uri) return;
    const raw = parsed.uri.trim();
    const normalized = normalizeFilePath(raw);
    const mime = parsed?.mime || null;

    const lowerMime = typeof mime === 'string' ? mime.toLowerCase() : '';
    const looksLikeStickerPack = /\\.(wasticker|wastickers|zip)$/i.test(raw);
    const shouldTryZip = isZipLikeUri(normalized, mime)
      || (lowerMime.includes('octet-stream') && (looksLikeStickerPack || /wasticker/i.test(raw)));

    if (shouldTryZip) {
      try {
        const extracted = await extractStickerFilesFromZip(normalized);
        if (!extracted || extracted.length === 0) {
          Alert.alert('No stickers found', 'This .wastickers pack does not contain supported files.');
          return;
        }
        if (extracted.length === 0) {
          Alert.alert('No stickers found', 'Unable to read sticker files in this pack.');
          return;
        }
        importStickerPathsInBatches(extracted, {
          source: 'wastickers',
          assumeReady: true,
          fastAnimatedCheck: false,
          packOverrides: { assumeReady: true, importedFrom: 'wastickers' },
        });
        setStack(prev => [...prev, { name: 'PackEditor' }]);
      } catch (error) {
        Alert.alert('Import failed', error?.message ?? 'Unable to read this sticker pack.');
      }
      return;
    }

    if (isTgsLikeUri(normalized, mime)) {
      const candidate = await buildIncomingSticker(normalized, { source: 'file-intent', animated: true });
      if (!candidate) return;
      appendStickersToDraft([candidate], 'file-intent');
      setStack(prev => [...prev, { name: 'PackEditor' }]);
      return;
    }

    const candidate = await buildIncomingSticker(normalized, { source: 'file-intent' });
    if (!candidate) return;
    if (!isSupportedStaticSticker(candidate) && !candidate.animated) {
      Alert.alert('Unsupported file', 'Open a .wastickers/.zip pack or a .webp/.png/.jpg/.tgs sticker.');
      return;
    }
    appendStickersToDraft([candidate], 'file-intent');
    setStack(prev => [...prev, { name: 'PackEditor' }]);
  }, [appendStickersToDraft, buildIncomingSticker, importStickerPathsInBatches]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const saved = await readPersistedState();
        if (!mounted) return;
        if (Array.isArray(saved?.packs)) setPacks(saved.packs);
        if (saved?.draftPack) setDraftPack(saved.draftPack);
      } catch {
        /* ignore */
      } finally {
        if (mounted) setHydrated(true);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const loadDiscoverPacks = useCallback(async ({ reset = false } = {}) => {
    if (reset) {
      setDiscoverLoading(true);
      setDiscoverError('');
    } else {
      if (discoverLoadingMore || discoverLoading || !discoverHasMore) return;
      setDiscoverLoadingMore(true);
    }

    const nextOffset = reset ? 0 : discoverOffset;
    const requestId = discoverRequestRef.current + 1;
    discoverRequestRef.current = requestId;

    const {
      packs: remotePacks,
      error,
      hasMore,
    } = await fetchDiscoverPacks({
      limit: DISCOVER_BATCH_SIZE,
      offset: nextOffset,
      includeStickers: false,
    });

    if (requestId !== discoverRequestRef.current) return;

    const incoming = Array.isArray(remotePacks) ? remotePacks : [];
    if (reset) {
      setDiscoverPacks(incoming);
      setDiscoverOffset(incoming.length);
    } else if (incoming.length > 0) {
      setDiscoverPacks(prev => {
        const existing = new Set((Array.isArray(prev) ? prev : []).map(item => item?.id).filter(Boolean));
        const append = incoming.filter(item => item?.id && !existing.has(item.id));
        return append.length > 0 ? [...prev, ...append] : prev;
      });
      setDiscoverOffset(prev => prev + incoming.length);
    }

    setDiscoverHasMore(Boolean(hasMore));
    setDiscoverError(error || '');
    setDiscoverLoading(false);
    setDiscoverLoadingMore(false);
  }, [discoverHasMore, discoverLoading, discoverLoadingMore, discoverOffset]);

  useEffect(() => {
    loadDiscoverPacks({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftPack?.id || !Array.isArray(draftPack?.stickers)) return;
    let cancelled = false;
    const tracker = animatedCheckRef.current;
    if (tracker.packId !== draftPack.id) {
      tracker.packId = draftPack.id;
      tracker.checked = new Set();
    }

    const repairAnimatedFlags = async () => {
      const updates = new Map();
      for (const sticker of draftPack.stickers) {
        if (cancelled) return;
        if (!sticker) continue;
        if (String(sticker.extension || '').toLowerCase() !== 'webp') continue;
        if (tracker.checked.has(sticker.id)) continue;
        tracker.checked.add(sticker.id);
        const animated = await detectAnimatedWebp(sticker.uri || sticker.originalUri, { fast: false });
        if (Boolean(sticker.animated) !== animated) {
          updates.set(sticker.id, animated);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (cancelled || updates.size === 0) return;
      handleUpdateDraft(prev => {
        if (!prev) return prev;
        const nextStickers = prev.stickers.map(item => (
          updates.has(item.id) ? { ...item, animated: updates.get(item.id) } : item
        ));
        return {
          ...prev,
          stickers: nextStickers,
          isAnimated: nextStickers.some(item => item?.animated),
        };
      });
    };

    repairAnimatedFlags();
    return () => {
      cancelled = true;
    };
  }, [draftPack?.id, draftPack?.stickers, handleUpdateDraft]);

  useEffect(() => {
    animatedCheckRef.current = { packId: draftPack?.id ?? null, checked: new Set() };
    previewQueueRef.current.running = false;
    previewQueueRef.current.processed = new Set();
  }, [draftPack?.id]);

  useEffect(() => {
    if (!draftPack?.id || !Array.isArray(draftPack?.stickers)) return;
    const queue = previewQueueRef.current;
    if (queue.running) return;

    let cancelled = false;
    queue.running = true;
    const batchUpdates = new Map();

    const flushPreviewBatch = () => {
      if (batchUpdates.size === 0 || cancelled) return;
      const updates = new Map(batchUpdates);
      batchUpdates.clear();
      handleUpdateDraft(prev => {
        if (!prev) return prev;
        let changed = false;
        const nextStickers = prev.stickers.map(item => {
          const previewUri = updates.get(item.id);
          if (!previewUri || item.previewImageUri === previewUri) return item;
          changed = true;
          return { ...item, previewImageUri: previewUri };
        });
        return changed ? { ...prev, stickers: nextStickers, updatedAt: Date.now() } : prev;
      });
    };

    const run = async () => {
      const pending = draftPack.stickers.filter(sticker => (
        sticker?.animated
        && !sticker.previewImageUri
        && !queue.processed.has(sticker.id)
      ));

      for (const sticker of pending) {
        if (cancelled) break;
        if (!sticker?.animated) continue;
        if (queue.processed.has(sticker.id)) continue;
        try {
          const previewUri = await createAnimatedPreviewImage(sticker);
          if (previewUri) {
            batchUpdates.set(sticker.id, previewUri);
          }
        } finally {
          queue.processed.add(sticker.id);
        }
        if (batchUpdates.size >= 4) {
          flushPreviewBatch();
        }
        await new Promise(resolve => setTimeout(resolve, 24));
      }
      flushPreviewBatch();
      queue.running = false;
    };

    const interaction = InteractionManager.runAfterInteractions(() => {
      run();
    });
    return () => {
      cancelled = true;
      interaction?.cancel?.();
      queue.running = false;
    };
  }, [draftPack?.id, draftPack?.stickers, handleUpdateDraft]);

  useEffect(() => {
    if (!Array.isArray(packs) || packs.length === 0) return;
    let cancelled = false;

    const backfillAnimatedPreviews = async () => {
      const updatesByPack = new Map();

      for (const pack of packs) {
        if (cancelled) return;
        const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
        for (const sticker of stickers) {
          if (cancelled) return;
          if (!sticker?.animated || sticker?.previewImageUri) continue;
          // eslint-disable-next-line no-await-in-loop
          const previewUri = await createAnimatedPreviewImage(sticker);
          if (previewUri) {
            const current = updatesByPack.get(pack.id) || new Map();
            current.set(sticker.id, previewUri);
            updatesByPack.set(pack.id, current);
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }

      if (cancelled || updatesByPack.size === 0) return;

      setPacks(prev => prev.map(pack => {
        const updates = updatesByPack.get(pack.id);
        if (!updates || updates.size === 0 || !Array.isArray(pack?.stickers)) return pack;
        let changed = false;
        const nextStickers = pack.stickers.map(sticker => {
          const previewUri = updates.get(sticker.id);
          if (!previewUri || sticker.previewImageUri === previewUri) return sticker;
          changed = true;
          return { ...sticker, previewImageUri: previewUri };
        });
        if (!changed) return pack;
        const packPreview = nextStickers.find(item => item?.previewImageUri)?.previewImageUri
          || pack?.previewImageUri
          || null;
        return { ...pack, stickers: nextStickers, previewImageUri: packPreview, updatedAt: Date.now() };
      }));
    };

    const interaction = InteractionManager.runAfterInteractions(() => {
      backfillAnimatedPreviews();
    });

    return () => {
      cancelled = true;
      interaction?.cancel?.();
    };
  }, [packs]);

  useEffect(() => {
    if (!Array.isArray(packs) || packs.length === 0) return;
    const hasPreviewUris = packs.some(pack => (
      Array.isArray(pack?.stickers)
      && pack.stickers.some(sticker => Boolean(sticker?.previewImageUri))
    ));
    if (!hasPreviewUris) return;

    let cancelled = false;
    const cleanup = async () => {
      const staleByPack = new Map();

      for (const pack of packs) {
        if (cancelled) return;
        const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
        for (const sticker of stickers) {
          if (cancelled) return;
          if (!sticker?.previewImageUri) continue;
          // eslint-disable-next-line no-await-in-loop
          const exists = await fileExists(sticker.previewImageUri);
          if (!exists) {
            const current = staleByPack.get(pack.id) || new Set();
            current.add(sticker.id);
            staleByPack.set(pack.id, current);
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      if (cancelled || staleByPack.size === 0) return;

      setPacks(prev => prev.map(pack => {
        const stale = staleByPack.get(pack.id);
        if (!stale || stale.size === 0 || !Array.isArray(pack?.stickers)) return pack;
        const nextStickers = pack.stickers.map(sticker => (
          stale.has(sticker.id) ? { ...sticker, previewImageUri: null } : sticker
        ));
        return { ...pack, stickers: nextStickers, updatedAt: Date.now() };
      }));
    };

    cleanup();
    return () => {
      cancelled = true;
    };
  }, [packs]);

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

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      writePersistedState({ packs, draftPack });
    }, 350);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [packs, draftPack, hydrated]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const handler = () => {
      if (stack.length > 1) {
        setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
        return true;
      }
      if (!ROOT_SCREENS.has(stack[0]?.name)) {
        setStack([{ name: TAB_ROOT.myPacks }]);
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  }, [stack]);

  const handleTabChange = useCallback(tabId => {
    const root = TAB_ROOT[tabId] || TAB_ROOT.myPacks;
    setActiveTab(tabId);
    setStack([{ name: root }]);
  }, []);

  const navigate = useCallback((name, params) => {
    setStack(prev => [...prev, { name, params }]);
  }, []);

  const goBack = useCallback(() => {
    setStack(prev => {
      if (prev.length > 1) return prev.slice(0, -1);
      const currentRoot = prev[0]?.name;
      if (!ROOT_SCREENS.has(currentRoot)) {
        return [{ name: TAB_ROOT.myPacks }];
      }
      return prev;
    });
  }, []);

  const handleCreatePack = useCallback(() => {
    if (draftPack) {
      navigate('PackEditor', { packId: draftPack.id });
      return;
    }
    const created = createPackDraft();
    setDraftPack(created);
    navigate('PackEditor', { packId: created.id });
  }, [draftPack, navigate]);

  const handleOpenPack = useCallback((pack) => {
    if (!pack?.id) return;
    navigate('PackDetails', { packId: pack.id });
  }, [navigate]);

  const handleEditPack = useCallback((pack) => {
    if (!pack) return;
    setDraftPack({
      ...pack,
      stickers: Array.isArray(pack.stickers) ? [...pack.stickers] : [],
    });
    navigate('PackEditor', { packId: pack.id });
  }, [navigate]);

  const handleUpdateDraft = useCallback((updater) => {
    setDraftPack(prev => {
      if (!prev) return prev;
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      return { ...next, updatedAt: Date.now() };
    });
  }, []);

  const handleUpdateSticker = useCallback((stickerId, patch) => {
    if (!stickerId) return;
    handleUpdateDraft(prev => {
      if (!prev) return prev;
      const nextStickers = Array.isArray(prev.stickers) ? prev.stickers.map(item => (
        item.id === stickerId ? { ...item, ...patch } : item
      )) : prev.stickers;
      return { ...prev, stickers: nextStickers };
    });
  }, [handleUpdateDraft]);

  const handlePublishPack = useCallback(async (pack) => {
    const targetPack = pack || draftPack;
    if (!targetPack) return;
    if (publishingId) return;

    if (Platform.OS !== 'android') {
      Alert.alert('Unsupported', 'Adding to WhatsApp is only available on Android.');
      return;
    }

    const sourceStickers = Array.isArray(targetPack.stickers)
      ? targetPack.stickers.filter(item => item?.uri || item?.originalUri)
      : [];
    if (sourceStickers.length === 0) {
      Alert.alert('No stickers yet', 'Add at least one sticker before publishing.');
      return;
    }

    if (!isImageResizerAvailable()) {
      const reason = getImageResizerError();
      Alert.alert('Image tools unavailable', reason?.message ?? 'Image tools are missing from this build.');
      return;
    }

    const staticStickers = sourceStickers.filter(sticker => !sticker?.animated);
    const animatedStickers = sourceStickers.filter(sticker => sticker?.animated);
    const baseTitle = targetPack.title || buildPackTitle();
    const variants = [];
    const assumeReady = Boolean(targetPack?.assumeReady || targetPack?.importedFrom === 'wastickers');

    if (staticStickers.length > 0 && animatedStickers.length > 0) {
      Alert.alert('Mixed pack detected', 'We will split this pack into Static and Animated packs for WhatsApp.');
      variants.push(createPackDraft({
        id: `${targetPack.id}-static-${Date.now()}`,
        title: `${baseTitle} (Static)`,
        stickers: staticStickers,
        trayIconUri: targetPack.trayIconUri,
        createdAt: targetPack.createdAt || Date.now(),
        updatedAt: Date.now(),
        isAnimated: false,
        assumeReady,
        importedFrom: targetPack?.importedFrom,
      }));
      variants.push(createPackDraft({
        id: `${targetPack.id}-animated-${Date.now()}`,
        title: `${baseTitle} (Animated)`,
        stickers: animatedStickers,
        trayIconUri: targetPack.trayIconUri,
        createdAt: targetPack.createdAt || Date.now(),
        updatedAt: Date.now(),
        isAnimated: true,
        assumeReady,
        importedFrom: targetPack?.importedFrom,
      }));
    } else {
      variants.push({
        ...targetPack,
        title: baseTitle,
        stickers: sourceStickers,
        isAnimated: animatedStickers.length > 0,
        assumeReady,
        importedFrom: targetPack?.importedFrom,
      });
    }

    const publishVariant = async (variant) => {
      const stickers = Array.isArray(variant.stickers) ? variant.stickers : [];
      const shouldSkipConversion = Boolean(variant?.assumeReady)
        && stickers.length > 0
        && stickers.every(item => {
          if (!item) return false;
          const ext = (item.extension || getFileExtension(item?.name || item?.uri || '') || '').toLowerCase();
          return !ext || ext === 'webp';
        });

      const conversion = shouldSkipConversion
        ? {
          converted: stickers.map(item => ({
            ...item,
            status: createStatus('Ready for WhatsApp', 'success', { original: true }),
            format: item?.format || 'WEBP',
          })),
          failed: [],
        }
        : await convertStickersForWhatsApp(stickers);

      const successful = conversion.converted.filter(item => item?.status?.level !== 'error');
      if (successful.length === 0) {
        throw new Error('Unable to prepare any stickers for WhatsApp.');
      }

      if (conversion.failed.length > 0) {
        Alert.alert('Some stickers skipped', `${conversion.failed.length} stickers could not be converted and were skipped.`);
      }

      const normalizedStickers = await ensureMinStickerFiles(successful, 3);
      if (normalizedStickers.length < 1) {
        throw new Error('Select at least one sticker to create a pack.');
      }

      const packStickers = normalizedStickers.slice(0, MAX_STICKERS);
      const traySource = variant.trayIconUri || packStickers[0]?.uri || packStickers[0]?.originalUri;
      if (!traySource) {
        throw new Error('Select a tray icon before publishing.');
      }

      const trayUri = await createTrayIcon(traySource);
      const packName = variant.title || baseTitle;
      const stickerItems = packStickers
        .map(item => ({
          path: stripFileScheme(item.uri || item.originalUri),
          emojis: Array.isArray(item.emojis) ? item.emojis : [],
        }))
        .filter(item => Boolean(item.path));

      if (stickerItems.length < 1) {
        throw new Error('Some sticker files are missing. Please convert again.');
      }

      const created = await createWhatsAppPack({
        name: packName,
        publisher: 'StickerConverter',
        trayImage: trayUri,
        stickers: stickerItems,
        animated: variant.isAnimated,
      });
      const identifier = created?.identifier;
      if (typeof identifier !== 'number') {
        throw new Error('Failed to create sticker pack.');
      }

      const existingStatus = await isPackAddedToWhatsApp({ identifier, includeExtraPackages: [] }).catch(() => null);
      const availability = existingStatus?.package_availability || {};
      if (availability.consumer === false && availability.smb === false) {
        throw new Error('Install WhatsApp to add sticker packs.');
      }
      const whitelist = existingStatus?.whitelist_status || {};
      if (whitelist.consumer || whitelist.smb) {
        throw new Error('This sticker pack is already in WhatsApp.');
      }

      const status = await addPackToWhatsApp({ identifier, name: packName });
      if (status?.type === 'already_added') {
        throw new Error('This sticker pack is already in WhatsApp.');
      }
      if (status?.type === 'validation_error' && status?.message) {
        throw new Error(status.message);
      }
      if (status?.isPackValid === false && status?.message) {
        throw new Error(status.message);
      }

      return {
        ...variant,
        trayIconUri: variant.trayIconUri || traySource,
        stickers: variant.stickers,
        updatedAt: Date.now(),
      };
    };

    setPublishingId(targetPack.id);
    const published = [];
    const failures = [];

    try {
      for (const variant of variants) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const finalPack = await publishVariant(variant);
          published.push(finalPack);
        } catch (error) {
          failures.push({ variant, error });
        }
      }

      if (published.length > 0) {
        setPacks(prev => {
          let next = [...prev];
          published.forEach(finalPack => {
            const existingIndex = next.findIndex(item => item.id === finalPack.id);
            if (existingIndex >= 0) {
              next[existingIndex] = finalPack;
            } else {
              next = [finalPack, ...next];
            }
          });
          return next;
        });
        setDraftPack(null);
        setStack([{ name: TAB_ROOT.myPacks }]);
      }

      if (failures.length > 0) {
        Alert.alert(
          'Some packs failed',
          `${failures.length} pack(s) could not be added. Please try again.`,
        );
      } else if (published.length > 0) {
        const message = published.length > 1
          ? `We added ${published.length} packs to WhatsApp.`
          : 'Your sticker pack was added to WhatsApp.';
        Alert.alert('Pack added', message);
      }
    } catch (error) {
      const isMissing = error?.code === 'E_ACTIVITY_NOT_FOUND';
      Alert.alert(
        isMissing ? 'WhatsApp not installed' : 'WhatsApp export failed',
        isMissing ? 'Install WhatsApp to add sticker packs.' : (error?.message ?? 'Unable to add pack to WhatsApp.'),
      );
    } finally {
      setPublishingId(null);
    }
  }, [draftPack, publishingId]);

  const computedPacks = useMemo(() => (
    packs.map(pack => {
      const stickers = Array.isArray(pack.stickers) ? pack.stickers : [];
      const firstSticker = stickers[0];
      const isAnimated = typeof pack.isAnimated === 'boolean'
        ? pack.isAnimated
        : stickers.some(item => item?.animated);
      const hasPackStaticPreview = Boolean(pack.previewImageUri || stickers.some(item => item?.previewImageUri));
      const trayExt = String(getFileExtension(pack.trayIconUri || '')).toLowerCase();
      const safeTrayIconUri = isAnimated && trayExt === 'webp' && hasPackStaticPreview ? null : pack.trayIconUri;
      const animatedPreviewUri = firstSticker?.uri || firstSticker?.originalUri || null;
      const staticPreviewUri = safeTrayIconUri
        || pack.previewImageUri
        || firstSticker?.previewImageUri
        || null;

      return {
        ...pack,
        count: stickers.length || pack.count || 0,
        isAnimated,
        previewUri: isAnimated ? staticPreviewUri : (
          safeTrayIconUri
          || firstSticker?.uri
          || firstSticker?.originalUri
          || firstSticker?.previewImageUri
          || null
        ),
        animatedPreviewUri,
        previewImageUri: staticPreviewUri || firstSticker?.previewImageUri || null,
      };
    })
  ), [packs]);

  const current = stack[stack.length - 1];
  let content = null;
  switch (current.name) {
    case 'Discover':
      content = (
        <DiscoverScreen
          packs={discoverPacks}
          loading={discoverLoading}
          loadingMore={discoverLoadingMore}
          hasMore={discoverHasMore}
          error={discoverError}
          onLoadMore={() => loadDiscoverPacks()}
          onNavigate={navigate}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
      );
      break;
    case 'Profile':
      content = (
        <ProfileScreen
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
      );
      break;
    case 'PackEditor':
      content = (
        <StickerPackEditorScreen
          pack={draftPack}
          onBack={goBack}
          onNavigate={navigate}
          onUpdatePack={handleUpdateDraft}
          onPublish={() => handlePublishPack(draftPack)}
          publishing={publishingId === draftPack?.id}
          importing={importState.active}
          importProgress={importState}
        />
      );
      break;
    case 'StickerEdit': {
      const stickerId = current.params?.stickerId;
      const activeSticker = draftPack?.stickers?.find(item => item.id === stickerId) || current.params?.sticker || null;
      content = (
        <StickerEditScreen
          onBack={goBack}
          sticker={activeSticker}
          onRemove={() => {
            if (!stickerId) return;
            handleUpdateDraft(prev => ({
              ...prev,
              stickers: prev.stickers.filter(item => item.id !== stickerId),
            }));
            goBack();
          }}
          onSetTrayIcon={() => {
            if (!activeSticker) return;
            handleUpdateDraft({ trayIconUri: activeSticker.uri || activeSticker.originalUri });
          }}
          onUpdateSticker={(patch) => handleUpdateSticker(stickerId, patch)}
        />
      );
      break;
    }
    case 'PackDetails': {
      const packId = current.params?.packId || current.params?.pack?.id;
      const targetPack = packs.find(item => item.id === packId) || current.params?.pack;
      content = (
        <PackDetailsScreen
          onBack={goBack}
          pack={targetPack}
          onAddToWhatsApp={() => handlePublishPack(targetPack)}
          onEditPack={() => handleEditPack(targetPack)}
          publishing={publishingId === targetPack?.id}
        />
      );
      break;
    }
    case 'MyPacks':
    default:
      content = (
        <MyStickerPacksScreen
          packs={computedPacks}
          onNavigate={navigate}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onCreatePack={handleCreatePack}
          onOpenPack={handleOpenPack}
        />
      );
  }

  return <View style={{ flex: 1 }}>{content}</View>;
};

export default StickerApp;
