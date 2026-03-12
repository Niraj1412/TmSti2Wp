import { getRNFS } from './fsProxy';
import { normalizeFilePath } from './stickerUtils';

const DEFAULT_MAX_SIZE_BYTES = 1024 * 1024;
const DEFAULT_FPS = 15;
const DEFAULT_SIZE = 512;
const PREVIEW_FPS = 6;
const PREVIEW_SIZE = 192;
const PREVIEW_DURATION_SECONDS = 2.5;
const QUALITY_STEPS = [70, 60, 50, 40, 30];
// Prefer smoother playback: keep FPS, reduce size/quality first.
const PROFILE_STEPS = [
  { fps: 15, size: 512, qualities: [70, 60, 50] },
  { fps: 15, size: 480, qualities: [60, 50, 40, 30] },
  { fps: 15, size: 448, qualities: [50, 40, 30] },
  { fps: 12, size: 448, qualities: [40, 30, 25] },
  { fps: 10, size: 384, qualities: [35, 30, 25] },
];

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

const getFfmpegKit = () => {
  try {
    return require('ffmpeg-kit-react-native');
  } catch {
    return null;
  }
};

let logCallbackRegistered = false;
let animatedWebpDecodeUnsupported = false;
const registerFfmpegLogs = kit => {
  if (logCallbackRegistered) return;
  const config = kit?.FFmpegKitConfig;
  if (!config?.enableLogCallback) return;
  config.enableLogCallback(log => {
    try {
      const message = log?.getMessage?.() || String(log || '');
      if (message) console.log('[ffmpeg]', message.trim());
    } catch {
      /* ignore */
    }
  });
  logCallbackRegistered = true;
};

