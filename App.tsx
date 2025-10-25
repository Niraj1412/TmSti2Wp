import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View } from 'react-native';
import HomeScreen from './android/app/src/screens/HomeScreen';
import { colors } from './android/app/src/styles/theme';

const App = () => (
  <View style={styles.root}>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <SafeAreaView style={styles.safeArea}>
      <HomeScreen />
    </SafeAreaView>
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
});

export default App;
