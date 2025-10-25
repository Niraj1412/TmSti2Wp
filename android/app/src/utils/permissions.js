import { PermissionsAndroid, Platform } from 'react-native';
import { isPermissionsAvailable, getPermissions, getPermissionsError } from './permissionsProxy';

export const requestStoragePermission = async () => {
  if (Platform.OS !== 'android') return true;

  if (!isPermissionsAvailable()) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[permissions] unavailable:', getPermissionsError()?.message);
    }
    return true; // Gracefully allow in environments where it is unsupported
  }

  const { check, request, openSettings, PERMISSIONS, RESULTS } = getPermissions();
  const hasPermission = await check(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
  if (hasPermission === RESULTS.GRANTED) return true;

  const result = await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
  return result === RESULTS.GRANTED;
};

export const ensureAllFilesAccess = async () => {
  if (Platform.OS !== 'android') {
    return true;
  }

  if (!isPermissionsAvailable()) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[permissions] unavailable:', getPermissionsError()?.message);
    }
    return true;
  }

  const { check, request, openSettings, PERMISSIONS, RESULTS } = getPermissions();

  if (Platform.Version < 30) {
    return requestStoragePermission();
  }

  const managePermission = PERMISSIONS.ANDROID.MANAGE_EXTERNAL_STORAGE;
  const status = await check(managePermission);

  if (status === RESULTS.GRANTED) {
    return true;
  }

  if (status === RESULTS.DENIED) {
    const requestStatus = await request(managePermission);
    return requestStatus === RESULTS.GRANTED;
  }

  if (status === RESULTS.BLOCKED) {
    await openSettings().catch(() => {});
    return false;
  }

  return false;
};
