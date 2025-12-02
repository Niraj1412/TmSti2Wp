import { Platform } from 'react-native';
import { tryRequire } from './safeRequire';

let ImageResizerInstance = null;
let resizerError = null;

const getExpoImageManipulator = () => {
  try {
    const mod = require('expo-image-manipulator');
    return mod && typeof mod.manipulateAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
};

const createManipulatorFallback = () => {
  const Manipulator = getExpoImageManipulator();
  if (!Manipulator) return null;
  return {
    createResizedImage: async (uri, width, height, format = 'WEBP', quality = 80) => {
      const actions = [{ resize: { width, height } }];
      const saveFormat = String(format).toLowerCase();
      const compress = Math.max(0, Math.min(1, (Number(quality) || 80) / 100));
      const result = await Manipulator.manipulateAsync(uri, actions, { compress, format: saveFormat });
      return { uri: result?.uri, width: result?.width ?? width, height: result?.height ?? height };
    },
  };
};

if (Platform.OS !== 'web') {
  try {
    const candidate = tryRequire('react-native-image-resizer');
    const manipulatorFallback = createManipulatorFallback();
    if (candidate && typeof candidate.createResizedImage === 'function') {
      // Wrap native resizer to gracefully handle GIF or failures via Manipulator fallback
      ImageResizerInstance = {
        createResizedImage: async (...args) => {
          const src = (args && args[0]) || '';
          const isGif = typeof src === 'string' && /\.gif(\?|#|$)/i.test(src);
          if (isGif && manipulatorFallback) {
            return manipulatorFallback.createResizedImage(...args);
          }
          try {
            return await candidate.createResizedImage(...args);
          } catch (e) {
            if (manipulatorFallback) {
              return manipulatorFallback.createResizedImage(...args);
            }
            throw e;
          }
        },
      };
    } else {
      const fallback = manipulatorFallback;
      if (fallback) {
        ImageResizerInstance = fallback;
      } else {
        throw new Error('react-native-image-resizer native module appears to be unlinked.');
      }
    }
  } catch (error) {
    resizerError = error;
    ImageResizerInstance = null;
  }
}

export const isImageResizerAvailable = () => ImageResizerInstance != null;
export const getImageResizer = () => ImageResizerInstance;
export const getImageResizerError = () => resizerError;
