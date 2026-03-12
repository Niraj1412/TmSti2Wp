import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '../styles/theme';
import ActionButton from './ui/ActionButton';
import { getRNFS } from '../utils/fsProxy';
import { buildStickerFromPath, normalizeFilePath } from '../utils/stickerUtils';
import { importTelegramStickerPack } from '../services/telegramService';

const TELEGRAM_BASE_PATHS = [
  // Common cached sticker paths (Android 11+ may use Android/media)
  '/storage/emulated/0/Android/data/org.telegram.messenger/files/stickers',
  '/storage/emulated/0/Android/media/org.telegram.messenger/files/stickers',
  '/storage/emulated/0/Android/data/org.telegram.messenger.web/files/stickers',
  '/storage/emulated/0/Android/media/org.telegram.messenger.web/files/stickers',
  '/storage/emulated/0/Android/data/org.telegram.messenger.beta/files/stickers',
  '/storage/emulated/0/Android/media/org.telegram.messenger.beta/files/stickers',
  // Legacy exports and user-accessible folders
  '/storage/emulated/0/Telegram/Telegram Files/stickers',
  '/storage/emulated/0/Telegram/Stickers',
  '/storage/emulated/0/Download/Telegram',
];
const DOWNLOAD_BASE_PATHS = [
  '/storage/emulated/0/Download/Telegram',
  '/storage/emulated/0/Download/Stickers',
  '/storage/emulated/0/Download',
];
const MAX_WHATSAPP_STICKERS = 30;
const STATIC_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];
const PERSISTED_SAF_ROOT_FILE = 'telegram-saf-root.txt';
const SAF_MAX_DEPTH = 3;

