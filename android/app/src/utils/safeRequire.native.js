// Native runtime helper returning known native modules lazily.
// Use static string requires inside call sites to satisfy Metro,
// but avoid importing modules until actually requested.

const REGISTRY = {
  'react-native-fs': () => {
    // eslint-disable-next-line global-require
    return require('react-native-fs');
  },
  'react-native-image-resizer': () => {
    // eslint-disable-next-line global-require
    return require('react-native-image-resizer');
  },
  'react-native-multiple-image-picker': () => {
    // eslint-disable-next-line global-require
    return require('react-native-multiple-image-picker');
  },
  'react-native-whatsapp-stickers-manager': () => {
    // eslint-disable-next-line global-require
    return require('react-native-whatsapp-stickers-manager');
  },
  'react-native-permissions': () => {
    // eslint-disable-next-line global-require
    return require('react-native-permissions');
  },
};

export const tryRequire = moduleName => {
  try {
    const loader = REGISTRY[moduleName];
    if (!loader) return null;
    return loader();
  } catch (_) {
    return null;
  }
};
