import { getRNFS } from '../utils/fsProxy';
import { buildStickerFromPath } from '../utils/stickerUtils';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_FILE_BASE = 'https://api.telegram.org/file';
const MAX_STICKERS = 30;

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

const normalizeFileUri = (value: string) => {
  if (!value) return '';
  return /^file:\/\//i.test(value) ? value : `file://${value}`;
};

const getBaseDirectory = (FileSystem: any, RNFS: any) => {
  const expoBase = FileSystem?.cacheDirectory || FileSystem?.documentDirectory;
  if (expoBase) return { type: 'expo', baseDir: expoBase };
  const rnfsBase = RNFS?.CachesDirectoryPath
    || RNFS?.ExternalCachesDirectoryPath
    || RNFS?.DocumentDirectoryPath
    || RNFS?.ExternalDirectoryPath
    || RNFS?.TemporaryDirectoryPath;
  if (rnfsBase) return { type: 'rnfs', baseDir: rnfsBase };
  return null;
};

const ensureDir = async (FileSystem: any, RNFS: any, dir: string) => {
  if (FileSystem?.makeDirectoryAsync) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    return;
  }
  if (RNFS?.mkdir) {
    await RNFS.mkdir(dir);
  }
};

const downloadFile = async (FileSystem: any, RNFS: any, url: string, targetPath: string) => {
  if (FileSystem?.downloadAsync) {
    await FileSystem.downloadAsync(url, targetPath);
    return targetPath;
  }
  if (RNFS?.downloadFile) {
    await RNFS.downloadFile({ fromUrl: url, toFile: targetPath }).promise;
    return normalizeFileUri(targetPath);
  }
  throw new Error('No file system module available for downloads.');
};

const parseStickerSetName = (input?: string | null) => {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/addstickers\/([^/?#]+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const tgMatch = trimmed.match(/tg:\/\/addstickers\?set=([^&]+)/i);
  if (tgMatch?.[1]) return tgMatch[1];
  if (trimmed.startsWith('@')) return trimmed.slice(1);
  return trimmed;
};

const telegramRequest = async (token: string, method: string, params: Record<string, string>) => {
  const query = new URLSearchParams(params);
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}?${query.toString()}`;
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    const description = payload?.description || 'Telegram API request failed.';
    throw new Error(description);
  }
  return payload.result;
};

const getFileExtension = (value?: string | null) => {
  if (!value) return '';
  const match = /(\.\w+)$/.exec(value);
  return match ? match[1].slice(1).toLowerCase() : '';
};

export const importTelegramStickerPack = async ({
  token,
  input,
  limit = MAX_STICKERS,
  onProgress,
}: {
  token: string;
  input: string;
  limit?: number;
  onProgress?: (progress: { current: number; total: number }) => void;
}) => {
  if (!token) throw new Error('Telegram bot token is required.');
  const setName = parseStickerSetName(input);
  if (!setName) throw new Error('Sticker pack link or name is required.');

  const FileSystem = getExpoFileSystem();
  const RNFS = getRNFS();
  const base = getBaseDirectory(FileSystem, RNFS);
  if (!base) throw new Error('Cache directory unavailable.');

  const pack = await telegramRequest(token, 'getStickerSet', { name: setName });
  const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
  const total = Math.min(stickers.length, limit);
  if (!total) throw new Error('Telegram pack is empty or unavailable.');

  const outputDir = base.type === 'expo'
    ? `${base.baseDir}telegram-pack-${Date.now()}/`
    : `${base.baseDir}/telegram-pack-${Date.now()}`;
  await ensureDir(FileSystem, RNFS, outputDir);

  const downloaded = [];
  for (let index = 0; index < total; index += 1) {
    const sticker = stickers[index];
    onProgress?.({ current: index + 1, total });
    const fileInfo = await telegramRequest(token, 'getFile', { file_id: sticker.file_id });
    const filePath = fileInfo?.file_path;
    if (!filePath) continue;

    const ext = getFileExtension(filePath) || (sticker?.is_animated ? 'tgs' : 'webp');
    const fileUrl = `${TELEGRAM_FILE_BASE}/bot${token}/${filePath}`;
    const fileName = `sticker-${String(index + 1).padStart(2, '0')}.${ext}`;
    const target = base.type === 'expo' ? `${outputDir}${fileName}` : `${outputDir}/${fileName}`;
    const localUri = await downloadFile(FileSystem, RNFS, fileUrl, target);

    const animated = Boolean(sticker?.is_animated || sticker?.is_video || sticker?.format === 'animated' || sticker?.format === 'video');
    const stickerItem = buildStickerFromPath(localUri, {
      source: 'telegram-bot',
      animated,
      emojis: sticker?.emoji ? [sticker.emoji] : [],
    });
    if (stickerItem) downloaded.push(stickerItem);
  }

  if (!downloaded.length) {
    throw new Error('Unable to download stickers from Telegram.');
  }

  return {
    name: pack?.name || setName,
    title: pack?.title || setName,
    isAnimated: downloaded.some(item => item?.animated),
    stickers: downloaded,
  };
};
