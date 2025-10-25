import { Platform } from 'react-native';
import { tryRequire } from './safeRequire';

let WSManagerInstance = null;
let wsManagerError = null;

if (Platform.OS !== 'web') {
  try {
    const candidate = tryRequire('react-native-whatsapp-stickers-manager');
    if (!candidate || !candidate.Pack) {
      throw new Error('react-native-whatsapp-stickers-manager appears to be unlinked.');
    }
    WSManagerInstance = candidate;
  } catch (error) {
    wsManagerError = error;
    WSManagerInstance = null;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[whatsappManagerProxy] module unavailable:', error?.message ?? error);
    }
  }
} else if (Platform.OS === 'web') {
  wsManagerError = new Error('WhatsApp stickers manager is not available on web.');
}

export const isWSManagerAvailable = () => WSManagerInstance != null;
export const getWSManager = () => WSManagerInstance;
export const getWSManagerError = () => wsManagerError;