const ensureFileUri = path => {
  if (!path) return path;
  if (/^(file|content):\/\//.test(path)) return path;
  return `file://${path.startsWith('/') ? '' : '/'}${path}`;
};

const joinPaths = (base, leaf) => {
  if (!base) return leaf;
  if (!leaf) return base;
  const sanitizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const sanitizedLeaf = leaf.startsWith('/') ? leaf.slice(1) : leaf;
  return `${sanitizedBase}/${sanitizedLeaf}`;
};

const isSupportedFile = filename => {
  const ext = filename?.split('.').pop()?.toLowerCase();
  return Boolean(ext && STATIC_EXTENSIONS.includes(ext));
};

const mapToStickerSources = (paths, existing = []) => {
  const existingSet = new Set(
    (Array.isArray(existing) ? existing : [])
      .map(item => normalizeFilePath(item?.originalUri || item?.uri || item))
      .filter(Boolean),
  );

  const prepared = [];
  for (const path of paths) {
    if (prepared.length >= MAX_WHATSAPP_STICKERS) break;
    const uri = ensureFileUri(path);
    const normalized = normalizeFilePath(uri);
    if (!normalized || existingSet.has(normalized)) continue;
    existingSet.add(normalized);
    prepared.push(buildStickerFromPath(normalized, { source: 'telegram' }));
  }
  return prepared;
};

const isSupportedEntry = (nameOrUri, mimeType) => {
  const name = nameOrUri || '';
  if (mimeType && mimeType.startsWith('image/')) return true;
  const ext = name.split('.').pop()?.toLowerCase();
  return Boolean(ext && STATIC_EXTENSIONS.includes(ext));
};

const collectWithRNFS = async RNFS => {
  const collected = [];
  const queue = [...TELEGRAM_BASE_PATHS];
  while (queue.length > 0 && collected.length < MAX_WHATSAPP_STICKERS * 2) {
    const current = queue.shift();
    try {
      const entries = await RNFS.readDir(current);
      for (const entry of entries) {
        if (entry.isDirectory()) { queue.push(entry.path); continue; }
        const ext = entry.name.split('.').pop()?.toLowerCase();
        if (ext && STATIC_EXTENSIONS.includes(ext)) collected.push(entry.path);
      }
    } catch { /* ignore */ }
  }
  return collected;
};

const collectWithExpoFs = async FileSystem => {
  const collected = [];
  const queue = [...TELEGRAM_BASE_PATHS];
  while (queue.length > 0 && collected.length < MAX_WHATSAPP_STICKERS * 2) {
    const current = queue.shift();
    try {
      const entries = await FileSystem.readDirectoryAsync(ensureFileUri(current));
      for (const entryName of entries) {
        const fullPath = joinPaths(current, entryName);
        try {
          const info = await FileSystem.getInfoAsync(ensureFileUri(fullPath));
          if (info?.isDirectory) {
            queue.push(fullPath);
          } else if (isSupportedFile(entryName)) {
            collected.push(fullPath);
          }
        } catch { /* ignore individual entry failures */ }
      }
    } catch { /* ignore inaccessible directories */ }
  }
  return collected;
};

const collectDownloads = async FileSystem => {
  if (!FileSystem) return [];
  const collected = [];
  const queue = [...DOWNLOAD_BASE_PATHS];
  while (queue.length > 0 && collected.length < MAX_WHATSAPP_STICKERS * 2) {
    const current = queue.shift();
    try {
      const entries = await FileSystem.readDirectoryAsync(ensureFileUri(current));
      for (const entryName of entries) {
        const fullPath = joinPaths(current, entryName);
        try {
          const info = await FileSystem.getInfoAsync(ensureFileUri(fullPath));
          if (info?.isDirectory) {
            queue.push(fullPath);
          } else if (isSupportedFile(entryName)) {
            collected.push(fullPath);
          }
        } catch { /* ignore individual entry failures */ }
      }
    } catch { /* ignore */ }
  }
  return collected;
};

const collectWithSAFRoot = async (FileSystem, root, maxDepth = SAF_MAX_DEPTH) => {
  if (!FileSystem?.StorageAccessFramework || !root) return [];
  const SAF = FileSystem.StorageAccessFramework;
  try {
    const collected = [];
    const queue = [{ uri: root, depth: 0 }];

    while (queue.length > 0 && collected.length < MAX_WHATSAPP_STICKERS * 2) {
      const { uri, depth } = queue.shift();
      let entries = [];
      try {
        entries = await SAF.readDirectoryAsync(uri);
      } catch (e) {
        console.warn('SAF.readDirectoryAsync failed for root', uri, e);
        continue;
      }

      for (const entry of entries) {
        if (collected.length >= MAX_WHATSAPP_STICKERS * 2) break;
        let info = null;
        try {
          info = await FileSystem.getInfoAsync(entry);
        } catch {
          info = null;
        }
        if (info?.isDirectory) {
          if (depth < maxDepth) queue.push({ uri: entry, depth: depth + 1 });
          continue;
        }
        if (isSupportedEntry(info?.name || entry, info?.mimeType)) {
          collected.push(entry);
          continue;
        }
        try {
          const lastSegment = decodeURIComponent(entry.split('/').pop() || '');
          if (isSupportedEntry(lastSegment || entry)) collected.push(entry);
        } catch {
          if (isSupportedEntry(entry)) collected.push(entry);
        }
      }
    }
    return collected;
  } catch {
    return [];
  }
};

const collectWithSAF = async FileSystem => {
  if (!FileSystem?.StorageAccessFramework) return { files: [], rootUri: null };
  const SAF = FileSystem.StorageAccessFramework;
  try {
    // Try to start the picker in Telegram's media folder so hidden paths are visible.
    const initialUris = [
      'content://com.android.externalstorage.documents/tree/primary%3AAndroid%2FMedia%2Forg.telegram.messenger%2Ffiles%2Fstickers',
      'content://com.android.externalstorage.documents/tree/primary%3AAndroid%2FMedia%2Forg.telegram.messenger',
      'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FTelegram',
    ];
    let permission = null;
    for (const initialUri of initialUris) {
      try {
        permission = await SAF.requestDirectoryPermissionsAsync(initialUri);
        if (permission?.granted) break;
      } catch {
        /* ignore and fall through */
      }
    }
    if (!permission?.granted) {
      // Final attempt without initialUri.
      permission = await SAF.requestDirectoryPermissionsAsync();
    }
    if (!permission?.granted) return { files: [], rootUri: null };
    const root = permission.directoryUri || permission.uri;
    const files = await collectWithSAFRoot(FileSystem, root);
    return { files, rootUri: root };
  } catch {
    return { files: [], rootUri: null };
  }
};

const requestStoragePermission = async () => {
  if (Platform.OS !== 'android') return true;
  try {
    const Permissions = require('react-native-permissions');
    const { check, request, RESULTS, PERMISSIONS } = Permissions;
    const permission = Platform.Version >= 33
      ? PERMISSIONS.ANDROID.READ_MEDIA_IMAGES
      : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
    const current = await check(permission);
    if (current === RESULTS.GRANTED || current === RESULTS.LIMITED) return true;
    const next = await request(permission);
    if (next === RESULTS.GRANTED || next === RESULTS.LIMITED) return true;
    // Try broad storage access for sideloaded builds so hidden Telegram folders are visible.
    if (PERMISSIONS.ANDROID.MANAGE_EXTERNAL_STORAGE) {
      const manageCurrent = await check(PERMISSIONS.ANDROID.MANAGE_EXTERNAL_STORAGE);
      if (manageCurrent === RESULTS.GRANTED) return true;
      const manageNext = await request(PERMISSIONS.ANDROID.MANAGE_EXTERNAL_STORAGE);
      return manageNext === RESULTS.GRANTED;
    }
    return false;
  } catch (_err) {
    try {
      // Fallback to the platform permission API if react-native-permissions is unavailable.
      const { PermissionsAndroid } = require('react-native');
      const permission = Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
      if (!permission) return true;
      const result = await PermissionsAndroid.request(permission);
      if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
      // Try MANAGE_EXTERNAL_STORAGE for sideloaded builds.
      if (PermissionsAndroid.PERMISSIONS.MANAGE_EXTERNAL_STORAGE) {
        const manage = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.MANAGE_EXTERNAL_STORAGE);
        return manage === PermissionsAndroid.RESULTS.GRANTED;
      }
      return false;
    } catch {
      return true;
    }
  }
};

