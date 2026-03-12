import { Image, NativeModules } from 'react-native';
import { getImageResizer } from '../utils/imageResizerProxy';
import { getRNFS } from '../utils/fsProxy';
import {
  STICKER_DIMENSION,
  STICKER_SIZE_LIMIT_BYTES,
  ANIMATED_STICKER_SIZE_LIMIT_BYTES,
  createStatus,
  getFileExtension,
  normalizeFilePath,
} from '../utils/stickerUtils';
import { convertVideoToAnimatedWebp, isFfmpegAvailable } from '../utils/videoStickerConverter';

const QUALITY_STEPS = [90, 80, 70, 60, 50, 40, 30, 25, 20, 15, 10];
const DETAIL_STEPS = [STICKER_DIMENSION, 384, 320, 256, 224, 192, 160, 128];
const PREPASS_QUALITY = 60;

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

const stripFileScheme = (value: string) => String(value || '').replace(/^file:\/\//i, '');

const resolveExtension = (sticker: any) => {
  if (!sticker) return '';
  const ext = (sticker?.extension || getFileExtension(sticker?.name || sticker?.uri || '') || '').toLowerCase();
  if (ext) return ext;
  const mime = sticker?.mimeType || sticker?.type;
  if (typeof mime === 'string' && mime.includes('/')) {
    return mime.split('/').pop()?.toLowerCase() || '';
  }
  return '';
};

export const isTgsConverterAvailable = () => {
  const converter = NativeModules?.TgsConverter;
  return Boolean(converter && typeof converter.renderFrames === 'function');
};

export const ensureLocalFileUri = async (uri: string, extensionHint?: string) => {
  if (!uri || !/^content:\/\//i.test(uri)) return uri;
  try {
    const FileSystem = getExpoFileSystem();
    const RNFS = getRNFS();
    const baseDir = FileSystem?.cacheDirectory
      || FileSystem?.documentDirectory
      || RNFS?.CachesDirectoryPath
      || RNFS?.DocumentDirectoryPath
      || RNFS?.TemporaryDirectoryPath;
    if (!baseDir) return uri;
    const ext = extensionHint || getFileExtension(uri) || 'webp';
    const dir = `${baseDir.replace(/\/$/, '')}/sticker-cache`;
    if (FileSystem?.makeDirectoryAsync) {
      await FileSystem.makeDirectoryAsync(normalizeFilePath(dir), { intermediates: true });
      const target = `${dir}/sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await FileSystem.copyAsync({ from: uri, to: normalizeFilePath(target) });
      return normalizeFilePath(target);
    }
    if (RNFS?.mkdir) {
      await RNFS.mkdir(dir);
      const target = `${dir}/sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      if (RNFS.copyFile) {
        await RNFS.copyFile(uri, target);
      }
      return normalizeFilePath(target);
    }
    return uri;
  } catch {
    return uri;
  }
};

const safeStat = async (uri: string) => {
  try {
    const FileSystem = getExpoFileSystem();
    const normalized = /^(file|content):\/\//.test(uri || '') ? uri : `file://${uri}`;
    const info = await FileSystem?.getInfoAsync?.(normalized);
    if (info?.size) return { size: info.size };
  } catch {
    /* ignore */
  }
  try {
    const RNFS = getRNFS();
    if (!RNFS?.stat) return null;
    const path = String(uri || '').replace(/^file:\/\//i, '');
    const stat = await RNFS.stat(path);
    return { size: stat?.size ?? null };
  } catch {
    return null;
  }
};

const getImageDimensions = (uri: string) => new Promise<{ width: number; height: number } | null>(resolve => {
  Image.getSize(
    uri,
    (width, height) => resolve({ width, height }),
    () => resolve(null),
  );
});

const createStickerVariant = async (ImageResizer: any, sourceUri: string, detailSize: number, quality: number, format: string) => {
  if (detailSize === STICKER_DIMENSION) {
    return ImageResizer.createResizedImage(
      sourceUri,
      STICKER_DIMENSION,
      STICKER_DIMENSION,
      format,
      quality,
      0,
      undefined,
      false,
      { mode: 'contain' },
    );
  }

  const reduced = await ImageResizer.createResizedImage(
    sourceUri,
    detailSize,
    detailSize,
    format,
    Math.min(PREPASS_QUALITY, quality),
    0,
    undefined,
    false,
    { mode: 'contain' },
  );

  return ImageResizer.createResizedImage(
    reduced.uri,
    STICKER_DIMENSION,
    STICKER_DIMENSION,
    format,
    quality,
    0,
    undefined,
    false,
    { mode: 'contain' },
  );
};

export const tryUseOriginalSticker = async (sticker: any) => {
  const sourceUri = sticker?.uri || sticker?.originalUri;
  const normalized = normalizeFilePath(sourceUri);
  if (!normalized) return null;
  const ext = resolveExtension(sticker);
  if (ext !== 'webp') return null;

  const safeSources = new Set(['telegram', 'file-intent', 'whatsapp', 'telegram-bot']);
  const allowUnknown = safeSources.has(sticker?.source);

  const fileStat = await safeStat(normalized);
  if (fileStat?.size) {
    if (fileStat.size > STICKER_SIZE_LIMIT_BYTES) return null;
  } else if (!allowUnknown) {
    return null;
  }

  const dimensions = await getImageDimensions(normalized);
  if (dimensions) {
    if (dimensions.width !== STICKER_DIMENSION || dimensions.height !== STICKER_DIMENSION) return null;
  } else if (!allowUnknown) {
    return null;
  }

  return {
    ...sticker,
    uri: normalized,
    width: dimensions?.width ?? STICKER_DIMENSION,
    height: dimensions?.height ?? STICKER_DIMENSION,
    size: fileStat?.size ?? null,
    qualityUsed: 'original',
    status: createStatus('Ready for WhatsApp', 'success', { original: true }),
    format: 'WEBP',
  };
};

export const convertStaticSticker = async (sticker: any) => {
  const ImageResizer = getImageResizer();
  const format = 'WEBP';
  let lastError: any;
  const sourceUri = sticker?.uri || sticker?.originalUri;
  const normalizedSource = normalizeFilePath(sourceUri);
  const localSource = await ensureLocalFileUri(normalizedSource, sticker?.extension);
  if (!normalizedSource) throw new Error('Sticker path missing.');

  for (const detailSize of DETAIL_STEPS) {
    for (const quality of QUALITY_STEPS) {
      try {
        const resized = await createStickerVariant(
          ImageResizer,
          localSource,
          detailSize,
          quality,
          format,
        );
        const normalizedFinal = normalizeFilePath(resized.uri);
        const fileStat = await safeStat(normalizedFinal);
        if (fileStat && fileStat.size <= STICKER_SIZE_LIMIT_BYTES) {
          return {
            ...sticker,
            uri: normalizedFinal,
            width: resized.width ?? STICKER_DIMENSION,
            height: resized.height ?? STICKER_DIMENSION,
            size: fileStat?.size ?? null,
            qualityUsed: quality,
            status: createStatus('Ready for WhatsApp', 'success', { quality, detailSize }),
            format,
          };
        }
        lastError = new Error('File exceeds 100KB after resizing.');
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError ?? new Error('Unable to convert sticker.');
};

export const prepareAnimatedWebpSticker = async (sticker: any) => {
  const sourceUri = sticker?.uri || sticker?.originalUri;
  const normalized = normalizeFilePath(sourceUri);
  if (!normalized) throw new Error('Sticker path missing.');
  const fileStat = await safeStat(normalized);
  if (fileStat?.size && fileStat.size > ANIMATED_STICKER_SIZE_LIMIT_BYTES) {
    throw new Error('Animated sticker exceeds 1MB limit.');
  }
  return {
    ...sticker,
    uri: normalized,
    size: fileStat?.size ?? null,
    status: createStatus('Ready for WhatsApp', 'success', { animated: true }),
    format: 'WEBP',
    animated: true,
  };
};

const ensureCacheTarget = async (extension: string) => {
  const FileSystem = getExpoFileSystem();
  const RNFS = getRNFS();
  const expoBase = FileSystem?.cacheDirectory || FileSystem?.documentDirectory;
  const rnfsBase = RNFS?.CachesDirectoryPath || RNFS?.DocumentDirectoryPath || RNFS?.TemporaryDirectoryPath;
  const baseDir = expoBase || rnfsBase;

  if (!baseDir) throw new Error('Cache directory unavailable.');

  const dir = baseDir.endsWith('/') ? `${baseDir}animated-stickers` : `${baseDir}/animated-stickers`;
  if (FileSystem?.makeDirectoryAsync) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } else if (RNFS?.mkdir) {
    await RNFS.mkdir(dir);
  }

  const filename = `animated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const targetUri = `${dir}/${filename}`;
  const targetPath = stripFileScheme(targetUri);

  return {
    uri: normalizeFilePath(targetUri),
    path: targetPath,
  };
};

const statFile = async (uri: string) => {
  const FileSystem = getExpoFileSystem();
  try {
    if (FileSystem?.getInfoAsync) {
      const info = await FileSystem.getInfoAsync(normalizeFilePath(uri));
      if (info?.size) return info.size;
    }
  } catch {
    /* ignore */
  }
  try {
    const RNFS = getRNFS();
    if (!RNFS?.stat) return null;
    const path = stripFileScheme(uri);
    const stat = await RNFS.stat(path);
    return stat?.size ?? null;
  } catch {
    return null;
  }
};

const removeDir = async (dirPath: string) => {
  const FileSystem = getExpoFileSystem();
  if (FileSystem?.deleteAsync) {
    try {
      await FileSystem.deleteAsync(normalizeFilePath(dirPath), { idempotent: true });
      return;
    } catch {
      /* ignore */
    }
  }
  try {
    const RNFS = getRNFS();
    if (RNFS?.unlink) {
      await RNFS.unlink(dirPath);
    }
  } catch {
    /* ignore */
  }
};

const getFfmpegKit = () => {
  try {
    return require('ffmpeg-kit-react-native');
  } catch {
    return null;
  }
};

const quote = (value: string) => `"${String(value || '').replace(/"/g, '\\"')}"`;

const convertFramesToWebp = async ({
  framesDir,
  pattern,
  fps,
  maxSizeBytes,
}: {
  framesDir: string;
  pattern: string;
  fps: number;
  maxSizeBytes: number;
}) => {
  const kit = getFfmpegKit();
  if (!kit?.FFmpegKit) throw new Error('FFmpeg is not available in this build.');
  const { FFmpegKit, ReturnCode } = kit;
  const inputPattern = `${framesDir}/${pattern}`;
  let lastError: any = null;

  for (const quality of [70, 60, 50, 40, 30]) {
    const target = await ensureCacheTarget('webp');
    const args = [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      inputPattern,
      '-vcodec',
      'libwebp',
      '-compression_level',
      '6',
      '-q:v',
      String(quality),
      '-pix_fmt',
      'yuva420p',
      '-loop',
      '0',
      target.path,
    ];

    const session = await FFmpegKit.executeWithArgumentsAsync
      ? await FFmpegKit.executeWithArgumentsAsync(args)
      : await FFmpegKit.execute(args.map(String).map(quote).join(' '));
    const returnCode = await session.getReturnCode();
    if (!ReturnCode?.isSuccess(returnCode)) {
      let message = 'FFmpeg conversion failed.';
      try {
        const logs = await session.getAllLogsAsString?.(1000);
        if (logs && /Unknown encoder 'libwebp'/.test(String(logs))) {
          message = 'FFmpeg build is missing libwebp. Install an ffmpeg-kit full/full-gpl build that includes WebP encoders.';
        } else if (logs) {
          message = `${message}\n${String(logs).slice(-2000)}`;
        }
      } catch {
        /* ignore */
      }
      lastError = new Error(message);
      continue;
    }
    const sizeBytes = await statFile(target.uri);
    if (!sizeBytes || sizeBytes <= maxSizeBytes) {
      return {
        uri: target.uri,
        size: sizeBytes ?? null,
        quality,
      };
    }
    lastError = new Error('Animated sticker exceeds 1MB limit.');
  }

  throw lastError || new Error('Unable to create animated sticker.');
};

export const convertAnimatedSticker = async (sticker: any, options?: { maxDurationSeconds?: number; fps?: number }) => {
  const ext = resolveExtension(sticker);
  const sourceUri = sticker?.uri || sticker?.originalUri;
  const normalized = normalizeFilePath(sourceUri);
  if (!normalized) throw new Error('Sticker path missing.');

  const maxDurationSeconds = options?.maxDurationSeconds ?? 3;
  const targetFps = options?.fps ?? 15;

  if (ext === 'tgs') {
    if (!isTgsConverterAvailable()) {
      throw new Error('TGS conversion is not available in this build.');
    }
    const converter = NativeModules.TgsConverter;
    const localSource = await ensureLocalFileUri(normalized, 'tgs');
    const frameInfo = await converter.renderFrames(
      localSource,
      STICKER_DIMENSION,
      STICKER_DIMENSION,
      targetFps,
      maxDurationSeconds * 1000,
    );
    const result = await convertFramesToWebp({
      framesDir: frameInfo.framesDir,
      pattern: frameInfo.pattern || 'frame-%03d.png',
      fps: Math.round(frameInfo.fps || targetFps),
      maxSizeBytes: ANIMATED_STICKER_SIZE_LIMIT_BYTES,
    });
    await removeDir(frameInfo.framesDir);
    return {
      ...sticker,
      uri: result.uri,
      size: result.size ?? null,
      status: createStatus('Ready for WhatsApp', 'success', { animated: true }),
      format: 'WEBP',
      animated: true,
    };
  }

  if (!isFfmpegAvailable()) {
    throw new Error('FFmpeg is not available in this build.');
  }

  const localSource = await ensureLocalFileUri(normalized, ext || 'mp4');
  const result = await convertVideoToAnimatedWebp({
    uri: localSource,
    startSeconds: 0,
    durationSeconds: maxDurationSeconds,
    fps: targetFps,
    size: STICKER_DIMENSION,
    maxSizeBytes: ANIMATED_STICKER_SIZE_LIMIT_BYTES,
  });

  return {
    ...sticker,
    uri: result.uri,
    size: result.size ?? null,
    status: createStatus('Ready for WhatsApp', 'success', { animated: true }),
    format: 'WEBP',
    animated: true,
  };
};
