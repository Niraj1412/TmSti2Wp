import { Platform } from 'react-native';
import { tryRequire } from './safeRequire';

let RNFSInstance = null;
let rnfsError = null;

if (Platform.OS !== 'web') {
  try {
    const candidate = tryRequire('react-native-fs');
    if (!candidate || typeof candidate.readDir !== 'function') {
      throw new Error('react-native-fs native module appears to be unlinked.');
    }
    RNFSInstance = candidate;
  } catch (error) {
    rnfsError = error;
    RNFSInstance = null;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[fsProxy] react-native-fs is unavailable:', error?.message ?? error);
    }
  }
} else if (Platform.OS === 'web') {
  rnfsError = new Error('File system access is not available on web environment.');
}

export const isRNFSAvailable = () => RNFSInstance != null;

export const getRNFS = () => RNFSInstance;

export const getRNFSError = () => rnfsError;

export const requireRNFS = () => {
  if (!RNFSInstance) {
    const error =
      rnfsError ??
      new Error(
        'react-native-fs is not available. Ensure the native module is installed and the app was rebuilt.',
      );
    throw error;
  }
  return RNFSInstance;
};
