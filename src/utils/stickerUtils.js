import { Platform } from 'react-native';

export const STICKER_DIMENSION = 512;
export const STICKER_SIZE_LIMIT_BYTES = 100 * 1024; // 100KB
export const ANIMATED_STICKER_SIZE_LIMIT_BYTES = 1024 * 1024; // 1MB

export const generateStickerId = () => `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const ANIMATED_EXTENSIONS = ['tgs', 'gif', 'webm', 'mp4', 'mkv'];

export const decodeBase64ToBytes = base64 => {
  if (!base64 || typeof base64 !== 'string') return null;
  try {
    const nodeBuffer = globalThis?.Buffer;
    if (nodeBuffer?.from) {
      return nodeBuffer.from(base64, 'base64');
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof global?.atob === 'function') {
      const binary = global.atob(base64);
      const length = binary.length;
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
  } catch {
    /* ignore */
  }
  return null;
};

export const isAnimatedWebpHeader = bytes => {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length < 21) return false;
  const readFourCC = (offset) => String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
  if (readFourCC(0) !== 'RIFF' || readFourCC(8) !== 'WEBP') return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = readFourCC(offset);
    const size = (
      (bytes[offset + 4])
      | (bytes[offset + 5] << 8)
      | (bytes[offset + 6] << 16)
      | (bytes[offset + 7] << 24)
    ) >>> 0;
    const payloadOffset = offset + 8;
    if (type === 'VP8X' && payloadOffset < bytes.length) {
      const flags = bytes[payloadOffset];
      return (flags & 0x02) === 0x02;
    }
    offset = payloadOffset + size + (size % 2);
  }
  return false;
};

// Returns a URI string suitable for native modules (keeps scheme when present).
export const normalizeFilePath = input => {
  if (!input || typeof input !== 'string') return '';
  const value = input.trim();
  // Keep known schemes as-is (content://, file://, http://, https://)
  if (/^(content|file|https?):\/\//i.test(value)) return value;
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

const resolveExtension = sticker => {
  if (!sticker) return '';
  const direct = sticker?.extension || getFileExtension(sticker?.name || sticker?.uri || '');
  if (direct) return direct.toLowerCase();
  const mime = sticker?.mimeType || sticker?.type;
  if (typeof mime === 'string' && mime.includes('/')) {
    return mime.split('/').pop().toLowerCase();
  }
  return '';
};

export const isAnimatedSticker = sticker => {
  if (sticker?.animated) return true;
  const ext = resolveExtension(sticker);
  if (ANIMATED_EXTENSIONS.includes(ext)) return true;
  const mime = sticker?.mimeType || sticker?.type;
  if (typeof mime === 'string') {
    if (mime.includes('gif') || mime.includes('webm') || mime.includes('mp4')) return true;
    if (mime.includes('tgsticker') || mime.includes('tgs')) return true;
  }
  return false;
};

export const isAnimatedWebpSticker = sticker => {
  if (!sticker?.animated) return false;
  const ext = resolveExtension(sticker);
  return ext === 'webp';
};

export const isSupportedStaticSticker = sticker => {
  if (sticker?.animated) return false;
  const ext = resolveExtension(sticker);
  const supportedExtensions = ['png', 'webp', 'jpeg', 'jpg'];
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
  const isAnimatedExt = ANIMATED_EXTENSIONS.includes(extension);
  const animated = typeof overrides?.animated === 'boolean' ? overrides.animated : isAnimatedExt;

  return {
    id: generateStickerId(),
    name,
    displayName: removeFileExtension(name),
    uri: normalizedUri,
    originalUri: normalizedUri,
    size: null,
    extension,
    format: extension ? extension.toUpperCase() : 'UNKNOWN',
    animated,
    status: createStatus('Imported', 'info'),
    ...overrides,
  };
};
