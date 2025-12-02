import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../styles/theme';
import ActionButton from './ui/ActionButton';
import { getRNFS, getRNFSError } from '../utils/fsProxy';

const TELEGRAM_BASE_PATHS = [
  '/storage/emulated/0/Android/data/org.telegram.messenger/files/stickers',
  '/storage/emulated/0/Android/data/org.telegram.messenger.web/files/stickers',
];
const MAX_WHATSAPP_STICKERS = 30;
const STATIC_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];

const ensureFileUri = path => {
  if (!path) return path;
  return path.startsWith('file://') ? path : `file://${path.startsWith('/') ? '' : '/'}${path}`;
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

const mapToStickerSources = paths => paths
  .slice(0, MAX_WHATSAPP_STICKERS)
  .map(path => {
    const uri = ensureFileUri(path);
    return { uri, originalUri: path };
  });

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

const requestManualSelection = async onImported => {
  try {
    const ImagePicker = require('expo-image-picker');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => ({ granted: false }));
    if (!perm?.granted) {
      Alert.alert('Permission needed', 'Allow access to your photos to import stickers.');
      return false;
    }
    const mediaTypeValue = (ImagePicker?.MediaType?.Images)
      || (ImagePicker?.MediaTypeOptions?.Images)
      || 'images';
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypeValue,
      allowsMultipleSelection: true,
      selectionLimit: MAX_WHATSAPP_STICKERS,
      quality: 1,
    });
    if (result?.canceled) return false;
    const assets = Array.isArray(result?.assets) ? result.assets : [];
    if (assets.length === 0) return false;
    const mapped = assets.map(asset => ({ uri: asset?.uri, originalUri: asset?.uri })).slice(0, MAX_WHATSAPP_STICKERS);
    onImported?.(mapped);
    return true;
  } catch (_error) {
    return false;
  }
};

const tryGetExpoFs = () => {
  try {
    return require('expo-file-system');
  } catch (_error) {
    return null;
  }
};

const TelegramImporter = ({ onImported }) => {
  const [loading, setLoading] = useState(false);

  const importFromTelegram = async () => {
    setLoading(true);
    try {
      const RNFS = getRNFS();
      if (RNFS) {
        const files = await collectWithRNFS(RNFS);
        if (files.length === 0) {
          Alert.alert('No stickers found', 'Open the sticker pack in Telegram once, then try again.');
          return;
        }
        onImported?.(mapToStickerSources(files));
        return;
      }

      const ExpoFileSystem = tryGetExpoFs();
      if (ExpoFileSystem) {
        const files = await collectWithExpoFs(ExpoFileSystem);
        if (files.length > 0) {
          onImported?.(mapToStickerSources(files));
          return;
        }
      }

      const manualSelectionHandled = await requestManualSelection(onImported);
      if (!manualSelectionHandled) {
        const reason = getRNFSError();
        Alert.alert('File access unavailable', reason?.message ?? 'This environment cannot scan Telegram cache automatically.');
      }
    } catch (e) {
      Alert.alert('Import failed', e?.message ?? 'Unable to read Telegram stickers.');
    } finally { setLoading(false); }
  };

  const disabled = Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <ActionButton title={loading ? 'Scanning Telegram...' : 'Import Telegram Stickers'} onPress={importFromTelegram} disabled={loading || disabled} loading={loading} />
      <Text style={styles.helper}>
        {disabled ? 'Telegram import is not available on web.' : 'Automatically discovers Telegram sticker files stored on your device.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceSubtle, borderRadius: 20, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2) },
  helper: { ...typography.caption, marginTop: spacing(1), textAlign: 'center' },
});

export default TelegramImporter;
