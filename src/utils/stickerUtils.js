import { Platform } from 'react-native';

export const STICKER_DIMENSION = 512;
export const STICKER_SIZE_LIMIT_BYTES = 100 * 1024; // 100KB

export const generateStickerId = () => `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Returns a URI string suitable for native modules (keeps scheme when present).
export const normalizeFilePath = input => {
  if (!input || typeof input !== 'string') return '';
  const value = input.trim();
  // Keep known schemes as-is (content://, file://)
  if (/^(content|file):\/\//i.test(value)) return value;
  // On Android, assume bare paths need file://
  if (Platform.OS === 'android') return `file://${value}`;
  return value;
};

export const getFileExtension = filename => {
  if (!filename) return '';
  const match = /(\.\w+)$/.exec(filename);
  return match ? match[1].slice(1).toLowerCase() : '';
};

export const removeFileExtension = filename => (filename ? filename.replace(/\.[^/.]+$/, '') || filename : 'Sticker');

export const deriveStickerName = path => {
  if (!path) return 'sticker.webp';
  const normalized = normalizeFilePath(path).replace(/^(file|content):\/\//, '');
  const parts = normalized.split(/[\\/]/);
  return parts.pop() || 'sticker.webp';
};

export const isAnimatedSticker = sticker => {
  const value = sticker?.extension || sticker?.type || sticker?.name || sticker?.uri;
  return getFileExtension(value)?.toLowerCase() === 'tgs';
};

export const isSupportedStaticSticker = sticker => {
  const ext = (sticker?.extension || getFileExtension(sticker?.name || sticker?.uri)).toLowerCase();
  const supportedExtensions = ['png', 'webp', 'jpeg', 'jpg', 'gif'];
  if (supportedExtensions.includes(ext)) return true;
  // If no extension, but we have a direct URI, attempt anyway (Expo picker often returns content:// without name)
  if (!ext && typeof sticker?.uri === 'string') return true;
  return false;
};

export const createStatus = (label, level = 'info', extra = {}) => ({ label, level, ...extra });

export const buildStickerFromPath = (path, overrides = {}) => {
  if (!path) return null;

  const normalizedUri = normalizeFilePath(path);
  const name = deriveStickerName(normalizedUri);
  const extension = getFileExtension(name);

  return {
    id: generateStickerId(),
    name,
    displayName: removeFileExtension(name),
    uri: normalizedUri,
    originalUri: normalizedUri,
    size: null,
    extension,
    format: extension ? extension.toUpperCase() : 'UNKNOWN',
    status: createStatus('Imported', 'info'),
    ...overrides,
  };
};
