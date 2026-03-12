import JSZip from 'jszip';
import { NativeModules } from 'react-native';
import { getFileExtension } from './stickerUtils';
import { getRNFS } from './fsProxy';
import { USE_NATIVE_UNZIP } from '../config/importConfig';

const SUPPORTED_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif', 'tgs', 'webm', 'mp4'];
const MAX_STICKERS = 30;
const YIELD_EVERY = 1;

const yieldToJs = () => new Promise(resolve => setTimeout(resolve, 0));

const decodeUri = uri => {
  if (!uri) return '';
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
};

const getExtensionFromUri = uri => {
  const cleaned = decodeUri(uri).split('?')[0].split('#')[0];
  return getFileExtension(cleaned);
};

const isZipMime = mimeType => {
  if (!mimeType || typeof mimeType !== 'string') return false;
  const value = mimeType.toLowerCase();
  return value.includes('zip') || value.includes('x-zip-compressed');
};

const isTgsMime = mimeType => {
  if (!mimeType || typeof mimeType !== 'string') return false;
  const value = mimeType.toLowerCase();
  return value.includes('x-tgsticker') || value.includes('tgsticker') || value.includes('tgs');
};

const sanitizeName = (name, index, extension) => {
  const base = (name || '').split('/').pop()?.split('\\').pop() || '';
  const sanitized = base.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (sanitized) {
    if (extension && !sanitized.toLowerCase().endsWith(`.${extension}`)) {
      return `${sanitized}.${extension}`;
    }
    return sanitized;
  }
  return `sticker-${index}.${extension || 'webp'}`;
};

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

