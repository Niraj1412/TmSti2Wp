import { getWSManager, isWSManagerAvailable, getWSManagerError } from '../utils/whatsappManagerProxy';
import { PACK_METADATA } from '../utils/constants';

const DEFAULT_PACK_PREFIX = 'Telegram Pack';

const normalizePath = path =>
  (typeof path === 'string' && path.length > 0 ? path.replace(/^file:\/\//, '') : '');

const buildPackName = () => {
  const timestamp = new Date().toISOString().replace(/[^\d]/g, '').slice(0, 14);
  return `${DEFAULT_PACK_PREFIX} ${timestamp}`;
};

const sanitizeStickers = stickers =>
  (Array.isArray(stickers) ? stickers : [])
    .map(item => {
      const path = normalizePath(item?.image_file ?? item?.uri);
      if (!path) {
        return null;
      }
      const emojis = Array.isArray(item?.emojis)
        ? item.emojis.filter(Boolean)
        : [];
      return {
        image_file: path,
        emojis: emojis.length > 0 ? emojis : ['\u{1F923}'],
      };
    })
    .filter(Boolean);

const buildStickerPackPayload = (name, trayPath, stickers) => {
  const metadata = PACK_METADATA ?? {};
  return {
    name,
    tray_image_file: trayPath,
    stickers,
    publisher: metadata.publisher ?? 'Sticker Converter',
    android_play_store_link: metadata.androidPlayStoreLink ?? '',
    ios_app_store_link: metadata.iosAppStoreLink ?? '',
    publisher_email: metadata.publisherEmail ?? '',
    publisher_website: metadata.publisherWebsite ?? '',
    privacy_policy_website: metadata.privacyPolicyWebsite ?? '',
    license_agreement_website: metadata.licenseAgreementWebsite ?? '',
    image_data_version: metadata.imageDataVersion ?? '1',
    avoid_cache: metadata.avoidCache ?? false,
    animated_sticker_pack: metadata.animatedStickerPack ?? false,
  };
};

export const createStickerPack = async (stickers, trayImagePath) => {
  if (!isWSManagerAvailable()) {
    const reason = getWSManagerError();
    return {
      success: false,
      error: reason?.message ?? 'WhatsApp pack manager not available in this environment.',
    };
  }

  const normalizedTray = normalizePath(trayImagePath);
  const normalizedStickers = sanitizeStickers(stickers);

  if (normalizedStickers.length < 3) {
    return {
      success: false,
      error: 'At least 3 stickers with emojis are required to create a pack.',
    };
  }

  if (!normalizedTray) {
    return {
      success: false,
      error: 'Missing tray image. Pick at least one sticker to use as tray icon.',
    };
  }

  const packName = buildPackName();
  const payload = buildStickerPackPayload(packName, normalizedTray, normalizedStickers);

  try {
    const RNWSManager = getWSManager();
    const result = await RNWSManager.Pack.createPack(payload);
    return {
      success: true,
      pack: {
        identifier: result?.identifier,
        name: result?.name ?? packName,
        trayImage: normalizedTray,
        stickers: normalizedStickers,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error?.message ?? 'Failed to create sticker pack.',
    };
  }
};

export const addPackToWhatsApp = async (identifier, name) => {
  if (!isWSManagerAvailable()) {
    const reason = getWSManagerError();
    return {
      success: false,
      message: reason?.message ?? 'WhatsApp pack manager not available in this environment.',
    };
  }

  if (typeof identifier !== 'number' || Number.isNaN(identifier)) {
    return {
      success: false,
      message: 'Invalid pack identifier.',
    };
  }

  try {
    const RNWSManager = getWSManager();
    const response = await RNWSManager.Pack.addPackToWhatsApp({
      identifier,
      name: name ?? '',
    });
    return {
      success: true,
      response,
    };
  } catch (error) {
    return {
      success: false,
      message: error?.message ?? 'Failed to add pack to WhatsApp.',
    };
  }
};
