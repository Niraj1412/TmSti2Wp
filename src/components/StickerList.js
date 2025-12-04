import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, radius } from '../styles/theme';

const StickerList = ({
  items = [],
  title = 'Selected stickers',
  selectable = false,
  selectedIds = [],
  onToggleSelect,
}) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  const selectedSet = new Set(
    Array.isArray(selectedIds) ? selectedIds : selectedIds ? Array.from(selectedIds) : [],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {selectable && (
        <Text style={styles.helper}>Tap a sticker to include or exclude it before converting.</Text>
      )}
      <View style={styles.grid}>
        {items.slice(0, 30).map(item => {
          const isSelected = selectable ? selectedSet.has(item.id) : true;
          const CellComponent = selectable ? Pressable : View;
          return (
            <CellComponent
              key={item.id || item.uri}
              style={[styles.cell, selectable && isSelected && styles.cellSelected]}
              onPress={selectable ? () => onToggleSelect?.(item) : undefined}
            >
              <Image source={{ uri: item.uri || item.originalUri }} style={styles.thumb} resizeMode="cover" />
              {selectable && (
                <View style={[styles.check, isSelected ? styles.checkOn : styles.checkOff]}>
                  <Text style={[styles.checkLabel, isSelected ? styles.checkLabelOn : styles.checkLabelOff]}>
                    {isSelected ? '✓' : '+'}
                  </Text>
                </View>
              )}
            </CellComponent>
          );
        })}
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
  title: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing(0.35) },
  helper: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing(0.75) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing(0.5) },
  cell: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    overflow: 'hidden',
    margin: spacing(0.5),
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cellSelected: { borderColor: colors.primaryAccent },
  thumb: { width: '100%', height: '100%' },
  caption: { ...typography.caption, marginTop: spacing(0.5), color: colors.textSecondary },
  check: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primaryAccent },
  checkOff: { backgroundColor: colors.surface },
  checkLabel: { ...typography.caption, fontWeight: '700' },
  checkLabelOn: { color: colors.surface },
  checkLabelOff: { color: colors.textPrimary },
});

export default StickerList;
