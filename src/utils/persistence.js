import { getRNFS } from './fsProxy';

const STORE_FILE = 'sticker-packs.json';

const getExpoFileSystem = () => {
  try {
    const legacy = require('expo-file-system/legacy');
    if (legacy) return legacy;
  } catch {
    /* ignore */
  }
  try {
    return require('expo-file-system');
  } catch {
    return null;
  }
};

const resolveStorePath = () => {
  const FileSystem = getExpoFileSystem();
  if (FileSystem?.documentDirectory) {
    return FileSystem.documentDirectory.endsWith('/')
      ? `${FileSystem.documentDirectory}${STORE_FILE}`
      : `${FileSystem.documentDirectory}/${STORE_FILE}`;
  }
  const RNFS = getRNFS();
  if (RNFS?.DocumentDirectoryPath) {
    return `${RNFS.DocumentDirectoryPath}/${STORE_FILE}`;
  }
  return null;
};

export const readPersistedState = async () => {
  const path = resolveStorePath();
  if (!path) return null;

  const FileSystem = getExpoFileSystem();
  try {
    if (FileSystem?.getInfoAsync && FileSystem?.readAsStringAsync) {
      const info = await FileSystem.getInfoAsync(path);
      if (!info?.exists) return null;
      const raw = await FileSystem.readAsStringAsync(path);
      return JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  try {
    const RNFS = getRNFS();
    if (RNFS?.exists && RNFS?.readFile) {
      const exists = await RNFS.exists(path);
      if (!exists) return null;
      const raw = await RNFS.readFile(path, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  return null;
};

export const writePersistedState = async (payload) => {
  const path = resolveStorePath();
  if (!path) return false;

  const serialized = JSON.stringify(payload ?? {});
  const FileSystem = getExpoFileSystem();
  try {
    if (FileSystem?.writeAsStringAsync) {
      await FileSystem.writeAsStringAsync(path, serialized);
      return true;
    }
  } catch {
    /* ignore */
  }

  try {
    const RNFS = getRNFS();
    if (RNFS?.writeFile) {
      await RNFS.writeFile(path, serialized, 'utf8');
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
};
