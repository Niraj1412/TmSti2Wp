import RNWSManager from 'react-native-whatsapp-stickers-manager';

const stripFileScheme = (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/^file:\/\//i, '');
};

export const createWhatsAppPack = async ({
  name,
  publisher,
  trayImage,
  stickers,
  animated,
}: {
  name: string;
  publisher: string;
  trayImage: string;
  stickers: Array<{ path: string; emojis?: string[] }>;
  animated: boolean;
}) => {
  const payload = {
    android_play_store_link: '',
    ios_app_store_link: '',
    publisher_email: '',
    publisher_website: '',
    privacy_policy_website: '',
    license_agreement_website: '',
    name,
    publisher,
    tray_image_file: stripFileScheme(trayImage),
    image_data_version: String(Date.now()),
    avoid_cache: false,
    animated_sticker_pack: animated,
    stickers: stickers.map(item => ({
      image_file: stripFileScheme(item.path),
      emojis: Array.isArray(item.emojis) ? item.emojis : [],
    })),
  };

  return RNWSManager.Pack.createPack(payload);
};

export const addPackToWhatsApp = async ({
  identifier,
  name,
}: {
  identifier: number;
  name: string;
}) => {
  return RNWSManager.Pack.addPackToWhatsApp({ identifier, name });
};

export const isPackAddedToWhatsApp = async ({
  identifier,
  includeExtraPackages = [],
}: {
  identifier: number;
  includeExtraPackages?: string[];
}) => {
  return RNWSManager.Pack.isPackAddedToWhatsApp({ identifier, includeExtraPackages });
};
