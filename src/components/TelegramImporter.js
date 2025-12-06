import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../styles/theme';
import ActionButton from './ui/ActionButton';
import { getRNFS, getRNFSError } from '../utils/fsProxy';
import { buildStickerFromPath, normalizeFilePath } from '../utils/stickerUtils';

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
const MAX_WHATSAPP_STICKERS = 30;
const STATIC_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];

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

const collectWithSAF = async FileSystem => {
  if (!FileSystem?.StorageAccessFramework) return [];
  const SAF = FileSystem.StorageAccessFramework;
  try {
    // Let the user pick any folder; we’ll scan once they select.
    const permission = await SAF.requestDirectoryPermissionsAsync();
    if (!permission?.granted) return [];
    const root = permission.directoryUri || permission.uri;
    const collected = [];
    const queue = [root];
    while (queue.length > 0 && collected.length < MAX_WHATSAPP_STICKERS * 2) {
      const current = queue.shift();
      let entries = [];
      try {
        entries = await SAF.readDirectoryAsync(current);
      } catch {
        continue;
      }
      for (const entry of entries) {
        try {
          const info = await FileSystem.getInfoAsync(entry);
          if (info?.isDirectory) {
            queue.push(entry);
          } else if (isSupportedFile(entry)) {
            collected.push(entry);
          }
        } catch { /* ignore */ }
      }
    }
    return collected;
  } catch {
    return [];
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
    return next === RESULTS.GRANTED || next === RESULTS.LIMITED;
  } catch (_err) {
    try {
      // Fallback to the platform permission API if react-native-permissions is unavailable.
      const { PermissionsAndroid } = require('react-native');
      const permission = Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
      if (!permission) return true;
      const result = await PermissionsAndroid.request(permission);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return true;
    }
  }
};

const tryGetExpoFs = () => {
  try {
    return require('expo-file-system');
  } catch (_error) {
    return null;
  }
};

const TelegramImporter = ({ onImported, existingStickers = [] }) => {
  const [loading, setLoading] = useState(false);

  const importFromTelegram = async () => {
    setLoading(true);
    try {
      const hasPermission = await requestStoragePermission();
      if (!hasPermission) {
        Alert.alert('Permission needed', 'Allow file access so we can read the Telegram sticker cache.');
        return;
      }
      const RNFS = getRNFS();
      const ExpoFileSystem = tryGetExpoFs();
      const rnfsReason = getRNFSError();
      const mapAndImport = files => {
        if (!files?.length) return false;
        const mapped = mapToStickerSources(files, existingStickers);
        if (mapped.length > 0) {
          onImported?.(mapped);
          return true;
        }
        return false;
      };

      // If react-native-fs is missing (Expo Go/dev client not using native module),
      // prompt the user to pick a folder via SAF first.
      let safTried = false;
      const trySaf = async () => {
        if (!ExpoFileSystem?.StorageAccessFramework) return [];
        safTried = true;
        return collectWithSAF(ExpoFileSystem);
      };

      if (!RNFS) {
        const safFiles = await trySaf();
        if (mapAndImport(safFiles)) return;
      }

      if (RNFS) {
        const files = await collectWithRNFS(RNFS);
        if (mapAndImport(files)) return;
      }

      if (ExpoFileSystem) {
        if (!safTried) {
          const safFiles = await trySaf();
          if (mapAndImport(safFiles)) return;
        }
        const files = await collectWithExpoFs(ExpoFileSystem);
        if (mapAndImport(files)) return;
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

  const disabled = Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <ActionButton title={loading ? 'Scanning Telegram...' : 'Import Telegram Stickers'} onPress={importFromTelegram} disabled={loading || disabled} loading={loading} />
      <Text style={styles.helper}>
        {disabled
          ? 'Telegram import is not available on web.'
          : 'Scans Telegram cache automatically and skips stickers you already added.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceSubtle, borderRadius: 20, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2) },
  helper: { ...typography.caption, marginTop: spacing(1), textAlign: 'center' },
});

export default TelegramImporter;