const tryGetExpoFs = () => {
  // Prefer the legacy API since StorageAccessFramework lives there in SDK 54.
  try {
    const legacy = require('expo-file-system/legacy');
    return legacy;
  } catch (_legacyErr) {
    try {
      const modern = require('expo-file-system');
      return modern.StorageAccessFramework ? modern : null;
    } catch (_err) {
      return null;
    }
  }
};

const describeFsAvailability = FileSystem => {
  if (!FileSystem) return 'expo-file-system not installed in this build.';
  if (!FileSystem.StorageAccessFramework) return 'StorageAccessFramework is missing in this build.';
  return null;
};

const getPersistedSafPath = async FileSystem => {
  if (!FileSystem?.documentDirectory) return null;
  try {
    const path = `${FileSystem.documentDirectory}${PERSISTED_SAF_ROOT_FILE}`;
    return await FileSystem.readAsStringAsync(path);
  } catch {
    return null;
  }
};

const persistSafPath = async (FileSystem, uri) => {
  if (!FileSystem?.documentDirectory || !uri) return;
  try {
    const path = `${FileSystem.documentDirectory}${PERSISTED_SAF_ROOT_FILE}`;
    await FileSystem.writeAsStringAsync(path, uri);
  } catch {
    /* ignore persistence failures */
  }
};

