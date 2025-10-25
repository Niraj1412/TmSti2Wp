import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { ensureAllFilesAccess } from '../utils/permissions';
import { mapTelegramFileToSticker, createStatus } from '../utils/stickerUtils';
import ActionButton from './ui/ActionButton';
import { colors, spacing, typography } from '../styles/theme';
import { getRNFS, getRNFSError, isRNFSAvailable } from '../utils/fsProxy';

const TELEGRAM_BASE_PATHS = [
  '/storage/emulated/0/Android/data/org.telegram.messenger/files/stickers',
  '/storage/emulated/0/Android/data/org.telegram.messenger.web/files/stickers',
];
const MAX_WHATSAPP_STICKERS = 30;

const STATIC_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];
const ANIMATED_EXTENSIONS = ['tgs'];

const collectStickerFiles = async RNFS => {
  const collected = [];
  const queue = [...TELEGRAM_BASE_PATHS];

  while (queue.length > 0 && collected.length < MAX_WHATSAPP_STICKERS * 2) {
    const current = queue.shift();
    try {
      const entries = await RNFS.readDir(current);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          queue.push(entry.path);
          continue;
        }
        const ext = entry.name.split('.').pop()?.toLowerCase();
        if (!ext) {
          continue;
        }
        if (STATIC_EXTENSIONS.includes(ext) || ANIMATED_EXTENSIONS.includes(ext)) {
          collected.push(entry.path);
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  return collected;
};

const TelegramImporter = ({ onImported }) => {
  const [loading, setLoading] = useState(false);

  const importFromTelegram = async () => {
    setLoading(true);
    try {
      if (!isRNFSAvailable()) {
        const reason = getRNFSError();
        Alert.alert(
          'File access unavailable',
          reason?.message ?? 'Rebuild the app to enable file system imports.',
        );
        return;
      }

      const RNFS = getRNFS();
      if (!RNFS) {
        Alert.alert(
          'File access unavailable',
          'react-native-fs is missing. Rebuild the native app to enable Telegram imports.',
        );
        return;
      }

      const allowed = await ensureAllFilesAccess();
      if (!allowed) {
        Alert.alert(
          'Permission needed',
          'Enable "All files access" in Settings to read Telegram stickers.',
        );
        return;
      }

      const files = await collectStickerFiles(RNFS);
      if (files.length === 0) {
        Alert.alert(
          'No stickers found',
          'Open the sticker pack in Telegram once, then try again.',
        );
        return;
      }

      const mapped = files
        .map(mapTelegramFileToSticker)
        .filter(Boolean)
        .slice(0, MAX_WHATSAPP_STICKERS);

      if (mapped.length === 0) {
        Alert.alert(
          'Nothing to import',
          'Only animated stickers were found. Convert them to static images first.',
        );
        return;
      }

      const withStatus = mapped.map((sticker, index) => ({
        ...sticker,
        status:
          sticker.status?.level === 'warning'
            ? sticker.status
            : createStatus(`Telegram sticker ${index + 1}`, 'info'),
        source: 'telegram',
      }));

      onImported?.(withStatus);
    } catch (error) {
      Alert.alert('Import failed', error?.message ?? 'Unable to read Telegram stickers.');
    } finally {
      setLoading(false);
    }
  };

  const isExpoGo = Constants?.appOwnership === 'expo';
  const isUnavailable = isExpoGo || Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <ActionButton
        title={loading ? 'Scanning Telegram...' : 'Import Telegram Stickers'}
        onPress={importFromTelegram}
        disabled={loading || isUnavailable}
        loading={loading}
      />
      <Text style={styles.helper}>
        {isUnavailable
          ? `Telegram import isn’t available in ${Platform.OS === 'web' ? 'web' : 'Expo Go'}.`
          : 'Automatically discovers Telegram sticker files stored on your device.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 20,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
  },
  helper: {
    ...typography.caption,
    marginTop: spacing(1),
    textAlign: 'center',
  },
});

export default TelegramImporter;
