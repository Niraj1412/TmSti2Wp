import { Platform, Alert } from 'react-native';
import { tryRequire } from './safeRequire';

let PickerInstance = null;
let pickerError = null;

const getExpoImagePicker = () => {
  try {
    const mod = require('expo-image-picker');
    return mod && typeof mod.launchImageLibraryAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
};

const createExpoPickerFallback = () => {
  const ImagePicker = getExpoImagePicker();
  if (!ImagePicker) return null;
  return {
    openPicker: async ({ maxSelectedAssets = 30 } = {}) => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => ({ granted: false }));
      if (!perm?.granted) {
        const err = new Error('Media library permission not granted.');
        err.code = 'E_PERMISSION_DENIED';
        throw err;
      }
      const mediaTypeValue = (ImagePicker?.MediaType?.Images)
        || (ImagePicker?.MediaTypeOptions?.Images)
        || 'images';
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypeValue,
        allowsMultipleSelection: true,
        selectionLimit: maxSelectedAssets,
        quality: 1,
      });
      if (result?.canceled) {
        const err = new Error('Picker cancelled');
        err.code = 'E_PICKER_CANCELLED';
        throw err;
      }
      const assets = Array.isArray(result?.assets) ? result.assets : [];
      const mimeToExt = mime => {
        if (!mime || typeof mime !== 'string') return '';
        const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
        return map[mime.toLowerCase()] || '';
      };
      return assets.map(a => {
        const ext = mimeToExt(a?.mimeType || a?.type);
        const base = a?.fileName || a?.filename || 'image';
        const filename = ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
        return {
          realPath: a?.uri || null,
          path: a?.uri || null,
          uri: a?.uri || null,
          filename,
        };
      });
    },
  };
};

if (Platform.OS !== 'web') {
  try {
    const candidate = tryRequire('react-native-multiple-image-picker');
    if (candidate && typeof candidate.openPicker === 'function') {
      PickerInstance = candidate;
    } else {
      const fallback = createExpoPickerFallback();
      if (fallback) {
        PickerInstance = fallback;
      } else {
        throw new Error('react-native-multiple-image-picker appears to be unlinked.');
      }
    }
  } catch (error) {
    pickerError = error;
    PickerInstance = null;
  }
}

export const isPickerAvailable = () => PickerInstance != null;
export const getPicker = () => PickerInstance;
export const getPickerError = () => pickerError;
