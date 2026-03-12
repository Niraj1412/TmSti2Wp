module.exports = {
  dependencies: {
    // Exclude outdated module that is incompatible with modern Gradle/AGP
    'react-native-multiple-image-picker': {
      platforms: {
        android: null,
      },
    },
  },
};
