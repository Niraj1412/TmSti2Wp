import { Platform } from 'react-native';
import { tryRequire } from './safeRequire';

let PermissionsModule = null;
let permissionsError = null;

if (Platform.OS !== 'web') {
  try {
    PermissionsModule = tryRequire('react-native-permissions');
    if (!PermissionsModule) {
      throw new Error('react-native-permissions is unavailable.');
    }
  } catch (e) {
    permissionsError = e;
    PermissionsModule = null;
  }
} else {
  permissionsError = new Error('Permissions module is not available on web.');
}

export const isPermissionsAvailable = () => PermissionsModule != null;
export const getPermissions = () => PermissionsModule;
export const getPermissionsError = () => permissionsError;

