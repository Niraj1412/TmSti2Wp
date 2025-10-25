import { Platform } from 'react-native';
import { getRNFS } from './fsProxy';

export const STICKER_DIMENSION = 512;
export const STICKER_SIZE_LIMIT_BYTES = 100 * 1024; // WhatsApp requires <= 100KB

export const generateStickerId = () =>
  `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const normalizeFilePath = path =>
  typeof path === 'string' ? path.replace(/^file:\/\//, '') : '';

export const getFileExtension = filename => {
  if (!filename) return '';
  const match = /\.(\w+)$/.exec(filename);
  return match ? match[1].toLowerCase() : '';
};

export const removeFileExtension = filename => {
  if (!filename) {
    return 'Sticker';
  }
  return filename.replace(/\.[^/.]+$/, '') || filename;
};

export const deriveStickerName = path => {
  if (!path) return 'sticker.webp';
  const normalized = normalizeFilePath(path);
  const parts = normalized.split(/[\\/]/);
  return parts.pop() || 'sticker.webp';
};

export const isAnimatedSticker = sticker => {
  const value = sticker?.extension || sticker?.type || sticker?.name || sticker?.uri;
  return getFileExtension(value)?.toLowerCase() === 'tgs';
};

export const isSupportedStaticSticker = sticker => {
  const supportedExtensions = ['png', 'webp', 'jpeg', 'jpg'];
  return supportedExtensions.includes(
    (sticker?.extension || getFileExtension(sticker?.name || sticker?.uri)).toLowerCase(),
  );
};

export const createStatus = (label, level = 'info', extra = {}) => ({
  label,
  level,
  ...extra,
});

export const buildStickerFromPath = (path, overrides = {}) => {
  if (!path) return null;

  const normalizedPath = normalizeFilePath(path);
  const extension = getFileExtension(normalizedPath);
  const name = deriveStickerName(normalizedPath);

  return {
    id: generateStickerId(),
    name,
    displayName: removeFileExtension(name),
    uri: Platform.OS === 'android' ? `file://${normalizedPath}` : normalizedPath,
    originalUri: normalizedPath,
    size: null,
    extension,
    format: extension ? extension.toUpperCase() : 'UNKNOWN',
    status: createStatus('Imported', 'info'),
    ...overrides,
  };
};

export const mapTelegramFileToSticker = filePath => {
  if (!filePath) return null;
  const sticker = buildStickerFromPath(filePath, { source: 'telegram' });

  if (isAnimatedSticker(sticker)) {
    return {
      ...sticker,
      status: createStatus('Animated (.tgs) not supported', 'warning'),
    };
  }

  if (!isSupportedStaticSticker(sticker)) {
    return {
      ...sticker,
      status: createStatus('Unsupported format', 'error'),
    };
  }

  return sticker;
};

export const ensureFileSize = async path => {
  const RNFS = getRNFS();
  if (!RNFS) {
    return null;
  }
  try {
    const normalized = normalizeFilePath(path);
    const stat = await RNFS.stat(normalized);
    return stat.size ?? null;
  } catch {
    return null;
  }
};
