import React from 'react';
import renderer, { act } from 'react-test-renderer';
import TelegramImporter from '../src/components/TelegramImporter';
import { buildStickerFromPath } from '../src/utils/stickerUtils';
import { Pressable, Alert, Platform } from 'react-native';
import * as fsProxy from '../src/utils/fsProxy';

jest.mock('react-native-permissions', () => {
  const RESULTS = { GRANTED: 'granted', LIMITED: 'limited' };
  return {
    RESULTS,
    PERMISSIONS: { ANDROID: { READ_MEDIA_IMAGES: 'READ_MEDIA_IMAGES', READ_EXTERNAL_STORAGE: 'READ_EXTERNAL_STORAGE' } },
    check: jest.fn(() => Promise.resolve(RESULTS.GRANTED)),
    request: jest.fn(() => Promise.resolve(RESULTS.GRANTED)),
  };
});

jest.mock('../src/utils/fsProxy', () => {
  let rnfs = null;
  let error = new Error('react-native-fs native module appears to be unlinked.');
  return {
    __setRNFS: value => { rnfs = value; },
    __setError: value => { error = value; },
    getRNFS: () => rnfs,
    getRNFSError: () => error,
  };
});

jest.mock('expo-file-system', () => {
  const fs = {
    readDirectoryAsync: jest.fn(),
    getInfoAsync: jest.fn(),
    StorageAccessFramework: {
      requestDirectoryPermissionsAsync: jest.fn(),
      readDirectoryAsync: jest.fn(),
    },
    __reset: () => {
      fs.readDirectoryAsync.mockReset();
      fs.getInfoAsync.mockReset();
      fs.StorageAccessFramework.requestDirectoryPermissionsAsync.mockReset();
      fs.StorageAccessFramework.readDirectoryAsync.mockReset();
    },
  };
  return fs;
});

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

describe('TelegramImporter', () => {
  const expoFs = require('expo-file-system');

  beforeEach(() => {
    jest.clearAllMocks();
    fsProxy.__setRNFS(null);
    expoFs.__reset();
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    Object.defineProperty(Platform, 'Version', { value: 33 });
  });

  test('imports via RNFS and skips already present stickers', async () => {
    const onImported = jest.fn();
    const existing = [
      buildStickerFromPath(
        '/storage/emulated/0/Android/data/org.telegram.messenger/files/stickers/st1.webp',
        { source: 'telegram' },
      ),
    ];

    const mockRNFS = {
      readDir: jest.fn(async () => [
        { isDirectory: () => false, name: 'st1.webp', path: '/storage/emulated/0/Android/data/org.telegram.messenger/files/stickers/st1.webp' },
        { isDirectory: () => false, name: 'st2.png', path: '/storage/emulated/0/Android/data/org.telegram.messenger/files/stickers/st2.png' },
      ]),
    };
    fsProxy.__setRNFS(mockRNFS);

    let tree;
    await act(async () => {
      tree = renderer.create(<TelegramImporter onImported={onImported} existingStickers={existing} />);
    });
    const button = tree.root.findByProps({ title: 'Import Telegram Stickers' });

    await act(async () => {
      button.props.onPress();
      await flushMicrotasks();
    });

    expect(mockRNFS.readDir).toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledTimes(1);
    const imported = onImported.mock.calls[0][0];
    expect(imported).toHaveLength(1);
    expect(imported[0].uri).toContain('st2.png');
  });

  test('uses SAF fallback when RNFS is unavailable', async () => {
    const onImported = jest.fn();
    fsProxy.__setRNFS(null);

    expoFs.StorageAccessFramework.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://root' });
    expoFs.StorageAccessFramework.readDirectoryAsync.mockImplementation(async () => ['content://root/sticker3.webp']);
    expoFs.getInfoAsync.mockResolvedValue({ isDirectory: false });

    let tree;
    await act(async () => {
      tree = renderer.create(<TelegramImporter onImported={onImported} existingStickers={[]} />);
    });
    const button = tree.root.findByProps({ title: 'Import Telegram Stickers' });

    await act(async () => {
      button.props.onPress();
      await flushMicrotasks();
    });

    expect(expoFs.StorageAccessFramework.requestDirectoryPermissionsAsync).toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledTimes(1);
    const imported = onImported.mock.calls[0][0];
    expect(imported[0].uri).toContain('sticker3.webp');
  });
});
