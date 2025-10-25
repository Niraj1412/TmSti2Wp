import React from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { isPickerAvailable, getPicker, getPickerError } from '../utils/multipleImagePickerProxy';
import ActionButton from './ui/ActionButton';
import { colors, spacing, typography } from '../styles/theme';

const MAX_ASSETS = 30;

const normalizeAssetPath = asset => {
  if (!asset) return null;
  return asset.realPath || asset.path || asset.uri || asset.filename || null;
};

const ImagePicker = ({ onImagesPicked, loading }) => {
  const openPicker = async () => {
    try {
      if (!isPickerAvailable()) {
        const reason = getPickerError();
        Alert.alert(
          'Gallery picker unavailable',
          reason?.message ?? 'This environment does not support image picking.',
        );
        return;
      }

      const Picker = getPicker();
      const assets = await Picker.openPicker({
        mediaType: 'image',
        isPreview: true,
        maxSelectedAssets: MAX_ASSETS,
        doneTitle: 'Import',
        cancelTitle: 'Cancel',
        selectedAssets: [],
      });

      if (!Array.isArray(assets) || assets.length === 0) {
        onImagesPicked?.([]);
        return;
      }

      const paths = assets.map(normalizeAssetPath).filter(Boolean);
      onImagesPicked?.(paths);
    } catch (error) {
      if (error?.code === 'E_PICKER_CANCELLED') {
        return;
      }
      Alert.alert('Image picker error', error?.message ?? 'Failed to pick images from gallery.');
    }
  };

  const isExpoGo = Constants?.appOwnership === 'expo';
  const isUnavailable = isExpoGo || Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <View style={styles.copyBlock}>
        <Text style={styles.title}>From gallery</Text>
        <Text style={styles.caption}>
          Load Telegram stickers you exported manually or saved from chat.
        </Text>
      </View>
      <ActionButton
        title="Choose Images"
        onPress={openPicker}
        disabled={loading || isUnavailable}
        loading={loading}
        variant="outline"
      />
      {isUnavailable && (
        <Text style={[styles.caption, { marginTop: spacing(0.75) }]}>
          Gallery picker isn’t available in {Platform.OS === 'web' ? 'web' : 'Expo Go'}.
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 20,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    marginTop: spacing(1.5),
  },
  copyBlock: {
    marginBottom: spacing(1.5),
  },
  title: {
    ...typography.subheading,
    color: colors.textPrimary,
    marginBottom: spacing(0.75),
  },
  caption: {
    ...typography.caption,
  },
});

export default ImagePicker;