const TelegramImporter = ({ onImported, existingStickers = [] }) => {
  const [loading, setLoading] = useState(false);
  const [botLoading, setBotLoading] = useState(false);
  const [botProgress, setBotProgress] = useState(null);
  const [botToken, setBotToken] = useState('');
  const [packLink, setPackLink] = useState('');

  const importFromTelegram = async () => {
    setLoading(true);
    try {
      const hasPermission = await requestStoragePermission();
      if (!hasPermission) {
        Alert.alert('Limited access', 'Allow file access for automatic scanning, or pick a folder when prompted.');
      }
      const RNFS = getRNFS();
      const ExpoFileSystem = tryGetExpoFs();
      const storedSafRoot = ExpoFileSystem ? await getPersistedSafPath(ExpoFileSystem) : null;
      try {
        // Diagnostic: log the raw native module for troubleshooting.
        const { NativeModules } = require('react-native');
        console.log('NativeModules.ExpoFileSystem keys:', Object.keys(NativeModules?.ExpoFileSystem || {}));
        console.log('ExpoFileSystem module keys:', ExpoFileSystem ? Object.keys(ExpoFileSystem) : []);
      } catch {}
      const fsIssue = describeFsAvailability(ExpoFileSystem);
      console.log('Import telemetry: ExpoFS', !!ExpoFileSystem, 'SAF', !!ExpoFileSystem?.StorageAccessFramework, 'RNFS', !!RNFS, 'storedRoot', storedSafRoot);
      if (fsIssue && !RNFS) {
        Alert.alert(
          'Storage access limited',
          `${fsIssue} We will try to read common Telegram paths with react-native-fs if available; otherwise manual import will not work.`,
        );
      }
      const mapAndImport = files => {
        if (!files?.length) return false;
        const mapped = mapToStickerSources(files, existingStickers);
        if (mapped.length > 0) {
          onImported?.(mapped);
          return true;
        }
        return false;
      };

      // Always prefer SAF first (Android 11+ blocks direct /Android/data access).
      if (ExpoFileSystem) {
        if (storedSafRoot) {
          const safFiles = await collectWithSAFRoot(ExpoFileSystem, storedSafRoot);
          console.log('collectWithSAFRoot (persisted) ->', safFiles.length);
          if (mapAndImport(safFiles)) return;
        }
        const { files, rootUri } = await collectWithSAF(ExpoFileSystem);
        console.log('collectWithSAF picked root', rootUri, 'files', files.length);
        if (mapAndImport(files)) {
          await persistSafPath(ExpoFileSystem, rootUri);
          return;
        }
        const filesFromCommonPaths = await collectWithExpoFs(ExpoFileSystem);
        console.log('collectWithExpoFs ->', filesFromCommonPaths.length);
        if (mapAndImport(filesFromCommonPaths)) return;
        const downloads = await collectDownloads(ExpoFileSystem);
        console.log('collectDownloads (expo) ->', downloads.length);
        if (mapAndImport(downloads)) return;
      }

      // RNFS fallback (older Android versions / OEMs that still expose paths)
      if (RNFS) {
        const files = await collectWithRNFS(RNFS);
        console.log('collectWithRNFS ->', files.length);
        if (mapAndImport(files)) return;
        const downloads = await collectDownloads(RNFS);
        console.log('collectDownloads (rnfs) ->', downloads.length);
        if (mapAndImport(downloads)) return;
      }

      Alert.alert(
        'No stickers found',
        !ExpoFileSystem && !RNFS
          ? 'File access modules are not available in this build. Install a development build (not Expo Go) so we can read Telegram stickers, or use a version of the app that includes file access.'
        : RNFS
          ? 'We could not locate Telegram sticker files. Open the pack in Telegram, then tap Import and pick the stickers folder if prompted.'
          : 'Could not access Telegram cache automatically. Tap "Import Telegram Stickers" again and pick the Telegram stickers folder (usually under Android/Media or Download/Telegram). If you are running Expo Go, build a development APK/AAB so file access works.',
      );
    } catch (e) {
      Alert.alert('Import failed', e?.message ?? 'Unable to read Telegram stickers.');
    } finally { setLoading(false); }
  };

  const importFromBot = async () => {
    if (botLoading) return;
    setBotLoading(true);
    setBotProgress(null);
    try {
      const result = await importTelegramStickerPack({
        token: botToken.trim(),
        input: packLink.trim(),
        onProgress: setBotProgress,
      });
      onImported?.(result.stickers);
      Alert.alert('Telegram pack imported', `Downloaded ${result.stickers.length} stickers from ${result.title}.`);
    } catch (e) {
      Alert.alert('Bot import failed', e?.message ?? 'Unable to import this pack via Telegram bot.');
    } finally {
      setBotLoading(false);
    }
  };

  const disabled = Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Import from Telegram</Text>
        <Text style={styles.badge}>Auto + manual</Text>
      </View>
      <Text style={styles.copy}>
        Pull cached sticker files directly from Telegram or pick a Telegram/Download folder. Perfect for packs your bot just exported.
      </Text>
      <ActionButton title={loading ? 'Scanning Telegram...' : 'Import Telegram Stickers'} onPress={importFromTelegram} disabled={loading || disabled} loading={loading} />
      <Text style={styles.helper}>
        {disabled
          ? 'Telegram import is not available on web.'
          : 'When prompted, pick the folder that directly contains .webp sticker files (e.g., Android/Media/org.telegram.messenger/Telegram/Telegram Stickers/<pack>).'}
      </Text>

      <View style={styles.botCard}>
        <Text style={styles.botTitle}>Import via Telegram bot</Text>
        <Text style={styles.botCopy}>
          Paste your bot token and a pack link (https://t.me/addstickers/...) to fetch stickers directly.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Bot token (123456:ABC...)"
          placeholderTextColor={colors.textMuted}
          value={botToken}
          onChangeText={setBotToken}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="Sticker pack link or name"
          placeholderTextColor={colors.textMuted}
          value={packLink}
          onChangeText={setPackLink}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ActionButton
          title={botLoading ? 'Downloading pack...' : 'Import via Bot'}
          onPress={importFromBot}
          disabled={botLoading || disabled}
          loading={botLoading}
        />
        {botProgress && (
          <Text style={styles.progressText}>
            Downloading {botProgress.current}/{botProgress.total}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, paddingVertical: spacing(2), paddingHorizontal: spacing(2.25), borderWidth: 1, borderColor: colors.divider, marginTop: spacing(1) },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing(0.75) },
  title: { ...typography.subheading, color: colors.textPrimary, fontWeight: '700' },
  badge: { ...typography.caption, color: colors.primaryAccent, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing(1), paddingVertical: spacing(0.35), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider },
  copy: { ...typography.body, marginBottom: spacing(1.25), color: colors.textSecondary },
  helper: { ...typography.caption, marginTop: spacing(1), textAlign: 'center' },
  botCard: { marginTop: spacing(1.5), padding: spacing(1.5), borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  botTitle: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing(0.5) },
  botCopy: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing(1) },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.7),
    color: colors.textPrimary,
    ...typography.body,
    marginBottom: spacing(0.75),
  },
  progressText: { ...typography.caption, marginTop: spacing(0.75), color: colors.textMuted, textAlign: 'center' },
});

export default TelegramImporter;
