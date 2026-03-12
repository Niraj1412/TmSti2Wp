import React from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { getPicker, getPickerError } from '../utils/multipleImagePickerProxy';
import ActionButton from './ui/ActionButton';
import { colors, radius, spacing, typography } from '../styles/theme';

const MAX_ASSETS = 30;

const ImagePicker = ({ onImagesPicked, loading }) => {
  const openPicker = async () => {
    try {
      const Picker = getPicker();
      if (!Picker) {
        const reason = getPickerError();
        Alert.alert('Gallery picker unavailable', reason?.message ?? 'Install react-native-image-picker or expo-image-picker and rebuild the app.');
        return;
      }
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
      onImagesPicked?.(assets);
    } catch (error) {
      if (error?.code === 'E_PICKER_CANCELLED') return;
      Alert.alert('Image picker error', error?.message ?? 'Failed to pick images from gallery.');
    }
  };

  const disabled = Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Import from gallery</Text>
        <Text style={styles.badge}>Manual</Text>
      </View>
      <Text style={styles.caption}>Load images you want to turn into WhatsApp-ready stickers.</Text>
      <ActionButton title="Choose Images" onPress={openPicker} disabled={loading || disabled} loading={loading} variant="outline" />
      {disabled && (
        <Text style={[styles.caption, { marginTop: spacing(0.75) }]}>Gallery picker isn't available on web.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    paddingVertical: spacing(1.75),
    paddingHorizontal: spacing(2.25),
    marginTop: spacing(1.25),
    borderWidth: 1,
    borderColor: colors.divider,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(0.5) },
  title: { ...typography.subheading, color: colors.textPrimary, fontWeight: '700' },
  badge: { ...typography.caption, color: colors.primary, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing(1), paddingVertical: spacing(0.35), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider },
  caption: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing(1) },
});

export default ImagePicker;
