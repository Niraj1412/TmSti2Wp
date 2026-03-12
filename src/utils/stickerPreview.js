import { NativeModules } from 'react-native';
import { getImageResizer, isImageResizerAvailable } from './imageResizerProxy';
import { getRNFS } from './fsProxy';
import { normalizeFilePath } from './stickerUtils';

const getStickerPreviewModule = () => {
  const module = NativeModules?.StickerPreview;
  if (!module || typeof module.createPreview !== 'function') return null;
  return module;
};

export const isNativeStickerPreviewAvailable = () => Boolean(getStickerPreviewModule());

const remoteSourceCache = new Map();

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

const isRemoteUri = uri => /^https?:\/\//i.test(String(uri || '').trim());

const guessRemoteExtension = uri => {
  const match = String(uri || '').match(/\.([a-zA-Z0-9]{2,6})(?:$|[?#])/);
  return (match?.[1] || 'webp').toLowerCase();
};

const ensureLocalPreviewSource = async uri => {
  const source = normalizeFilePath(uri);
  if (!source || !isRemoteUri(source)) return source;
  const cached = remoteSourceCache.get(source);
  if (cached) return cached;

  const ext = guessRemoteExtension(source);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filename = `preview-src-${token}.${ext}`;

  const FileSystem = getExpoFileSystem();
  const RNFS = getRNFS();
  const expoDir = FileSystem?.cacheDirectory || FileSystem?.documentDirectory || null;
  const rnfsDir = RNFS?.CachesDirectoryPath || RNFS?.TemporaryDirectoryPath || RNFS?.DocumentDirectoryPath || null;

  if (FileSystem?.downloadAsync && expoDir) {
    try {
      const target = expoDir.endsWith('/') ? `${expoDir}${filename}` : `${expoDir}/${filename}`;
      const downloaded = await FileSystem.downloadAsync(source, target);
      const localUri = normalizeFilePath(downloaded?.uri || target);
      remoteSourceCache.set(source, localUri);
      return localUri;
    } catch {
      /* ignore and fallback */
    }
  }

  if (RNFS?.downloadFile && rnfsDir) {
    try {
      const target = `${rnfsDir}/${filename}`;
      const result = await RNFS.downloadFile({ fromUrl: source, toFile: target }).promise;
      if (result?.statusCode >= 200 && result?.statusCode < 300) {
        const localUri = normalizeFilePath(target);
        remoteSourceCache.set(source, localUri);
        return localUri;
      }
    } catch {
      /* ignore and fallback */
    }
  }

  return source;
};

export const createStickerPreview = async (uri, { width = 128, height = 128 } = {}) => {
  const source = await ensureLocalPreviewSource(uri);
  if (!source) return null;

  const nativePreview = getStickerPreviewModule();
  if (nativePreview?.createPreview) {
    try {
      const result = await nativePreview.createPreview(source, width, height);
      const out = result?.uri || result?.path || null;
      if (out) return normalizeFilePath(out);
    } catch {
      /* ignore */
    }
  }

  try {
    const ImageManipulator = require('expo-image-manipulator');
    if (ImageManipulator?.manipulateAsync) {
      const resized = await ImageManipulator.manipulateAsync(
        source,
        [{ resize: { width, height } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.PNG },
      );
      if (resized?.uri) return normalizeFilePath(resized.uri);
    }
  } catch {
    /* ignore */
  }

  if (!isImageResizerAvailable()) return null;
  try {
    const resizer = getImageResizer();
    const resized = await resizer.createResizedImage(
      source,
      width,
      height,
      'PNG',
      75,
      0,
      undefined,
      false,
      { mode: 'cover' },
    );
    return resized?.uri ? normalizeFilePath(resized.uri) : null;
  } catch {
    return null;
  }
};

export const cropStickerSquare = async (uri) => {
  const source = normalizeFilePath(uri);
  if (!source) return null;
  const nativePreview = getStickerPreviewModule();
  if (!nativePreview || typeof nativePreview.cropSquare !== 'function') return null;
  try {
    const result = await nativePreview.cropSquare(source);
    const out = result?.uri || result?.path || null;
    return out ? normalizeFilePath(out) : null;
  } catch {
    return null;
  }
};

export const removeStickerBackgroundBasic = async (uri, { tolerance = 44 } = {}) => {
  const source = normalizeFilePath(uri);
  if (!source) return null;
  const nativePreview = getStickerPreviewModule();
  if (!nativePreview || typeof nativePreview.removeBackgroundBasic !== 'function') return null;
  try {
    const result = await nativePreview.removeBackgroundBasic(source, tolerance);
    const out = result?.uri || result?.path || null;
    return out ? normalizeFilePath(out) : null;
  } catch {
    return null;
  }
};
