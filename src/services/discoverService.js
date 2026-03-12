import {
  DISCOVER_PACKS_TABLE,
  DISCOVER_STICKERS_TABLE,
  DISCOVER_STORAGE_PUBLIC_BASE_URL,
  DISCOVER_SUPABASE_ANON_KEY,
  DISCOVER_SUPABASE_URL,
} from '../config/discoverConfig';

const normalizeBaseUrl = value => String(value || '').trim().replace(/\/+$/, '');

const getAuthHeaders = () => ({
  apikey: DISCOVER_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${DISCOVER_SUPABASE_ANON_KEY}`,
});

const asArray = value => (Array.isArray(value) ? value : []);

const toSafeNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveRemoteUri = value => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^(https?:\/\/|file:\/\/|content:\/\/)/i.test(raw)) return raw;

  const base = normalizeBaseUrl(DISCOVER_STORAGE_PUBLIC_BASE_URL);
  if (!base) return null;
  return `${base}/${raw.replace(/^\/+/, '')}`;
};

const buildStickerModel = (row, index) => {
  const assetUri = resolveRemoteUri(row?.asset_url);
  const previewUri = resolveRemoteUri(row?.preview_url);
  const fallbackUri = assetUri || previewUri || null;
  return {
    id: String(row?.id || `sticker-${index}`),
    uri: fallbackUri,
    originalUri: fallbackUri,
    // Keep paused preview strictly static; never fallback to animated asset uri.
    previewImageUri: previewUri || null,
    animated: Boolean(row?.is_animated),
    source: 'discover',
  };
};

const buildPackModel = (row, stickers) => {
  const list = asArray(stickers).filter(item => Boolean(item?.uri || item?.previewImageUri));
  const firstSticker = list[0] || null;
  const firstAnimated = list.find(item => item?.animated) || null;
  const trayIconUri = resolveRemoteUri(row?.tray_icon_url);
  const previewImageUri = resolveRemoteUri(row?.preview_image_url)
    || trayIconUri
    || firstSticker?.previewImageUri
    || firstSticker?.uri
    || null;
  const isAnimated = Boolean(row?.is_animated) || list.some(item => item?.animated);
  const remoteCount = toSafeNumber(row?.sticker_count || row?.stickers_count || row?.count);

  return {
    id: String(row?.id || ''),
    title: String(row?.title || 'Sticker Pack'),
    author: String(row?.author || ''),
    count: list.length || remoteCount,
    stickers: list,
    isAnimated,
    trayIconUri,
    previewImageUri,
    previewUri: previewImageUri || firstSticker?.uri || null,
    animatedPreviewUri: resolveRemoteUri(row?.animated_preview_url) || firstAnimated?.uri || null,
    source: 'discover',
    discover: {
      tags: asArray(row?.tags).map(tag => String(tag)),
      downloadsCount: toSafeNumber(row?.downloads_count),
      createdAt: row?.created_at || null,
    },
  };
};

const buildApiUrl = (baseUrl, table) => `${baseUrl}/rest/v1/${table}`;

export const isDiscoverConfigured = () => (
  Boolean(normalizeBaseUrl(DISCOVER_SUPABASE_URL))
  && Boolean(String(DISCOVER_SUPABASE_ANON_KEY || '').trim())
);

export const fetchDiscoverPacks = async ({ limit = 30, offset = 0, includeStickers = false } = {}) => {
  if (!isDiscoverConfigured()) {
    return {
      packs: [],
      error: 'Discover is not configured. Set Supabase URL/key in src/config/discoverConfig.js.',
      hasMore: false,
    };
  }

  const baseUrl = normalizeBaseUrl(DISCOVER_SUPABASE_URL);
  const headers = getAuthHeaders();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);

  try {
    const packsUrl = new URL(buildApiUrl(baseUrl, DISCOVER_PACKS_TABLE));
    packsUrl.searchParams.set(
      'select',
      'id,title,author,is_animated,tags,tray_icon_url,downloads_count,created_at',
    );
    packsUrl.searchParams.set('order', 'created_at.desc');
    packsUrl.searchParams.set('limit', String(safeLimit));
    packsUrl.searchParams.set('offset', String(safeOffset));

    const packsResponse = await fetch(packsUrl.toString(), { headers });
    if (!packsResponse.ok) {
      throw new Error(`Failed to load packs (${packsResponse.status}).`);
    }

    const packRows = asArray(await packsResponse.json());
    if (packRows.length === 0) return { packs: [], error: null, hasMore: false };

    let packs = [];

    if (!includeStickers) {
      packs = packRows
        .map(packRow => buildPackModel(packRow, []))
        .filter(pack => Boolean(pack?.id && pack?.title));
    } else {
      const packIds = packRows
        .map(row => String(row?.id || '').trim())
        .filter(Boolean)
        .map(id => id.replace(/,/g, ''));

      let stickerRows = [];
      if (packIds.length > 0) {
        const stickersUrl = new URL(buildApiUrl(baseUrl, DISCOVER_STICKERS_TABLE));
        stickersUrl.searchParams.set('select', 'id,pack_id,position,asset_url,preview_url,is_animated');
        stickersUrl.searchParams.set('pack_id', `in.(${packIds.join(',')})`);
        stickersUrl.searchParams.set('order', 'position.asc');

        const stickersResponse = await fetch(stickersUrl.toString(), { headers });
        if (!stickersResponse.ok) {
          throw new Error(`Failed to load stickers (${stickersResponse.status}).`);
        }
        stickerRows = asArray(await stickersResponse.json());
      }

      const stickersByPackId = new Map();
      stickerRows.forEach((row, index) => {
        const packId = String(row?.pack_id || '').trim();
        if (!packId) return;
        const existing = stickersByPackId.get(packId) || [];
        existing.push({ ...row, __order: index });
        stickersByPackId.set(packId, existing);
      });

      packs = packRows
        .map(packRow => {
          const packId = String(packRow?.id || '').trim();
          const sortedRows = asArray(stickersByPackId.get(packId)).sort((a, b) => {
            const diff = toSafeNumber(a?.position) - toSafeNumber(b?.position);
            return diff !== 0 ? diff : toSafeNumber(a?.__order) - toSafeNumber(b?.__order);
          });
          const stickers = sortedRows.map((row, index) => buildStickerModel(row, index));
          return buildPackModel(packRow, stickers);
        })
        .filter(pack => Boolean(pack?.id && pack?.title));
    }

    return { packs, error: null, hasMore: packRows.length === safeLimit };
  } catch (error) {
    return {
      packs: [],
      error: error?.message || 'Failed to load discover packs.',
      hasMore: false,
    };
  }
};

export const fetchDiscoverPackStickers = async ({ packId, limit = 120 } = {}) => {
  const safePackId = String(packId || '').trim();
  if (!safePackId) return { stickers: [], error: 'Missing pack id.' };
  if (!isDiscoverConfigured()) {
    return {
      stickers: [],
      error: 'Discover is not configured. Set Supabase URL/key in src/config/discoverConfig.js.',
    };
  }

  const baseUrl = normalizeBaseUrl(DISCOVER_SUPABASE_URL);
  const headers = getAuthHeaders();
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 120));

  try {
    const stickersUrl = new URL(buildApiUrl(baseUrl, DISCOVER_STICKERS_TABLE));
    stickersUrl.searchParams.set('select', 'id,pack_id,position,asset_url,preview_url,is_animated');
    stickersUrl.searchParams.set('pack_id', `eq.${safePackId}`);
    stickersUrl.searchParams.set('order', 'position.asc');
    stickersUrl.searchParams.set('limit', String(safeLimit));

    const response = await fetch(stickersUrl.toString(), { headers });
    if (!response.ok) {
      throw new Error(`Failed to load stickers (${response.status}).`);
    }

    const rows = asArray(await response.json());
    const stickers = rows.map((row, index) => buildStickerModel(row, index));
    return { stickers, error: null };
  } catch (error) {
    return {
      stickers: [],
      error: error?.message || 'Failed to load pack stickers.',
    };
  }
};