const normalizeFileUri = value => {
  if (!value || typeof value !== 'string') return '';
  if (/^(file|content):\/\//i.test(value)) return value;
  return `file://${value}`;
};

const stripFileScheme = value => String(value || '').replace(/^file:\/\//i, '');

const getZipArchive = () => {
  if (!USE_NATIVE_UNZIP) return null;
  const RNZipArchive = NativeModules?.RNZipArchive;
  if (!RNZipArchive || typeof RNZipArchive.unzip !== 'function') return null;
  return {
    unzip: (source, target) => RNZipArchive.unzip(stripFileScheme(source), stripFileScheme(target), 'UTF-8'),
  };
};

const getBaseDirectory = (FileSystem, RNFS) => {
  const expoBase = FileSystem?.documentDirectory || FileSystem?.cacheDirectory;
  if (expoBase) return { type: 'expo', baseDir: expoBase };
  const rnfsBase = RNFS?.DocumentDirectoryPath
    || RNFS?.ExternalDirectoryPath
    || RNFS?.CachesDirectoryPath
    || RNFS?.ExternalCachesDirectoryPath
    || RNFS?.TemporaryDirectoryPath;
  if (rnfsBase) return { type: 'rnfs', baseDir: rnfsBase };
  return null;
};

const ensureLocalUri = async (FileSystem, uri, fallbackExtension = 'dat') => {
  if (!uri) throw new Error('Missing file URI.');
  if (/^file:\/\//i.test(uri)) return uri;
  const RNFS = getRNFS();
  const base = getBaseDirectory(FileSystem, RNFS);
  if (!base) throw new Error('Cache directory unavailable.');
  const ext = getExtensionFromUri(uri) || fallbackExtension;

  if (base.type === 'expo' && FileSystem?.makeDirectoryAsync) {
    const dir = `${base.baseDir}incoming/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const target = `${dir}import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    if (/^https?:\/\//i.test(uri) && FileSystem?.downloadAsync) {
      await FileSystem.downloadAsync(uri, target);
    } else {
      await FileSystem.copyAsync({ from: uri, to: target });
    }
    return target;
  }

  if (!RNFS) throw new Error('Cache directory unavailable.');
  const dir = `${base.baseDir}/incoming`;
  await RNFS.mkdir(dir);
  const target = `${dir}/import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const targetUri = normalizeFileUri(target);
  if (/^https?:\/\//i.test(uri) && RNFS?.downloadFile) {
    await RNFS.downloadFile({ fromUrl: uri, toFile: target }).promise;
    return targetUri;
  }
  if (/^content:\/\//i.test(uri) && FileSystem?.copyAsync) {
    await FileSystem.copyAsync({ from: uri, to: targetUri });
    return targetUri;
  }
  await RNFS.copyFile(uri, target);
  return targetUri;
};

const listFilesRecursive = async (dirPath, FileSystem, RNFS) => {
  if (RNFS?.readDir) {
    const entries = await RNFS.readDir(dirPath);
    const output = [];
    for (const entry of entries) {
      if (entry.isFile && entry.isFile()) {
        output.push(entry.path);
      } else if (entry.isDirectory && entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        const nested = await listFilesRecursive(entry.path, FileSystem, RNFS);
        output.push(...nested);
      }
    }
    return output;
  }

  if (FileSystem?.readDirectoryAsync && FileSystem?.getInfoAsync) {
    const names = await FileSystem.readDirectoryAsync(normalizeFileUri(dirPath));
    const output = [];
    for (const name of names) {
      const child = `${dirPath.replace(/\/$/, '')}/${name}`;
      // eslint-disable-next-line no-await-in-loop
      const info = await FileSystem.getInfoAsync(normalizeFileUri(child));
      if (info?.isDirectory) {
        // eslint-disable-next-line no-await-in-loop
        const nested = await listFilesRecursive(child, FileSystem, RNFS);
        output.push(...nested);
      } else if (info?.exists) {
        output.push(child);
      }
    }
    return output;
  }

  return [];
};

const fileExists = async (path, FileSystem, RNFS) => {
  if (!path) return false;
  if (RNFS?.exists) {
    try {
      return await RNFS.exists(path);
    } catch {
      return false;
    }
  }
  if (FileSystem?.getInfoAsync) {
    try {
      const info = await FileSystem.getInfoAsync(normalizeFileUri(path));
      return Boolean(info?.exists);
    } catch {
      return false;
    }
  }
  return false;
};

const extractStickerFilesFromZipNative = async (uri, FileSystem, RNFS, base) => {
  if (!USE_NATIVE_UNZIP) return null;
  const zipArchive = getZipArchive();
  if (!zipArchive?.unzip) return null;

  const localZipUri = await ensureLocalUri(FileSystem, uri, 'zip');
  const sourcePath = stripFileScheme(localZipUri);
  const sourceOk = await fileExists(sourcePath, FileSystem, RNFS);
  if (!sourceOk) return null;
  const basePath = base.type === 'expo'
    ? stripFileScheme(base.baseDir)
    : base.baseDir;
  const outputDir = `${basePath.replace(/\/$/, '')}/sticker-pack-${Date.now()}`;
  const outputDirUri = normalizeFileUri(outputDir);

  if (FileSystem?.makeDirectoryAsync) {
    await FileSystem.makeDirectoryAsync(outputDirUri, { intermediates: true });
  } else if (RNFS?.mkdir) {
    await RNFS.mkdir(outputDir);
  }

  await zipArchive.unzip(sourcePath, outputDir);

  const allFiles = await listFilesRecursive(outputDir, FileSystem, RNFS);
  const stickers = [];
  for (const filePath of allFiles) {
    if (stickers.length >= MAX_STICKERS) break;
    const extension = getFileExtension(filePath);
    if (!SUPPORTED_EXTENSIONS.includes(extension)) continue;
    stickers.push(normalizeFileUri(filePath));
  }
  return stickers;
};

export const isZipLikeUri = (uri, mimeType) => {
  if (isZipMime(mimeType)) return true;
  const ext = getExtensionFromUri(uri);
  return ['zip', 'wasticker', 'wastickers'].includes(ext);
};

export const isTgsLikeUri = (uri, mimeType) => {
  if (isTgsMime(mimeType)) return true;
  return getExtensionFromUri(uri) === 'tgs';
};

export const extractStickerFilesFromZip = async uri => {
  const FileSystem = getExpoFileSystem();
  const RNFS = getRNFS();
  if (!FileSystem && !RNFS) throw new Error('File system is not available in this build.');
  const base = getBaseDirectory(FileSystem, RNFS);
  if (!base) throw new Error('Cache directory unavailable.');

  try {
    const nativeResult = await extractStickerFilesFromZipNative(uri, FileSystem, RNFS, base);
    if (nativeResult && nativeResult.length > 0) return nativeResult;
  } catch {
    // Fall back to JSZip when native unzip fails.
  }

  const localZipUri = await ensureLocalUri(FileSystem, uri, 'zip');
  let base64 = null;
  if (FileSystem?.readAsStringAsync) {
    base64 = await FileSystem.readAsStringAsync(localZipUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else if (RNFS?.readFile) {
    base64 = await RNFS.readFile(localZipUri.replace(/^file:\/\//i, ''), 'base64');
  }
  if (!base64) throw new Error('Unable to read sticker pack.');
  const zip = await JSZip.loadAsync(base64, { base64: true });

  const outputBase = base.type === 'expo'
    ? `${base.baseDir}sticker-pack-${Date.now()}/`
    : `${base.baseDir}/sticker-pack-${Date.now()}`;
  if (base.type === 'expo' && FileSystem?.makeDirectoryAsync) {
    await FileSystem.makeDirectoryAsync(outputBase, { intermediates: true });
  } else if (RNFS?.mkdir) {
    await RNFS.mkdir(outputBase);
  }

  const files = [];
  const entries = Object.values(zip.files);
  let processed = 0;
  for (const entry of entries) {
    if (files.length >= MAX_STICKERS) break;
    if (entry.dir) continue;
    const extension = getFileExtension(entry.name);
    if (!SUPPORTED_EXTENSIONS.includes(extension)) continue;
    const data = await entry.async('base64');
    const filename = sanitizeName(entry.name, files.length + 1, extension);
    const target = base.type === 'expo'
      ? `${outputBase}${filename}`
      : `${outputBase}/${filename}`;
    if (FileSystem?.writeAsStringAsync) {
      await FileSystem.writeAsStringAsync(target, data, {
        encoding: FileSystem.EncodingType.Base64,
      });
      files.push(target);
    } else if (RNFS?.writeFile) {
      await RNFS.writeFile(target, data, 'base64');
      files.push(normalizeFileUri(target));
    }
    processed += 1;
    if (processed % YIELD_EVERY === 0) {
      await yieldToJs();
    }
  }

  return files;
};
