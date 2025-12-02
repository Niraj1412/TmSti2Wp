import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, radius } from '../styles/theme';

const StickerList = ({ items = [], title = 'Selected stickers' }) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.grid}>
        {items.slice(0, 30).map(item => (
          <View key={item.id || item.uri} style={styles.cell}>
            <Image source={{ uri: item.uri || item.originalUri }} style={styles.thumb} resizeMode="cover" />
          </View>
        ))}
      </View>
      {items.length > 30 && (
        <Text style={styles.caption}>+{items.length - 30} more</Text>
      )}
    </View>
  );
};

const SIZE = 64;

const styles = StyleSheet.create({
  container: { marginTop: spacing(1.25) },
  title: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing(1) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing(0.5) },
  cell: { width: SIZE, height: SIZE, borderRadius: radius.md, overflow: 'hidden', margin: spacing(0.5), backgroundColor: colors.surfaceElevated },
  thumb: { width: '100%', height: '100%' },
  caption: { ...typography.caption, marginTop: spacing(0.5), color: colors.textSecondary },
});

export default StickerList;

