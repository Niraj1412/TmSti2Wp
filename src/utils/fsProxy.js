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
  }
} else {
  rnfsError = new Error('File system access is not available on web environment.');
}

export const isRNFSAvailable = () => RNFSInstance != null;
export const getRNFS = () => RNFSInstance;
export const getRNFSError = () => rnfsError;
export const requireRNFS = () => {
  if (!RNFSInstance) {
    const error = rnfsError ?? new Error('react-native-fs is not available. Rebuild the app.');
    throw error;
  }
  return RNFSInstance;
};

