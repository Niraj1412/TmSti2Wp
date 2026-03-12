import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StickerApp from './src/screens/StickerApp';
import { colors } from './src/styles/theme';

class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, { error?: Error | null }> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: colors.textPrimary, fontSize: 16, marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {this.state.error?.message ?? 'Unknown error'}
          </Text>
        </View>
      );
    }
    return this.props.children as any;
  }
}

const App = () => (
  <View style={styles.root}>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <SafeAreaView style={styles.safeArea}>
      <ErrorBoundary>
        <StickerApp />
      </ErrorBoundary>
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