const stripFileScheme = value => String(value || '').replace(/^file:\/\//i, '');

const ensureCacheTarget = async extension => {
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

const statFile = async uri => {
  const FileSystem = getExpoFileSystem();
  try {
    if (FileSystem?.getInfoAsync) {
      const info = await FileSystem.getInfoAsync(normalizeFilePath(uri));
      if (typeof info?.size === 'number') return info.size;
    }
  } catch {
    /* ignore */
  }
  try {
    const RNFS = getRNFS();
    if (!RNFS?.stat) return null;
    const path = stripFileScheme(uri);
    if (RNFS?.exists) {
      const exists = await RNFS.exists(path);
      if (!exists) return null;
    }
    const stat = await RNFS.stat(path);
    return typeof stat?.size === 'number' ? stat.size : null;
  } catch {
    return null;
  }
};

const isSessionDone = (kit, state) => {
  const SessionState = kit?.SessionState;
  if (SessionState) {
    return state === SessionState.COMPLETED || state === SessionState.FAILED;
  }
  if (typeof state === 'string') {
    return /completed|failed/i.test(state);
  }
  if (typeof state === 'number') {
    return state >= 2;
  }
  return false;
};

const waitForSessionCompletion = async (kit, session, timeoutMs = 60000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await session.getState?.();
    const returnCode = await session.getReturnCode?.();
    const value = returnCode?.getValue?.();
    if (isSessionDone(kit, state) || typeof value === 'number') {
      return { state, returnCode, timedOut: false };
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const state = await session.getState?.();
  const returnCode = await session.getReturnCode?.();
  return { state, returnCode, timedOut: true };
};

const debugSession = async session => {
  try {
    const state = await session.getState?.();
    const returnCode = await session.getReturnCode?.();
    const rc = returnCode?.getValue?.() ?? returnCode;
    const rcSuccess = returnCode?.isValueSuccess?.();
    console.log('[video-sticker] FFmpeg state:', state, 'returnCode:', rc, 'returnCodeSuccess:', rcSuccess);
  } catch {
    /* ignore */
  }
};

const resolveReturnCodeSuccess = (ReturnCode, returnCode) => {
  try {
    if (ReturnCode?.isSuccess?.(returnCode)) return true;
  } catch {
    /* ignore */
  }
  try {
    if (returnCode?.isValueSuccess?.()) return true;
  } catch {
    /* ignore */
  }
  try {
    const value = returnCode?.getValue?.();
    if (typeof value === 'number') return value === 0;
  } catch {
    /* ignore */
  }
  if (typeof returnCode === 'number') return returnCode === 0;
  return false;
};

const waitForFileSize = async (uriOrPath, attempts = 40) => {
  for (let i = 0; i < attempts; i += 1) {
    const size = await statFile(uriOrPath);
    if (typeof size === 'number' && size > 0) return size;
    // Small delay before retrying.
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
};

const quote = value => `"${String(value || '').replace(/"/g, '\\"')}"`;

const executeFfmpeg = async (FFmpegKit, args) => {
  if (typeof FFmpegKit.executeWithArgumentsAsync === 'function') {
    return FFmpegKit.executeWithArgumentsAsync(args);
  }
  return FFmpegKit.execute(args.map(String).map(quote).join(' '));
};

const buildFfmpegError = async (session) => {
  let message = 'FFmpeg conversion failed.';
  let logs = '';
  try {
    const output = await session.getOutput?.();
    if (output) logs = String(output);
  } catch {
    /* ignore */
  }
  try {
    const allLogs = await session.getAllLogsAsString?.(1000);
    if (allLogs) logs = `${logs}\n${String(allLogs)}`;
  } catch {
    /* ignore */
  }
  if (logs) {
    if (/skipping unsupported chunk:\s*ANIM/i.test(logs) && /image data not found/i.test(logs)) {
      const error = new Error('This FFmpeg build cannot decode animated WEBP inputs.');
      error.code = 'E_ANIM_WEBP_UNSUPPORTED';
      return error;
    }
    if (/Unknown encoder 'libwebp'/.test(logs)) {
      return new Error('FFmpeg build is missing libwebp. Install an ffmpeg-kit full/full-gpl build that includes WebP encoders.');
    }
    if (/Unknown encoder 'libx264'/.test(logs)) {
      return new Error('FFmpeg build is missing the H.264 encoder (libx264).');
    }
    if (/Unknown encoder 'h264_mediacodec'/.test(logs)) {
      return new Error('Hardware H.264 encoder is not available on this device.');
    }
    if (/Unknown encoder 'mpeg4'/.test(logs)) {
      return new Error('FFmpeg build is missing the MPEG-4 encoder.');
    }
    if (/Invalid data found when processing input/.test(logs)) {
      return new Error('FFmpeg could not read this sticker file.');
    }
    message = `${message}\n${logs.slice(-2000)}`;
  }
  return new Error(message);
};

export const isFfmpegAvailable = () => Boolean(getFfmpegKit()?.FFmpegKit);

export const convertAnimatedWebpToMp4Preview = async ({
  uri,
  fps = PREVIEW_FPS,
  size = PREVIEW_SIZE,
  durationSeconds = PREVIEW_DURATION_SECONDS,
} = {}) => {
  if (!uri) throw new Error('Sticker URI missing.');
  const kit = getFfmpegKit();
  if (!kit?.FFmpegKit) throw new Error('FFmpeg is not available in this build.');

  registerFfmpegLogs(kit);
  const { FFmpegKit, ReturnCode } = kit;
  const inputPath = stripFileScheme(normalizeFilePath(uri));
  const inputLower = String(uri || '').toLowerCase();
  if (animatedWebpDecodeUnsupported && inputLower.endsWith('.webp')) {
    const error = new Error('Animated WEBP preview conversion is unavailable on this build.');
    error.code = 'E_ANIM_WEBP_UNSUPPORTED';
    throw error;
  }
  const inputExists = await statFile(inputPath);
  if (inputExists === null) {
    console.log('[video-preview] Input path not accessible:', inputPath);
  }

  const safeFps = Math.max(6, Number(fps) || PREVIEW_FPS);
  const safeSize = Math.max(192, Number(size) || PREVIEW_SIZE);
  const safeDuration = Math.max(1.5, Number(durationSeconds) || PREVIEW_DURATION_SECONDS);
  const filter = `fps=${safeFps},scale=${safeSize}:${safeSize}:force_original_aspect_ratio=decrease,pad=${safeSize}:${safeSize}:(ow-iw)/2:(oh-ih)/2:color=black`;

  const attempts = [
    {
      label: 'h264_mediacodec',
      args: ['-vcodec', 'h264_mediacodec', '-b:v', '600k'],
    },
    {
      label: 'libx264',
      args: [
        '-vcodec',
        'libx264',
        '-preset',
        'ultrafast',
        '-profile:v',
        'baseline',
        '-level',
        '3.0',
        '-crf',
        '28',
      ],
    },
    {
      label: 'mpeg4',
      args: ['-vcodec', 'mpeg4', '-qscale:v', '6'],
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    const target = await ensureCacheTarget('mp4');
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'info',
      '-stats',
      '-i',
      inputPath,
      '-vf',
      filter,
      '-t',
      String(safeDuration),
      '-an',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      ...attempt.args,
      target.path,
    ];

    console.log('[video-preview] Input:', inputPath);
    console.log('[video-preview] Output:', target.path);
    console.log('[video-preview] Attempt:', attempt.label);
    const session = await executeFfmpeg(FFmpegKit, args);
    const { state, returnCode, timedOut } = await waitForSessionCompletion(kit, session, 45000);
    if (timedOut) {
      console.log('[video-preview] FFmpeg wait timed out, last state:', state);
    }
    await debugSession(session);
    const isSuccess = resolveReturnCodeSuccess(ReturnCode, returnCode);
    const sizeBytes = await waitForFileSize(target.uri) || await waitForFileSize(target.path);
    console.log('[video-preview] FFmpeg success:', isSuccess, attempt.label);
    if (isSuccess && sizeBytes) {
      return { uri: target.uri, size: sizeBytes, fps: safeFps, sizeHint: safeSize };
    }
    lastError = await buildFfmpegError(session);
    if (lastError?.code === 'E_ANIM_WEBP_UNSUPPORTED') {
      animatedWebpDecodeUnsupported = true;
      break;
    }
  }

  throw lastError || new Error('Unable to generate preview video.');
};

export const extractAnimatedWebpPoster = async ({
  uri,
  size = PREVIEW_SIZE,
} = {}) => {
  if (!uri) throw new Error('Sticker URI missing.');
  const kit = getFfmpegKit();
  if (!kit?.FFmpegKit) throw new Error('FFmpeg is not available in this build.');

  registerFfmpegLogs(kit);
  const { FFmpegKit, ReturnCode } = kit;
  const inputPath = stripFileScheme(normalizeFilePath(uri));
  const inputExists = await statFile(inputPath);
  if (inputExists === null) {
    console.log('[poster-preview] Input path not accessible:', inputPath);
  }

  const safeSize = Math.max(256, Number(size) || PREVIEW_SIZE);
  const filter = `scale=${safeSize}:${safeSize}:force_original_aspect_ratio=decrease,pad=${safeSize}:${safeSize}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;

  const target = await ensureCacheTarget('png');
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'info',
    '-stats',
    '-i',
    inputPath,
    '-vf',
    filter,
    '-vframes',
    '1',
    '-f',
    'image2',
    target.path,
  ];

  console.log('[poster-preview] Input:', inputPath);
  console.log('[poster-preview] Output:', target.path);
  const session = await executeFfmpeg(FFmpegKit, args);
  const { state, returnCode, timedOut } = await waitForSessionCompletion(kit, session, 45000);
  if (timedOut) {
    console.log('[poster-preview] FFmpeg wait timed out, last state:', state);
  }
  await debugSession(session);
  const isSuccess = resolveReturnCodeSuccess(ReturnCode, returnCode);
  const sizeBytes = await waitForFileSize(target.uri) || await waitForFileSize(target.path);
  if (isSuccess && sizeBytes) {
    return { uri: target.uri, size: sizeBytes };
  }
  throw await buildFfmpegError(session);
};

export const convertVideoToAnimatedWebp = async ({
  uri,
  startSeconds = 0,
  durationSeconds = 3,
  fps = DEFAULT_FPS,
  size = DEFAULT_SIZE,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
} = {}) => {
  if (!uri) throw new Error('Video URI missing.');
  const kit = getFfmpegKit();
  if (!kit?.FFmpegKit) throw new Error('FFmpeg is not available in this build.');

  registerFfmpegLogs(kit);
  const { FFmpegKit, ReturnCode } = kit;
  const inputPath = stripFileScheme(normalizeFilePath(uri));
  const inputExists = await statFile(inputPath);
  if (inputExists === null) {
    console.log('[video-sticker] Input path not accessible:', inputPath);
  }
  const safeStart = Math.max(0, Number(startSeconds) || 0);
  const safeDuration = Math.max(0.5, Number(durationSeconds) || 0);
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
    throw new Error('Duration must be greater than 0.');
  }

  let lastError = null;

  for (const profile of PROFILE_STEPS) {
    const profileFps = Number(profile?.fps) || fps;
    const profileSize = Number(profile?.size) || size;
    const filter = `fps=${profileFps},scale=${profileSize}:${profileSize}:force_original_aspect_ratio=decrease,pad=${profileSize}:${profileSize}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;

    for (const quality of profile.qualities || QUALITY_STEPS) {
      const target = await ensureCacheTarget('webp');
      console.log('[video-sticker] FFmpeg input:', inputPath);
      console.log('[video-sticker] FFmpeg output:', target.path);
      console.log('[video-sticker] Profile', { fps: profileFps, size: profileSize, quality });
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'info',
        '-stats',
        '-ss',
        String(safeStart),
        '-t',
        String(safeDuration),
        '-i',
        inputPath,
        '-vf',
        filter,
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
        '-an',
        '-fps_mode',
        'vfr',
        target.path,
      ];

      const session = await executeFfmpeg(FFmpegKit, args);
      const { state, returnCode, timedOut } = await waitForSessionCompletion(kit, session, 90000);
      if (timedOut) {
        console.log('[video-sticker] FFmpeg wait timed out, last state:', state);
      }
      await debugSession(session);
      let sizeBytes = await waitForFileSize(target.uri);
      if (!sizeBytes) {
        sizeBytes = await waitForFileSize(target.path);
      }
      const isSuccess = resolveReturnCodeSuccess(ReturnCode, returnCode);
      console.log('[video-sticker] FFmpeg success:', isSuccess);
      console.log('[video-sticker] Output size (bytes):', sizeBytes);
      if (!isSuccess) {
        if (sizeBytes && sizeBytes > 0) {
          return {
            uri: target.uri,
            size: sizeBytes,
            quality,
            durationSeconds: safeDuration,
          };
        }
        lastError = await buildFfmpegError(session);
        continue;
      }
      if (!sizeBytes || sizeBytes <= maxSizeBytes) {
        return {
          uri: target.uri,
          size: sizeBytes ?? null,
          quality,
          durationSeconds: safeDuration,
        };
      }
      lastError = new Error(`Animated sticker exceeds 1MB limit (${sizeBytes} bytes).`);
    }
  }

  throw lastError || new Error('Unable to create animated sticker.');
};
