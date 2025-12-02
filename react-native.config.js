module.exports = {
  dependencies: {
    // Exclude outdated module that is incompatible with modern Gradle/AGP
    'react-native-multiple-image-picker': {
      platforms: {
        android: null,
      },
    },
    // Exclude WhatsApp stickers manager (not compatible with RN 0.81 codegen)
    'react-native-whatsapp-stickers-manager': {
      platforms: {
        android: null,
      },
    },
  },
};
