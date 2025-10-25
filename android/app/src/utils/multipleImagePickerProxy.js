import { Platform } from 'react-native';
import { tryRequire } from './safeRequire';

let PickerInstance = null;
let pickerError = null;

if (Platform.OS !== 'web') {
  try {
    const candidate = tryRequire('react-native-multiple-image-picker');
    if (!candidate || typeof candidate.openPicker !== 'function') {
      throw new Error('react-native-multiple-image-picker appears to be unlinked.');
    }
    PickerInstance = candidate;
  } catch (error) {
    pickerError = error;
    PickerInstance = null;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[multipleImagePickerProxy] module unavailable:', error?.message ?? error);
    }
  }
} else if (Platform.OS === 'web') {
  pickerError = new Error('Gallery picker is not available on web.');
}

export const isPickerAvailable = () => PickerInstance != null;
export const getPicker = () => PickerInstance;
export const getPickerError = () => pickerError;
