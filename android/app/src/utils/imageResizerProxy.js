import { Platform } from 'react-native';
import { tryRequire } from './safeRequire';

let ImageResizerInstance = null;
let resizerError = null;

if (Platform.OS !== 'web') {
  try {
    const candidate = tryRequire('react-native-image-resizer');
    if (!candidate || typeof candidate.createResizedImage !== 'function') {
      throw new Error('react-native-image-resizer native module appears to be unlinked.');
    }
    ImageResizerInstance = candidate;
  } catch (error) {
    resizerError = error;
    ImageResizerInstance = null;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[imageResizerProxy] module unavailable:', error?.message ?? error);
    }
  }
} else if (Platform.OS === 'web') {
  resizerError = new Error('Image resizing is not available on web environment.');
}

export const isImageResizerAvailable = () => ImageResizerInstance != null;
export const getImageResizer = () => ImageResizerInstance;
export const getImageResizerError = () => resizerError;
